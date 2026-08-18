// pdfkit's built-in "Helvetica"/"Helvetica-Bold" only cover WinAnsiEncoding — there is no
// glyph for ₹ (U+20B9) in them, so `doc.text('₹100')` silently drops/boxes the rupee sign
// (confirmed empirically: fee-records.service.ts's old receipt used raw ₹ with the default
// font and rendered broken). DejaVu Sans is a single TTF (unlike Google Fonts-style
// Latin/Latin-ext-split webfonts) that has both full Basic Latin AND ₹ in one file, so no
// mid-string font switching is needed — register it once and use it for all PDF body text.
const REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

export const FONT = 'Body';
export const FONT_BOLD = 'Body-Bold';

export function registerFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont(FONT, REGULAR);
  doc.registerFont(FONT_BOLD, BOLD);
}

/** Formats a number as ₹ with Indian digit grouping (e.g. 150000 -> ₹1,50,000). */
export function formatRupees(amount: number): string {
  const n = Math.round(Number(amount) || 0);
  const intPart = String(Math.abs(n));
  let grouped = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  return `${n < 0 ? '-' : ''}₹${grouped}`;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? ' ' + ONES[o] : ''}`;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${h ? ONES[h] + ' Hundred' : ''}${h && rest ? ' ' : ''}${rest ? twoDigits(rest) : ''}`;
}

/** Indian numbering (Crore/Lakh/Thousand) amount-in-words, e.g. 33000 -> "Thirty Three Thousand Rupees Only". */
export function rupeesInWords(amount: number): string {
  let n = Math.round(Number(amount) || 0);
  if (n === 0) return 'Zero Rupees Only';

  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = n;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  return `${parts.join(' ').trim()} Rupees Only`;
}
