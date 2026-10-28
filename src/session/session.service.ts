import { ForbiddenException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { ExpoPushService } from '../notifications/expo-push.service';
import { TemporaryBlockException } from '../common/exceptions/temporary-block.exception';

export type DeviceInfo = { deviceId: string; deviceLabel?: string; ip?: string };

const BLOCK_AFTER_STRIKES = 3;
const WARNING_AFTER_STRIKES = 2;
const TEMP_BLOCK_MS = 60_000;

/**
 * Everything to do with "which device is this account logged in on right
 * now" lives here, deliberately kept out of AuthService: single-device
 * enforcement, the strike/auto-block counter, and the login/forced-logout
 * audit trail behind the admin "Account Activities" tab.
 */
@Injectable()
export class SessionService {
  constructor(
    private prisma: PrismaService,
    private gamificationService: GamificationService,
    private expoPushService: ExpoPushService,
  ) {}

  generateTokenId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Called right after credentials are verified, before a JWT is signed.
   * For student accounts, any other still-active session gets revoked here
   * (the caller is responsible for pushing the real-time "force-logout"
   * socket event to that device) and counted as a "strike"; three strikes
   * blocks the account until an admin unblocks it. Staff/admin accounts are
   * exempt from single-device enforcement.
   */
  async startSession(userId: number, role: string, device: DeviceInfo) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('User not found');

    if (user.isBlocked) {
      throw new ForbiddenException(user.blockedReason || 'This account has been blocked. Please contact support.');
    }
    if (user.blockedUntil && user.blockedUntil.getTime() > Date.now()) {
      // Same timestamp every time, not "now + 60s" recomputed on each hit — otherwise a client
      // that keeps retrying (or auto-refreshing) during the cooldown would never see it expire.
      throw new TemporaryBlockException(
        user.blockedReason || 'Too many logins from different devices. Please try again shortly.',
        user.blockedUntil,
      );
    }

    const enforceSingleDevice = role === 'student';
    let kickedPreviousSession = false;
    let forcedLogoutStrikes = user.forcedLogoutStrikes;

    if (enforceSingleDevice) {
      const activeSessions = await this.prisma.userSession.findMany({ where: { userId, revokedAt: null } });
      const sameDeviceSessionIds = activeSessions.filter((s) => s.deviceId === device.deviceId).map((s) => s.id);
      const otherDeviceSessionIds = activeSessions.filter((s) => s.deviceId !== device.deviceId).map((s) => s.id);

      // Re-logging in from the same device (e.g. after the token expired)
      // is just cleanup, not a kick — only a *different* device counts.
      if (sameDeviceSessionIds.length) {
        await this.prisma.userSession.updateMany({
          where: { id: { in: sameDeviceSessionIds } },
          data: { revokedAt: new Date(), revokedReason: 'reauthenticated_same_device' },
        });
      }

      if (otherDeviceSessionIds.length) {
        await this.prisma.userSession.updateMany({
          where: { id: { in: otherDeviceSessionIds } },
          data: { revokedAt: new Date(), revokedReason: 'replaced_by_new_login' },
        });
        kickedPreviousSession = true;

        forcedLogoutStrikes += 1;
        await this.prisma.user.update({ where: { id: userId }, data: { forcedLogoutStrikes } });
        await this.recordActivity(userId, 'forced_logout', device);

        if (forcedLogoutStrikes >= BLOCK_AFTER_STRIKES) {
          const blockedReason = 'Too many logins from different devices (web, app, Android, iOS…). Please wait 60 seconds and try again.';
          const blockedUntil = new Date(Date.now() + TEMP_BLOCK_MS);
          // Temporary cooldown, not a permanent lock — strikes reset so the account is usable
          // again the moment the cooldown expires, instead of sitting blocked until an admin
          // manually clears it (that's still what `isBlocked` is for — a deliberate admin ban).
          await this.prisma.user.update({
            where: { id: userId },
            data: { blockedUntil, blockedReason, forcedLogoutStrikes: 0 },
          });
          await this.recordActivity(userId, 'blocked', device);
          this.expoPushService
            .sendToUser(userId, 'Account temporarily locked', blockedReason)
            .catch(() => {});
          throw new TemporaryBlockException(blockedReason, blockedUntil);
        }
        if (forcedLogoutStrikes >= WARNING_AFTER_STRIKES) {
          await this.recordActivity(userId, 'warning', device);
        }
      }
    }

    const tokenId = this.generateTokenId();
    // These three writes don't depend on each other's results — running them
    // sequentially was adding avoidable round-trip latency to every login.
    await Promise.all([
      this.prisma.userSession.create({
        data: { userId, tokenId, deviceId: device.deviceId, deviceLabel: device.deviceLabel, ip: device.ip },
      }),
      this.recordActivity(userId, 'login', device),
      role === 'student' ? this.gamificationService.recordDailyLogin(userId).catch(() => {}) : Promise.resolve(),
    ]);

    // Trusted students (no forced-logout history) get a 14-day session;
    // once we've had to kick another device for this account, sessions
    // expire sooner (7 days) as an extra safety margin.
    const expiresIn = enforceSingleDevice && forcedLogoutStrikes > 0 ? '7d' : '14d';

    return { tokenId, expiresIn, kickedPreviousSession };
  }

  /** Same session continuing (token refresh) — no kick logic, just extends `lastSeenAt`. */
  async touchSession(tokenId?: string) {
    if (!tokenId) return;
    await this.prisma.userSession.updateMany({ where: { tokenId, revokedAt: null }, data: { lastSeenAt: new Date() } });
  }

  async isSessionActive(tokenId?: string): Promise<boolean> {
    // Tokens issued before this feature shipped carry no jti / have no
    // matching row — treat them as still valid rather than mass-logging-out
    // everyone the moment this ships.
    if (!tokenId) return true;
    const session = await this.prisma.userSession.findUnique({ where: { tokenId } });
    if (!session) return true;
    return session.revokedAt === null;
  }

  async logout(tokenId?: string) {
    if (!tokenId) return;
    await this.prisma.userSession.updateMany({
      where: { tokenId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'manual_logout' },
    });
  }

  async unblock(userId: number) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { isBlocked: false, blockedAt: null, blockedUntil: null, blockedReason: null, forcedLogoutStrikes: 0 },
    });
    await this.recordActivity(userId, 'unblocked');
  }

  async recordActivity(userId: number, event: string, device?: DeviceInfo) {
    await this.prisma.loginActivity.create({
      data: { userId, event, deviceId: device?.deviceId, deviceLabel: device?.deviceLabel, ip: device?.ip },
    });
  }

  async getActivity(userId: number, limit = 50) {
    return this.prisma.loginActivity.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
  }

  async getAccountStatus(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isBlocked: true, blockedAt: true, blockedUntil: true, blockedReason: true, forcedLogoutStrikes: true },
    });
    return user;
  }

  /**
   * Self-service device list for the student Settings page. Students only ever have one
   * active row at a time (startSession revokes any other device on login for role='student'
   * above) — this stays generic since teacher/admin accounts aren't single-device-enforced
   * and can genuinely have more than one.
   */
  async getMyDevices(userId: number) {
    return this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, tokenId: true, deviceId: true, deviceLabel: true, ip: true, createdAt: true, lastSeenAt: true },
    });
  }

  /** Lets a student log themselves out of a device they no longer have (e.g. old phone) without an admin. */
  async revokeMyDevice(userId: number, sessionId: number) {
    const session = await this.prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new ForbiddenException('Session not found');
    }
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: 'self_revoked' },
    });
  }
}
