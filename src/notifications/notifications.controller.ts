import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { FcmService } from './fcm.service';
import { ExpoPushService } from './expo-push.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private service: NotificationsService,
    private fcmService: FcmService,
    private expoPushService: ExpoPushService,
    private prisma: PrismaService,
  ) {}

  @Post('register-token')
  async registerFcmToken(@Request() req: any, @Body() body: { token: string; platform?: string }) {
    await this.prisma.user.update({
      where: { id: req.user.id },
      data: { expoPushToken: body.token, expoPushTokenPlatform: body.platform ?? null },
    });
    return { success: true, message: `Push token registered for user ${req.user.id}` };
  }

  @Post('send')
  async sendPushNotification(@Body() body: { token?: string; topic?: string; title: string; message: string; data?: Record<string, string> }) {
    if (body.topic) {
      return this.fcmService.sendToTopic(body.topic, body.title, body.message, body.data);
    }
    if (body.token) {
      return this.fcmService.sendToDevice(body.token, body.title, body.message, body.data);
    }
    return { success: false, error: 'Provide either token or topic' };
  }

  @Get()
  async findAll() {
    return this.service.findAll();
  }

  @Get('history')
  async findHistory() {
    const data = await this.service.findHistory();
    return { success: true, data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(parseInt(id, 10));
  }

  @Post()
  async create(@Body() body: any) {
    // Only pass through fields the Notification model actually has — callers (e.g. the
    // timetable-sync flow) sometimes include extra context fields like `batch` that would
    // otherwise crash the Prisma insert with "Unknown argument".
    const { title, message, type, recipientRole, recipients, isRead, isSent } = body;
    const notification = await this.service.create({
      title,
      message,
      type,
      recipientRole,
      recipients: recipients || [],
      ...(isRead !== undefined ? { isRead } : {}),
      ...(isSent !== undefined ? { isSent } : {}),
    });

    let pushResult: any = null;
    if (body.sendPush) {
      const result = await this.expoPushService.sendToAudience(recipientRole, recipients, title, message);
      pushResult = {
        success: !!result.success,
        sent: result.sent,
        failed: result.success ? 0 : 1,
        errors: result.success ? [] : [result.reason].filter(Boolean),
      };
    }

    return { success: true, data: notification, pushResult };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
