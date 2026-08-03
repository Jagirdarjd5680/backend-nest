import { Controller, Get, Post, UseGuards, Res } from '@nestjs/common';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Response } from 'express';

@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class BackupController {
  constructor(private backupService: BackupService) {}

  @Get()
  async listBackups() {
    return this.backupService.listBackups();
  }

  @Post('create')
  async createBackup() {
    const result = await this.backupService.createBackup();
    return {
      success: true,
      message: 'Backup created successfully',
      fileName: result.fileName,
      sizeBytes: result.sizeBytes,
    };
  }

  @Post('download')
  async downloadBackup(@Res() res: Response) {
    const result = await this.backupService.createBackup();
    return res.download(result.filePath, result.fileName);
  }

  @Post('cleanup-logs')
  async cleanupLogs() {
    return this.backupService.cleanupLogs();
  }
}
