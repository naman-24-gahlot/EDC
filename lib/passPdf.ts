// SERVER-ONLY. Writes lib/passCard.ts's layout as a PDF — one page per card, each page exactly the
// card's size, so a card printer or "actual size" printing reproduces it 1:1. A small hand-written
// PDF (no library): the standard Helvetica/Courier fonts every PDF reader has, the photo embedded
// as-is (it's already a JPEG), and the QR as filled squares.
if (typeof window !== 'undefined') {
  throw new Error('lib/passPdf.ts must never be imported into client code.');
}

import { textWidth, type Shape } from '@/lib/passCard';

const K = 72 / 25.4; // points per mm
const n = (v: number) => (Math.round(v * 100) / 100).toString();
const rgb = (hex: string) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => n(parseInt(h.slice(i, i + 2), 16) / 255)).join(' '); };
const FONT_REF = { regular: '/F1', bold: '/F2', mono: '/F3' } as const;

// The standard fonts use WinAnsi: Latin-1 plus a few typographic marks. Anything else prints as "?".
const WIN: Record<number, number> = { 0x2026: 0x85, 0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x20ac: 0x80 };
function pdfString(s: string): string {
  let out = '';
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (WIN[c]) c = WIN[c]; else if (c > 255 || (c < 32 && c !== 9)) c = 63;
    if (c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
    else if (c < 127) out += String.fromCharCode(c);
    else out += '\\' + c.toString(8).padStart(3, '0');
  }
  return `(${out})`;
}

/** Width and height of a baseline/progressive JPEG (from its SOF marker). */
function jpegSize(b: Buffer): { w: number; h: number } | null {
  // Photos are checked on upload (isWellFormedJpeg); older or hand-edited ones just print without the photo.
  try {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const dim = { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        return dim.w && dim.h ? dim : null;
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  } catch { /* malformed */ }
  return null;
}

/** A (rounded) rectangle path in points — mm in, PDF's bottom-left origin. Bézier corners. */
function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const R = Math.min(r, w / 2, h / 2);
  if (R <= 0) return `${n(x * K)} ${n(y * K)} ${n(w * K)} ${n(h * K)} re`;
  const k = 0.5523 * R;
  const p = (a: number, b: number) => `${n(a * K)} ${n(b * K)}`;
  const x2 = x + w, y2 = y + h;
  return [
    `${p(x + R, y)} m`, `${p(x2 - R, y)} l`, `${p(x2 - R + k, y)} ${p(x2, y + R - k)} ${p(x2, y + R)} c`,
    `${p(x2, y2 - R)} l`, `${p(x2, y2 - R + k)} ${p(x2 - R + k, y2)} ${p(x2 - R, y2)} c`,
    `${p(x + R, y2)} l`, `${p(x + R - k, y2)} ${p(x, y2 - R + k)} ${p(x, y2 - R)} c`,
    `${p(x, y + R)} l`, `${p(x, y + R - k)} ${p(x + R - k, y)} ${p(x + R, y)} c`, 'h',
  ].join(' ');
}

export function passPdf(pages: { w: number; h: number; shapes: Shape[] }[], title = 'EDC entry pass'): Buffer {
  const objects: (string | Buffer)[] = []; // index = object number - 1
  const add = (o: string | Buffer) => { objects.push(o); return objects.length; };
  const catalog = add(''), pagesObj = add('');
  const fonts = [add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>')];
  const kids: number[] = [];

  for (const page of pages) {
    const H = page.h;
    const images: string[] = [];
    let c = '';
    for (const s of page.shapes) {
      if (s.kind === 'rect') {
        const path = roundRect(s.x, H - s.y - s.h, s.w, s.h, s.r ?? 0);
        c += `${rgb(s.fill)} rg ${path} f\n`;
        if (s.stroke) c += `${rgb(s.stroke)} RG ${n((s.strokeWidth ?? 0.2) * K)} w ${path} S\n`;
      } else if (s.kind === 'line') {
        const dash = s.dash ? `[${n(s.width * 4 * K)} ${n(s.width * 3 * K)}] 0 d ` : '';
        c += `${dash}${rgb(s.color)} RG ${n(s.width * K)} w ${n(s.x1 * K)} ${n((H - s.y1) * K)} m ${n(s.x2 * K)} ${n((H - s.y2) * K)} l S${dash ? ' [] 0 d' : ''}\n`;
      } else if (s.kind === 'text') {
        const wmm = textWidth(s.text, s.font, s.size, s.spacing ?? 0);
        const x = s.align === 'center' ? s.x - wmm / 2 : s.align === 'right' ? s.x - wmm : s.x;
        // Tc = letter spacing (points), as the screen version's letter-spacing.
        c += `BT ${FONT_REF[s.font]} ${n(s.size)} Tf ${n((s.spacing ?? 0) * K)} Tc ${rgb(s.color)} rg ${n(x * K)} ${n((H - s.y) * K)} Td ${pdfString(s.text)} Tj ET\n`;
      } else if (s.kind === 'qr') {
        const u = s.size / s.modules;
        c += '0 0 0 rg\n';
        for (const i of s.cells) c += `${n((s.x + (i % s.modules) * u) * K)} ${n((H - s.y - (Math.floor(i / s.modules) + 1) * u) * K)} ${n(u * K + 0.02)} ${n(u * K + 0.02)} re\n`;
        c += 'f\n';
      } else if (s.kind === 'photo') {
        const m = s.src.match(/^data:image\/jpeg;base64,(.+)$/);
        const bytes = m ? Buffer.from(m[1], 'base64') : null;
        const dim = bytes ? jpegSize(bytes) : null;
        if (!bytes || !dim) continue;
        const name = `/Im${images.length + 1}`;
        const head = `<< /Type /XObject /Subtype /Image /Width ${dim.w} /Height ${dim.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`;
        images.push(`${name} ${add(Buffer.concat([Buffer.from(head, 'latin1'), bytes, Buffer.from('\nendstream', 'latin1')]))} 0 R`);
        // "Cover" the box like the screen version: scale to fill, centre, clip the overflow.
        const scale = Math.max(s.w / dim.w, s.h / dim.h);
        const dw = dim.w * scale, dh = dim.h * scale;
        const dx = s.x + (s.w - dw) / 2, dy = s.y + (s.h - dh) / 2;
        c += `q ${roundRect(s.x, H - s.y - s.h, s.w, s.h, s.r)} W n ${n(dw * K)} 0 0 ${n(dh * K)} ${n(dx * K)} ${n((H - dy - dh) * K)} cm ${name} Do Q\n`;
      }
    }
    const content = add(`<< /Length ${Buffer.byteLength(c, 'latin1')} >>\nstream\n${c}endstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(page.w * K)} ${n(page.h * K)}] /Contents ${content} 0 R /Resources << /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> /XObject << ${images.join(' ')} >> >> >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R /ViewerPreferences << /PrintScaling /None >> >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title ${pdfString(title)} /Producer (EDC Access) >>`);

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = parts[0].length;
  const xref: number[] = [];
  objects.forEach((o, i) => {
    xref.push(offset);
    const body = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), typeof o === 'string' ? Buffer.from(o, 'latin1') : o, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(body);
    offset += body.length;
  });
  const table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref.map((x) => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(Buffer.from(table, 'latin1'));
  return Buffer.concat(parts);
}
