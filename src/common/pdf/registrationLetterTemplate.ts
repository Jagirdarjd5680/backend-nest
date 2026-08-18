import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { registerFonts, FONT, FONT_BOLD, formatRupees } from './fonts';
import type { InvoiceCompany } from './invoiceTemplate';

export interface RegistrationLetterData {
  company: InvoiceCompany;
  refNo: string;
  date: Date;
  student: { name: string; email: string; address?: string; rollNumber?: string };
  courseName: string;
  batchName?: string;
  totalFee: number;
  discount?: number;
  finalFee: number;
}

async function loadLogo(logo?: string): Promise<Buffer | string | null> {
  if (!logo) return null;
  try {
    if (logo.startsWith('data:image')) {
      return Buffer.from(logo.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    }
    if (logo.startsWith('http')) {
      const res = await axios.get(logo, { responseType: 'arraybuffer' });
      return Buffer.from(res.data);
    }
    const p = path.join(process.cwd(), logo.startsWith('/') ? logo : '/' + logo);
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/** Draws a registration/admission confirmation letter onto an already-created pdfkit document. */
export async function drawRegistrationLetter(doc: PDFKit.PDFDocument, data: RegistrationLetterData): Promise<void> {
  registerFonts(doc);
  const primary = data.company.primaryColor || '#f39c12';

  // ─── Header (same treatment as the invoice, for a consistent letterhead) ─
  doc.fillColor('#1a1a2e').font(FONT_BOLD).fontSize(18).text(data.company.name.toUpperCase(), 40, 40);
  let headerY = doc.y + 2;
  if (data.company.gstNumber) {
    doc.font(FONT).fontSize(9).fillColor('#444').text(`GST : ${data.company.gstNumber}`, 40, headerY);
    headerY = doc.y + 4;
  }
  if (data.company.address) {
    doc.font(FONT).fontSize(9).fillColor('#444').text(data.company.address, 40, headerY, { width: 320, lineGap: 2 });
    headerY = doc.y + 2;
  }
  if (data.company.phone) {
    doc.text(`Phone no.: ${data.company.phone}`, 40, headerY);
    headerY = doc.y + 2;
  }
  if (data.company.email) {
    doc.text(`Email: ${data.company.email}`, 40, headerY);
    headerY = doc.y;
  }

  const logo = await loadLogo(data.company.logo);
  if (logo) {
    try {
      doc.image(logo as any, 460, 36, { width: 95, height: 95, fit: [95, 95] });
    } catch {
      // Skip silently — missing logo shouldn't block the letter.
    }
  }

  const dividerY = Math.max(headerY + 10, 118);
  doc.moveTo(40, dividerY).lineTo(555, dividerY).strokeColor(primary).lineWidth(2).stroke();

  // ─── Ref / Date / Recipient ───────────────────────────────────────────
  doc.y = dividerY + 18;
  doc.fillColor('#000').font(FONT).fontSize(10);
  doc.text(`Ref No: ${data.refNo}`, 40, doc.y);
  doc.text(data.date.toLocaleDateString('en-GB'), 40, doc.y, { align: 'right', width: 515 });
  doc.moveDown(1);
  doc.font(FONT_BOLD).text(data.student.name.toUpperCase());
  doc.font(FONT).fontSize(9).fillColor('#444');
  if (data.student.address) doc.text(data.student.address);
  if (data.student.rollNumber) doc.text(`Roll No: ${data.student.rollNumber}`);

  // ─── Subject ──────────────────────────────────────────────────────────
  doc.moveDown(1.5);
  doc.font(FONT_BOLD).fontSize(13).fillColor(primary).text('Subject: Registration Confirmation Letter', { align: 'center' });
  doc.moveDown(1.2);

  // ─── Body ─────────────────────────────────────────────────────────────
  const firstName = data.student.name.split(' ')[0];
  doc.fillColor('#000').font(FONT).fontSize(10.5);
  doc.text(`Dear ${firstName},`);
  doc.moveDown(0.5);
  doc.font(FONT_BOLD).text('Congratulations!', { continued: true });
  doc.font(FONT).text(` Welcome to ${data.company.name}. Your registration has been `, { continued: true });
  doc.font(FONT_BOLD).text('confirmed', { continued: true });
  doc.font(FONT).text('. Your enrolled course and fee details are outlined below.');

  // ─── Course details table ─────────────────────────────────────────────
  doc.moveDown(1.5);
  const courseTop = doc.y;
  doc.rect(40, courseTop, 515, 20).fill('#f8f8f8').stroke('#ddd');
  doc.fillColor('#000').font(FONT_BOLD).fontSize(10).text('Course Details', 40, courseTop + 5, { align: 'center', width: 515 });

  const drawInfoRow = (label: string, value: string, y: number) => {
    doc.rect(40, y, 150, 22).stroke('#ddd');
    doc.rect(190, y, 365, 22).stroke('#ddd');
    doc.font(FONT_BOLD).fontSize(9).fillColor('#000').text(label, 48, y + 6);
    doc.font(FONT).fontSize(9).fillColor('#333').text(value, 198, y + 6, { width: 350 });
  };
  let rowY = courseTop + 20;
  drawInfoRow('Course Name', data.courseName, rowY); rowY += 22;
  drawInfoRow('Student Email', data.student.email, rowY); rowY += 22;
  if (data.batchName) { drawInfoRow('Batch', data.batchName, rowY); rowY += 22; }

  // ─── Fee structure table ──────────────────────────────────────────────
  doc.y = rowY + 20;
  const feeTop = doc.y;
  doc.rect(40, feeTop, 515, 20).fill('#f8f8f8').stroke('#ddd');
  doc.fillColor('#000').font(FONT_BOLD).fontSize(10).text('Fees Structure', 40, feeTop + 5, { align: 'center', width: 515 });

  const feeColW = 515 / 3;
  const feeHeaderY = feeTop + 20;
  ['Total Fee', 'Discount', 'Net Fee'].forEach((h, i) => {
    doc.rect(40 + i * feeColW, feeHeaderY, feeColW, 26).fill('#f9f9f9').stroke('#ddd');
    doc.fillColor('#000').font(FONT_BOLD).fontSize(9).text(h, 40 + i * feeColW, feeHeaderY + 9, { align: 'center', width: feeColW });
  });
  const feeDataY = feeHeaderY + 26;
  const feeData = [formatRupees(data.totalFee), formatRupees(data.discount || 0), formatRupees(data.finalFee)];
  feeData.forEach((d, i) => {
    doc.rect(40 + i * feeColW, feeDataY, feeColW, 26).stroke('#ddd');
    doc.font(FONT).fontSize(10).fillColor('#333').text(d, 40 + i * feeColW, feeDataY + 8, { align: 'center', width: feeColW });
  });

  // ─── Terms ────────────────────────────────────────────────────────────
  // Same reasoning as invoiceTemplate.ts: the real policy text can run to several
  // paragraphs — this only needs to say terms apply, not restate them.
  doc.y = feeDataY + 26 + 24;
  doc.font(FONT_BOLD).fontSize(10).fillColor('#000').text('Terms and Conditions');
  doc.moveDown(0.3);
  doc.font(FONT).fontSize(8).fillColor('#444').text('Terms and Conditions Apply', 40, doc.y);

  // ─── Signatory ────────────────────────────────────────────────────────
  const sigY = Math.max(doc.y + 30, doc.page.height - 110);
  doc.font(FONT).fontSize(9).fillColor('#333').text(`For: ${data.company.name.toUpperCase()}`, 380, sigY, { align: 'center', width: 175 });
  doc.moveTo(380, sigY + 40).lineTo(555, sigY + 40).strokeColor('#333').lineWidth(0.5).stroke();
  doc.text('Authorized Signatory', 380, sigY + 46, { align: 'center', width: 175 });
}
