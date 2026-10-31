import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Socket } from 'socket.io';
import { VideoAgentService } from './video-agent.service';

/**
 * Socket for the local agent only (namespace /video-agent, device token in the handshake) —
 * separate from the default namespace the dashboard's login-JWT socket uses. Every handler
 * answers through the ack callback as { ok, ...data } or { ok: false, error }.
 */
// SkipThrottle: the global HTTP ThrottlerGuard can't read a socket "request", and the agent
// is already authenticated by its device token.
@SkipThrottle()
@WebSocketGateway({ namespace: '/video-agent', cors: { origin: '*' } })
export class VideoAgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('VideoAgentGateway');

  constructor(private readonly agents: VideoAgentService) {}

  async handleConnection(client: Socket) {
    const auth = client.handshake.auth || {};
    const agent = await this.agents.authenticate(auth.token as string);
    if (!agent) {
      this.logger.warn(`Rejected agent socket ${client.id}: invalid or revoked token`);
      client.emit('agent:revoked');
      client.disconnect(true);
      return;
    }
    client.data.agentId = agent.id;
    await this.agents.attach(agent.id, client, { encoder: auth.encoder, version: auth.version });
    // The client's 'connect' fires before this async auth finishes — it waits for this instead.
    client.emit('agent:ready');
    this.logger.log(`Agent ${agent.name} connected (${auth.encoder || 'encoder ?'})`);
  }

  handleDisconnect(client: Socket) {
    if (client.data?.agentId) this.agents.detach(client.data.agentId, client);
  }

  private async run(client: Socket, fn: (agentId: string) => Promise<any>) {
    const agentId = client.data?.agentId;
    if (!agentId) return { ok: false, error: 'Not authenticated' };
    try {
      return { ok: true, ...(await fn(agentId)) };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed', status: err?.status };
    }
  }

  @SubscribeMessage('job:pending')
  pending(@ConnectedSocket() client: Socket) {
    return this.run(client, async (agentId) => ({ jobs: await this.agents.pendingFor(agentId) }));
  }

  @SubscribeMessage('job:key')
  key(@ConnectedSocket() client: Socket, @MessageBody() body: { jobId: string }) {
    return this.run(client, (agentId) => this.agents.keyFor(agentId, body?.jobId));
  }

  @SubscribeMessage('job:presign')
  presign(@ConnectedSocket() client: Socket, @MessageBody() body: { jobId: string; paths: string[] }) {
    return this.run(client, (agentId) => this.agents.presign(agentId, body?.jobId, body?.paths));
  }

  @SubscribeMessage('job:status')
  status(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    return this.run(client, (agentId) => this.agents.reportStatus(agentId, body || {}));
  }
}
