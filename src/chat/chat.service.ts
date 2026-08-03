import { Injectable, Inject, forwardRef, ForbiddenException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExpoPushService } from '../notifications/expo-push.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatGateway } from './chat.gateway';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expoPushService: ExpoPushService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * Push a message to whichever room is listening for it over the live socket
   * connection — this is what makes web/REST-originated sends (chat.controller.ts
   * POST /chat/send) show up instantly on the other side instead of only after a
   * manual refresh. Only targets the receiver's (and session's) room — never the
   * sender's, since the sender already has the message from its own REST response
   * or socket echo.
   */
  private broadcastMessage(message: any) {
    const receiverRoom = `user_${message.receiverId}`;
    this.chatGateway.server.to(receiverRoom).emit('message_received', message);
    console.log(`[ChatService] Broadcast message ${message.id} to room ${receiverRoom}`);
    if (message.sessionId) {
      this.chatGateway.server.to(`session_${message.sessionId}`).emit('message_received', message);
    }
  }

  /** Tell the other side their sent messages were just seen, so their UI can flip to double-tick live. */
  private broadcastRead(readerUserId: number, otherUserId: number) {
    this.chatGateway.server.to(`user_${otherUserId}`).emit('messages_read', { by: readerUserId });
    console.log(`[ChatService] messages_read: ${readerUserId} read ${otherUserId}'s messages`);
  }

  /**
   * Get direct chat history between current user and target user
   */
  async getHistory(targetUserId: number, currentUserId: number) {
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        AND: [
          {
            OR: [
              { senderId: currentUserId, receiverId: targetUserId },
              { senderId: targetUserId, receiverId: currentUserId },
            ],
          },
          { sessionId: null },
          // hiddenFrom stores a comma-wrapped list of user ids that cleared this
          // message for themselves (",3,7," etc) — the vast majority of rows have
          // it NULL (never cleared by anyone), and `NOT: { contains }` on a NULL
          // column is SQL NULL (excluded by WHERE), so it must be OR'd with the
          // null case explicitly or every un-cleared message vanishes.
          { OR: [{ hiddenFrom: null }, { NOT: { hiddenFrom: { contains: `,${currentUserId},` } } }] },
        ],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, name: true, role: true, avatar: true } },
        receiver: { select: { id: true, name: true, role: true, avatar: true } },
      },
    });

    // Mark unread messages from target user as read
    const { count } = await this.prisma.chatMessage.updateMany({
      where: { senderId: targetUserId, receiverId: currentUserId, isRead: false },
      data: { isRead: true },
    });
    if (count > 0) this.broadcastRead(currentUserId, targetUserId);

    return { success: true, data: messages };
  }

  /**
   * Get support session chat history
   */
  async getSessionHistory(sessionId: string) {
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, name: true, role: true, avatar: true } },
        receiver: { select: { id: true, name: true, role: true, avatar: true } },
      },
    });

    return { success: true, data: messages };
  }

  /**
   * Send a chat message with spam prevention & auto-responder
   */
  async sendMessage(dto: SendMessageDto, senderId: number, senderRole: string) {
    const receiverId = dto.receiver;

    // Check if sender user exists and is not blocked
    const sender = await this.prisma.user.findUnique({ where: { id: senderId } });
    if (!sender) {
      throw new NotFoundException('User not found');
    }
    if (sender.isBlockedFromChat) {
      throw new ForbiddenException('You have been blocked from chat by the admin.');
    }

    // --- Spam prevention & auto-response logic for students ---
    if (senderRole === 'student') {
      const whereCondition = dto.sessionId
        ? { sessionId: dto.sessionId }
        : {
            OR: [
              { senderId, receiverId },
              { senderId: receiverId, receiverId: senderId },
            ],
            sessionId: null,
          };

      const recentMessages = await this.prisma.chatMessage.findMany({
        where: whereCondition,
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const isVeryFirstMessage = recentMessages.length === 0;

      // Count consecutive messages from student without reply
      let consecutiveCount = 0;
      for (const msg of recentMessages) {
        if (msg.senderId === senderId) {
          consecutiveCount++;
        } else {
          break;
        }
      }

      if (consecutiveCount >= 2) {
        throw new HttpException(
          { success: false, message: 'Please wait for a response before sending more messages.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Auto-response for first message ever
      if (isVeryFirstMessage) {
        setTimeout(async () => {
          try {
            const autoMessage = await this.prisma.chatMessage.create({
              data: {
                senderId: receiverId,
                receiverId: senderId,
                message: 'Thank you for reaching out! We will connect with you soon.',
                sessionId: dto.sessionId || null,
                isAutoResponse: true,
              },
              include: {
                sender: { select: { id: true, name: true, role: true, avatar: true } },
                receiver: { select: { id: true, name: true, role: true, avatar: true } },
              },
            });
            this.broadcastMessage(autoMessage);
            this.expoPushService
              .sendToUser(senderId, 'Support', 'Thank you for reaching out! We will connect with you soon.', {
                type: 'chat_message',
                senderId: String(receiverId),
                sessionId: dto.sessionId ?? '',
              })
              .catch(() => {});
          } catch (err) {
            // silent catch
          }
        }, 1000);
      }
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        senderId,
        receiverId,
        message: dto.message || '',
        image: dto.image || null,
        sessionId: dto.sessionId || null,
      },
      include: {
        sender: { select: { id: true, name: true, role: true, avatar: true } },
        receiver: { select: { id: true, name: true, role: true, avatar: true } },
      },
    });

    console.log(`[ChatService] Message ${message.id} created: ${senderId} -> ${receiverId}`);
    this.broadcastMessage(message);

    this.expoPushService
      .sendToUser(receiverId, message.sender?.name ?? 'New message', dto.message || 'Sent an image', {
        type: 'chat_message',
        senderId: String(senderId),
        sessionId: dto.sessionId ?? '',
      })
      .catch(() => {});

    return { success: true, data: message };
  }

  /** Admin broadcast: same message sent 1:1 to an explicit list of recipients. */
  async bulkSend(receiverIds: number[], message: string, senderId: number, senderRole: string) {
    const results = await this._sendToMany(receiverIds, message, senderId, senderRole);
    return { success: true, message: `Message sent to ${results.length} user(s)` };
  }

  /** Admin broadcast: same message sent 1:1 to every active, non-deleted student. */
  async bulkSendToAll(message: string, senderId: number, senderRole: string) {
    const students = await this.prisma.user.findMany({
      where: { role: 'student', isActive: true, isDeleted: false, id: { not: senderId } },
      select: { id: true },
    });
    const results = await this._sendToMany(
      students.map((s) => s.id),
      message,
      senderId,
      senderRole,
    );
    return { success: true, message: `Message sent to ${results.length} student(s)` };
  }

  /** Sequential, not Promise.all — a broadcast to hundreds of students shouldn't blow through the DB pool at once. */
  private async _sendToMany(receiverIds: number[], message: string, senderId: number, senderRole: string) {
    const results: any[] = [];
    for (const receiverId of receiverIds) {
      try {
        const result = await this.sendMessage({ receiver: receiverId, message }, senderId, senderRole);
        results.push(result.data);
      } catch (err) {
        console.log(`[ChatService] Bulk send to ${receiverId} failed: ${(err as Error).message}`);
      }
    }
    return results;
  }

  /**
   * Get list of users with active chat history — plus support/admin, who is always
   * shown even with zero prior messages so there's always someone to message from
   * the chat tab, instead of a new user seeing a permanently empty list.
   */
  async getRecentChatUsers(currentUserId: number) {
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        OR: [{ senderId: currentUserId }, { receiverId: currentUserId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        sender: { select: { id: true, name: true, email: true, role: true, avatar: true, isBlockedFromChat: true, lastSeenAt: true } },
        receiver: { select: { id: true, name: true, email: true, role: true, avatar: true, isBlockedFromChat: true, lastSeenAt: true } },
      },
    });

    // The frontend chat sidebar (ChatSidebar.jsx) renders each entry as a flat
    // user object with a `lastMessage: { message, createdAt }` field and an
    // `unreadCount` badge — it does not know about a `{ user, lastMessage }`
    // wrapper, so keep this shape flat rather than nesting `user`.
    const userMap = new Map<number, any>();
    for (const msg of messages) {
      const partner = msg.senderId === currentUserId ? msg.receiver : msg.sender;
      if (partner && partner.id !== currentUserId && !userMap.has(partner.id)) {
        const { lastSeenAt, ...rest } = partner;
        userMap.set(partner.id, {
          ...rest,
          lastSeen: lastSeenAt,
          isOnline: this.chatGateway.isOnline(partner.id),
          lastMessage: { message: msg.message, createdAt: msg.createdAt },
          unreadCount: 0,
        });
      }
    }

    const unreadCounts = await this.prisma.chatMessage.groupBy({
      by: ['senderId'],
      where: { receiverId: currentUserId, isRead: false },
      _count: { _all: true },
    });
    for (const row of unreadCounts) {
      const entry = userMap.get(row.senderId);
      if (entry) entry.unreadCount = row._count._all;
    }

    const list = Array.from(userMap.values());

    const supportContact = await this._getSupportContact(currentUserId);
    if (supportContact && !userMap.has(supportContact.id)) {
      const { lastSeenAt, ...rest } = supportContact as any;
      list.unshift({
        ...rest,
        lastSeen: lastSeenAt,
        isOnline: this.chatGateway.isOnline(supportContact.id),
        lastMessage: null,
        unreadCount: 0,
      });
    }

    return { success: true, data: list };
  }

  /** The account shown to every student as "chat with support" — the oldest active admin. */
  private async _getSupportContact(excludeUserId: number) {
    if (!excludeUserId) return null;
    return this.prisma.user.findFirst({
      where: { role: 'admin', isActive: true, id: { not: excludeUserId } },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, email: true, role: true, avatar: true, isBlockedFromChat: true, lastSeenAt: true },
    });
  }

  /**
   * Mark messages from partner as read
   */
  async markAsRead(targetUserId: number, currentUserId: number) {
    const { count } = await this.prisma.chatMessage.updateMany({
      where: { senderId: targetUserId, receiverId: currentUserId, isRead: false },
      data: { isRead: true },
    });
    if (count > 0) this.broadcastRead(currentUserId, targetUserId);

    return { success: true, message: 'Messages marked as read' };
  }

  /** Basic profile + online/last-seen/block status for the chat header. */
  async getUserSummary(targetUserId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, role: true, avatar: true, lastSeenAt: true, isBlockedFromChat: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const { lastSeenAt, ...rest } = user;
    return {
      success: true,
      data: { ...rest, lastSeen: lastSeenAt, isOnline: this.chatGateway.isOnline(targetUserId) },
    };
  }

  /** Admin-only: toggle whether a user can send chat messages system-wide. */
  async toggleBlockFromChat(targetUserId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { isBlockedFromChat: true } });
    if (!user) throw new NotFoundException('User not found');

    const isBlockedFromChat = !user.isBlockedFromChat;
    await this.prisma.user.update({ where: { id: targetUserId }, data: { isBlockedFromChat } });

    // Real-time: the blocked user's own chat screen disables instantly, and anyone
    // currently chatting with them (e.g. the admin who just blocked them) sees it too.
    this.chatGateway.server.emit('chat_block_status', { userId: targetUserId, isBlockedFromChat });

    return {
      success: true,
      message: isBlockedFromChat ? 'User blocked from chat' : 'User unblocked from chat',
      isBlockedFromChat,
    };
  }

  /**
   * "Clear chat" for the requesting user only — appends their id to hiddenFrom
   * on every message in this conversation rather than deleting rows, so the
   * other participant's history is untouched.
   */
  async clearChatForMe(targetUserId: number, currentUserId: number) {
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        OR: [
          { senderId: currentUserId, receiverId: targetUserId },
          { senderId: targetUserId, receiverId: currentUserId },
        ],
        sessionId: null,
      },
      select: { id: true, hiddenFrom: true },
    });

    await Promise.all(
      messages
        .filter((m) => !(m.hiddenFrom ?? '').includes(`,${currentUserId},`))
        .map((m) =>
          this.prisma.chatMessage.update({
            where: { id: m.id },
            data: { hiddenFrom: `${m.hiddenFrom ?? ','}${currentUserId},` },
          }),
        ),
    );

    return { success: true, message: 'Chat cleared' };
  }
}
