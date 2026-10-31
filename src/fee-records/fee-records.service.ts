import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ExpoPushService } from '../notifications/expo-push.service';
import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { drawInvoice, InvoiceCompany } from '../common/pdf/invoiceTemplate';
import { drawRegistrationLetter } from '../common/pdf/registrationLetterTemplate';

type PaymentEntry = { amount: number; method: string; note?: string; paidAt: string | Date };

@Injectable()
export class FeeRecordsService {
  private readonly logger = new Logger(FeeRecordsService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private expoPushService: ExpoPushService,
  ) {}

  /** Shared letterhead block for both the invoice and the registration letter. */
  private async buildCompanyInfo(): Promise<InvoiceCompany> {
    const settings = await this.settingsService.getAllSettings();
    return {
      name: settings?.general?.siteName || 'LMS',
      gstNumber: settings?.company?.gstNumber || '',
      address: settings?.company?.address || '',
      phone: settings?.company?.contact || '',
      email: settings?.company?.email ? String(settings.company.email).split('\n')[0] : '',
      logo: settings?.general?.pdfLogo || settings?.general?.siteLogo || '',
      primaryColor: settings?.theme?.primaryColor || '#f39c12',
    };
  }

  private normalizePayments(raw: any): PaymentEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p) => p && Number(p.amount) > 0)
      .map((p) => ({
        amount: Number(p.amount),
        method: p.method || 'cash',
        note: p.note || '',
        paidAt: p.paidAt || new Date(),
      }));
  }

  /** Shapes a raw Prisma FeeRecord (with student/course included) into what the admin UI's
   * Quick Payment modal actually reads — paidAmount/remainingAmount are derived from the
   * payments ledger rather than stored redundantly, so they can never drift out of sync. */
  private formatRecord(record: any) {
    const payments = Array.isArray(record.payments) ? record.payments : [];
    const paidAmount = payments.reduce((sum: number, p: any) => sum + Number(p?.amount || 0), 0);
    const lastPayment = payments[payments.length - 1];
    return {
      _id: record.id.toString(),
      id: record.id,
      totalFee: record.totalFee,
      discount: record.discount,
      finalFee: record.finalFee,
      emiEnabled: record.emiEnabled,
      emiCount: record.emiCount,
      paidAmount,
      remainingAmount: Math.max(0, record.finalFee - paidAmount),
      payments,
      studentId: record.studentId,
      student: record.student
        ? { _id: record.student.id.toString(), id: record.student.id, name: record.student.name, email: record.student.email }
        : null,
      course: record.course
        ? { _id: record.course.id.toString(), id: record.course.id, title: record.course.title }
        : null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      // Aliases for the older Fee Ledger table (FeeRecordsPage.jsx), which predates
      // per-course/multi-installment tracking and still reads these flat field names.
      amountPaid: paidAmount,
      paymentDate: lastPayment?.paidAt || record.updatedAt,
      // UserFeeHistory.jsx's accordion badge — derived rather than stored so it can never
      // go stale relative to the payments ledger.
      status: paidAmount <= 0 ? 'pending' : paidAmount >= record.finalFee ? 'paid' : 'partial',
    };
  }

  async findAll() {
    const records = await this.prisma.feeRecord.findMany({ include: { student: true, course: true } });
    return records.map((r) => this.formatRecord(r));
  }

  async findByUserId(userId: number) {
    const records = await this.prisma.feeRecord.findMany({
      where: { studentId: userId },
      include: { student: true, course: true },
      orderBy: { updatedAt: 'desc' },
    });
    return records.map((r) => this.formatRecord(r));
  }

  async findOne(id: number) {
    const item = await this.prisma.feeRecord.findUnique({ where: { id }, include: { student: true, course: true } });
    if (!item) throw new NotFoundException(`Fee record with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    const studentId = parseInt(String(data.studentId ?? data.userId ?? data.user ?? data.student ?? 0), 10);
    if (!studentId) throw new BadRequestException('studentId is required');
    const rawCourseId = data.courseId ?? data.course;
    const courseId = rawCourseId != null && rawCourseId !== '' ? parseInt(String(rawCourseId), 10) : null;

    const totalFee = Number(data.totalFee ?? 0);
    const discount = Number(data.discount ?? 0);
    const finalFee = Number(data.finalFee ?? Math.max(0, totalFee - discount));
    const emiEnabled = Boolean(data.emiEnabled);
    const emiCount = Number(data.emiCount ?? 1) || 1;
    const payments = this.normalizePayments(data.payments);

    const record = await this.prisma.feeRecord.create({
      data: { studentId, courseId, totalFee, discount, finalFee, emiEnabled, emiCount, payments: payments as any },
      include: { student: true, course: true },
    });

    const newPayments = this.normalizePayments(data.newPayments ?? data.payments);
    if (newPayments.length > 0) {
      this.notifyNewPayments(record, payments, newPayments).catch((err) =>
        this.logger.error(`Payment notification failed for feeRecord ${record.id}: ${err.message}`),
      );
    }

    return this.formatRecord(record);
  }

  async update(id: number, data: any) {
    const existing = await this.findOne(id);

    const totalFee = data.totalFee !== undefined ? Number(data.totalFee) : existing.totalFee;
    const discount = data.discount !== undefined ? Number(data.discount) : existing.discount;
    const finalFee = data.finalFee !== undefined ? Number(data.finalFee) : Math.max(0, totalFee - discount);
    const emiEnabled = data.emiEnabled !== undefined ? Boolean(data.emiEnabled) : existing.emiEnabled;
    const emiCount = data.emiCount !== undefined ? Number(data.emiCount) || 1 : existing.emiCount;
    // `payments` is the full authoritative ledger (can shrink — the UI's per-payment "Delete
    // Record" button removes entries), so it always fully replaces what's stored rather than
    // being appended to.
    const payments = data.payments !== undefined ? this.normalizePayments(data.payments) : (existing.payments as any) || [];

    const updated = await this.prisma.feeRecord.update({
      where: { id },
      data: { totalFee, discount, finalFee, emiEnabled, emiCount, payments: payments as any },
      include: { student: true, course: true },
    });

    const newPayments = this.normalizePayments(data.newPayments);
    if (newPayments.length > 0) {
      this.notifyNewPayments(updated, payments, newPayments).catch((err) =>
        this.logger.error(`Payment notification failed for feeRecord ${id}: ${err.message}`),
      );
    }

    return this.formatRecord(updated);
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.feeRecord.delete({ where: { id } });
  }

  /** Fires once per newly-added payment this save — an invoice email (using the dynamic
   * company/GST settings) plus an in-app push notification. `allPayments` is the record's full
   * ledger after this save, used to compute "paid so far" as of each new entry. */
  private async notifyNewPayments(record: any, allPayments: PaymentEntry[], newPayments: PaymentEntry[]) {
    const user = record.student;
    if (!user) return;

    // Match each "new" entry to its position in the full ledger by scanning from the end —
    // newly-added payments are always appended last by the frontend.
    const startIndex = allPayments.length - newPayments.length;

    for (let i = 0; i < newPayments.length; i++) {
      const idx = startIndex + i;
      if (idx < 0) continue;
      const amountPaid = newPayments[i].amount;
      const paidSoFar = allPayments.slice(0, idx + 1).reduce((s, p) => s + Number(p.amount || 0), 0);

      try {
        await this.sendInvoiceForPayment(record, allPayments, idx, amountPaid, paidSoFar);
      } catch (err: any) {
        this.logger.error(`Invoice email failed for feeRecord ${record.id} payment #${idx}: ${err.message}`);
      }

      try {
        await this.expoPushService.sendToUser(
          user.id,
          'Payment Received',
          `₹${Math.round(amountPaid)} received for ${record.course?.title || 'your course'}. Thank you!`,
          { type: 'fee_payment', feeRecordId: record.id, courseId: record.courseId },
        );
      } catch (err: any) {
        this.logger.warn(`Push notification failed for user ${user.id}: ${err.message}`);
      }
    }
  }

  // ─── PDF Receipt / Tax Invoice Generation ─────────────────────────────

  /** Renders one specific payment entry from a fee record as a PDF invoice — GST is taken
   * from the course's own gstType/gstPercent (set at course-creation time), so a course
   * marked "no GST" never gets a GST split invented for it, and one marked with a rate always
   * uses that exact rate. */
  private async renderInvoicePdf(
    record: any,
    payment: PaymentEntry,
    invoiceNo: string,
    paidSoFar: number,
  ): Promise<{ filePath: string; fileName: string; pdfBuffer: Buffer }> {
    const user = record.student;
    const course = record.course;

    const uploadDir = path.join(process.cwd(), 'uploads', 'receipts');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const fileName = `receipt_${user.id}_${invoiceNo}.pdf`;
    const filePath = path.join(uploadDir, fileName);

    const company = await this.buildCompanyInfo();
    const studentAddress = (user.studentProfile as any)?.address as string | undefined;
    const gstApplies = course && course.gstType && course.gstType !== 'none' && Number(course.gstPercent) > 0;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        fs.writeFileSync(filePath, pdfBuffer);
        resolve({ filePath, fileName, pdfBuffer });
      });
      doc.on('error', (err) => reject(err));

      drawInvoice(doc, {
        company,
        billTo: { name: user.name, address: studentAddress, contact: user.phone || undefined },
        invoiceNo,
        date: payment.paidAt ? new Date(payment.paidAt) : new Date(),
        itemName: course?.title || 'Course Fee',
        totalAmount: Number(payment.amount || 0),
        gstRatePercent: gstApplies ? Number(course.gstPercent) : 0,
        totalPaidSoFar: paidSoFar,
        courseTotalFee: record.finalFee,
      })
        .then(() => doc.end())
        .catch(reject);
    });
  }

  private async sendInvoiceEmail(user: any, filePath: string, fileName: string, pdfBuffer: Buffer, courseTitle: string, amount: number) {
    const host = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !smtpUser || !pass) {
      this.logger.log(`SMTP not configured. Invoice saved locally at ${filePath}`);
      return { success: true, message: `Invoice PDF generated locally at ${fileName} (SMTP credentials missing for email dispatch).` };
    }
    if (!user.email) {
      return { success: false, message: 'Student has no email on file' };
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host, port: 587, auth: { user: smtpUser, pass } });
    await transporter.sendMail({
      from: smtpUser,
      to: user.email,
      subject: `Payment Invoice - ${courseTitle}`,
      html: `<p>Dear ${user.name},</p><p>Thank you for your payment of ₹${Math.round(amount)} towards <b>${courseTitle}</b>. Please find your invoice attached.</p><p>Best regards</p>`,
      attachments: [{ filename: fileName, content: pdfBuffer }],
    });
    return { success: true, message: `Invoice sent to ${user.email}` };
  }

  private async sendInvoiceForPayment(record: any, allPayments: PaymentEntry[], idx: number, amountPaid: number, paidSoFar: number) {
    const invoiceNo = `INV-${record.id}-${idx + 1}-${Date.now().toString().slice(-4)}`;
    const { filePath, fileName, pdfBuffer } = await this.renderInvoicePdf(record, allPayments[idx], invoiceNo, paidSoFar);
    await this.sendInvoiceEmail(record.student, filePath, fileName, pdfBuffer, record.course?.title || 'Course Fee', amountPaid);
  }

  /** Manual "download/send receipt" from the payment history list — regenerates the invoice
   * for one specific past payment (by index into that fee record's ledger), not just the
   * latest one, since an admin can click the icon next to any row. */
  private async getRecordAndPayment(userId: number, courseId?: number, paymentIndex?: number) {
    const record = await this.prisma.feeRecord.findFirst({
      where: { studentId: userId, ...(courseId ? { courseId } : {}) },
      include: { student: true, course: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!record) throw new NotFoundException('No fee record found for this student/course');

    const payments = (Array.isArray(record.payments) ? record.payments : []) as PaymentEntry[];
    const idx = paymentIndex != null && paymentIndex !== ('' as any) ? Number(paymentIndex) : payments.length - 1;
    if (idx < 0 || !payments[idx]) throw new BadRequestException('No payment found at that index');

    return { record, payments, idx };
  }

  async generateReceiptPdf(userId: number, courseId?: number, paymentIndex?: number) {
    const { record, payments, idx } = await this.getRecordAndPayment(userId, courseId, paymentIndex);
    const paidSoFar = payments.slice(0, idx + 1).reduce((s, p) => s + Number(p.amount || 0), 0);
    const invoiceNo = `INV-${record.id}-${idx + 1}-${Date.now().toString().slice(-4)}`;
    return this.renderInvoicePdf(record, payments[idx], invoiceNo, paidSoFar);
  }

  async sendReceiptEmail(userId: number, courseId?: number, paymentIndex?: number): Promise<{ success: boolean; message: string }> {
    const { record, payments, idx } = await this.getRecordAndPayment(userId, courseId, paymentIndex);
    const paidSoFar = payments.slice(0, idx + 1).reduce((s, p) => s + Number(p.amount || 0), 0);
    const invoiceNo = `INV-${record.id}-${idx + 1}-${Date.now().toString().slice(-4)}`;
    const { filePath, fileName, pdfBuffer } = await this.renderInvoicePdf(record, payments[idx], invoiceNo, paidSoFar);
    return this.sendInvoiceEmail(record.student, filePath, fileName, pdfBuffer, record.course?.title || 'Course Fee', payments[idx].amount);
  }

  // ─── Registration Confirmation Letter ─────────────────────────────────
  async generateRegistrationLetterPdf(userId: number, courseId?: number): Promise<{ filePath: string; fileName: string; pdfBuffer: Buffer }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const feeRecord = courseId
      ? await this.prisma.feeRecord.findFirst({ where: { studentId: userId, courseId } })
      : await this.prisma.feeRecord.findFirst({ where: { studentId: userId }, orderBy: { updatedAt: 'desc' } });
    const paidAmount = (Array.isArray(feeRecord?.payments) ? (feeRecord.payments as any[]) : []).reduce(
      (s, p) => s + Number(p?.amount || 0),
      0,
    );

    let courseTitle = 'Training Program';
    let batchName: string | undefined;
    if (courseId) {
      const course = await this.prisma.course.findUnique({ where: { id: courseId } });
      if (course) courseTitle = course.title;
      const booking = await this.prisma.bookingBatch.findFirst({
        where: { userId, batch: { courseId } },
        include: { batch: true },
      });
      batchName = booking?.batch?.name;
    }

    const uploadDir = path.join(process.cwd(), 'uploads', 'certificates');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const refNo = `REG-${Date.now().toString().slice(-6)}`;
    const fileName = `registration_${userId}_${refNo}.pdf`;
    const filePath = path.join(uploadDir, fileName);

    const company = await this.buildCompanyInfo();
    const studentAddress = (user.studentProfile as any)?.address as string | undefined;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        fs.writeFileSync(filePath, pdfBuffer);
        resolve({ filePath, fileName, pdfBuffer });
      });
      doc.on('error', (err) => reject(err));

      drawRegistrationLetter(doc, {
        company,
        refNo,
        date: new Date(),
        student: { name: user.name, email: user.email, address: studentAddress, rollNumber: user.rollNumber || undefined },
        courseName: courseTitle,
        batchName,
        totalFee: feeRecord?.finalFee || paidAmount || 0,
        discount: feeRecord?.discount || 0,
        finalFee: feeRecord?.finalFee || paidAmount || 0,
      })
        .then(() => doc.end())
        .catch(reject);
    });
  }

  async sendRegistrationLetterEmail(userId: number, courseId?: number): Promise<{ success: boolean; message: string }> {
    const { filePath, fileName, pdfBuffer } = await this.generateRegistrationLetterPdf(userId, courseId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    const host = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !smtpUser || !pass) {
      this.logger.log(`SMTP not configured. Registration letter saved to ${filePath}`);
      return { success: true, message: `Registration letter PDF generated locally at ${fileName} (SMTP credentials missing for email dispatch).` };
    }
    if (!user?.email) {
      return { success: false, message: 'Student has no email on file' };
    }

    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host, port: 587, auth: { user: smtpUser, pass } });
      await transporter.sendMail({
        from: smtpUser,
        to: user.email,
        subject: `Registration Confirmation - ${user.name}`,
        html: `<p>Dear ${user.name},</p><p>Please find attached your registration confirmation letter.</p><p>Best regards,<br/>LMS Team</p>`,
        attachments: [{ filename: fileName, content: pdfBuffer }],
      });
      return { success: true, message: `Registration letter sent to ${user.email}` };
    } catch (err) {
      this.logger.error(`Failed to send registration letter email: ${err.message}`);
      return { success: false, message: `Failed to send email: ${err.message}` };
    }
  }
}
