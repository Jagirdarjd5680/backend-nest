import { Injectable } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { SessionService } from './session.service';

/**
 * Dedicated socket namespace for account/session security events (right now
 * just "force-logout"). Kept separate from ChatGateway on purpose: this one
 * verifies the JWT itself on connect instead of trusting a raw query param,
 * since a forged "log this user out" or "log me in as them" signal here
 * would actually matter.
 */
@Injectable()
@WebSocketGateway({ namespace: '/session', cors: { origin: '*' } })
export class SessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private sessionService: SessionService,
  ) {}

  async handleConnection(client: Socket) {
    const token = (client.handshake.query?.token as string) || client.handshake.auth?.token;
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      const active = await this.sessionService.isSessionActive(payload.jti);
      if (!active) {
        client.emit('force-logout', { reason: 'session_revoked' });
        client.disconnect(true);
        return;
      }
      client.data.userId = payload.sub;
      client.join(`user_${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // No per-socket bookkeeping needed here — UserSession rows are the source of truth.
  }

  /** Pushed the moment a different device logs in and this session gets revoked. */
  emitForceLogout(userId: number, reason: string) {
    this.server.to(`user_${userId}`).emit('force-logout', { reason });
  }
}
