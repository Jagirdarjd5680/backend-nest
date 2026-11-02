import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

/**
 * Certificate of Completion — A4 portrait, white with a yellow outer / black inner frame,
 * the institute's own layout (issue-date + certificate-no tabs, ISO badge, yellow highlight
 * bars under the title, student and course). Everything that varies (institute name, logo,
 * signature image, signatory, website) comes from Settings → General → Certificate.
 */

const HEAD = 'Oswald-Bold';
const BODY = 'Oswald';
const BODY_MEDIUM = 'Oswald-Medium';
const font = (weight: number) => require.resolve(`@fontsource/oswald/files/oswald-latin-${weight}-normal.woff`);

const YELLOW = '#FFC20E';
const INK = '#111111';
const MUTED = '#3A3A3A';
const PANEL = '#E6E6E6';
const SHAPE = '#F1F1F1';

export interface CertificateData {
  companyName: string;
  companyTagline?: string;
  logo?: string; // data URI, http(s) URL, or local /uploads/... path
  studentName: string;
  courseName: string;
  issueDate: Date;
  certificateId: string;
  /** e.g. "45 Hours" — dashed blank line when unknown. */
  duration?: string;
  /** e.g. "A+" — dashed blank line when unknown. */
  grade?: string;
  /** e.g. "Photoshop, Illustrator" — dashed blank line when unknown. */
  specialization?: string;
  signatureName?: string; // right column, e.g. "Jitendra Kumar Rajpurohit"
  signatureTitle?: string; // under it, e.g. "Founder & CEO"
  signatureImage?: string; // left column, above "Authorized Signature"
  website?: string; // footer, e.g. "godofgraphics.in"
  /** Kept for older callers; not printed on this layout. */
  softwareCovered?: string;
}

/** Settings → General → Certificate (falls back to the older Company/siteName fields). */
export function certificateBranding(settings: any): Omit<CertificateData, 'studentName' | 'courseName' | 'issueDate' | 'certificateId'> {
  const g = settings?.general ?? {};
  const c = settings?.company ?? {};
  return {
    companyName: g.certificateInstituteName || g.siteName || 'God of Graphics',
    companyTagline: g.certificateTagline || c.tagline || 'Premier Academy for Multimedia & Computer Education',
    logo: g.pdfLogo || g.siteLogo || '',
    signatureName: g.certificateSignatoryName || c.signatoryName || undefined,
    signatureTitle: g.certificateSignatoryTitle || 'Founder & CEO',
    signatureImage: g.pdfCertificateSignature || undefined,
    website: g.certificateWebsite || undefined,
  };
}

async function loadImage(src?: string): Promise<Buffer | string | null> {
  if (!src) return null;
  try {
    if (src.startsWith('data:image')) return Buffer.from(src.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    if (src.startsWith('http')) {
      const res = await axios.get(src, { responseType: 'arraybuffer', timeout: 8000 });
      return Buffer.from(res.data);
    }
    const p = path.join(process.cwd(), src.startsWith('/') ? src : '/' + src);
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/** Largest font size (≤ max) at which `text` fits in `width`. */
function fitSize(doc: PDFKit.PDFDocument, fontName: string, text: string, width: number, max: number, min = 10): number {
  let size = max;
  doc.font(fontName);
  while (size > min && doc.fontSize(size).widthOfString(text) > width) size -= 1;
  return size;
}

/** Centered text sitting on a yellow highlight bar (bar covers the lower part of the letters). */
function highlighted(doc: PDFKit.PDFDocument, text: string, y: number, size: number, W: number, maxWidth: number) {
  const s = fitSize(doc, HEAD, text, maxWidth, size);
  doc.font(HEAD).fontSize(s);
  const w = doc.widthOfString(text);
  const barH = s * 0.42;
  doc.rect((W - w) / 2 - 14, y + s * 0.72, w + 28, barH).fillColor(YELLOW).fill();
  doc.fillColor(INK).text(text, 0, y, { width: W, align: 'center', lineBreak: false });
  return y + s * 1.35;
}

/** "Label: value" with a dashed underline; the value is printed on the line when known. */
function field(doc: PDFKit.PDFDocument, label: string, value: string | undefined, x: number, y: number, width: number) {
  doc.font(BODY).fontSize(17).fillColor(INK).text(`${label}:`, x, y, { lineBreak: false });
  const lx = x + doc.widthOfString(`${label}:`) + 6;
  const ly = y + 21;
  doc.save().moveTo(lx, ly).lineTo(x + width, ly).dash(5, { space: 4 }).strokeColor(INK).lineWidth(1).stroke().restore();
  doc.undash();
  if (value) {
    const s = fitSize(doc, BODY_MEDIUM, value, x + width - lx - 4, 15, 9);
    doc.font(BODY_MEDIUM).fontSize(s).fillColor(INK).text(value, lx + 2, y + 2 + (15 - s), { width: x + width - lx - 4, lineBreak: false });
  }
}

/** Grey rounded tab at the top corners: a small label over a value. */
function tab(doc: PDFKit.PDFDocument, x: number, y: number, w: number, label: string, value: string) {
  doc.roundedRect(x, y, w, 50, 10).fillColor(PANEL).fill();
  doc.font(BODY).fontSize(14).fillColor(INK).text(label, x, y + 6, { width: w, align: 'center', lineBreak: false });
  const s = fitSize(doc, BODY, value, w - 16, 12, 7);
  doc.font(BODY).fontSize(s).fillColor(MUTED).text(value, x + 8, y + 28, { width: w - 16, align: 'center', lineBreak: false });
}

export async function drawCertificate(doc: PDFKit.PDFDocument, data: CertificateData): Promise<void> {
  doc.registerFont(HEAD, font(700));
  doc.registerFont(BODY_MEDIUM, font(500));
  doc.registerFont(BODY, font(400));

  const W = doc.page.width; // 595 (A4 portrait)
  const H = doc.page.height; // 842
  const cx = W / 2;

  // ─── Background: soft grey triangles + frames ────────────────────────────
  doc.rect(0, 0, W, H).fillColor('#FFFFFF').fill();
  doc.save().fillColor(SHAPE);
  doc.polygon([0, 230], [80, 330], [0, 430]).fill();
  doc.polygon([0, 470], [60, 560], [0, 650]).fill();
  doc.polygon([W, 250], [W - 90, 360], [W, 470]).fill();
  doc.polygon([W, 520], [W - 70, 610], [W, 700]).fill();
  doc.polygon([W - 160, 0], [W - 60, 0], [W - 110, 60]).fill();
  doc.polygon([160, H], [260, H], [210, H - 60]).fill();
  doc.restore();

  doc.rect(16, 16, W - 32, H - 32).strokeColor(YELLOW).lineWidth(9).stroke();
  doc.rect(28, 28, W - 56, H - 56).strokeColor(INK).lineWidth(1.6).stroke();

  // ─── Top tabs ─────────────────────────────────────────────────────────────
  const d = data.issueDate;
  const date = `${String(d.getDate()).padStart(2, '0')} / ${String(d.getMonth() + 1).padStart(2, '0')} / ${d.getFullYear()}`;
  tab(doc, 46, 46, 128, 'Issue Date:', date);
  tab(doc, W - 46 - 128, 46, 128, 'Certificate No:', data.certificateId);

  // ─── Logo, institute, tagline ─────────────────────────────────────────────
  let y = 44;
  const logo = await loadImage(data.logo);
  if (logo) {
    try {
      doc.image(logo as any, cx - 26, y, { fit: [52, 52], align: 'center', valign: 'center' });
    } catch {
      // unreadable logo — the name below still identifies the institute
    }
  }
  y += 56;
  const nameSize = fitSize(doc, HEAD, data.companyName.toUpperCase(), 250, 19);
  doc.font(HEAD).fontSize(nameSize).fillColor(INK).text(data.companyName.toUpperCase(), 0, y, { width: W, align: 'center', characterSpacing: 0.6, lineBreak: false });
  y += nameSize + 8;
  if (data.companyTagline) {
    const ts = fitSize(doc, BODY_MEDIUM, data.companyTagline, W - 130, 13);
    doc.font(BODY_MEDIUM).fontSize(ts).fillColor(INK).text(data.companyTagline, 0, y, { width: W, align: 'center', lineBreak: false });
    y += ts + 12;
  }

  // ISO Certified badge
  const bw = 112;
  const bx = cx - bw / 2;
  doc.roundedRect(bx, y, bw, 30, 6).strokeColor('#9A9A9A').lineWidth(1).stroke();
  doc.circle(bx + 20, y + 15, 10).strokeColor('#9A9A9A').lineWidth(0.8).stroke();
  doc.font(HEAD).fontSize(12).fillColor('#5A5A5A').text('ISO', bx + 8, y + 7, { width: 24, align: 'center', lineBreak: false });
  doc.moveTo(bx + 36, y + 4).lineTo(bx + 36, y + 26).strokeColor('#9A9A9A').lineWidth(0.8).stroke();
  doc.font(HEAD).fontSize(9).fillColor('#5A5A5A').text('ISO', bx + 42, y + 3, { lineBreak: false });
  doc.font(BODY).fontSize(12).fillColor('#5A5A5A').text('Certified', bx + 42, y + 12, { lineBreak: false });
  y += 48;

  // ─── Title ────────────────────────────────────────────────────────────────
  y = highlighted(doc, 'CERTIFICATE OF COMPLETION', y, 38, W, W - 150);
  y += 6;
  doc.moveTo(cx - 180, y).lineTo(cx + 180, y).strokeColor(YELLOW).lineWidth(2.5).stroke();
  y += 34;

  // ─── Awarded to ───────────────────────────────────────────────────────────
  doc.font(BODY).fontSize(19).fillColor(INK).text('This certificate is proudly awarded to', 0, y, { width: W, align: 'center', lineBreak: false });
  y += 46;
  y = highlighted(doc, data.studentName, y, 28, W, W - 160);
  y += 20;

  doc.font(BODY).fontSize(19).fillColor(INK).text('For successfully completing the professional course in', 0, y, { width: W, align: 'center', lineBreak: false });
  y += 44;
  y = highlighted(doc, data.courseName, y, 27, W, W - 130);
  y += 18;

  doc.font(BODY).fontSize(18).fillColor(INK).text(
    `At ${data.companyName} Institute, demonstrating creativity, practical knowledge and professional skills.`,
    80,
    y,
    { width: W - 160, align: 'center', lineGap: 4 },
  );
  y = doc.y + 40;

  // ─── Details ──────────────────────────────────────────────────────────────
  field(doc, 'Duration', data.duration, 72, y, 220);
  field(doc, 'Grade', data.grade, 312, y, 212);
  y += 46;
  field(doc, 'Project / Specialization', data.specialization, 72, y, 452);

  // ─── Signatures ───────────────────────────────────────────────────────────
  const lineY = H - 118;
  const sig = await loadImage(data.signatureImage);
  if (sig) {
    try {
      doc.image(sig as any, 80, lineY - 62, { fit: [150, 58], align: 'center', valign: 'bottom' });
    } catch {
      // no usable image — the blank line is still signable by hand
    }
  }
  doc.moveTo(54, lineY).lineTo(250, lineY).strokeColor(INK).lineWidth(1.6).stroke();
  doc.font(BODY).fontSize(17).fillColor(INK).text('Authorized Signature', 54, lineY + 6, { width: 196, align: 'center', lineBreak: false });

  if (data.signatureName) {
    const ss = fitSize(doc, BODY_MEDIUM, data.signatureName, 210, 19, 11);
    doc.font(BODY_MEDIUM).fontSize(ss).fillColor(INK).text(data.signatureName, W - 264, lineY - ss - 8, { width: 210, align: 'center', lineBreak: false });
  }
  doc.moveTo(W - 264, lineY).lineTo(W - 54, lineY).strokeColor(INK).lineWidth(1.6).stroke();
  doc.font(BODY).fontSize(17).fillColor(INK).text(data.signatureTitle || 'Founder & CEO', W - 264, lineY + 6, { width: 210, align: 'center', lineBreak: false });

  if (data.website) {
    doc.font(BODY).fontSize(14).fillColor(INK).text(data.website, 0, H - 62, { width: W, align: 'center', lineBreak: false });
  }
}
