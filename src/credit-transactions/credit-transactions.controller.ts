import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { CreditTransactionsService } from './credit-transactions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('credits')
@UseGuards(JwtAuthGuard)
export class CreditTransactionsController {
  constructor(private service: CreditTransactionsService) {}

  @Get('history')
  async findHistoryOwn(@Request() req: any) {
    const userId = req.user.id;
    const balance = await this.service.getBalance(userId);
    const history = await this.service.findByUser(userId);
    return {
      success: true,
      balance,
      data: history
    };
  }

  @Get('history/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findHistoryForUser(@Param('userId') userId: string) {
    const numUserId = parseInt(userId, 10);
    const balance = await this.service.getBalance(numUserId);
    const history = await this.service.findByUser(numUserId);
    return {
      success: true,
      balance,
      data: history
    };
  }

  @Post('sync/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async syncUserCredits(@Param('userId') userId: string) {
    const numUserId = parseInt(userId, 10);
    const balance = await this.service.getBalance(numUserId);
    const history = await this.service.findByUser(numUserId);
    return {
      success: true,
      message: `Synchronized token history and updated balance to ${balance}.`,
      balance,
      data: history
    };
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(parseInt(id, 10));
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(@Body() data: any) {
    return this.service.create(data);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
