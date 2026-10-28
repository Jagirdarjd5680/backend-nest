import { computeCouponDiscount } from '../coupons/coupons.service';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
// TS import-equals, not a default import — this project's tsconfig has
// allowSyntheticDefaultImports but not esModuleInterop, so `import Razorpay from 'razorpay'`
// compiles to a reference to a `.default` that doesn't exist on this package's `export =`
// CJS module, and `new Razorpay(...)` fails at runtime with "razorpay_1.default is not a
// constructor". `import X = require(...)` is the correct way to consume an `export =` module
// under these compiler options, and unlike `import * as X`, TS still allows `new X(...)`.
import Razorpay = require('razorpay');
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { Platform, assertCoursePlatformAccess } from '../common/platform';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Admin's Settings > Payments page (frontend/src/pages/Settings/PaymentSettings.jsx)
   * saves gateway key/secret into the `payments` Settings row live, with no backend
   * restart — so this is read fresh per-request instead of cached at boot, otherwise
   * a key entered in the admin panel would never take effect until the process restarted.
   * process.env stays as a fallback for deployments that prefer env-based config.
   */
  private async getRazorpayCredentials(): Promise<{ keyId: string; keySecret: string } | null> {
    try {
      const settingsRow = await this.prisma.settings.findUnique({ where: { key: 'payments' } });
      const paymentsSettings = settingsRow ? JSON.parse(settingsRow.value) : null;
      const gateway = paymentsSettings?.gateways?.find((g: any) => g.name === 'Razorpay');
      if (gateway?.key && gateway?.secret) {
        return { keyId: gateway.key, keySecret: gateway.secret };
      }
    } catch (err: any) {
      console.warn('⚠️ [Payments] Failed to read Razorpay settings, falling back to env vars:', err.message);
    }

    const keyId = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET;
    return keyId && keySecret ? { keyId, keySecret } : null;
  }

  async createOrder(userId: number, dto: CreateOrderDto, platform?: Platform | null) {
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
    });
    if (!course) {
      throw new NotFoundException(`Course with ID ${dto.courseId} not found`);
    }
    assertCoursePlatformAccess(course.platformAccess, platform ?? null);

    let discount = 0;
    let appliedCoupon = null;

    if (dto.couponCode) {
      const coupon = await this.prisma.coupon.findUnique({
        where: { code: dto.couponCode.toUpperCase() },
      });
      if (coupon && new Date(coupon.expiry) > new Date()) {
        discount = computeCouponDiscount(coupon, course.price);
        appliedCoupon = coupon.code;
      }
    }

    const finalAmount = Math.round(Math.max(0, course.price - discount) * 100) / 100;
    const amountInPaise = Math.round(finalAmount * 100);

    const credentials = await this.getRazorpayCredentials();
    let razorpayOrderId = `order_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    if (credentials && amountInPaise > 0) {
      try {
        const razorpay = new Razorpay({ key_id: credentials.keyId, key_secret: credentials.keySecret });
        const order = await razorpay.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: `rcpt_${Date.now()}_${userId}`,
          notes: {
            userId: userId.toString(),
            courseId: dto.courseId.toString(),
          },
        });
        razorpayOrderId = order.id;
        console.log(`✅ [Payments] Real Razorpay order created orderId=${razorpayOrderId} courseId=${dto.courseId}`);
      } catch (err) {
        console.error('❌ [Payments] Razorpay order creation failed, falling back to mock order ID:', err.message);
      }
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        courseId: dto.courseId,
        amount: finalAmount,
        discountAmount: discount,
        couponCode: appliedCoupon || '',
        status: 'pending',
        razorpayOrderId,
      },
    });

    const keyId = credentials?.keyId || 'rzp_test_key';

    return {
      success: true,
      orderId: razorpayOrderId,
      amount: finalAmount,
      amountInPaise,
      currency: 'INR',
      keyId,
      paymentId: payment.id,
      courseTitle: course.title,
    };
  }

  async initiateTestPayment(gatewayName: string, amount: number | string) {
    const amountNum = Number(amount) || 1;
    const amountInPaise = Math.round(amountNum * 100);

    const settingsRow = await this.prisma.settings.findUnique({ where: { key: 'payments' } });
    const paymentsSettings = settingsRow ? JSON.parse(settingsRow.value) : null;
    const gatewayConfig = paymentsSettings?.gateways?.find((g: any) => g.name === gatewayName);

    if (!gatewayConfig?.key) {
      throw new BadRequestException(`${gatewayName} API key is not configured in Settings`);
    }

    if (gatewayName === 'Razorpay') {
      const keyId = gatewayConfig.key;
      const keySecret = gatewayConfig.secret;
      let orderId = `order_test_${Date.now()}`;

      if (keyId && keySecret) {
        try {
          const testClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
          const order = await testClient.orders.create({
            amount: amountInPaise,
            currency: 'INR',
            receipt: `test_rcpt_${Date.now()}`,
            notes: { purpose: 'test-payment' },
          });
          orderId = order.id;
        } catch (err: any) {
          const reason = err.error?.description || err.message;
          console.error(`❌ [Payments] Test Razorpay order FAILED: ${reason}`, err.error ?? err);
          throw new BadRequestException(`Razorpay test order failed: ${reason}`);
        }
      }

      return {
        success: true,
        data: {
          key: keyId,
          amount: amountInPaise,
          currency: 'INR',
          order_id: orderId,
        },
      };
    }

    return {
      success: true,
      data: {
        key: gatewayConfig.key,
        amount: amountInPaise,
        currency: 'INR',
        order_id: `order_test_${Date.now()}`,
        message: `Live test flow for ${gatewayName} is not implemented yet — showing a mock order.`,
      },
    };
  }

  async verifyPayment(userId: number, dto: VerifyPaymentDto) {
    const credentials = await this.getRazorpayCredentials();

    const isMock = dto.razorpayOrderId.startsWith('order_mock_');
    let isSignatureValid = false;

    if (isMock) {
      isSignatureValid = true;
    } else if (credentials?.keySecret) {
      const generatedSignature = crypto
        .createHmac('sha256', credentials.keySecret)
        .update(`${dto.razorpayOrderId}|${dto.razorpayPaymentId}`)
        .digest('hex');

      isSignatureValid = generatedSignature === dto.razorpaySignature;
    } else {
      isSignatureValid = true;
    }

    if (!isSignatureValid) {
      await this.prisma.payment.updateMany({
        where: { razorpayOrderId: dto.razorpayOrderId },
        data: { status: 'failed' },
      });
      throw new BadRequestException('Invalid payment signature verification failed');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { razorpayOrderId: dto.razorpayOrderId },
    });

    if (payment) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'completed',
          razorpayPaymentId: dto.razorpayPaymentId,
          razorpaySignature: dto.razorpaySignature,
        },
      });
    }

    // Auto-enroll student into course
    await this.prisma.enrollment.upsert({
      where: {
        userId_courseId: {
          userId,
          courseId: dto.courseId,
        },
      },
      create: {
        userId,
        courseId: dto.courseId,
      },
      update: {},
    });

    // Referral reward logic (Step 6)
    try {
      const referral = await this.prisma.referral.findFirst({
        where: { referredId: userId, status: 'pending' },
      });
      if (referral) {
        const rewardAmount = Math.round(Number(payment?.amount || 100) * 0.1); // 10% reward
        await this.prisma.$transaction([
          this.prisma.user.update({
            where: { id: referral.referrerId },
            data: { walletBalance: { increment: rewardAmount } },
          }),
          this.prisma.referral.update({
            where: { id: referral.id },
            data: { status: 'rewarded', rewardAmount },
          }),
        ]);
        console.log(`[PaymentsService] Rewarded ₹${rewardAmount} to referrer #${referral.referrerId}`);
      }
    } catch (err) {
      console.error('[PaymentsService] Referral reward processing failed:', err.message);
    }

    return {
      success: true,
      message: 'Payment verified and course enrolled successfully',
      data: {
        courseId: dto.courseId,
        orderId: dto.razorpayOrderId,
        paymentId: dto.razorpayPaymentId,
      },
    };
  }

  async findAll() {
    return this.prisma.payment.findMany({
      include: {
        user: true,
        course: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStats() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [revenueAgg, refundsAgg, monthlyAgg] = await Promise.all([
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'completed' },
      }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'refunded' },
      }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'completed', createdAt: { gte: startOfMonth } },
      }),
    ]);

    return {
      totalRevenue: revenueAgg._sum.amount || 0,
      totalRefunds: refundsAgg._sum.amount || 0,
      monthlyRevenue: monthlyAgg._sum.amount || 0,
    };
  }

  async findOne(id: number) {
    const item = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        user: true,
        course: true,
      },
    });
    if (!item) throw new NotFoundException(`Payment with ID ${id} not found`);
    return item;
  }

  async findByUser(userId: number) {
    return this.prisma.payment.findMany({
      where: { userId },
      include: {
        course: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: any) {
    return this.prisma.payment.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.payment.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.payment.delete({ where: { id } });
  }
}
