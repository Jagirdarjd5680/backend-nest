import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

/**
 * Admin-only namespace for real-time Recycle Bin updates — separate from ChatGateway (student
 * facing, unauthenticated) and SessionGateway (per-user session security). Every connecting
 * client must present a valid admin JWT; anyone else gets disconnected immediately so a random
 * student can't listen in on "which users just got archived".
 */
@Injectable()
@WebSocketGateway({ namespace: '/admin/recycle-bin', cors: { origin: '*' } })
export class UsersRecycleBinGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private jwtService: JwtService) {}

  handleConnection(client: Socket) {
    const token = (client.handshake.query?.token as string) || client.handshake.auth?.token;
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      if (payload.role !== 'admin') {
        client.disconnect(true);
        return;
      }
      client.join('admins');
    } catch {
      client.disconnect(true);
    }
  }

  /** event: "archived" | "restored" | "permanently_deleted" */
  emitRecycleBinChange(event: string, count: number) {
    this.server.to('admins').emit('recycle-bin-change', { event, count });
  }
}
