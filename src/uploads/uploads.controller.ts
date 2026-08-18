import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadsService } from './uploads.service';
import { UploadChunkDto } from './dto/upload-chunk.dto';
import { QueryUploadsDto } from './dto/query-uploads.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import * as multer from 'multer';

@SkipThrottle()
@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 5000 * 1024 * 1024 }, // 5GB limit
    }),
  )
  async directUpload(
    @UploadedFile() file: any,
    @Body() body: { title?: string; courseId?: string },
    @Request() req: any,
  ) {
    const rawUserId = req.user?.id ?? req.user?._id ?? 'system';
    const userId = String(rawUserId);
    return this.uploadsService.handleDirectUpload(file, body, userId);
  }

  @Post('import-url')
  async importUrl(@Body() body: { title?: string; url?: string; type?: string }, @Request() req: any) {
    const rawUserId = req.user?.id ?? req.user?._id ?? 'system';
    const userId = String(rawUserId);
    return this.uploadsService.importUrl(body, userId);
  }

  @Post('chunk')
  @UseInterceptors(
    FileInterceptor('chunk', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per chunk limit
    }),
  )
  async chunkUpload(
    @UploadedFile() file: any,
    @Body() dto: UploadChunkDto,
    @Request() req: any,
  ) {
    const rawUserId = req.user?.id ?? req.user?._id ?? 'system';
    const userId = String(rawUserId);
    return this.uploadsService.handleChunkUpload(file, dto, userId);
  }

  @Get()
  async findAll(@Query() queryDto: QueryUploadsDto, @Request() req: any) {
    const rawUserId = req.user?.id ?? req.user?._id ?? 'system';
    const userId = String(rawUserId);
    const userRole = req.user?.role || 'admin';
    return this.uploadsService.findAll(queryDto, { id: userId, role: userRole });
  }

  @Get('stats')
  async getStats() {
    return this.uploadsService.getStats();
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() dto: BulkDeleteDto, @Request() req: any) {
    const rawUserId = req.user?.id ?? req.user?._id ?? 'system';
    const userId = String(rawUserId);
    const userRole = req.user?.role || 'admin';
    return this.uploadsService.bulkDelete(dto, { id: userId, role: userRole });
  }

  @Delete(':filename')
  async remove(@Param('filename') filename: string, @Request() req: any) {
    const rawUserId = req.user?.id ?? req.user?._id ?? 'system';
    const userId = String(rawUserId);
    const userRole = req.user?.role || 'admin';
    return this.uploadsService.remove(filename, { id: userId, role: userRole });
  }
}
