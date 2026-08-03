import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('referrals')
export class ReferralsController {
  constructor(private service: ReferralsService) {}

  // GET /api/referrals/stats
  @UseGuards(JwtAuthGuard)
  @Get('stats')
  async getStats(@Request() req: any) {
    return this.service.getStats(req.user.id);
  }

  // POST /api/referrals/join-request
  @UseGuards(JwtAuthGuard)
  @Post('join-request')
  async submitJoinRequest(@Request() req: any) {
    return this.service.submitJoinRequest(req.user.id);
  }

  // GET /api/referrals/admin/join-requests
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('admin/join-requests')
  async getAdminJoinRequests() {
    return this.service.getAdminJoinRequests();
  }

  // PUT /api/referrals/admin/join-requests/:id/process
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Put('admin/join-requests/:id/process')
  async processJoinRequest(@Param('id') id: string, @Body() body: any) {
    return this.service.processJoinRequest(parseInt(id, 10), body.status, body.adminMessage);
  }

  // GET /api/referrals/leaderboard
  @Get('leaderboard')
  async getLeaderboard() {
    return this.service.getLeaderboard();
  }

  // POST /api/referrals/withdraw
  @UseGuards(JwtAuthGuard)
  @Post('withdraw')
  async submitWithdrawal(@Request() req: any, @Body() body: any) {
    return this.service.submitWithdrawal(req.user.id, body.amount, body.points, body.upiId);
  }

  // GET /api/referrals/my-withdrawals
  @UseGuards(JwtAuthGuard)
  @Get('my-withdrawals')
  async getMyWithdrawals(@Request() req: any) {
    return this.service.getMyWithdrawals(req.user.id);
  }

  // GET /api/referrals/admin/withdrawals
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('admin/withdrawals')
  async getAdminWithdrawals() {
    return this.service.getAdminWithdrawals();
  }

  // PUT /api/referrals/admin/withdrawals/:id
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Put('admin/withdrawals/:id')
  @UseInterceptors(
    FileInterceptor('screenshot', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadsDir = join(process.cwd(), 'uploads', 'withdrawals');
          if (!existsSync(uploadsDir)) {
            mkdirSync(uploadsDir, { recursive: true });
          }
          cb(null, uploadsDir);
        },
        filename: (req, file, cb) => {
          cb(null, `withdrawal_${Date.now()}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async updateAdminWithdrawal(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() file?: any,
  ) {
    let screenshotUrl = body.screenshotUrl;
    if (file) {
      screenshotUrl = `/uploads/withdrawals/${file.filename}`;
    }
    return this.service.updateAdminWithdrawal(
      parseInt(id, 10),
      body.status,
      body.transactionId,
      body.adminNote,
      screenshotUrl,
    );
  }

  // GET /api/referrals/admin/all
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('admin/all')
  async getAdminAllReferrals() {
    return this.service.getAdminAllReferrals();
  }

  // PUT /api/referrals/admin/records/:id/process
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Put('admin/records/:id/process')
  async processReferralRecord(@Param('id') id: string, @Body() body: any) {
    return this.service.processReferralRecord(parseInt(id, 10), body.status);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll() {
    return this.service.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.findOne(numId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Body() data: any) {
    return this.service.create(data);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
