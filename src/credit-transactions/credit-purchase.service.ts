import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay = require('razorpay');
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Plans shown by the mobile SupportCreditScreen. Price and credit count are always
 * derived here from the plan id — the client only names the plan, so it can't pick
 * its own price or credit amount.
 */
const PLANS: Record<string, { credits: number; factor: number }> = {
  plan_1: { credits: 1, factor: 1 },
  plan_10: { credits: 10, factor: 0.9 },
  plan_20: { credits: 20, factor: 0.85 },
};

const PURPOSE = 'support-credits';

@Injectable()
export class CreditPurchaseService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
    private settings: SettingsService,
  ) {}

  private async client() {
    const credentials = await this.payments.getRazorpayCredentials();
    if (!credentials) throw new BadRequestException('Payment gateway is not configured');
    return {
      credentials,
      razorpay: new Razorpay({ key_id: credentials.keyId, key_secret: credentials.keySecret }),
    };
  }

  async createOrder(userId: number, planId: string) {
    const plan = PLANS[planId];
    if (!plan) throw new BadRequestException('Unknown credit plan');

    const all = await this.settings.getAllSettings();
    const creditPrice = Number(all?.tutorSupport?.creditPrice) || 100;
    const amountInPaise = Math.floor(creditPrice * plan.credits * plan.factor) * 100;

    const { credentials, razorpay } = await this.client();
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `cred_${Date.now()}_${userId}`,
      notes: { purpose: PURPOSE, userId: String(userId), planId, credits: String(plan.credits) },
    });

    return {
      success: true,
      order: { id: order.id, amount: amountInPaise, currency: 'INR', key: credentials.keyId },
    };
  }

  async verifyPayment(userId: number, body: any) {
    const orderId = String(body?.razorpay_order_id || '');
    const paymentId = String(body?.razorpay_payment_id || '');
    const signature = String(body?.razorpay_signature || '');
    if (!orderId || !paymentId || !signature) throw new BadRequestException('Missing payment details');

    const { credentials, razorpay } = await this.client();
    const expected = crypto
      .createHmac('sha256', credentials.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new BadRequestException('Invalid payment signature');
    }

    // Credits come from the order Razorpay holds, not from the request body.
    const order: any = await razorpay.orders.fetch(orderId);
    const notes = order?.notes || {};
    if (notes.purpose !== PURPOSE || String(notes.userId) !== String(userId)) {
      throw new BadRequestException('Order does not belong to this account');
    }
    const credits = Number(notes.credits) || 0;
    if (credits <= 0) throw new BadRequestException('Invalid credit order');

    // A replayed verify call must not add the credits twice.
    const marker = `(order ${orderId})`;
    const existing = await this.prisma.creditTransaction.findFirst({
      where: { userId, description: { contains: marker } },
    });
    if (!existing) {
      await this.prisma.creditTransaction.create({
        data: {
          userId,
          type: 'credit',
          amount: credits,
          description: `Purchased ${credits} support credits ${marker}`,
        },
      });
    }

    return { success: true, credits, message: 'Credits added successfully' };
  }
}
