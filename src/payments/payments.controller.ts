import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request, Headers } from '@nestjs/common';
import { assertOwnsRow, assertSelfOrStaff } from '../common/access';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/create-payment.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { normalizePlatform } from '../common/platform';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private service: PaymentsService) {}

  @Post('test/initiate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async initiateTestPayment(@Body() body: { gateway: string; amount: number | string }) {
    return this.service.initiateTestPayment(body.gateway, body.amount);
  }

  @Post('create-order')
  async createOrder(@Request() req: any, @Body() dto: CreateOrderDto, @Headers('x-platform') platformHeader?: string) {
    return this.service.createOrder(req.user.id, dto, normalizePlatform(platformHeader));
  }

  @Post('verify')
  async verifyPayment(@Request() req: any, @Body() dto: VerifyPaymentDto) {
    return this.service.verifyPayment(req.user.id, dto);
  }

  @Get('my-payments')
  async getMyPayments(@Request() req: any) {
    const data = await this.service.findByUser(req.user.id);
    return { success: true, data };
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findAll() {
    return this.service.findAll();
  }

  @Get('user/:userId')
  async findByUser(@Param('userId') userId: string, @Request() req: any) {
    assertSelfOrStaff(req.user, parseInt(userId, 10));
    const data = await this.service.findByUser(parseInt(userId, 10));
    return { success: true, data };
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getStats() {
    const data = await this.service.getStats();
    return { success: true, data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return assertOwnsRow(req.user, await this.service.findOne(parseInt(id, 10)), (p: any) => p.userId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(@Body() data: CreatePaymentDto) {
    return this.service.create(data);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() data: UpdatePaymentDto) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
