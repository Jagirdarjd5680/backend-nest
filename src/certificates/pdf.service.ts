import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { SettingsService } from '../settings/settings.service';
import { drawCertificate, CertificateData } from '../common/pdf/certificateTemplate';

@Injectable()
export class PdfService {
  constructor(private settingsService: SettingsService) {}

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

    const settings = await this.settingsService.getAllSettings();
    const certData: CertificateData = {
      companyName: settings?.general?.siteName || 'God of Graphics',
      companyTagline: settings?.company?.tagline || 'Premier Academy for Multimedia & Computer Education',
      logo: settings?.general?.pdfLogo || settings?.general?.siteLogo || '',
      studentName: student.name,
      courseName: course.certificateName || course.title,
      issueDate: meta.issueDate,
      certificateId: meta.certificateId,
      signatureName: settings?.company?.signatoryName || undefined,
      signatureImage: settings?.general?.pdfCertificateSignature || undefined,
    };

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 0 });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        fs.writeFileSync(filePath, pdfBuffer);
        resolve({ fileName, filePath, pdfBuffer });
      });
      doc.on('error', (err) => reject(err));

      drawCertificate(doc, certData)
        .then(() => doc.end())
        .catch(reject);
    });
  }
}
