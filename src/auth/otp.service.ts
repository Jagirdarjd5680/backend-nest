import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemporaryBlockException } from '../common/exceptions/temporary-block.exception';
import { getSmtpConfig } from '../utils/smtp-config';

const SEND_LIMIT = 3; // this many sends allowed inside the window; the next one is blocked
const SEND_WINDOW_MS = 60_000;

@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Repeated OTP-send taps for the same phone number burn a real SMS credit each time in
   * production mode, and even in test mode it's a sign of someone hammering the button. Blocks
   * for a fixed 60s from the *first* of the recent sends — not "now + 60s" recomputed on every
   * retry — so a client that keeps tapping/refreshing during the cooldown sees the same expiry
   * count down instead of it perpetually resetting.
   */
  async checkSendCooldown(phone: string): Promise<void> {
    const windowStart = new Date(Date.now() - SEND_WINDOW_MS);
    const recent = await this.prisma.otpCode.findMany({
      where: { target: phone, createdAt: { gte: windowStart } },
      orderBy: { createdAt: 'asc' },
      take: SEND_LIMIT + 1,
    });
    if (recent.length < SEND_LIMIT) return;

    const blockedUntil = new Date(recent[0].createdAt.getTime() + SEND_WINDOW_MS);
    if (blockedUntil.getTime() > Date.now()) {
      throw new TemporaryBlockException(
        'Too many OTP requests for this number. Please wait 60 seconds and try again.',
        blockedUntil,
      );
    }
  }

  /**
   * Persisted in the DB, not an in-memory Map — a Map loses every pending code on
   * every server restart (this dev server gets restarted routinely) and never
   * validates across more than one backend instance in production.
   */
  async generateOtp(target: string): Promise<string> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    // Invalidate any earlier unconsumed code for this target so only the latest one verifies.
    await this.prisma.otpCode.updateMany({
      where: { target, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.otpCode.create({ data: { target, code: otp, expiresAt } });
    return otp;
  }

  async verifyOtp(target: string, otp: string): Promise<boolean> {
    const record = await this.prisma.otpCode.findFirst({
      where: { target, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return false;
    if (new Date() > record.expiresAt) return false;
    if (record.code !== otp) return false;

    // Conditional update, not a plain update(): if two verify requests for the same
    // OTP race each other (e.g. a double-tap firing two submits), only the request
    // whose updateMany actually flips an unconsumed row wins — the other gets
    // count 0 and correctly fails instead of both reading the row as valid.
    const result = await this.prisma.otpCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return result.count === 1;
  }

  async sendEmailOtp(email: string, otp: string): Promise<void> {
    const smtp = await getSmtpConfig(this.prisma);
    if (!smtp) {
      console.log(`[OtpService] SMTP not configured. Verification code for ${email}: ${otp}`);
      return;
    }

    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.pass },
      });
      await transporter.sendMail({
        from: smtp.from,
        to: email,
        subject: 'Verify your email',
        html: `<p>Your verification code is:</p><h2>${otp}</h2><p>This code expires in 5 minutes.</p>`,
      });
    } catch (err) {
      console.error('[OtpService] Failed to send verification email:', err.message);
    }
  }

  /**
   * `mode` comes from Settings > Auth's Test/Production toggle (auth.otpMode). Test mode never
   * calls the real SMS gateway — the OTP only ever reaches the server console, so QA/dev logins
   * can't burn a real SMS credit or accidentally text a real phone. Production mode sends via
   * 2Factor.in using Settings > Integrations' smsApiKey; with no key configured it still just
   * falls back to console-only rather than failing the login flow.
   */
  async sendSmsOtp(phone: string, otp: string, mode: 'test' | 'production' = 'test', smsApiKey?: string): Promise<void> {
    if (mode !== 'production' || !smsApiKey) {
      console.log(
        `[OtpService] ${mode === 'production' ? 'SMS API key not configured, ' : 'Test mode, '}OTP for ${phone}: ${otp}`,
      );
      return;
    }

    try {
      const axios = require('axios');
      const url = `https://2factor.in/API/V1/${smsApiKey}/SMS/${phone}/${otp}`;
      const smsRes = await axios.get(url);
      if (smsRes.data?.Status !== 'Success') {
        console.error('[OtpService] 2Factor.in did not report success:', smsRes.data);
      }
    } catch (err) {
      console.error('[OtpService] Failed to send SMS via 2Factor.in:', err.message);
    }
  }
}
