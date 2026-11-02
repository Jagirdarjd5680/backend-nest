import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ExpoPushService } from '../notifications/expo-push.service';

// The business/user timezone (IST) — fixed offset, no DST to worry about.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Start of the calendar day in IST, as an absolute UTC instant — NOT the server
 * process's local timezone. `Date#setHours` used to zero out the time in whatever
 * timezone Node/the OS happens to run in (UTC on virtually every host), so a login
 * in the early hours of the Indian morning (midnight-5:30AM IST = still the previous
 * UTC day) was silently landing on the same "day" as the prior night's login and
 * failing to increment the streak (or, in the opposite window, skipping a day and
 * resetting it to 1). Shifting into IST before zeroing, then shifting back, makes
 * the comparison timezone-independent regardless of where this process is hosted.
 */
function startOfDay(date: Date): Date {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Students who can appear on a leaderboard: real, current accounts (not archived/deactivated/blocked). */
const RANKABLE = { role: 'student', isActive: true, isDeleted: false, isBlocked: false } as const;

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private prisma: PrismaService,
    private expoPushService: ExpoPushService,
  ) {}

  /**
   * Called from SessionService.startSession() — the one place every login path (password,
   * Google, OTP) funnels through — so a streak only ever moves on a genuine fresh login,
   * matching "daily login streak" literally rather than any in-app activity.
   */
  async recordDailyLogin(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastActiveDate: true, currentStreak: true, longestStreak: true },
    });
    if (!user) return;

    const today = startOfDay(new Date());
    const last = user.lastActiveDate ? startOfDay(user.lastActiveDate) : null;

    if (last && last.getTime() === today.getTime()) return; // already logged in today, no change

    const isConsecutiveDay = last && today.getTime() - last.getTime() === ONE_DAY_MS;
    const newStreak = isConsecutiveDay ? user.currentStreak + 1 : 1;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        currentStreak: newStreak,
        longestStreak: Math.max(user.longestStreak, newStreak),
        lastActiveDate: new Date(),
      },
    });
  }

  /**
   * Streak reminders at 7 PM and 9 PM IST to every student who hasn't opened the app today.
   * Opening the app (POST /gamification/check-in) stamps lastActiveDate, so someone who
   * reacts to the 7 PM push never gets the 9 PM one. Pinned to Asia/Kolkata so it stays
   * correct regardless of the server host's own timezone.
   */
  @Cron('0 19 * * *', { timeZone: 'Asia/Kolkata' })
  async eveningStreakReminder() {
    return this.remindInactiveStudents(false);
  }

  @Cron('0 21 * * *', { timeZone: 'Asia/Kolkata' })
  async lastCallStreakReminder() {
    return this.remindInactiveStudents(true);
  }

  async remindInactiveStudents(lastCall: boolean) {
    const today = startOfDay(new Date());
    const yesterday = new Date(today.getTime() - ONE_DAY_MS);
    const candidates = await this.prisma.user.findMany({
      where: {
        role: 'student',
        isActive: true,
        isDeleted: false,
        expoPushToken: { not: null },
        OR: [{ lastActiveDate: null }, { lastActiveDate: { lt: today } }],
      },
      select: { id: true, currentStreak: true, lastActiveDate: true },
    });

    for (const u of candidates) {
      // A streak is still alive tonight only if the last visit was yesterday.
      const alive = u.currentStreak > 0 && !!u.lastActiveDate && u.lastActiveDate >= yesterday;
      const [title, body] = alive
        ? lastCall
          ? [`Last chance! Your ${u.currentStreak}-day streak ends at midnight \u{1F525}`, 'Open GOG and watch a lecture to keep it alive.']
          : [`Keep your ${u.currentStreak}-day streak going \u{1F525}`, "You haven't learned today yet — a few minutes is enough."]
        : lastCall
          ? ["Your day isn't over yet \u{1F4DA}", 'Open GOG now and start a new learning streak tonight.']
          : ['Time to learn something new \u{1F3A8}', 'Start a learning streak today — open GOG and pick up a lecture.'];
      await this.expoPushService.sendToUser(u.id, title, body, { type: 'streak_warning' }).catch(() => {});
    }

    this.logger.log(`Streak reminder (${lastCall ? '9 PM' : '7 PM'}) sent to ${candidates.length} user(s)`);
    return { reminded: candidates.length };
  }

  /** Current streak as of today: a streak whose last day is before yesterday has already broken. */
  private liveStreak(currentStreak: number, lastActiveDate: Date | null) {
    if (!lastActiveDate || !currentStreak) return 0;
    const yesterday = startOfDay(new Date()).getTime() - ONE_DAY_MS;
    return startOfDay(lastActiveDate).getTime() >= yesterday ? currentStreak : 0;
  }

  async getLeaderboard(limit: number = 20) {
    const students = await this.prisma.user.findMany({
      where: RANKABLE,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        points: true,
        rollNumber: true,
      },
      orderBy: { points: 'desc' },
      take: limit,
    });

    const ranked = students.map((s, idx) => ({
      rank: idx + 1,
      id: s.id,
      _id: s.id.toString(),
      name: s.name,
      email: s.email,
      avatar: s.avatar || '',
      points: s.points || 0,
      rollNumber: s.rollNumber || null,
      badge: idx === 0 ? 'Gold' : idx === 1 ? 'Silver' : idx === 2 ? 'Bronze' : 'Scholar',
    }));

    return {
      success: true,
      count: ranked.length,
      leaderboard: ranked,
    };
  }

  /** Matches frontend/src/pages/Leaderboard/Leaderboard.jsx's expected `{ success, data }' shape. */
  async getLeaderboardByPoints(limit: number = 20) {
    const students = await this.prisma.user.findMany({
      where: { ...RANKABLE, points: { gt: 0 } },
      select: { id: true, name: true, avatar: true, points: true, rollNumber: true },
      orderBy: [{ points: 'desc' }, { id: 'asc' }],
      take: limit,
    });

    const data = students.map((s) => ({
      _id: s.id.toString(),
      id: s.id,
      name: s.name,
      avatar: s.avatar || '',
      points: s.points || 0,
      rollNumber: s.rollNumber || null,
    }));

    return { success: true, data };
  }

  async getLeaderboardByStreaks(limit: number = 20) {
    const students = await this.prisma.user.findMany({
      // Only live streaks — a streak whose last visit is before yesterday has already broken.
      where: { ...RANKABLE, currentStreak: { gt: 0 }, lastActiveDate: { gte: new Date(startOfDay(new Date()).getTime() - ONE_DAY_MS) } },
      select: { id: true, name: true, avatar: true, points: true, currentStreak: true, longestStreak: true, rollNumber: true },
      orderBy: [{ currentStreak: 'desc' }, { longestStreak: 'desc' }],
      take: limit,
    });

    const data = students.map((s) => ({
      _id: s.id.toString(),
      id: s.id,
      name: s.name,
      avatar: s.avatar || '',
      points: s.points || 0,
      streaks: { current: s.currentStreak, longest: s.longestStreak },
      rollNumber: s.rollNumber || null,
    }));

    return { success: true, data };
  }

  async getUserGamification(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, points: true, currentStreak: true, longestStreak: true, lastActiveDate: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const higherRankCount = await this.prisma.user.count({
      where: { ...RANKABLE, points: { gt: user.points } },
    });

    const rank = higherRankCount + 1;

    // Check achievements/badges
    const badges: string[] = ['Getting Started'];
    if (user.points >= 100) badges.push('Centurion');
    if (user.points >= 500) badges.push('Master Scholar');
    if (user.points >= 1000) badges.push('Legendary Student');

    return {
      success: true,
      userId,
      name: user.name,
      points: user.points || 0,
      rank,
      badges,
      streaks: {
        current: this.liveStreak(user.currentStreak, user.lastActiveDate),
        longest: user.longestStreak || 0,
        lastActiveDate: user.lastActiveDate,
      },
    };
  }

  async awardPoints(userId: number, pointsToAward: number, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { points: { increment: pointsToAward } },
    });

    return {
      success: true,
      userId,
      awarded: pointsToAward,
      newTotalPoints: updated.points,
      reason: reason || 'Earned via learning activity',
    };
  }
}
