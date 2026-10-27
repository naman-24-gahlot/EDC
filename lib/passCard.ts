// CLIENT-SAFE (no server imports). The printable entry pass / ID card: the sizes offered, the
// colour per role, and ONE layout — a list of shapes in millimetres — that both renderers draw:
// components/PassCardSvg.tsx (screen preview and browser printing) and lib/passPdf.ts (the PDF
// download). Same layout, same text fitting, so the PDF and the print can't drift apart.

export const CARD_SIZES = [
  { id: 'cr80', label: 'ID card — landscape', note: 'CR80 · 85.6 × 54 mm — PVC card printers, the standard ID / bank-card size', w: 85.6, h: 54 },
  { id: 'cr80p', label: 'ID card — portrait', note: 'CR80 · 54 × 85.6 mm — vertical lanyard badges', w: 54, h: 85.6 },
  { id: 'cr100', label: 'Large ID card', note: 'CR100 · 98.5 × 67 mm — oversized ID cards', w: 98.5, h: 67 },
  { id: 'badge', label: 'Event badge', note: '4 × 3 in · 101.6 × 76.2 mm — lanyard badge pouches', w: 101.6, h: 76.2 },
  { id: 'a6', label: 'Paper pass (A6)', note: 'A6 · 105 × 148 mm — a gate pass on plain paper', w: 105, h: 148 },
  { id: 'a4', label: 'ID card on A4', note: 'A4 page with one CR80 card and cut marks — any office printer', w: 210, h: 297 },
] as const;
export type CardSizeId = (typeof CARD_SIZES)[number]['id'];
export const DEFAULT_CARD_SIZE: CardSizeId = 'cr80';
export const cardSize = (id: string | null | undefined) => CARD_SIZES.find((s) => s.id === id) ?? CARD_SIZES[0];
export const isCardSize = (v: unknown): v is CardSizeId => typeof v === 'string' && CARD_SIZES.some((s) => s.id === v);

/** Role colours: the band across the card, so a guard can tell roles apart at a glance. */
export const ROLE_STYLE: Record<string, { band: string; accent: string; label: string }> = {
  master: { band: '#1F2937', accent: '#DB3B51', label: 'MASTER' },
  employee: { band: '#004180', accent: '#5AA9E6', label: 'EMPLOYEE' },
  incubee: { band: '#0F766E', accent: '#5EEAD4', label: 'INCUBEE' },
  event_guest: { band: '#C2410C', accent: '#FDBA74', label: 'EVENT GUEST' },
  visitor: { band: '#6D28D9', accent: '#C4B5FD', label: 'VISITOR' },
  vvip: { band: '#111827', accent: '#D4A017', label: 'VVIP VISITOR' },
  driver: { band: '#475569', accent: '#CBD5E1', label: 'DRIVER' },
  relative: { band: '#9D174D', accent: '#F9A8D4', label: 'RELATIVE' },
  bodyguard: { band: '#7F1D1D', accent: '#FCA5A5', label: 'BODYGUARD' },
};
export const roleKey = (p: { systemRole?: string; profileType?: string | null; vvip?: boolean }) =>
  p.systemRole === 'master' ? 'master' : p.profileType === 'visitor' && p.vvip ? 'vvip' : p.profileType ?? 'employee';

/** Everything printed on a card. Built on the server (lib/passData.ts). */
export interface CardData {
  name: string;
  role: string;            // ROLE_STYLE key
  subtitle: string | null; // "Under Rahul Sharma" / the event / the host
  code: string | null;     // EDC12345
  validity: string;        // "Valid 21 Oct – 19 Nov 2026 · Mon–Fri 09:00–17:00"
  photo: string | null;    // data:image/jpeg;base64,…
  qr: { size: number; cells: number[] } | null; // dark module indexes (row * size + col)
  issued: string;          // "Issued 27 Oct 2026"
}

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { kind: 'text'; x: number; y: number; size: number; text: string; font: Font; color: string; align: 'left' | 'center' | 'right' }
  | { kind: 'photo'; x: number; y: number; w: number; h: number; src: string }
  | { kind: 'qr'; x: number; y: number; size: number; modules: number; cells: number[] }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number };
export type Font = 'regular' | 'bold' | 'mono';

// ——— text measuring (Helvetica / Courier advance widths, 1/1000 em), shared by both renderers ———
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const PT = 0.3528; // mm per point
export function textWidth(text: string, font: Font, sizePt: number): number {
  let units = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    units += font === 'mono' ? 600 : (c >= 32 && c <= 126 ? HELV[c - 32] : 600) * (font === 'bold' ? 1.06 : 1);
  }
  return (units / 1000) * sizePt * PT;
}
/** Shrinks to fit `maxW` (not below `min`), then cuts with "…". */
function fit(text: string, font: Font, size: number, maxW: number, min: number): { text: string; size: number } {
  let s = size;
  while (s > min && textWidth(text, font, s) > maxW) s -= 0.25;
  let t = text;
  while (t.length > 1 && textWidth(t, font, s) > maxW) t = t.slice(0, -2) + '…';
  return { text: t, size: s };
}
/** A name on up to two lines, as large as fits. */
function fitName(name: string, size: number, maxW: number, min: number): { lines: string[]; size: number } {
  const one = fit(name, 'bold', size, maxW, size * 0.75);
  if (textWidth(one.text, 'bold', one.size) <= maxW && !one.text.endsWith('…')) return { lines: [one.text], size: one.size };
  const words = name.split(/\s+/);
  let best = { lines: [one.text], size: one.size };
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    let s = size;
    while (s > min && Math.max(textWidth(a, 'bold', s), textWidth(b, 'bold', s)) > maxW) s -= 0.25;
    if (s > best.size || best.lines[0].endsWith('…')) best = { lines: [fit(a, 'bold', s, maxW, s).text, fit(b, 'bold', s, maxW, s).text], size: s };
  }
  return best;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** The card's shapes for a W×H mm card at (ox, oy). */
function cardShapes(d: CardData, W: number, H: number, ox = 0, oy = 0): Shape[] {
  const st = ROLE_STYLE[d.role] ?? ROLE_STYLE.employee;
  const s = Math.min(W, H);
  const m = s * 0.07;
  const out: Shape[] = [];
  const rect = (x: number, y: number, w: number, h: number, fill: string) => out.push({ kind: 'rect', x: ox + x, y: oy + y, w, h, fill });
  const text = (x: number, y: number, size: number, t: string, font: Font, color: string, align: 'left' | 'center' | 'right' = 'left') => out.push({ kind: 'text', x: ox + x, y: oy + y, size, text: t, font, color, align });
  const photo = (x: number, y: number, w: number, h: number) => {
    if (d.photo) out.push({ kind: 'photo', x: ox + x, y: oy + y, w, h, src: d.photo });
    else { rect(x, y, w, h, '#E2E8F0'); text(x + w / 2, y + h / 2 + (w * 0.35) / 2 * 0.7, (w * 0.35) / PT, initials(d.name), 'bold', '#475569', 'center'); }
  };
  const qr = (x: number, y: number, size: number) => {
    if (!d.qr) return;
    rect(x, y, size, size, '#FFFFFF');
    const pad = size * 0.04;
    out.push({ kind: 'qr', x: ox + x + pad, y: oy + y + pad, size: size - pad * 2, modules: d.qr.size, cells: d.qr.cells });
  };

  rect(0, 0, W, H, '#FFFFFF');
  const landscape = W > H;
  const headH = s * (landscape ? 0.19 : 0.17);
  rect(0, 0, W, headH, st.band);
  rect(0, headH, W, s * 0.025, st.accent);
  const headSize = (headH * 0.34) / PT;
  const footH = s * 0.13;
  rect(0, H - footH, W, footH, '#F1F5F9');
  // Validity and issue date on one line, or two when one line would be too small to read.
  const footSize = (footH * 0.32) / PT;
  const one = fit(`${d.validity}  ·  ${d.issued}`, 'regular', footSize, W - m * 2, 3.5);
  if (one.size >= Math.min(4.8, footSize) && !one.text.endsWith('…')) {
    text(W / 2, H - footH / 2 + (one.size * PT) * 0.35, one.size, one.text, 'regular', '#334155', 'center');
  } else {
    const a = fit(d.validity, 'regular', footSize * 0.85, W - m * 2, 3.5), b = fit(d.issued, 'regular', a.size, W - m * 2, 3.5);
    text(W / 2, H - footH / 2 - a.size * PT * 0.15, a.size, a.text, 'regular', '#334155', 'center');
    text(W / 2, H - footH / 2 + a.size * PT * 1.0, b.size, b.text, 'regular', '#64748B', 'center');
  }

  if (landscape) {
    text(m, headH * 0.64, headSize, 'EDC · IIM JAMMU', 'bold', '#FFFFFF');
    const role = fit(st.label, 'bold', headSize * 0.9, W * 0.5, 4);
    text(W - m, headH * 0.64, role.size, role.text, 'bold', st.accent === '#D4A017' ? '#D4A017' : '#FFFFFF', 'right');
    const top = headH + s * 0.025 + m * 0.7, bottom = H - footH - m * 0.6, bodyH = bottom - top;
    const pw = bodyH * 0.74;
    photo(m, top, pw, bodyH);
    const qs = d.qr ? Math.min(bodyH * 0.92, W * 0.27) : 0;
    if (d.qr) qr(W - m - qs, top + (bodyH - qs) / 2, qs);
    const tx = m + pw + m * 0.6, tw = W - tx - (d.qr ? qs + m * 1.1 : m);
    const name = fitName(d.name, (s * 0.19) / 0.93, tw, 6);
    let y = top + name.size * PT * 0.95;
    for (const line of name.lines) { text(tx, y, name.size, line, 'bold', '#0F172A'); y += name.size * PT * 1.12; }
    if (d.subtitle) { const sub = fit(d.subtitle, 'regular', (s * 0.11) / 1, tw, 4.5); text(tx, y + sub.size * PT * 0.25, sub.size, sub.text, 'regular', '#475569'); y += sub.size * PT * 1.35; }
    if (d.code) { const c = fit(d.code, 'mono', s * 0.2, tw, 6); text(tx, bottom - c.size * PT * 0.15, c.size, c.text, 'mono', st.band); }
  } else {
    const head = fit('EDC · IIM JAMMU', 'bold', headSize, W - m * 2, 5);
    text(W / 2, headH * 0.5 + head.size * PT * 0.12, head.size, head.text, 'bold', '#FFFFFF', 'center');
    const role = fit(st.label, 'bold', headSize * 0.7, W - m * 2, 4);
    text(W / 2, headH * 0.86, role.size, role.text, 'bold', st.accent, 'center');
    const top = headH + s * 0.025 + m * 0.8, bottom = H - footH - m * 0.5, avail = bottom - top;
    // Stack: photo, name, subtitle, QR, code — scaled down together if it doesn't fit.
    const nameSize = (s * 0.15) / 0.93, subSize = s * 0.1, codeSize = s * 0.17;
    let pw = W * 0.4, qs = d.qr ? W * 0.42 : 0;
    const fixed = nameSize * PT * 2.4 + (d.subtitle ? subSize * PT * 1.4 : 0) + codeSize * PT * 1.3 + m;
    const scale = Math.min(1, (avail - fixed) / (pw * 1.2 + qs));
    pw *= scale; qs *= scale;
    let y = top;
    photo((W - pw) / 2, y, pw, pw * 1.2); y += pw * 1.2 + m * 0.4;
    const name = fitName(d.name, nameSize, W - m * 2, 6);
    for (const line of name.lines) { y += name.size * PT * 1.05; text(W / 2, y, name.size, line, 'bold', '#0F172A', 'center'); }
    if (d.subtitle) { const sub = fit(d.subtitle, 'regular', subSize, W - m * 2, 4.5); y += sub.size * PT * 1.35; text(W / 2, y, sub.size, sub.text, 'regular', '#475569', 'center'); }
    y += m * 0.5;
    if (d.qr) { qr((W - qs) / 2, y, qs); y += qs; }
    if (d.code) { const c = fit(d.code, 'mono', codeSize, W - m * 2, 6); y += c.size * PT * 1.15; text(W / 2, y, c.size, c.text, 'mono', st.band, 'center'); }
  }
  return out;
}

/** The full page for a size: the card itself, or (A4) a CR80 card with cut marks and a note. */
export function passLayout(d: CardData, sizeId: CardSizeId): { w: number; h: number; shapes: Shape[] } {
  const size = cardSize(sizeId);
  if (size.id !== 'a4') return { w: size.w, h: size.h, shapes: cardShapes(d, size.w, size.h) };
  const cw = 85.6, ch = 54, x = (size.w - cw) / 2, y = 25;
  const shapes: Shape[] = [{ kind: 'rect', x: 0, y: 0, w: size.w, h: size.h, fill: '#FFFFFF' }, ...cardShapes(d, cw, ch, x, y)];
  const mark = (x1: number, y1: number, x2: number, y2: number) => shapes.push({ kind: 'line', x1, y1, x2, y2, color: '#64748B', width: 0.2 });
  for (const [cx, cy] of [[x, y], [x + cw, y], [x, y + ch], [x + cw, y + ch]] as const) {
    const dx = cx === x ? -1 : 1, dy = cy === y ? -1 : 1;
    mark(cx + dx * 2, cy, cx + dx * 8, cy);
    mark(cx, cy + dy * 2, cx, cy + dy * 8);
  }
  shapes.push({ kind: 'text', x: size.w / 2, y: y + ch + 16, size: 9, text: 'Cut along the marks — 85.6 × 54 mm (CR80). Laminate or slip into a card holder.', font: 'regular', color: '#475569', align: 'center' });
  return { w: size.w, h: size.h, shapes };
}
