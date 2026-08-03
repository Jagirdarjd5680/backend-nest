import { Controller, Post, Body, UnauthorizedException, Get, UseGuards, Request, Query, Ip } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { DeviceInfo } from '../session/session.service';

// Tighter than the app-wide 100/min default (app.module.ts) — these are exactly the routes a
// signup/login-spraying script would hit, so junk-account creation gets rate-limited hard here.
const AUTH_THROTTLE = { default: { ttl: 60000, limit: 10 } };
const OTP_THROTTLE = { default: { ttl: 60000, limit: 5 } };

function extractDevice(body: any, ip: string): DeviceInfo {
  return {
    deviceId: body?.deviceId || 'unknown-device',
    deviceLabel: body?.deviceLabel,
    ip,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(@Body() registerDto: RegisterDto & { deviceId?: string; deviceLabel?: string }, @Ip() ip: string) {
    return this.authService.register(registerDto, extractDevice(registerDto, ip));
  }

  @Throttle(AUTH_THROTTLE)
  @Post('login')
  async login(@Body() loginDto: LoginDto & { deviceId?: string; deviceLabel?: string }, @Ip() ip: string) {
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user, extractDevice(loginDto, ip));
  }

  @Throttle(AUTH_THROTTLE)
  @Post('2fa/verify')
  async verifyTwoFactor(@Body() body: { email: string; otp: string; deviceId?: string; deviceLabel?: string }, @Ip() ip: string) {
    return this.authService.verifyTwoFactor(body.email, body.otp, extractDevice(body, ip));
  }

  @Throttle(OTP_THROTTLE)
  @Post('2fa/resend')
  async resendTwoFactor(@Body() body: { email: string }) {
    return this.authService.resendTwoFactorOtp(body.email);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/two-factor')
  async setTwoFactor(@Body() body: { enabled: boolean }, @Request() req: any) {
    return this.authService.setTwoFactorEnabled(Number(req.user.id || req.user._id), !!body.enabled);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: any) {
    return { success: true, user: req.user };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Request() req: any) {
    return this.authService.getMe(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('refresh')
  async refreshToken(@Request() req: any) {
    return this.authService.refreshToken(req.user.id, req.user.jti);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req: any) {
    return this.authService.logout(req.user.jti);
  }

  // ─── Google OAuth ────────────────────────────────────────────────────────
  @Get('google/callback')
  async googleCallback(@Query('code') code: string) {
    // In production: use passport-google-oauth20 strategy; here we accept profile from google flow
    return { success: true, message: 'Google OAuth callback received. Configure GOOGLE_CLIENT_ID/SECRET for full flow.', code };
  }

  @Post('google')
  async googleLogin(@Body() body: { profile: any; deviceId?: string; deviceLabel?: string }, @Ip() ip: string) {
    return this.authService.googleLogin(body.profile, extractDevice(body, ip));
  }

  // ─── OTP Login ───────────────────────────────────────────────────────────
  @Throttle(OTP_THROTTLE)
  @Post('send-otp')
  async sendOtp(@Body() body: { phone: string }) {
    return this.authService.sendOtp(body.phone);
  }

  @Throttle(OTP_THROTTLE)
  @Post('verify-otp')
  async verifyOtp(
    @Body() body: { phone: string; otp: string; deviceId?: string; deviceLabel?: string; referralCode?: string },
    @Ip() ip: string,
  ) {
    return this.authService.verifyOtpLogin(body.phone, body.otp, extractDevice(body, ip), body.referralCode);
  }

  @UseGuards(JwtAuthGuard)
  @Post('apply-referral')
  async applyReferral(@Body() body: { code: string }, @Request() req: any) {
    return this.authService.applyReferralCode(req.user.id, body.code);
  }

  // ─── Email Verification ──────────────────────────────────────────────────
  @Throttle(OTP_THROTTLE)
  @Post('verify-email')
  async verifyEmail(@Body() body: { email: string; code: string }) {
    return this.authService.verifyEmail(body.email, body.code);
  }

  @Throttle(OTP_THROTTLE)
  @Post('resend-verification')
  async resendVerification(@Body() body: { email: string }) {
    return this.authService.resendVerification(body.email);
  }

  // ─── Password Reset ──────────────────────────────────────────────────────
  @Throttle(OTP_THROTTLE)
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }
}
