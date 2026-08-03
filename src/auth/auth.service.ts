import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { SessionService, DeviceInfo } from '../session/session.service';
import { SessionGateway } from '../session/session.gateway';
import { SettingsService } from '../settings/settings.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REALTIME_EVENTS } from '../realtime/events';
import { GamificationService } from '../gamification/gamification.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as MailChecker from 'mailchecker';

const FALLBACK_DEVICE: DeviceInfo = { deviceId: 'unknown-device' };

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private otpService: OtpService,
    private sessionService: SessionService,
    private sessionGateway: SessionGateway,
    private settingsService: SettingsService,
    private realtimeService: RealtimeService,
    private gamificationService: GamificationService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (user && user.password) {
      const isMatch = await bcrypt.compare(pass, user.password);
      if (isMatch) {
        const { password, ...result } = user;
        return result;
      }
    }
    return null;
  }

  /**
   * Every login-issuing flow (password, register, Google, OTP) funnels
   * through here: start (or take over) the session, then sign a JWT whose
   * `jti` ties it to that session row. If a different device just got
   * kicked, push it a real-time notice on the session socket.
   */
  private async _issueToken(user: any, device: DeviceInfo) {
    const { tokenId, expiresIn, kickedPreviousSession } = await this.sessionService.startSession(
      user.id,
      user.role,
      device,
    );

    if (kickedPreviousSession) {
      this.sessionGateway.emitForceLogout(user.id, 'new_device_login');
    }

    const payload = { email: user.email, sub: user.id, role: user.role, jti: tokenId };
    return this.jwtService.sign(payload, { expiresIn });
  }

  /** Only the plain email/password login path (register/Google/OTP prove identity their own way). */
  async login(user: any, device: DeviceInfo = FALLBACK_DEVICE) {
    const { requireEmailVerification } = await this.settingsService.getAuthSettings();
    if (requireEmailVerification && user.isEmailVerified === false) {
      throw new UnauthorizedException('Your email is not verified. Please verify to continue.');
    }

    // Password alone proves identity, but a 2FA-enabled account still needs a second factor
    // before a token is issued — send the OTP now and make the caller complete verifyTwoFactor.
    if (user.twoFactorEnabled) {
      const otp = await this.otpService.generateOtp(`2fa:${user.email}`);
      await this.otpService.sendEmailOtp(user.email, otp);
      return { success: true, requiresTwoFactor: true, email: user.email };
    }

    const token = await this._issueToken(user, device);
    return {
      success: true,
      token,
      user: this._formatUser(user),
    };
  }

  /** Resend for the 2FA step — same pattern as resendVerification (email-only, no re-auth), used by that flow too. */
  async resendTwoFactorOtp(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user?.twoFactorEnabled) {
      return { success: true, message: 'If this account has 2FA enabled, a new code has been sent.' };
    }
    const otp = await this.otpService.generateOtp(`2fa:${email}`);
    await this.otpService.sendEmailOtp(email, otp);
    return { success: true, message: 'If this account has 2FA enabled, a new code has been sent.' };
  }

  /** Second step of login for accounts with `twoFactorEnabled` — verifies the OTP sent by login() above. */
  async verifyTwoFactor(email: string, otp: string, device: DeviceInfo = FALLBACK_DEVICE) {
    const valid = await this.otpService.verifyOtp(`2fa:${email}`, otp);
    if (!valid) throw new BadRequestException('Invalid or expired code. Please try again.');

    const user = await this.usersService.findByEmail(email);
    if (!user) throw new BadRequestException('User not found');

    const token = await this._issueToken(user, device);
    return {
      success: true,
      token,
      user: this._formatUser(user),
    };
  }

  /** Self-service 2FA toggle for the student Settings page — no admin endpoint covers this today. */
  async setTwoFactorEnabled(userId: number, enabled: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: enabled } });
    return { success: true, twoFactorEnabled: enabled };
  }

  async register(registerDto: any, device: DeviceInfo = FALLBACK_DEVICE) {
    const { allowRegistration, requireEmailVerification } = await this.settingsService.getAuthSettings();
    if (allowRegistration === false) {
      throw new ForbiddenException('Registration is currently disabled');
    }

    const existing = await this.usersService.findByEmail(registerDto.email);
    if (existing) {
      throw new BadRequestException('User already exists');
    }

    if (!MailChecker.isValid(registerDto.email)) {
      throw new BadRequestException('Disposable/temporary email addresses are not allowed. Please use a real email address.');
    }

    // Pass raw password to usersService.create so it is hashed ONCE
    const newUser = await this.usersService.create({
      name: registerDto.name,
      email: registerDto.email,
      password: registerDto.password,
      role: registerDto.role || 'student',
      phone: registerDto.phone,
    });

    if (registerDto.referralCode) {
      await this._createPendingReferral(newUser.id, registerDto.referralCode).catch((err) =>
        console.warn(`⚠️ [Auth] Referral code "${registerDto.referralCode}" not applied for user ${newUser.id}: ${err.message}`),
      );
    }

    if (requireEmailVerification) {
      await this.prisma.user.update({ where: { id: newUser.id }, data: { isEmailVerified: false } as any });
      const otp = await this.otpService.generateOtp(`verify:${registerDto.email}`);
      await this.otpService.sendEmailOtp(registerDto.email, otp);
      return {
        success: true,
        requireVerification: true,
        message: 'Registration successful! Please check your email for a verification code.',
      };
    }

    const token = await this._issueToken(newUser, device);
    const formattedUser = this._formatUser(newUser);
    const needsReferralPrompt = await this._needsReferralPrompt(newUser.id);

    return {
      success: true,
      token,
      user: formattedUser,
      needsReferralPrompt,
      data: {
        token,
        user: formattedUser,
      },
    };
  }

  async verifyEmail(email: string, code: string) {
    const valid = await this.otpService.verifyOtp(`verify:${email}`, code);
    if (!valid) throw new BadRequestException('Invalid or expired code. Please try again.');

    const user = await this.usersService.findByEmail(email);
    if (!user) throw new BadRequestException('User not found');

    await this.prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true } as any });
    return { success: true, message: 'Email verified successfully' };
  }

  async resendVerification(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Don't reveal whether the account exists.
      return { success: true, message: 'If this account exists, a new code has been sent.' };
    }

    const otp = await this.otpService.generateOtp(`verify:${email}`);
    await this.otpService.sendEmailOtp(email, otp);
    return { success: true, message: 'If this account exists, a new code has been sent.' };
  }

  async getMe(userId: number) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');
    const { password, ...safeUser } = user as any;

    // The mobile app calls this on every app open using its long-lived stored token —
    // it does NOT re-run the login flow daily, so gating the streak behind a fresh
    // credentials login (the only place it used to be recorded, in SessionService.
    // startSession) meant the streak only ever moved the day a user actually typed
    // their password/OTP again. Recording it here too makes "open the app" count,
    // matching what users actually expect from a daily streak; recordDailyLogin is
    // still idempotent per calendar day (IST) so this can't double-count.
    if (user.role === 'student') {
      this.gamificationService.recordDailyLogin(userId).catch(() => {});
    }

    return {
      success: true,
      data: this._formatUser(safeUser),
    };
  }

  /** Refreshing extends the SAME session — no device passed, no kick logic, same jti reused. */
  async refreshToken(userId: number, tokenId?: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    await this.sessionService.touchSession(tokenId);
    const payload = { email: user.email, sub: user.id, role: user.role, jti: tokenId };
    return {
      success: true,
      token: this.jwtService.sign(payload),
      user: this._formatUser(user),
    };
  }

  async logout(tokenId?: string) {
    await this.sessionService.logout(tokenId);
    return { success: true };
  }

  // ─── Google OAuth ────────────────────────────────────────────────────────
  async googleLogin(profile: any, device: DeviceInfo = FALLBACK_DEVICE) {
    const email = profile.emails?.[0]?.value;
    if (!email) throw new BadRequestException('No email returned from Google');

    let user = await this.usersService.findByEmail(email);
    if (!user) {
      user = await this.usersService.create({
        // usersService.create() hashes whatever password it's given — passing a
        // pre-hashed value here used to hash it a second time for no reason.
        name: profile.displayName || `${profile.name?.givenName} ${profile.name?.familyName}`.trim(),
        email,
        password: crypto.randomBytes(16).toString('hex'),
        role: 'student',
        source: 'google',
        avatar: profile.photos?.[0]?.value || '',
      });
    }

    const token = await this._issueToken(user, device);
    return {
      success: true,
      token,
      user: this._formatUser(user),
    };
  }

  // ─── OTP Login ───────────────────────────────────────────────────────────
  async sendOtp(phone: string) {
    const otp = await this.otpService.generateOtp(phone);
    await this.otpService.sendSmsOtp(phone, otp);
    return {
      success: true,
      message: `OTP sent to ${phone}`,
    };
  }

  async verifyOtpLogin(phone: string, otp: string, device: DeviceInfo = FALLBACK_DEVICE, referralCode?: string) {
    const valid = await this.otpService.verifyOtp(phone, otp);
    if (!valid) throw new BadRequestException('Invalid or expired OTP');

    let user = await this.usersService.findByPhone(phone);
    const isNewUser = !user;
    if (!user) {
      user = await this.usersService.create({
        name: `User_${phone.slice(-4)}`,
        email: `${phone}@otp.local`,
        // usersService.create() hashes whatever password it's given — passing a
        // pre-hashed value here used to hash it a second time (real, synchronous
        // CPU work) for no reason, since OTP accounts never log in with a password.
        password: crypto.randomBytes(16).toString('hex'),
        phone,
        role: 'student',
        source: 'mobile',
      });

      // If the client already has a referral code at signup time (e.g. typed on the
      // same screen, or restored from local storage after an interrupted first run),
      // apply it right away instead of relying on a fragile separate follow-up call.
      if (referralCode) {
        await this._createPendingReferral(user.id, referralCode).catch((err) =>
          console.warn(`⚠️ [Auth] Referral code "${referralCode}" not applied for user ${user.id}: ${err.message}`),
        );
      }
    }

    const [token, needsReferralPrompt] = await Promise.all([
      this._issueToken(user, device),
      // Whether to still show the "enter a referral code" step is based on whether a
      // referral has actually been recorded for this account — NOT on isNewUser. A
      // brand-new signup that got interrupted (app killed, retried OTP call, etc.)
      // before completing this step must still be prompted on the very next login,
      // not silently skipped forever just because the user row already exists.
      this._needsReferralPrompt(user.id),
    ]);

    return {
      success: true,
      token,
      user: this._formatUser(user),
      isNewUser,
      needsReferralPrompt,
    };
  }

  private async _needsReferralPrompt(userId: number): Promise<boolean> {
    const existing = await this.prisma.referral.findFirst({ where: { referredId: userId } });
    return !existing;
  }

  /**
   * Follow-up step for entering a referral code post-login — safe to call any time
   * (not just right after a brand-new signup): _createPendingReferral itself rejects
   * a second referral for an account that already has one.
   */
  async applyReferralCode(userId: number, code: string) {
    await this._createPendingReferral(userId, code);
    return { success: true, message: 'Referral code applied — pending admin approval.' };
  }

  private async _createPendingReferral(referredId: number, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    if (!code) throw new BadRequestException('Referral code is required');

    const referrer = await this.prisma.user.findUnique({ where: { referralCode: code } });
    if (!referrer || !referrer.isReferralApproved) {
      throw new BadRequestException('Invalid referral code');
    }
    if (referrer.id === referredId) {
      throw new BadRequestException('You cannot refer yourself');
    }

    const alreadyReferred = await this.prisma.referral.findFirst({ where: { referredId } });
    if (alreadyReferred) {
      throw new BadRequestException('A referral code has already been applied to this account');
    }

    await this.prisma.referral.create({
      data: { referrerId: referrer.id, referredId, status: 'pending' },
    });
    console.log(`🔗 [Referral] Pending referral created: referrer=${referrer.id} (${code}) -> referred=${referredId}`);
    this.realtimeService.emitToUser(referrer.id, REALTIME_EVENTS.REFERRAL_UPDATED, { reason: 'new_referral' });
  }

  // ─── Password Reset ──────────────────────────────────────────────────────
  async forgotPassword(email: string) {
    const { allowForgotPassword } = await this.settingsService.getAuthSettings();
    if (allowForgotPassword === false) {
      throw new ForbiddenException('Password reset is currently disabled');
    }

    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Return success regardless to prevent email enumeration
      return { success: true, message: 'If this email exists, a reset link has been sent.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpiry: resetExpiry,
      } as any,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    await this._sendResetEmail(user.email, user.name, resetLink);

    return { success: true, message: 'If this email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      } as any,
    });

    if (!user) throw new BadRequestException('Invalid or expired reset token');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        passwordResetToken: null,
        passwordResetExpiry: null,
      } as any,
    });

    return { success: true, message: 'Password has been reset successfully.' };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────
  private async _sendResetEmail(email: string, name: string, link: string) {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      console.log(`[AuthService] SMTP not configured. Password reset link for ${email}: ${link}`);
      return;
    }

    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host, port: 587, auth: { user, pass } });
      await transporter.sendMail({
        from: user,
        to: email,
        subject: 'Password Reset Request',
        html: `<p>Hi ${name},</p><p>Click <a href="${link}">here</a> to reset your password. This link expires in 1 hour.</p>`,
      });
    } catch (err) {
      console.error('[AuthService] Failed to send reset email:', err.message);
    }
  }

  private _formatUser(user: any) {
    return {
      id: user.id,
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar || '',
      phone: user.phone || '',
      address: user.address || '',
      permissions: user.permissions || 'fullControl',
      modulePermissions: user.modulePermissions || null,
      rollNumber: user.rollNumber || null,
      isActive: user.isActive ?? true,
      twoFactorEnabled: user.twoFactorEnabled ?? false,
      source: user.source || 'web',
    };
  }
}
