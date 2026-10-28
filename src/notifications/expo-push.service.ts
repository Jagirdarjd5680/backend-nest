import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from './fcm.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

const isExpoToken = (t: string) => t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken');

/** FCM `data` payloads only accept string values. */
const stringifyData = (data?: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));

/**
 * The Expo app registers Expo push tokens (`ExponentPushToken[...]`), not raw
 * FCM/APNs device tokens — those two formats are not interchangeable. Sending
 * through firebase-admin (fcm.service.ts) with an Expo token silently fails.
 * This talks to Expo's own push HTTP API instead, which relays to FCM/APNs using
 * Expo's project credentials — no separate Firebase Android app registration needed.
 *
 * The Flutter app (`mobile/`) registers raw FCM tokens on the same column, so `send()`
 * splits the list: Expo tokens go to Expo, everything else goes through firebase-admin.
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  constructor(
    private prisma: PrismaService,
    private fcm: FcmService,
  ) {}

  async send(tokens: string[], title: string, body: string, data?: Record<string, unknown>) {
    const all = [...new Set(tokens.filter((t) => typeof t === 'string' && t.trim().length > 0))];
    if (all.length === 0) return { success: false, sent: 0, failed: 0, reason: 'No registered devices' };

    const expo = await this.sendExpo(all.filter(isExpoToken), title, body, data);
    const fcm = await this.sendFcm(all.filter((t) => !isExpoToken(t)), title, body, data);
    const sent = expo.sent + fcm.sent;
    const failed = all.length - sent;
    const reason = failed > 0 ? fcm.reason || expo.reason : undefined;
    return { success: sent > 0, sent, failed, reason };
  }

  private async sendFcm(tokens: string[], title: string, body: string, data?: Record<string, unknown>) {
    if (tokens.length === 0) return { sent: 0 };
    let sent = 0;
    let reason: string | undefined;
    // sendEachForMulticast caps at 500 tokens per call.
    for (let i = 0; i < tokens.length; i += 500) {
      const res: any = await this.fcm.sendToMultiple(tokens.slice(i, i + 500), title, body, stringifyData(data));
      if (res.success) sent += res.successCount || 0;
      else reason = res.reason || res.error;
    }
    if (!reason && sent < tokens.length) reason = 'Some devices rejected the push (app uninstalled or token expired)';
    return { sent, reason };
  }

  private async sendExpo(validTokens: string[], title: string, body: string, data?: Record<string, unknown>) {
    if (validTokens.length === 0) return { sent: 0 };
    let sent = 0;
    for (let i = 0; i < validTokens.length; i += CHUNK_SIZE) {
      const chunk = validTokens.slice(i, i + CHUNK_SIZE);
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(chunk.map((to) => ({ to, title, body, data, sound: 'default' }))),
        });
        if (res.ok) sent += chunk.length;
        else this.logger.warn(`Expo push chunk failed: ${res.status} ${await res.text()}`);
      } catch (err: any) {
        this.logger.error(`Expo push send failed: ${err.message}`);
      }
    }
    return { sent, reason: sent < validTokens.length ? 'Expo push service rejected some tokens' : undefined };
  }

  async sendToUser(userId: number, title: string, body: string, data?: Record<string, unknown>) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { expoPushToken: true } });
    if (!user?.expoPushToken) return { success: false, sent: 0, reason: 'No push token on file' };
    return this.send([user.expoPushToken], title, body, data);
  }

  /** recipients (specific user ids) takes priority over recipientRole ("all" or a role name). */
  async sendToAudience(recipientRole: string, recipients: number[] | undefined, title: string, body: string, data?: Record<string, unknown>) {
    const where =
      Array.isArray(recipients) && recipients.length > 0
        ? { id: { in: recipients }, expoPushToken: { not: null } }
        : recipientRole && recipientRole !== 'all'
          ? { role: recipientRole, expoPushToken: { not: null } }
          : { expoPushToken: { not: null } };

    const users = await this.prisma.user.findMany({ where: where as any, select: { expoPushToken: true } });
    const tokens = users.map((u) => u.expoPushToken).filter((t): t is string => !!t);
    return this.send(tokens, title, body, data);
  }
}
