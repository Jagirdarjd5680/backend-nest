import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService) {}

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
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      console.log(`[OtpService] SMTP not configured. Verification code for ${email}: ${otp}`);
      return;
    }

    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host, port: 587, auth: { user, pass } });
      await transporter.sendMail({
        from: user,
        to: email,
        subject: 'Verify your email',
        html: `<p>Your verification code is:</p><h2>${otp}</h2><p>This code expires in 5 minutes.</p>`,
      });
    } catch (err) {
      console.error('[OtpService] Failed to send verification email:', err.message);
    }
  }

  async sendSmsOtp(phone: string, otp: string): Promise<void> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !from) {
      console.log(`[OtpService] SMS credentials not configured. OTP for ${phone}: ${otp}`);
      return;
    }

    try {
      const twilio = require('twilio');
      const client = twilio(accountSid, authToken);
      await client.messages.create({
        body: `Your verification OTP is: ${otp}. Valid for 5 minutes.`,
        from,
        to: phone,
      });
    } catch (err) {
      console.error('[OtpService] Failed to send SMS:', err.message);
    }
  }
}
