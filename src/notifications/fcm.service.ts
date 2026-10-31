import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
// firebase-admin v14 is modular only — the old `admin.credential` / `admin.messaging()`
// namespace no longer exists on the default export.
import { App, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import { SettingsService } from '../settings/settings.service';

/** Must match the channel the Flutter app creates (mobile/lib/main.dart). */
const ANDROID_CHANNEL_ID = 'gog_default';

/** Heads-up delivery on Android, sound on iOS — shared by every send. */
const PLATFORM_OPTIONS = {
  android: { priority: 'high', notification: { channelId: ANDROID_CHANNEL_ID, sound: 'default' } },
  apns: { payload: { aps: { sound: 'default' } } },
} as const;

/** Own named app, so it never collides with any other firebase-admin initialization. */
const APP_NAME = 'gog-fcm';
/** How long a Settings read is trusted before checking for an updated key. */
const SETTINGS_TTL_MS = 60 * 1000;

type ServiceAccount = { project_id?: string; client_email?: string; private_key?: string };

/**
 * Fallback when Settings has no key: FIREBASE_SERVICE_ACCOUNT_PATH (the JSON file), or
 * FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.
 */
function envServiceAccountJson(): string {
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (file) return fs.readFileSync(file, 'utf8');
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) return '';
  return JSON.stringify({
    project_id: FIREBASE_PROJECT_ID,
    client_email: FIREBASE_CLIENT_EMAIL,
    private_key: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
}

/**
 * Credentials come from Settings > Integrations > Firebase Push Notifications (the
 * service-account JSON the admin pastes/uploads), falling back to backend env. Resolved
 * lazily and re-checked every minute, so saving a new key in Settings takes effect
 * without a server restart.
 */
@Injectable()
export class FcmService {
  private firebaseApp: App | null = null;
  private messaging: Messaging | null = null;
  private activeJson = '';
  private checkedAt = 0;
  private resolving: Promise<Messaging | null> | null = null;

  constructor(private settings: SettingsService) {}

  private async _getMessaging(): Promise<Messaging | null> {
    if (Date.now() - this.checkedAt < SETTINGS_TTL_MS) return this.messaging;
    this.resolving ??= this._refresh().finally(() => (this.resolving = null));
    return this.resolving;
  }

  private async _refresh(): Promise<Messaging | null> {
    let json = '';
    try {
      json = (await this.settings.getFirebaseServiceAccountJson()) || envServiceAccountJson();
    } catch (err) {
      console.error('[FcmService] Could not read Firebase credentials:', err.message);
    }
    this.checkedAt = Date.now();
    if (json === this.activeJson) return this.messaging;

    await this._teardown();
    this.activeJson = json;
    if (!json) {
      console.warn(
        '[FcmService] ⚠️ Firebase not configured — pushes to the Flutter app will NOT be delivered. ' +
          'Add the service-account JSON in Settings > Integrations > Firebase Push Notifications.',
      );
      return null;
    }

    try {
      const sa: ServiceAccount = JSON.parse(json);
      this.firebaseApp = initializeApp(
        {
          credential: cert({
            projectId: sa.project_id,
            clientEmail: sa.client_email,
            privateKey: sa.private_key?.replace(/\\n/g, '\n'),
          }),
        },
        APP_NAME,
      );
      this.messaging = getMessaging(this.firebaseApp);
      console.log(`[FcmService] ✅ Firebase Admin ready (project ${sa.project_id})`);
    } catch (err) {
      console.error('[FcmService] Invalid Firebase service account:', err.message);
    }
    return this.messaging;
  }

  private async _teardown() {
    const app = this.firebaseApp;
    this.firebaseApp = null;
    this.messaging = null;
    if (app) await deleteApp(app).catch(() => {});
  }

  async sendToDevice(token: string, title: string, body: string, data?: Record<string, string>) {
    const messaging = await this._getMessaging();
    if (!messaging) {
      console.log(`[FcmService] Skipped push to token ${token}: ${title} — ${body}`);
      return { success: false, reason: 'Firebase not configured' };
    }

    try {
      const result = await messaging.send({
        token,
        notification: { title, body },
        data: data || {},
        ...PLATFORM_OPTIONS,
      });
      return { success: true, messageId: result };
    } catch (err) {
      console.error('[FcmService] Push notification failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async sendToTopic(topic: string, title: string, body: string, data?: Record<string, string>) {
    const messaging = await this._getMessaging();
    if (!messaging) {
      console.log(`[FcmService] Skipped push to topic ${topic}: ${title} — ${body}`);
      return { success: false, reason: 'Firebase not configured' };
    }

    try {
      const result = await messaging.send({
        topic,
        notification: { title, body },
        data: data || {},
        ...PLATFORM_OPTIONS,
      });
      return { success: true, messageId: result };
    } catch (err) {
      console.error('[FcmService] Topic push failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async sendToMultiple(tokens: string[], title: string, body: string, data?: Record<string, string>) {
    if (tokens.length === 0) return { success: false, reason: 'No tokens' };
    const messaging = await this._getMessaging();
    if (!messaging) {
      console.warn(`[FcmService] Skipped push to ${tokens.length} Flutter device(s): Firebase not configured`);
      return { success: false, reason: 'Firebase not configured (Settings > Integrations)' };
    }

    try {
      const result = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: data || {},
        ...PLATFORM_OPTIONS,
      });
      result.responses.forEach((r: any, i: number) => {
        if (!r.success) console.warn(`[FcmService] token …${tokens[i].slice(-8)} rejected: ${r.error?.code}`);
      });
      return {
        success: true,
        successCount: result.successCount,
        failureCount: result.failureCount,
      };
    } catch (err) {
      console.error('[FcmService] Multicast push failed:', err.message);
      return { success: false, error: err.message };
    }
  }
}
