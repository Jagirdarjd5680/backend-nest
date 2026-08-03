import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.coupon.findMany();
  }

  async findOne(id: number) {
    const item = await this.prisma.coupon.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Coupon with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.coupon.create({ data: this.normalizeInput(data) });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.coupon.update({ where: { id }, data: this.normalizeInput(data) });
  }

  // The frontend form works with a richer coupon shape (discountType/discountValue/endDate/etc.)
  // than the original minimal schema (discount/expiry). Keep discount/expiry in sync so the
  // existing checkout logic in payments.service.ts (which only reads those two fields) still works.
  private normalizeInput(data: any) {
    const { code, ...rest } = data;
    const normalized: any = { ...rest };
    if (code) normalized.code = String(code).trim().toUpperCase();

    if (rest.discountValue !== undefined) normalized.discount = Number(rest.discountValue);
    if (rest.endDate) normalized.expiry = new Date(rest.endDate);
    if (rest.startDate) normalized.startDate = new Date(rest.startDate);
    if (rest.endDate) normalized.endDate = new Date(rest.endDate);

    return normalized;
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.coupon.delete({ where: { id } });
  }

  // ─── Step 3: Pre-Checkout Coupon Validation ─────────────────────────────
  async validateCoupon(code: string, purchaseAmount: number, userId?: number, courseId?: number) {
    if (!code) throw new BadRequestException('Coupon code is required');

    const coupon = await this.prisma.coupon.findFirst({
      where: { code: code.trim().toUpperCase() },
    });

    if (!coupon) throw new NotFoundException('Invalid coupon code');

    const now = new Date();
    if (coupon.expiry && now > coupon.expiry) {
      throw new BadRequestException('Coupon has expired');
    }

    const discountAmount = Math.min(coupon.discount, purchaseAmount);
    const finalAmount = Math.max(0, purchaseAmount - discountAmount);

    return {
      success: true,
      valid: true,
      code: coupon.code,
      discountAmount,
      originalAmount: purchaseAmount,
      finalAmount,
      coupon,
    };
  }
}
