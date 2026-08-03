import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ChatService } from './chat.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // How many sockets a user currently has open, so a duplicate tab/reconnect
  // doesn't flip presence to "offline" the moment one of them disconnects.
  private readonly onlineCounts = new Map<number, number>();

  constructor(
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  isOnline(userId: number): boolean {
    return (this.onlineCounts.get(userId) ?? 0) > 0;
  }

  /**
   * Verifies the connecting client's JWT instead of trusting a raw `userId` query
   * param (the old behaviour let anyone connect claiming to be any user and both
   * read their messages and send messages impersonating them) — same approach
   * already used by SessionGateway for the same reason.
   */
  handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token as string) || (client.handshake.query?.token as string);
    if (!token) {
      console.log(`[ChatGateway] Rejected socket ${client.id}: no auth token in handshake`);
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      client.join(`user_${payload.sub}`);
      console.log(`[ChatGateway] User ${payload.sub} connected: socket ${client.id}`);

      const wasOffline = !this.isOnline(payload.sub);
      this.onlineCounts.set(payload.sub, (this.onlineCounts.get(payload.sub) ?? 0) + 1);
      if (wasOffline) {
        this.server.emit('presence', { userId: payload.sub, online: true, lastSeenAt: null });
      }
    } catch (err) {
      console.log(`[ChatGateway] Rejected socket ${client.id}: invalid token (${(err as Error).message})`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    console.log(`[ChatGateway] User ${userId ?? '(unknown)'} disconnected`);
    if (!userId) return;

    const remaining = Math.max((this.onlineCounts.get(userId) ?? 1) - 1, 0);
    if (remaining > 0) {
      this.onlineCounts.set(userId, remaining);
      return;
    }
    this.onlineCounts.delete(userId);

    const lastSeenAt = new Date();
    await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt } }).catch(() => {});
    this.server.emit('presence', { userId, online: false, lastSeenAt: lastSeenAt.toISOString() });
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(@MessageBody() data: { room: string }, @ConnectedSocket() client: Socket) {
    client.join(data.room);
    return { event: 'joined', room: data.room };
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(@MessageBody() data: { room: string }, @ConnectedSocket() client: Socket) {
    client.leave(data.room);
    return { event: 'left', room: data.room };
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody() data: { receiver: number; message?: string; image?: string; sessionId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!client.data?.userId) return { success: false, message: 'Not authenticated' };
    console.log(`[ChatGateway] send_message from ${client.data.userId} to ${data.receiver}`);

    try {
      const result = await this.chatService.sendMessage(
        {
          receiver: data.receiver,
          message: data.message,
          image: data.image,
          sessionId: data.sessionId,
        },
        client.data.userId,
        client.data.role || 'student',
      );

      // chatService.sendMessage() already broadcast to the receiver's (and session's)
      // room — this only echoes back to the sender's own socket, since it doesn't
      // append the sent message locally and relies on this event to show it (see
      // native-app/src/screens/chatConversation/Screen.tsx).
      client.emit('message_received', result.data);

      return result;
    } catch (err: any) {
      // e.g. blocked-from-chat or the spam-throttle exception — surface it instead
      // of leaving the client waiting forever for a message_received that never comes.
      return { success: false, message: err?.response?.message || err?.message || 'Failed to send message' };
    }
  }

  @SubscribeMessage('typing_status')
  handleTyping(
    @MessageBody() data: { receiverId: number; isTyping: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    if (!client.data?.userId) return;
    const targetRoom = `user_${data.receiverId}`;
    console.log(`[ChatGateway] typing_status ${client.data.userId} -> ${data.receiverId}: ${data.isTyping}`);
    this.server.to(targetRoom).emit('typing_status', {
      senderId: client.data.userId,
      isTyping: data.isTyping,
    });
  }
}
