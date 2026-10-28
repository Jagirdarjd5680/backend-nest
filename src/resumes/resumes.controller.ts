import { Controller, Get, Post, Patch, Put, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ResumesService } from './resumes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { assertOwnsRow, isStaff } from '../common/access';

/**
 * Staff manage every resume; anyone else only sees and changes their own.
 * Responses are `{ success, data }` — the web ResumeBuilder reads `res.data.data`.
 */
@Controller('resumes')
@UseGuards(JwtAuthGuard)
export class ResumesController {
  constructor(private service: ResumesService) {}

  private async owned(id: string, user: any) {
    return assertOwnsRow(user, await this.service.findOne(parseInt(id, 10)).catch(() => null), (r: any) => r.userId);
  }

  @Get()
  async findAll(@Request() req: any) {
    return { success: true, data: await this.service.findAll(isStaff(req.user) ? undefined : req.user.id) };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return { success: true, data: await this.owned(id, req.user) };
  }

  @Post()
  async create(@Body() data: any, @Request() req: any) {
    // Staff may create for a student (`userId`); otherwise it's always the caller's own.
    const userId = isStaff(req.user) && data?.userId ? Number(data.userId) : req.user.id;
    return { success: true, data: await this.service.create({ ...data, userId }) };
  }

  @Put(':id')
  async replace(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    return this.update(id, data, req);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    await this.owned(id, req.user);
    return { success: true, data: await this.service.update(parseInt(id, 10), data) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    await this.owned(id, req.user);
    await this.service.remove(parseInt(id, 10));
    return { success: true };
  }
}
