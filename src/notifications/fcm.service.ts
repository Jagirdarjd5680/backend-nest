import { Injectable } from '@nestjs/common';

@Injectable()
export class FcmService {
  private firebaseApp: any = null;
  private messaging: any = null;

  constructor() {
    this._initialize();
  }

  private _initialize() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      console.warn('[FcmService] Firebase credentials not configured. Push notifications will be skipped.');
      return;
    }

    try {
      const admin = require('firebase-admin');
      if (!admin.apps.length) {
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        });
      } else {
        this.firebaseApp = admin.apps[0];
      }
      this.messaging = admin.messaging(this.firebaseApp);
    } catch (err) {
      console.error('[FcmService] Failed to initialize Firebase Admin SDK:', err.message);
    }
  }

  async sendToDevice(token: string, title: string, body: string, data?: Record<string, string>) {
    if (!this.messaging) {
      console.log(`[FcmService] Skipped push to token ${token}: ${title} — ${body}`);
      return { success: false, reason: 'Firebase not configured' };
    }

    try {
      const result = await this.messaging.send({
        token,
        notification: { title, body },
        data: data || {},
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      return { success: true, messageId: result };
    } catch (err) {
      console.error('[FcmService] Push notification failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async sendToTopic(topic: string, title: string, body: string, data?: Record<string, string>) {
    if (!this.messaging) {
      console.log(`[FcmService] Skipped push to topic ${topic}: ${title} — ${body}`);
      return { success: false, reason: 'Firebase not configured' };
    }

    try {
      const result = await this.messaging.send({
        topic,
        notification: { title, body },
        data: data || {},
      });
      return { success: true, messageId: result };
    } catch (err) {
      console.error('[FcmService] Topic push failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async sendToMultiple(tokens: string[], title: string, body: string, data?: Record<string, string>) {
    if (!this.messaging || tokens.length === 0) {
      return { success: false, reason: 'Firebase not configured or no tokens' };
    }

    try {
      const result = await this.messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: data || {},
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
