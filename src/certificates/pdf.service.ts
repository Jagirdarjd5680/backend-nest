import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { SettingsService } from '../settings/settings.service';
import { drawCertificate, CertificateData, certificateBranding } from '../common/pdf/certificateTemplate';

export type CertificateMeta = { certificateId: string; pin?: string; issueDate: Date; duration?: string; grade?: string; specialization?: string };

@Injectable()
export class PdfService {
  constructor(private settingsService: SettingsService) {}

  /** Renders a certificate with the current settings — nothing is saved or issued. */
  async renderCertificate(
    student: { name: string },
    course: { title: string; certificateName?: string },
    meta: CertificateMeta,
  ): Promise<Buffer> {
    const settings = await this.settingsService.getAllSettings();
    const certData: CertificateData = {
      ...certificateBranding(settings),
      studentName: student.name,
      // The course's real name — the course form's "Certificate Title" (e.g. "testcf") read as gibberish here.
      courseName: course.title.trim(),
      issueDate: meta.issueDate,
      certificateId: meta.certificateId,
      duration: meta.duration,
      grade: meta.grade,
      specialization: meta.specialization,
    };

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);
      drawCertificate(doc, certData)
        .then(() => doc.end())
        .catch(reject);
    });
  }

  async generateCertificatePDF(
    student: { name: string; email?: string | null },
    course: { title: string; certificateName?: string },
    meta: CertificateMeta,
  ): Promise<{ fileName: string; filePath: string; pdfBuffer: Buffer }> {
    const uploadDir = path.join(process.cwd(), 'uploads', 'certificates');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const fileName = `certificate_${meta.certificateId}_${Date.now()}.pdf`;
    const filePath = path.join(uploadDir, fileName);
    const pdfBuffer = await this.renderCertificate(student, course, meta);
    fs.writeFileSync(filePath, pdfBuffer);
    return { fileName, filePath, pdfBuffer };
  }
}
