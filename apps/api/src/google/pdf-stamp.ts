import * as fs from 'fs';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';

/** Font có dấu tiếng Việt để in dấu chốt; không có thì in không dấu. */
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
];

function ascii(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\x20-\x7e]/g, '-');
}

/**
 * Đóng dấu "ĐÃ CHỐT – số hồ sơ – ngày – mã kiểm tra" + mã QR lên mọi trang (US-07.4, BR-29).
 */
export async function stampFinalized(
  pdfBytes: Buffer,
  p: { number: string; date: string; verifyCode: string; verifyUrl: string; fontPath?: string },
): Promise<Buffer> {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  let font: PDFFont;
  let unicode = false;
  const fontFile = [p.fontPath, ...FONT_CANDIDATES].find((f) => f && fs.existsSync(f));
  if (fontFile) {
    try {
      pdf.registerFontkit(fontkit);
      font = await pdf.embedFont(fs.readFileSync(fontFile), { subset: true });
      unicode = true;
    } catch {
      font = await pdf.embedFont(StandardFonts.HelveticaBold);
    }
  } else {
    font = await pdf.embedFont(StandardFonts.HelveticaBold);
  }
  const text = `ĐÃ CHỐT – ${p.number} – ${p.date} – Mã kiểm tra: ${p.verifyCode}`;
  const line = unicode ? text : ascii(text);
  const qrPng = await QRCode.toBuffer(p.verifyUrl, { margin: 1, width: 120 });
  const qr = await pdf.embedPng(qrPng);
  for (const page of pdf.getPages()) {
    const { width } = page.getSize();
    page.drawRectangle({ x: 20, y: 14, width: width - 40, height: 50, borderColor: rgb(0.75, 0.1, 0.1), borderWidth: 1.2, color: rgb(1, 1, 1), opacity: 0.9 });
    page.drawText(line, { x: 30, y: 34, size: 10, font, color: rgb(0.75, 0.1, 0.1) });
    page.drawImage(qr, { x: width - 68, y: 16, width: 46, height: 46 });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
