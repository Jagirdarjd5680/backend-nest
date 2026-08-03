import { Controller, Get, Post, Query, Param, Body, UseGuards, Request } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('gamification')
@UseGuards(JwtAuthGuard)
export class GamificationController {
  constructor(private service: GamificationService) {}

  @Get('leaderboard')
  async getLeaderboard(@Query('limit') limit?: string) {
    const limitNum = Math.min(Math.max(parseInt(limit || '20', 10), 1), 100);
    return this.service.getLeaderboard(limitNum);
  }

  @Get('leaderboard/points')
  async getLeaderboardPoints(@Query('limit') limit?: string) {
    const limitNum = Math.min(Math.max(parseInt(limit || '20', 10), 1), 100);
    return this.service.getLeaderboardByPoints(limitNum);
  }

  @Get('leaderboard/streaks')
  async getLeaderboardStreaks(@Query('limit') limit?: string) {
    const limitNum = Math.min(Math.max(parseInt(limit || '20', 10), 1), 100);
    return this.service.getLeaderboardByStreaks(limitNum);
  }

  @Get('my-stats')
  async getMyStats(@Request() req: any) {
    return this.service.getUserGamification(req.user.id);
  }

  @Get('user/:userId')
  async getUserStats(@Param('userId') userId: string) {
    return this.service.getUserGamification(parseInt(userId, 10));
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Post('award-points')
  async awardPoints(@Body() body: { userId: number; points: number; reason?: string }) {
    return this.service.awardPoints(body.userId, body.points, body.reason);
  }
}
