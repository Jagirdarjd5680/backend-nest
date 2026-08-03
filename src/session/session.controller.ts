import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SessionService } from './session.service';
import { SessionGateway } from './session.gateway';

@Controller('session')
export class SessionController {
  constructor(
    private sessionService: SessionService,
    private sessionGateway: SessionGateway,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req: any) {
    await this.sessionService.logout(req.user.jti);
    return { success: true };
  }

  // ─── Self-service (student Settings page) — MUST stay ahead of the :userId/* admin
  // routes below, or Express/Nest would match "me" as a :userId value instead. ───────

  @UseGuards(JwtAuthGuard)
  @Get('me/status')
  async myStatus(@Request() req: any) {
    const data = await this.sessionService.getAccountStatus(Number(req.user.id || req.user._id));
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/activity')
  async myActivity(@Request() req: any) {
    const data = await this.sessionService.getActivity(Number(req.user.id || req.user._id));
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/devices')
  async myDevices(@Request() req: any) {
    const data = await this.sessionService.getMyDevices(Number(req.user.id || req.user._id));
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/devices/:sessionId/revoke')
  async revokeMyDevice(@Param('sessionId') sessionId: string, @Request() req: any) {
    const userId = Number(req.user.id || req.user._id);
    await this.sessionService.revokeMyDevice(userId, parseInt(sessionId, 10));
    // Disconnect that device's live socket immediately, the same way a new-device login does —
    // otherwise the app stays "logged in" until its JWT happens to expire on its own.
    this.sessionGateway.emitForceLogout(userId, 'device_revoked_by_you');
    return { success: true };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get(':userId/status')
  async status(@Param('userId') userId: string) {
    const data = await this.sessionService.getAccountStatus(parseInt(userId, 10));
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get(':userId/activity')
  async activity(@Param('userId') userId: string) {
    const data = await this.sessionService.getActivity(parseInt(userId, 10));
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post(':userId/unblock')
  async unblock(@Param('userId') userId: string) {
    await this.sessionService.unblock(parseInt(userId, 10));
    return { success: true };
  }
}
