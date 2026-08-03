import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, UseInterceptors, UploadedFile, Request } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModulePermissionsGuard } from '../auth/module-permissions.guard';
import { RequireModulePermission } from '../auth/module-permissions.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

// NOTE: chat is used by every role (students chat from the mobile app too), so
// routes here are deliberately NOT restricted by @Roles() — ModulePermissionsGuard
// only ever restricts `teacher` accounts, everyone else passes through untouched.
@Controller('chat')
@UseGuards(JwtAuthGuard, ModulePermissionsGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @RequireModulePermission('chat', 'view')
  @Get('history/:userId')
  async getHistory(@Param('userId') userId: string, @Request() req: any) {
    const currentUserId = Number(req.user.id || req.user._id);
    const targetUserId = parseInt(userId, 10);
    return this.chatService.getHistory(targetUserId, currentUserId);
  }

  @RequireModulePermission('chat', 'view')
  @Get('session-history/:sessionId')
  async getSessionHistory(@Param('sessionId') sessionId: string) {
    return this.chatService.getSessionHistory(sessionId);
  }

  @RequireModulePermission('chat', 'add')
  @Post('send')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadsDir = join(process.cwd(), 'uploads', 'chat');
          if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
          cb(null, uploadsDir);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
          cb(null, `${uniqueSuffix}-${originalName}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — matches the client-side check in ChatMessageArea.jsx
    }),
  )
  async sendMessage(@UploadedFile() file: any, @Body() dto: SendMessageDto, @Request() req: any) {
    const senderId = Number(req.user.id || req.user._id);
    const senderRole = req.user.role || 'student';
    // Image arrives as a multipart file when sent from the chat UI (FormData);
    // `dto.image` stays available for callers that pass an already-hosted URL instead.
    if (file) dto.image = `/uploads/chat/${file.filename}`;
    console.log(`[ChatController] POST /chat/send from ${senderId} (${senderRole}) to ${dto.receiver}${file ? ' with image' : ''}`);
    return this.chatService.sendMessage(dto, senderId, senderRole);
  }

  @RequireModulePermission('chat', 'view')
  @Get('users')
  async getRecentChatUsers(@Request() req: any) {
    const currentUserId = Number(req.user.id || req.user._id);
    return this.chatService.getRecentChatUsers(currentUserId);
  }

  @Post('read/:userId')
  async markAsRead(@Param('userId') userId: string, @Request() req: any) {
    const currentUserId = Number(req.user.id || req.user._id);
    const targetUserId = parseInt(userId, 10);
    return this.chatService.markAsRead(targetUserId, currentUserId);
  }

  @RequireModulePermission('chat', 'view')
  @Get('user/:userId')
  async getUserSummary(@Param('userId') userId: string) {
    return this.chatService.getUserSummary(parseInt(userId, 10));
  }

  @RequireModulePermission('chat', 'add')
  @Delete('clear/:userId')
  async clearChat(@Param('userId') userId: string, @Request() req: any) {
    const currentUserId = Number(req.user.id || req.user._id);
    const targetUserId = parseInt(userId, 10);
    return this.chatService.clearChatForMe(targetUserId, currentUserId);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Put('block/:userId')
  async toggleBlock(@Param('userId') userId: string) {
    return this.chatService.toggleBlockFromChat(parseInt(userId, 10));
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Post('bulk-send')
  async bulkSend(@Body() body: { receivers: (number | string)[]; message: string }, @Request() req: any) {
    const senderId = Number(req.user.id || req.user._id);
    const senderRole = req.user.role || 'admin';
    return this.chatService.bulkSend(body.receivers.map(Number), body.message, senderId, senderRole);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Post('bulk-send-all')
  async bulkSendToAll(@Body() body: { message: string }, @Request() req: any) {
    const senderId = Number(req.user.id || req.user._id);
    const senderRole = req.user.role || 'admin';
    return this.chatService.bulkSendToAll(body.message, senderId, senderRole);
  }
}
