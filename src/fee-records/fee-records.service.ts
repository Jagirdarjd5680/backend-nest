import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FeeRecordsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.feeRecord.findMany({
      include: {
        student: true,
      },
    });
  }

  async findByUserId(userId: number) {
    return this.prisma.feeRecord.findMany({
      where: { studentId: userId },
      include: {
        student: true,
      },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.feeRecord.findUnique({
      where: { id },
      include: {
        student: true,
      },
    });
    if (!item) throw new NotFoundException(`FeeRecords with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    const rawStudentId = data.studentId ?? data.userId ?? data.user ?? data.student;
    const studentId = parseInt(String(rawStudentId || 0), 10);

    let amountPaid = Number(data.amountPaid ?? data.paidAmount ?? data.finalFee ?? data.totalFee ?? 0);
    if ((!amountPaid || isNaN(amountPaid)) && Array.isArray(data.payments)) {
      amountPaid = data.payments.reduce((acc: number, p: any) => acc + Number(p?.amount || 0), 0);
    }
    if (isNaN(amountPaid)) {
      amountPaid = 0;
    }

    return this.prisma.feeRecord.create({
      data: {
        studentId,
        amountPaid,
        paymentDate: data.paymentDate ? new Date(data.paymentDate) : new Date(),
      },
      include: {
        student: true,
      },
    });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    const updateData: any = {};

    if (data.amountPaid !== undefined || data.paidAmount !== undefined || data.finalFee !== undefined || data.totalFee !== undefined) {
      updateData.amountPaid = Number(data.amountPaid ?? data.paidAmount ?? data.finalFee ?? data.totalFee ?? 0);
    } else if (Array.isArray(data.payments)) {
      updateData.amountPaid = data.payments.reduce((acc: number, p: any) => acc + Number(p?.amount || 0), 0);
    }

    const rawStudentId = data.studentId ?? data.userId ?? data.user ?? data.student;
    if (rawStudentId !== undefined) {
      updateData.studentId = parseInt(String(rawStudentId), 10);
    }

    if (data.paymentDate) {
      updateData.paymentDate = new Date(data.paymentDate);
    }

    return this.prisma.feeRecord.update({
      where: { id },
      data: updateData,
      include: {
        student: true,
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.feeRecord.delete({ where: { id } });
  }

  // ─── PDF Receipt Generation (Step 1) ──────────────────────────────────
  async generateReceiptPdf(userId: number, courseId?: number): Promise<{ filePath: string; fileName: string; pdfBuffer: Buffer }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const feeRecord = await this.prisma.feeRecord.findFirst({
      where: { studentId: userId },
    });

    let courseTitle = 'Course Fee';
    if (courseId) {
      const course = await this.prisma.course.findUnique({ where: { id: courseId } });
      if (course) courseTitle = course.title;
    }

    const uploadDir = path.join(process.cwd(), 'uploads', 'receipts');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const receiptNo = `REC-${Date.now().toString().slice(-6)}`;
    const fileName = `receipt_${userId}_${receiptNo}.pdf`;
    const filePath = path.join(uploadDir, fileName);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        fs.writeFileSync(filePath, pdfBuffer);
        resolve({ filePath, fileName, pdfBuffer });
      });

      doc.on('error', (err) => reject(err));

      // PDF Content Header
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#1E3A8A').text('PAYMENT RECEIPT', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').fillColor('#6B7280').text(`Receipt No: ${receiptNo} | Date: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown(1.5);

      // Divider
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E5E7EB').lineWidth(1).stroke();
      doc.moveDown(1.5);

      // Student Info
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#111827').text('Student Details:');
      doc.fontSize(10).font('Helvetica').fillColor('#374151');
      doc.text(`Name: ${user.name}`);
      doc.text(`Email: ${user.email}`);
      if (user.phone) doc.text(`Phone: ${user.phone}`);
      if (user.rollNumber) doc.text(`Roll Number: ${user.rollNumber}`);
      doc.moveDown(1.5);

      // Payment Details Table
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#111827').text('Payment Summary:');
      doc.moveDown(0.5);

      const tableTop = doc.y;
      doc.rect(40, tableTop, 515, 24).fill('#F3F4F6');
      doc.fillColor('#1F2937').fontSize(10).font('Helvetica-Bold');
      doc.text('Description', 50, tableTop + 7);
      doc.text('Amount Paid', 450, tableTop + 7, { align: 'right' });

      const rowTop = tableTop + 30;
      doc.fillColor('#374151').font('Helvetica');
      doc.text(courseTitle, 50, rowTop);
      const amountStr = `₹${(feeRecord?.amountPaid || 0).toLocaleString()}`;
      doc.text(amountStr, 450, rowTop, { align: 'right' });

      doc.moveDown(2);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E5E7EB').lineWidth(1).stroke();
      doc.moveDown(1.5);

      // Footer
      doc.fontSize(10).font('Helvetica-Oblique').fillColor('#6B7280').text('Thank you for your payment! This is an electronically generated receipt.', { align: 'center' });

      doc.end();
    });
  }

  async sendReceiptEmail(userId: number, courseId?: number): Promise<{ success: boolean; message: string }> {
    const { filePath, fileName, pdfBuffer } = await this.generateReceiptPdf(userId, courseId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    const host = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !smtpUser || !pass) {
      console.log(`[FeeRecordsService] SMTP not configured. Receipt saved to ${filePath}`);
      return { success: true, message: `Receipt PDF generated locally at ${fileName} (SMTP credentials missing for email dispatch).` };
    }

    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host, port: 587, auth: { user: smtpUser, pass } });
      await transporter.sendMail({
        from: smtpUser,
        to: user.email,
        subject: `Payment Receipt - ${user.name}`,
        html: `<p>Dear ${user.name},</p><p>Please find attached your payment receipt PDF.</p><p>Best regards,<br/>LMS Team</p>`,
        attachments: [{ filename: fileName, content: pdfBuffer }],
      });
      return { success: true, message: `Receipt sent to ${user.email}` };
    } catch (err) {
      console.error('[FeeRecordsService] Failed to send receipt email:', err.message);
      return { success: false, message: `Failed to send email: ${err.message}` };
    }
  }
}
