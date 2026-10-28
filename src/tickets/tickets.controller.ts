import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { assertOwnsRow, isStaff } from '../common/access';

/** Staff manage every ticket; anyone else only sees and changes their own. */
@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private service: TicketsService) {}

  private async owned(id: string, user: any) {
    return assertOwnsRow(user, await this.service.findOne(parseInt(id, 10)).catch(() => null), (r: any) => r.userId);
  }

  @Get()
  async findAll(@Request() req: any) {
    return this.service.findAll(isStaff(req.user) ? undefined : req.user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.owned(id, req.user);
  }

  @Post()
  async create(@Body() data: any, @Request() req: any) {
    return this.service.create(isStaff(req.user) ? data : { ...data, userId: req.user.id });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    await this.owned(id, req.user);
    const { userId, ...rest } = data || {};
    return this.service.update(parseInt(id, 10), isStaff(req.user) ? data : rest);
  }

  @Post(':id/reply')
  async reply(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    await this.owned(id, req.user);
    const author = isStaff(req.user) ? 'Support team' : req.user.name || 'Student';
    return this.service.reply(parseInt(id, 10), data?.text ?? data?.message, author);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    await this.owned(id, req.user);
    return this.service.remove(parseInt(id, 10));
  }
}
