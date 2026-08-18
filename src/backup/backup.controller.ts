import { Controller, Get, Post, UseGuards, UseInterceptors, UploadedFile, Res, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
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
    const result = await this.backupService.exportAll();
    return {
      success: true,
      message: 'Backup created successfully',
      fileName: result.fileName,
      sizeBytes: result.sizeBytes,
      counts: result.counts,
    };
  }

  @Post('download')
  async downloadBackup(@Res() res: Response) {
    const result = await this.backupService.exportAll();
    return res.download(result.filePath, result.fileName);
  }

  // GET, not POST — this is what the Settings > Backup page's "Download Backup" button hits
  // directly as a blob fetch.
  @Get('export')
  async exportBackup(@Res() res: Response) {
    const result = await this.backupService.exportAll();
    return res.download(result.filePath, result.fileName);
  }

  // A full dump of a 56-table database can easily exceed the default ~100kb JSON body-parser
  // limit, so this takes the file as multipart form-data (multer, memory storage) instead of
  // a raw JSON body — avoids raising the global body-size limit for every other route just to
  // support this one big, rare, admin-only upload.
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }))
  async importBackup(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No backup file was uploaded.');
    }
    return this.backupService.importAll(file.buffer.toString('utf-8'));
  }

  @Post('cleanup-logs')
  async cleanupLogs() {
    return this.backupService.cleanupLogs();
  }
}
