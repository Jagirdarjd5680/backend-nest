import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { registerFonts as registerBodyFonts, FONT, FONT_BOLD } from './fonts';

const SCRIPT_FONT = 'Script';
const SCRIPT_REGULAR = require.resolve('@fontsource/dancing-script/files/dancing-script-latin-700-normal.woff2');

const GOLD = '#C9A24B';
const GOLD_LIGHT = '#E4C978';
const BG_DARK = '#141414';
const BG_DARK_2 = '#1c1c1c';

export interface CertificateData {
  companyName: string;
  companyTagline?: string;
  logo?: string; // data URI, http(s) URL, or local /uploads/... path
  studentName: string;
  courseName: string;
  softwareCovered?: string; // e.g. "Photoshop, Illustrator, Corel Draw"
  issueDate: Date;
  certificateId: string;
  signatureName?: string; // e.g. "Founder & CEO - Jitendra Rajpurohit"
  signatureImage?: string;
}

async function loadImage(src?: string): Promise<Buffer | string | null> {
  if (!src) return null;
  try {
    if (src.startsWith('data:image')) return Buffer.from(src.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    if (src.startsWith('http')) {
      const res = await axios.get(src, { responseType: 'arraybuffer' });
      return Buffer.from(res.data);
    }
    const p = path.join(process.cwd(), src.startsWith('/') ? src : '/' + src);
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/** One quarter-circle "curl" made of a few nested arcs + a dot — the base unit the corner ornament repeats. */
function drawCurl(doc: PDFKit.PDFDocument, cx: number, cy: number, r: number, startAngle: number) {
  for (let i = 0; i < 3; i++) {
    const rr = r - i * 5;
    if (rr <= 2) continue;
    doc
      .save()
      .translate(cx, cy)
      .rotate(startAngle)
      .path(`M ${-rr} 0 A ${rr} ${rr} 0 0 1 0 ${-rr}`)
      .strokeColor(GOLD)
      .lineWidth(0.8)
      .stroke()
      .restore();
  }
  doc.circle(cx, cy, 2).fillColor(GOLD).fill();
}

/**
 * Draws one gold corner flourish (an L-frame with a decorative curl at the apex) at (x, y),
 * oriented so it opens toward the page center. `flipX`/`flipY` mirror it for the other 3 corners.
 */
function drawCornerOrnament(doc: PDFKit.PDFDocument, x: number, y: number, flipX: boolean, flipY: boolean) {
  const armLen = 95;
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;

  doc.save().translate(x, y).scale(sx, sy);

  // Double L-frame lines
  doc.moveTo(0, 22).lineTo(0, 6).lineTo(6, 0).lineTo(armLen, 0).strokeColor(GOLD).lineWidth(1.3).stroke();
  doc.moveTo(0, 32).lineTo(0, 14).lineTo(14, 0).lineTo(armLen - 12, 0).strokeColor(GOLD_LIGHT).lineWidth(0.6).stroke();

  // Decorative curl nested in the corner apex
  doc.save().translate(22, 22);
  for (let i = 0; i < 4; i++) {
    const rr = 16 - i * 4;
    doc
      .path(`M 0 ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0`)
      .strokeColor(i % 2 === 0 ? GOLD : GOLD_LIGHT)
      .lineWidth(0.7)
      .stroke();
  }
  doc.circle(0, 0, 2.2).fillColor(GOLD).fill();
  doc.restore();

  // Small leaf accents along each arm
  [40, 65].forEach((d) => {
    doc.save().translate(d, -2).rotate(-20);
    doc.path('M 0 0 C 4 -6, 10 -6, 12 0 C 10 6, 4 6, 0 0 Z').fillColor(GOLD).fillOpacity(0.85).fill();
    doc.restore();
    doc.save().translate(-2, d).rotate(70);
    doc.path('M 0 0 C 4 -6, 10 -6, 12 0 C 10 6, 4 6, 0 0 Z').fillColor(GOLD).fillOpacity(0.85).fill();
    doc.restore();
  });

  doc.restore();
}

/** A compact circular "certified" seal badge — center label + a ring of small tick marks instead of curved text (pdfkit has no native text-on-path support). */
function drawSealBadge(doc: PDFKit.PDFDocument, cx: number, cy: number, r: number, label: string) {
  doc.save();
  doc.circle(cx, cy, r).fillColor('#B8860B').fill();
  doc.circle(cx, cy, r).strokeColor(GOLD_LIGHT).lineWidth(1.5).stroke();
  doc.circle(cx, cy, r - 6).strokeColor(GOLD_LIGHT).lineWidth(0.8).stroke();

  const tickCount = 32;
  for (let i = 0; i < tickCount; i++) {
    const angle = (i / tickCount) * Math.PI * 2;
    const inner = r - 6;
    const outer = r - 2;
    doc
      .moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
      .lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
      .strokeColor(GOLD_LIGHT)
      .lineWidth(0.6)
      .stroke();
  }

  const textWidth = (r - 8) * 2;
  const textX = cx - r + 8;
  const [labelTop, labelBottom] = label.split(' ');
  doc.font(FONT_BOLD).fontSize(6.5).fillColor('#1a1a1a').text('CERTIFIED', textX, cy - r + 14, { width: textWidth, align: 'center', characterSpacing: 0.5 });
  doc.font(FONT_BOLD).fontSize(13).fillColor('#1a1a1a').text(labelTop, textX, cy - 13, { width: textWidth, align: 'center' });
  doc.font(FONT_BOLD).fontSize(13).fillColor('#1a1a1a').text(labelBottom || '', textX, cy + 2, { width: textWidth, align: 'center' });
  doc.font(FONT_BOLD).fontSize(6.5).fillColor('#1a1a1a').text('CERTIFIED', textX, cy + r - 20, { width: textWidth, align: 'center', characterSpacing: 0.5 });

  // Ribbon tails beneath the seal
  doc.path(`M ${cx - r * 0.5} ${cy + r * 0.75} L ${cx - r * 0.75} ${cy + r * 1.6} L ${cx - r * 0.15} ${cy + r * 1.15} Z`).fillColor('#8B6508').fill();
  doc.path(`M ${cx + r * 0.5} ${cy + r * 0.75} L ${cx + r * 0.75} ${cy + r * 1.6} L ${cx + r * 0.15} ${cy + r * 1.15} Z`).fillColor('#8B6508').fill();
  doc.restore();
}

/** Draws the "Certificate of Completion" onto an already-created landscape pdfkit document. */
export async function drawCertificate(doc: PDFKit.PDFDocument, data: CertificateData): Promise<void> {
  registerBodyFonts(doc);
  doc.registerFont(SCRIPT_FONT, SCRIPT_REGULAR);

  const W = doc.page.width;
  const H = doc.page.height;

  // ─── Background ───────────────────────────────────────────────────────
  doc.rect(0, 0, W, H).fillColor(BG_DARK).fill();
  // A handful of soft, oversized translucent strokes stand in for a marble-vein texture —
  // an actual raster marble background image would look better but isn't available here.
  doc.save();
  for (let i = 0; i < 6; i++) {
    const y = (H / 6) * i + (i % 2 === 0 ? 20 : -10);
    doc
      .moveTo(-50, y)
      .bezierCurveTo(W * 0.3, y + 60, W * 0.6, y - 60, W + 50, y + 20)
      .strokeColor(BG_DARK_2)
      .lineWidth(30 + (i % 3) * 10)
      .strokeOpacity(0.5)
      .stroke();
  }
  doc.restore();

  // Outer + inner frame
  doc.rect(18, 18, W - 36, H - 36).strokeColor(GOLD).lineWidth(1.5).stroke();
  doc.rect(26, 26, W - 52, H - 52).strokeColor(GOLD).lineWidth(0.5).stroke();

  // Corner ornaments
  drawCornerOrnament(doc, 26, 26, false, false);
  drawCornerOrnament(doc, W - 26, 26, true, false);
  drawCornerOrnament(doc, 26, H - 26, false, true);
  drawCornerOrnament(doc, W - 26, H - 26, true, true);

  // ─── Logo ─────────────────────────────────────────────────────────────
  const centerX = W / 2;
  let y = 42;
  const logo = await loadImage(data.logo);
  if (logo) {
    try {
      doc.image(logo as any, centerX - 34, y, { width: 68, height: 68, fit: [68, 68] });
      y += 74;
    } catch {
      y += 6;
    }
  } else {
    doc.circle(centerX, y + 30, 30).fillColor('#8B0000').fill();
    doc.circle(centerX, y + 30, 30).strokeColor(GOLD).lineWidth(1.5).stroke();
    doc.font(FONT_BOLD).fontSize(22).fillColor(GOLD_LIGHT).text(data.companyName.charAt(0), centerX - 30, y + 14, { width: 60, align: 'center' });
    y += 68;
  }

  // ─── Company name + tagline ──────────────────────────────────────────
  doc.font(FONT_BOLD).fontSize(20).fillColor('#fff').text(data.companyName.toUpperCase(), 0, y, { width: W, align: 'center', characterSpacing: 1.5 });
  y = doc.y + 4;
  if (data.companyTagline) {
    doc.font(FONT_BOLD).fontSize(9).fillColor(GOLD).text(data.companyTagline.toUpperCase(), 0, y, { width: W, align: 'center', characterSpacing: 1 });
    y = doc.y + 10;
  }
  doc.moveTo(centerX - 90, y).lineTo(centerX + 90, y).strokeColor(GOLD).lineWidth(0.8).stroke();
  y += 14;

  // ─── Certificate of Completion (script) ──────────────────────────────
  doc.font(SCRIPT_FONT).fontSize(46).fillColor(GOLD_LIGHT).text('Certificate of Completion', 0, y, { width: W, align: 'center' });
  y = doc.y + 10;

  doc.font(FONT_BOLD).fontSize(13).fillColor('#fff').text('PROUDLY PRESENTED TO', 0, y, { width: W, align: 'center', characterSpacing: 3 });
  y = doc.y + 16;

  // ─── Student name ─────────────────────────────────────────────────────
  doc.font(FONT_BOLD).fontSize(30).fillColor(GOLD_LIGHT).text(data.studentName.toUpperCase(), 60, y, { width: W - 120, align: 'center', characterSpacing: 1 });
  y = doc.y + 6;
  doc.moveTo(centerX - 220, y).lineTo(centerX + 220, y).strokeColor(GOLD).lineWidth(1).stroke();
  y += 18;

  // ─── Course line ──────────────────────────────────────────────────────
  const leftX = 70;
  const labelWidth = 240;
  doc.font(FONT_BOLD).fontSize(12).fillColor('#fff').text('For succesfully completing the ', leftX, y, { continued: true, width: labelWidth });
  doc.font(FONT).fontSize(13).fillColor('#eee').text(data.courseName, { width: W - leftX - 70 });
  doc.moveTo(leftX + labelWidth + 4, doc.y - 2).lineTo(W - 70, doc.y - 2).strokeColor(GOLD).lineWidth(0.5).stroke();
  y = doc.y + 6;

  if (data.softwareCovered) {
    doc.font(FONT_BOLD).fontSize(12).fillColor('#fff').text('course. Software coverd', leftX, y, { continued: true, width: labelWidth });
    doc.font(FONT).fontSize(13).fillColor('#eee').text(data.softwareCovered, { width: W - leftX - 70 });
    doc.moveTo(leftX + labelWidth + 4, doc.y - 2).lineTo(W - 70, doc.y - 2).strokeColor(GOLD).lineWidth(0.5).stroke();
    y = doc.y + 6;
  }
  doc.moveTo(leftX, y + 14).lineTo(W - 70, y + 14).strokeColor(GOLD).lineWidth(0.4).stroke();

  // ─── Footer: date / seal / signature ─────────────────────────────────
  const footerY = H - 110;
  doc.font(FONT).fontSize(12).fillColor('#fff').text(
    data.issueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase(),
    70,
    footerY,
    { width: 220 },
  );
  doc.moveTo(70, doc.y + 4).lineTo(290, doc.y + 4).strokeColor(GOLD).lineWidth(0.8).stroke();
  doc.font(FONT).fontSize(7.5).fillColor('#aaa').text('DATE OF ISSUED', 70, doc.y + 8);
  doc.text(`CERTIFICATE ID - ${data.certificateId}`, 70, doc.y + 2);

  drawSealBadge(doc, centerX, footerY + 42, 48, 'ISO 9001');

  const sigImage = await loadImage(data.signatureImage);
  const sigX = W - 290;
  if (sigImage) {
    try {
      doc.image(sigImage as any, sigX + 40, footerY - 30, { width: 100, height: 45, fit: [100, 45] });
    } catch {
      // No signature image — the underline still reads fine on its own.
    }
  }
  doc.moveTo(sigX, footerY + 20).lineTo(sigX + 220, footerY + 20).strokeColor(GOLD).lineWidth(0.8).stroke();
  if (data.signatureName) {
    doc.font(FONT_BOLD).fontSize(9).fillColor('#fff').text(data.signatureName.toUpperCase(), sigX, footerY + 26, { width: 220, align: 'center', characterSpacing: 0.5 });
  }
}
