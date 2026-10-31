import { Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FinalizeDto, VideoAgentService } from './video-agent.service';

/** Dashboard routes (admin/teacher login). */
@Controller('video-agent')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'teacher')
export class VideoAgentController {
  constructor(private readonly agents: VideoAgentService) {}

  @Get('status')
  status() {
    return this.agents.status();
  }

  @Post('jobs')
  createJob(@Body() body: any, @Request() req: any) {
    return this.agents.createJob(body || {}, req.user?.id);
  }

  @Get('jobs')
  listJobs(@Query('limit') limit?: string) {
    return this.agents.listJobs(Number(limit) || 30);
  }

  @Post('jobs/:id/retry')
  retry(@Param('id') id: string) {
    return this.agents.retryJob(id);
  }

  @Post('jobs/:id/cancel')
  cancel(@Param('id') id: string, @Body() body: { discard?: boolean }) {
    return this.agents.cancelJob(id, !!body?.discard);
  }

  @Post('pairing-code')
  @Roles('admin')
  pairingCode(@Request() req: any) {
    return this.agents.createPairingCode(req.user?.id != null ? String(req.user.id) : undefined);
  }

  @Delete('agent')
  @Roles('admin')
  revoke() {
    return this.agents.revoke();
  }
}

/** Routes the agent itself calls (pairing code / device token, no login). */
@Controller('video-agent/agent')
export class VideoAgentDeviceController {
  constructor(private readonly agents: VideoAgentService) {}

  @Post('pair')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  pair(@Body() body: { code?: string; name?: string; version?: string }) {
    return this.agents.pair(String(body?.code || ''), String(body?.name || ''), body?.version);
  }

  /** Playlists + thumbnail are a few hundred KB of text at most, so they come over HTTPS, not the socket. */
  @Post('jobs/:id/finalize')
  @SkipThrottle()
  async finalize(@Param('id') id: string, @Body() body: FinalizeDto, @Headers('authorization') authorization?: string) {
    const token = authorization?.startsWith('Agent ') ? authorization.slice(6) : undefined;
    const agent = await this.agents.authenticate(token);
    if (!agent) throw new ForbiddenException('Invalid agent token');
    return this.agents.finalize(agent.id, id, body);
  }
}
