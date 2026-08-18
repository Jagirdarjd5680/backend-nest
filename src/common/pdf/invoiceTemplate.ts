import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { registerFonts, FONT, FONT_BOLD, formatRupees, rupeesInWords } from './fonts';

export interface InvoiceCompany {
  name: string;
  gstNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
  logo?: string; // data URI, http(s) URL, or a local /uploads/... path
  primaryColor?: string;
}

export interface InvoiceBillTo {
  name: string;
  address?: string;
  contact?: string;
}

export interface InvoiceData {
  company: InvoiceCompany;
  billTo: InvoiceBillTo;
  invoiceNo: string;
  date: Date;
  itemName: string;
  hsnCode?: string;
  quantity?: number;
  /** GST-inclusive amount actually charged for this line item. */
  totalAmount: number;
  /** Omit (or pass 0) for a course whose GST setting is "none" — the invoice then shows a
   * plain sub-total with no SGST/CGST rows or GST column at all, instead of a 0% split. */
  gstRatePercent?: number;
  /** Prior payments already made toward this same course/order, if any — omit for a single, fully-paid invoice. */
  totalPaidSoFar?: number;
  courseTotalFee?: number;
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

/**
 * Draws a Tax-Invoice-style receipt (header, GST-split item table, amount in words, totals
 * box, terms, signatory) onto an already-created pdfkit document. Caller owns doc lifecycle
 * (pipe/end) — this only draws.
 */
export async function drawInvoice(doc: PDFKit.PDFDocument, data: InvoiceData): Promise<void> {
  registerFonts(doc);
  const primary = data.company.primaryColor || '#f39c12';
  // No caller-specified rate means the course's GST setting is "none" — show a plain invoice
  // with no GST split at all, rather than silently defaulting to some rate the course was
  // never configured for.
  const hasGst = (data.gstRatePercent ?? 0) > 0;
  const gstRate = hasGst ? (data.gstRatePercent as number) : 0;
  const gstTotal = hasGst ? (data.totalAmount * gstRate) / (100 + gstRate) : 0;
  const baseTotal = data.totalAmount - gstTotal;
  const cgst = gstTotal / 2;
  const sgst = gstTotal / 2;

  // ─── Header ───────────────────────────────────────────────────────────
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
      // Corrupt/unreadable image — skip silently, header text still renders fine without it.
    }
  }

  const dividerY = Math.max(headerY + 10, 118);
  doc.moveTo(40, dividerY).lineTo(555, dividerY).strokeColor(primary).lineWidth(2).stroke();

  // ─── Title ────────────────────────────────────────────────────────────
  doc.y = dividerY + 14;
  doc.fillColor(primary).font(FONT_BOLD).fontSize(20).text(hasGst ? 'Tax Invoice' : 'Invoice', { align: 'center' });

  // ─── Bill To / Invoice Details ───────────────────────────────────────
  doc.moveDown(1);
  const infoY = doc.y;
  doc.fillColor('#000').font(FONT_BOLD).fontSize(10).text('Bill To', 40, infoY);
  doc.font(FONT).fontSize(9).fillColor('#333');
  doc.text(data.billTo.name, 40, infoY + 15);
  let billY = doc.y + 2;
  if (data.billTo.address) {
    doc.text(data.billTo.address, 40, billY, { width: 260 });
    billY = doc.y + 2;
  }
  if (data.billTo.contact) {
    doc.text(`Contact No.: ${data.billTo.contact}`, 40, billY);
    billY = doc.y;
  }

  doc.font(FONT_BOLD).fontSize(10).fillColor('#000').text('Invoice Details', 300, infoY, { align: 'right', width: 255 });
  doc.font(FONT).fontSize(9).fillColor('#333');
  doc.text(`Invoice No.: ${data.invoiceNo}`, 300, infoY + 15, { align: 'right', width: 255 });
  doc.text(`Date: ${data.date.toLocaleDateString('en-GB')}`, 300, infoY + 27, { align: 'right', width: 255 });

  doc.y = Math.max(billY, infoY + 45) + 16;

  // ─── Item table ───────────────────────────────────────────────────────
  const tableTop = doc.y;
  const colW = [30, 195, 60, 55, 70, 55, 50]; // sums to 515
  const headers = ['#', 'Item name', 'HSN/ SAC', 'Quantity', 'Price/ Unit', 'GST', 'Amount'];

  doc.rect(40, tableTop, 515, 24).fill(primary);
  let curX = 40;
  headers.forEach((h, i) => {
    doc.fillColor('#fff').font(FONT_BOLD).fontSize(8).text(h, curX + 4, tableTop + 8, { width: colW[i] - 8, align: i === 1 ? 'left' : 'center' });
    curX += colW[i];
  });

  const rowY = tableTop + 24;
  const rowH = 34;
  doc.rect(40, rowY, 515, rowH).stroke('#ddd');
  let lineX = 40;
  colW.slice(0, -1).forEach((w) => {
    lineX += w;
    doc.moveTo(lineX, rowY).lineTo(lineX, rowY + rowH).strokeColor('#ddd').stroke();
  });

  doc.fillColor('#333').font(FONT).fontSize(8);
  let cx = 40;
  doc.text('1', cx + 4, rowY + 13, { width: colW[0] - 8, align: 'center' }); cx += colW[0];
  doc.text(data.itemName, cx + 4, rowY + 13, { width: colW[1] - 8 }); cx += colW[1];
  doc.text(data.hsnCode || '9983', cx + 4, rowY + 13, { width: colW[2] - 8, align: 'center' }); cx += colW[2];
  doc.text(String(data.quantity ?? 1), cx + 4, rowY + 13, { width: colW[3] - 8, align: 'center' }); cx += colW[3];
  doc.text(formatRupees(baseTotal), cx + 4, rowY + 13, { width: colW[4] - 8, align: 'center' }); cx += colW[4];
  doc.text(hasGst ? `${formatRupees(gstTotal)}\n(${gstRate}%)` : 'N/A', cx + 4, rowY + 13, { width: colW[5] - 8, align: 'center' }); cx += colW[5];
  doc.text(formatRupees(data.totalAmount), cx + 4, rowY + 13, { width: colW[6] - 8, align: 'center' });

  const totalRowY = rowY + rowH;
  doc.rect(40, totalRowY, 515, 22).fill('#f9f9f9').stroke('#ddd');
  doc.fillColor('#000').font(FONT_BOLD).fontSize(9).text('Total (Net)', 40, totalRowY + 6, { width: colW[0] + colW[1] + colW[2] + colW[3], align: 'center' });
  doc.text(hasGst ? formatRupees(gstTotal) : '-', 40 + colW[0] + colW[1] + colW[2] + colW[3], totalRowY + 6, { width: colW[4] + colW[5], align: 'center' });
  doc.text(formatRupees(data.totalAmount), 40 + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5], totalRowY + 6, { width: colW[6], align: 'center' });

  // ─── Amount in words / Terms (left)  +  Totals box (right) ─────────────
  const belowTableY = totalRowY + 22 + 24;
  doc.y = belowTableY;

  doc.font(FONT_BOLD).fontSize(10).fillColor('#1a1a2e').text('Invoice Amount In Words', 40, belowTableY);
  doc.font(FONT).fontSize(9).fillColor('#333').text(rupeesInWords(data.totalAmount), 40, doc.y + 4, { width: 300 });
  const wordsBottomY = doc.y;

  const calcX = 355;
  let calcY = belowTableY;
  const drawCalcRow = (label: string, value: string, opts: { bold?: boolean; color?: string } = {}) => {
    doc.fillColor(opts.color || '#000').font(opts.bold ? FONT_BOLD : FONT).fontSize(9.5);
    doc.text(label, calcX, calcY, { width: 100 });
    doc.text(value, calcX + 100, calcY, { width: 100, align: 'right' });
    calcY += 18;
  };
  drawCalcRow('Sub Total', formatRupees(baseTotal));
  if (hasGst) {
    drawCalcRow(`SGST@${(gstRate / 2).toFixed(0)}%`, formatRupees(sgst));
    drawCalcRow(`CGST@${(gstRate / 2).toFixed(0)}%`, formatRupees(cgst));
  }

  doc.rect(calcX, calcY, 200, 26).fill(primary);
  doc.fillColor('#fff').font(FONT_BOLD).fontSize(10.5);
  doc.text('Total', calcX + 10, calcY + 7, { width: 90 });
  doc.text(formatRupees(data.totalAmount), calcX + 100, calcY + 7, { width: 90, align: 'right' });
  calcY += 26;

  if (data.courseTotalFee != null && data.totalPaidSoFar != null && data.courseTotalFee > data.totalAmount) {
    calcY += 8;
    drawCalcRow('Course Total Fee', formatRupees(data.courseTotalFee));
    drawCalcRow('Total Paid So Far', formatRupees(data.totalPaidSoFar), { bold: true, color: '#16A34A' });
    drawCalcRow('Balance Due', formatRupees(Math.max(0, data.courseTotalFee - data.totalPaidSoFar)), { bold: true, color: '#DC2626' });
  }

  // ─── Terms and Conditions ────────────────────────────────────────────
  // Deliberately NOT the full policy text (settings.policies.termsAndConditions can run to
  // several paragraphs — dumping it here as bullets was pushing a single-item invoice onto
  // 3 pages). An invoice just needs to say terms apply, not restate them.
  doc.y = Math.max(wordsBottomY, calcY) + 24;
  doc.font(FONT_BOLD).fontSize(10).fillColor('#000').text('Terms and Conditions');
  doc.moveDown(0.3);
  doc.font(FONT).fontSize(8).fillColor('#444').text('Terms and Conditions Apply', 40, doc.y);

  // ─── Signatory ────────────────────────────────────────────────────────
  const sigY = Math.max(doc.y + 30, doc.page.height - 110);
  doc.font(FONT).fontSize(9).fillColor('#333').text(`For: ${data.company.name.toUpperCase()}`, 380, sigY, { align: 'center', width: 175 });
  doc.moveTo(380, sigY + 40).lineTo(555, sigY + 40).strokeColor('#333').lineWidth(0.5).stroke();
  doc.text('Authorized Signatory', 380, sigY + 46, { align: 'center', width: 175 });
}
