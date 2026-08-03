import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

/**
 * The native app registers Expo push tokens (`ExponentPushToken[...]`), not raw
 * FCM/APNs device tokens — those two formats are not interchangeable. Sending
 * through firebase-admin (fcm.service.ts) with an Expo token silently fails.
 * This talks to Expo's own push HTTP API instead, which relays to FCM/APNs using
 * Expo's project credentials — no separate Firebase Android app registration needed.
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  constructor(private prisma: PrismaService) {}

  async send(tokens: string[], title: string, body: string, data?: Record<string, unknown>) {
    const validTokens = tokens.filter((t) => t?.startsWith('ExponentPushToken'));
    if (validTokens.length === 0) return { success: false, sent: 0, reason: 'No valid Expo push tokens' };

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
    return { success: sent > 0, sent };
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
