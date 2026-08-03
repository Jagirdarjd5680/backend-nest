import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { BatchMaterialsService } from './batch-materials.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('batch-materials')
@UseGuards(JwtAuthGuard)
export class BatchMaterialsController {
  private readonly logger = new Logger(BatchMaterialsController.name);

  constructor(private service: BatchMaterialsService) {}

  @Get()
  async findAll() {
    return this.service.findAll();
  }

  // Must stay ahead of ':batchId' below, or Nest would match "my-course" as the batchId param.
  @Get('my-course/:courseId')
  async getMyMaterialsForCourse(@Param('courseId') courseId: string, @Request() req: any) {
    const numId = parseInt(courseId, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid Course ID' };
    return this.service.getMyMaterialsForCourse(req.user.id, numId);
  }

  @Get(':batchId/all')
  async getAllForBatch(@Param('batchId') batchId: string) {
    const numId = parseInt(batchId, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid Batch ID' };
    return this.service.findAllForBatch(numId);
  }

  @Get(':batchId')
  async findByBatch(
    @Param('batchId') batchId: string,
    @Query('parent') parent?: string,
  ) {
    const numId = parseInt(batchId, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid Batch ID' };

    let parentId: number | null = null;
    if (parent && parent !== 'null' && parent !== 'undefined') {
      parentId = parseInt(parent, 10);
      if (isNaN(parentId)) parentId = null;
    }

    return this.service.findByBatch(numId, parentId);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadsDir = join(process.cwd(), 'uploads');
          if (!existsSync(uploadsDir)) {
            mkdirSync(uploadsDir, { recursive: true });
          }
          cb(null, uploadsDir);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
          cb(null, `${uniqueSuffix}-${originalName}`);
        },
      }),
      limits: {
        fileSize: 1000 * 1024 * 1024, // 1GB
      },
    }),
  )
  async uploadFile(@UploadedFile() file: any, @Body() body: any) {
    this.logger.log(`[UPLOAD BATCH MATERIAL] File: ${file?.originalname}, Payload: ${JSON.stringify(body)}`);
    return this.service.uploadFile(file, body);
  }

  @Post('from-media')
  async addFromMedia(@Body() body: any) {
    this.logger.log(`[ADD FROM MEDIA] Payload: ${JSON.stringify(body)}`);
    return this.service.addFromMedia(body);
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() body: { ids: any[] }) {
    this.logger.log(`[BULK DELETE BATCH MATERIALS] IDs: ${JSON.stringify(body.ids)}`);
    return this.service.bulkDelete(body.ids || []);
  }

  @Post()
  async create(@Body() data: any) {
    this.logger.log(`[CREATE BATCH MATERIAL] Payload: ${JSON.stringify(data)}`);
    return this.service.create(data);
  }

  @Put(':id')
  async updatePut(@Param('id') id: string, @Body() data: any) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.update(numId, data);
  }

  @Patch(':id')
  async updatePatch(@Param('id') id: string, @Body() data: any) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.update(numId, data);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.remove(numId);
  }
}
