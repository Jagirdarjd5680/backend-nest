import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PdfService {
  async generateCertificatePDF(
    student: { name: string; email: string },
    course: { title: string; certificateName?: string },
    meta: { certificateId: string; pin: string; issueDate: Date },
  ): Promise<{ fileName: string; filePath: string; pdfBuffer: Buffer }> {
    const uploadDir = path.join(process.cwd(), 'uploads', 'certificates');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const fileName = `certificate_${meta.certificateId}_${Date.now()}.pdf`;
    const filePath = path.join(uploadDir, fileName);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        layout: 'landscape',
        size: 'A4',
        margin: 40,
      });

      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        fs.writeFileSync(filePath, pdfBuffer);
        resolve({ fileName, filePath, pdfBuffer });
      });

      doc.on('error', (err) => reject(err));

      // Border Frame
      doc
        .rect(20, 20, doc.page.width - 40, doc.page.height - 40)
        .lineWidth(4)
        .strokeColor('#1E3A8A')
        .stroke();

      doc
        .rect(28, 28, doc.page.width - 56, doc.page.height - 56)
        .lineWidth(1)
        .strokeColor('#D97706')
        .stroke();

      // Title Header
      doc
        .moveDown(1.5)
        .font('Helvetica-Bold')
        .fontSize(28)
        .fillColor('#1E3A8A')
        .text('CERTIFICATE OF COMPLETION', { align: 'center' });

      doc
        .moveDown(0.5)
        .font('Helvetica')
        .fontSize(14)
        .fillColor('#4B5563')
        .text('This is to certify that', { align: 'center' });

      // Student Name
      doc
        .moveDown(0.8)
        .font('Helvetica-Bold')
        .fontSize(24)
        .fillColor('#D97706')
        .text(student.name, { align: 'center' });

      doc
        .moveDown(0.5)
        .font('Helvetica')
        .fontSize(14)
        .fillColor('#4B5563')
        .text('has successfully completed the course', { align: 'center' });

      // Course Title (admin's certificateName, when set, is what's meant to print here —
      // falls back to the course's marketing title otherwise)
      doc
        .moveDown(0.8)
        .font('Helvetica-Bold')
        .fontSize(20)
        .fillColor('#111827')
        .text(course.certificateName || course.title, { align: 'center' });

      // Details Footer
      doc.moveDown(2);

      const issueDateStr = meta.issueDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#6B7280')
        .text(`Date of Issue: ${issueDateStr}`, 60, doc.page.height - 100);

      doc
        .text(`Certificate ID: ${meta.certificateId}`, { align: 'center' });

      doc
        .text(`Verification PIN: ${meta.pin}`, doc.page.width - 220, doc.page.height - 100);

      doc.end();
    });
  }
}
