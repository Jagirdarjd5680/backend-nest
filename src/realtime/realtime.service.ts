import { Injectable } from '@nestjs/common';
import { ChatGateway } from '../chat/chat.gateway';

/**
 * General-purpose real-time broadcaster for app-wide events (referral approved,
 * assignment graded, admin table row added/updated/deleted, etc.) — anything that
 * isn't a chat message. Reuses ChatGateway's socket server instead of opening a
 * second gateway on the same default namespace (Socket.IO gives one client
 * connection per namespace, and the frontend's single `socket` singleton in
 * src/realtime/socketClient.js already connects to the default namespace with a
 * verified JWT, auto-joining `user_${id}` — see chat.gateway.ts#handleConnection).
 *
 * Frontend contract: emits `realtime_update` shaped as `{ type, data, timestamp }`,
 * matching what AuthContext.jsx already listens for (a holdover from the old Express
 * backend's utils/socketEmitter.js, which this replaces — that file talked to
 * `req.app.get('io')`, an Express-only pattern that silently no-ops under Nest and
 * was never actually wired into any route).
 *
 * To add a new real-time feature: inject RealtimeService into that feature's
 * service/controller and call emitToUser/emitToRoom after the write succeeds, then
 * add a `case` for the new `type` in AuthContext.jsx's toast switch (or a more
 * specific listener if it needs to update a table instead of just notifying).
 */
@Injectable()
export class RealtimeService {
  constructor(private readonly chatGateway: ChatGateway) {}

  emitToUser(userId: number | string, type: string, data: Record<string, any> = {}) {
    this.emitToRoom(`user_${userId}`, type, data);
  }

  emitToRoom(room: string, type: string, data: Record<string, any> = {}) {
    if (!this.chatGateway.server) {
      console.warn(`[RealtimeService] Socket server not ready yet — dropped ${type} to ${room}`);
      return;
    }
    console.log(`[RealtimeService] ${type} -> ${room}`);
    this.chatGateway.server.to(room).emit('realtime_update', {
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /** Broadcast to everyone currently connected — use sparingly (e.g. site-wide banner). */
  emitToAll(type: string, data: Record<string, any> = {}) {
    if (!this.chatGateway.server) return;
    console.log(`[RealtimeService] ${type} -> (all)`);
    this.chatGateway.server.emit('realtime_update', { type, data, timestamp: new Date().toISOString() });
  }
}
