import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
// See the matching comment in payments.service.ts — import-equals, not a default import,
// or `new Razorpay(...)` fails at runtime ("razorpay_1.default is not a constructor").
import Razorpay = require('razorpay');
import * as nodemailer from 'nodemailer';

@Injectable()
export class EventBookingsService {
  constructor(private prisma: PrismaService) {}

  /** Same "read live from admin Settings, env as fallback" pattern as PaymentsService. */
  private async getRazorpayCredentials(): Promise<{ keyId: string; keySecret: string } | null> {
    try {
      const settingsRow = await this.prisma.settings.findUnique({ where: { key: 'payments' } });
      const paymentsSettings = settingsRow ? JSON.parse(settingsRow.value) : null;
      const gateway = paymentsSettings?.gateways?.find((g: any) => g.name === 'Razorpay');
      if (gateway?.key && gateway?.secret) {
        return { keyId: gateway.key, keySecret: gateway.secret };
      }
    } catch {
      // fall through to env vars
    }
    const keyId = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET;
    return keyId && keySecret ? { keyId, keySecret } : null;
  }

  private generateTicketCode(eventId: number): string {
    return `EVT${eventId}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private async sendTicketEmail(email: string, name: string, event: { title: string; date: Date }, ticketCode: string) {
    try {
      const settingsRow = await this.prisma.settings.findUnique({ where: { key: 'smtp' } });
      const smtp = settingsRow ? JSON.parse(settingsRow.value) : null;
      if (!smtp?.host || !smtp?.user || !smtp?.pass) {
        console.log(`📧 [EventTicket] SMTP not configured — ticket ${ticketCode} for ${email} not emailed (event: ${event.title})`);
        return;
      }

      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: parseInt(smtp.port || '587', 10),
        secure: smtp.port === '465',
        auth: { user: smtp.user, pass: smtp.pass },
      });

      await transporter.sendMail({
        from: smtp.from || smtp.user,
        to: email,
        subject: `Your ticket for ${event.title}`,
        html: `
          <p>Hi ${name},</p>
          <p>You're confirmed for <b>${event.title}</b> on ${event.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
          <p style="font-size:20px;letter-spacing:2px;background:#f4f4f5;padding:12px 20px;display:inline-block;border-radius:8px;"><b>${ticketCode}</b></p>
          <p>Show this ticket code at entry. See you there!</p>
        `,
      });
      console.log(`✅ [EventTicket] Ticket email sent to ${email} (${ticketCode})`);
    } catch (err: any) {
      console.error(`❌ [EventTicket] Failed to send ticket email to ${email}:`, err.message);
    }
  }

  /**
   * Free events confirm instantly; paid events need a Razorpay order first (see verifyPayment).
   * Mirrors payments.service.ts's mock-order fallback so paid events still work in dev without
   * real Razorpay keys configured.
   */
  async createOrder(userId: number, eventId: number) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const existing = await this.prisma.eventBooking.findFirst({
      where: { userId, eventId, status: { in: ['confirmed', 'pending_payment'] } },
    });
    if (existing) {
      throw new BadRequestException(
        existing.status === 'confirmed' ? "You're already booked for this event" : 'You already have a pending booking for this event',
      );
    }

    if (event.price <= 0) {
      const booking = await this.confirmBooking(userId, eventId, 0);
      return { success: true, requiresPayment: false, data: booking };
    }

    const amountInPaise = Math.round(event.price * 100);
    const credentials = await this.getRazorpayCredentials();
    let razorpayOrderId = `order_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    if (credentials) {
      try {
        const razorpay = new Razorpay({ key_id: credentials.keyId, key_secret: credentials.keySecret });
        const order = await razorpay.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: `evt_${Date.now()}_${userId}`,
          notes: { userId: String(userId), eventId: String(eventId) },
        });
        razorpayOrderId = order.id;
        console.log(`✅ [EventBooking] Razorpay order created orderId=${razorpayOrderId} eventId=${eventId}`);
      } catch (err: any) {
        console.error('❌ [EventBooking] Razorpay order creation failed, falling back to mock order:', err.message);
      }
    }

    const booking = await this.prisma.eventBooking.create({
      data: { userId, eventId, status: 'pending_payment', razorpayOrderId },
    });

    const keyId = credentials?.keyId || 'rzp_test_key';
    return {
      success: true,
      requiresPayment: true,
      bookingId: booking.id,
      orderId: razorpayOrderId,
      amount: event.price,
      amountInPaise,
      currency: 'INR',
      keyId,
      eventTitle: event.title,
    };
  }

  async verifyPayment(
    userId: number,
    eventId: number,
    dto: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  ) {
    const booking = await this.prisma.eventBooking.findFirst({
      where: { userId, eventId, razorpayOrderId: dto.razorpayOrderId, status: 'pending_payment' },
    });
    if (!booking) throw new NotFoundException('Pending booking not found for this payment');

    const isMock = dto.razorpayOrderId.startsWith('order_mock_');
    let isSignatureValid = isMock;

    if (!isMock) {
      const credentials = await this.getRazorpayCredentials();
      if (credentials?.keySecret) {
        const generatedSignature = crypto
          .createHmac('sha256', credentials.keySecret)
          .update(`${dto.razorpayOrderId}|${dto.razorpayPaymentId}`)
          .digest('hex');
        isSignatureValid = generatedSignature === dto.razorpaySignature;
      } else {
        isSignatureValid = true;
      }
    }

    if (!isSignatureValid) {
      await this.prisma.eventBooking.update({ where: { id: booking.id }, data: { status: 'cancelled' } });
      throw new BadRequestException('Invalid payment signature');
    }

    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const ticketCode = this.generateTicketCode(eventId);
    const confirmed = await this.prisma.eventBooking.update({
      where: { id: booking.id },
      data: {
        status: 'confirmed',
        razorpayPaymentId: dto.razorpayPaymentId,
        amountPaid: event.price,
        ticketCode,
        ticketEmailedAt: new Date(),
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) await this.sendTicketEmail(user.email, user.name, event, ticketCode);

    return { success: true, message: 'Payment verified — you are booked in!', data: confirmed };
  }

  private async confirmBooking(userId: number, eventId: number, amountPaid: number) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const ticketCode = this.generateTicketCode(eventId);
    const booking = await this.prisma.eventBooking.create({
      data: { userId, eventId, status: 'confirmed', amountPaid, ticketCode, ticketEmailedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) await this.sendTicketEmail(user.email, user.name, event, ticketCode);

    return booking;
  }

  async getMyBookings(userId: number) {
    return this.prisma.eventBooking.findMany({
      where: { userId, status: { not: 'cancelled' } },
      include: { event: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll() {
    return this.prisma.eventBooking.findMany({
      include: {
          user: true,
          event: true
      }
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.eventBooking.findUnique({
      where: { id },
      include: {
          user: true,
          event: true
      }
    });
    if (!item) throw new NotFoundException(`EventBookings with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.eventBooking.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.eventBooking.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.eventBooking.delete({ where: { id } });
  }
}
