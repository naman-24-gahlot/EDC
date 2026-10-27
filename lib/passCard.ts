// CLIENT-SAFE (no server imports). The printable entry pass / ID card: the sizes offered, the
// colour per role, and ONE layout — a list of shapes in millimetres — that both renderers draw:
// components/PassCardSvg.tsx (screen preview and browser printing) and lib/passPdf.ts (the PDF
// download). Same layout, same text fitting, so the PDF and the print can't drift apart.
// The look follows the on-screen entry pass (/me/pass): two-line header, round photo, role pill,
// QR in a framed box, spaced access code, and VALID TILL / DAYS / HOURS columns.

export const CARD_SIZES = [
  { id: 'cr80', label: 'ID card — landscape', note: 'CR80 · 85.6 × 54 mm — PVC card printers, the standard ID / bank-card size', w: 85.6, h: 54 },
  { id: 'cr80p', label: 'ID card — portrait', note: 'CR80 · 54 × 85.6 mm — vertical lanyard badges', w: 54, h: 85.6 },
  { id: 'cr100', label: 'Large ID card', note: 'CR100 · 98.5 × 67 mm — oversized ID cards', w: 98.5, h: 67 },
  { id: 'badge', label: 'Event badge', note: '4 × 3 in · 101.6 × 76.2 mm — lanyard badge pouches', w: 101.6, h: 76.2 },
  { id: 'a6', label: 'Gate pass (A6)', note: 'A6 · 105 × 148 mm — the on-screen entry pass, on paper', w: 105, h: 148 },
  { id: 'a4', label: 'ID card on A4', note: 'A4 page with one CR80 card and cut marks — any office printer', w: 210, h: 297 },
] as const;
export type CardSizeId = (typeof CARD_SIZES)[number]['id'];
export const DEFAULT_CARD_SIZE: CardSizeId = 'cr80';
export const cardSize = (id: string | null | undefined) => CARD_SIZES.find((s) => s.id === id) ?? CARD_SIZES[0];
export const isCardSize = (v: unknown): v is CardSizeId => typeof v === 'string' && CARD_SIZES.some((s) => s.id === v);

/** Role colours: the header band and pill, so a guard can tell roles apart at a glance. */
export const ROLE_STYLE: Record<string, { band: string; accent: string; pill: string; label: string }> = {
  master: { band: '#1F2937', accent: '#DB3B51', pill: '#FDE2E6', label: 'Master' },
  employee: { band: '#004180', accent: '#DB3B51', pill: '#DCEAF1', label: 'Employee' },
  incubee: { band: '#0F766E', accent: '#2DD4BF', pill: '#CCFBF1', label: 'Incubee' },
  event_guest: { band: '#C2410C', accent: '#FB923C', pill: '#FFEDD5', label: 'Event guest' },
  visitor: { band: '#6D28D9', accent: '#A78BFA', pill: '#EDE9FE', label: 'Visitor' },
  vvip: { band: '#111827', accent: '#D4A017', pill: '#FEF3C7', label: 'VVIP visitor' },
  driver: { band: '#475569', accent: '#94A3B8', pill: '#E2E8F0', label: 'Driver' },
  relative: { band: '#9D174D', accent: '#F472B6', pill: '#FCE7F3', label: 'Relative' },
  bodyguard: { band: '#7F1D1D', accent: '#F87171', pill: '#FEE2E2', label: 'Bodyguard' },
};
export const roleKey = (p: { systemRole?: string; profileType?: string | null; vvip?: boolean }) =>
  p.systemRole === 'master' ? 'master' : p.profileType === 'visitor' && p.vvip ? 'vvip' : p.profileType ?? 'employee';

/** Everything printed on a card. Built on the server (lib/passData.ts). */
export interface CardData {
  name: string;
  role: string;            // ROLE_STYLE key
  subtitle: string | null; // "Under Rahul Sharma" / the event / the host
  code: string | null;     // EDC12345
  /** The access period in force, or null (then the card says so and has no QR). */
  access: { till: string; days: string; hours: string } | null;
  photo: string | null;    // data:image/jpeg;base64,…
  qr: { size: number; cells: number[] } | null; // dark module indexes (row * size + col)
  issued: string;          // "Issued 27 Oct 2026"
}

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string; r?: number; stroke?: string; strokeWidth?: number }
  | { kind: 'text'; x: number; y: number; size: number; text: string; font: Font; color: string; align: 'left' | 'center' | 'right'; spacing?: number }
  | { kind: 'photo'; x: number; y: number; w: number; h: number; src: string; r: number }
  | { kind: 'qr'; x: number; y: number; size: number; modules: number; cells: number[] }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash?: boolean };
export type Font = 'regular' | 'bold' | 'mono';

// ——— text measuring (Helvetica / Courier advance widths, 1/1000 em), shared by both renderers ———
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
export const PT = 0.3528; // mm per point
/** Width in mm, including letter spacing (mm, after every character but the last). */
export function textWidth(text: string, font: Font, sizePt: number, spacing = 0): number {
  let units = 0, n = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    units += font === 'mono' ? 600 : (c >= 32 && c <= 126 ? HELV[c - 32] : 600) * (font === 'bold' ? 1.06 : 1);
    n++;
  }
  return (units / 1000) * sizePt * PT + Math.max(0, n - 1) * spacing;
}
/** Shrinks to fit `maxW` (not below `min`), then cuts with "…". */
function fit(text: string, font: Font, size: number, maxW: number, min: number, spacing = 0): { text: string; size: number } {
  let s = size;
  while (s > min && textWidth(text, font, s, spacing) > maxW) s -= 0.25;
  let t = text;
  while (t.length > 1 && textWidth(t, font, s, spacing) > maxW) t = t.slice(0, -2) + '…';
  return { text: t, size: s };
}
/** A name on up to two lines, as large as fits. */
function fitName(name: string, size: number, maxW: number, min: number): { lines: string[]; size: number } {
  const one = fit(name, 'bold', size, maxW, size * 0.8);
  if (!one.text.endsWith('…') && textWidth(one.text, 'bold', one.size) <= maxW) return { lines: [one.text], size: one.size };
  const words = name.split(/\s+/);
  let best = { lines: [fit(name, 'bold', min, maxW, min).text], size: min };
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    let s = size;
    while (s > min && Math.max(textWidth(a, 'bold', s), textWidth(b, 'bold', s)) > maxW) s -= 0.25;
    if (s > best.size || best.lines[0].endsWith('…')) best = { lines: [fit(a, 'bold', s, maxW, s).text, fit(b, 'bold', s, maxW, s).text], size: s };
  }
  return best;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const INK = '#1B2A38', MUTED = '#7C8C9B', BODY = '#F7F9FB', FOOT = '#EEF2F5', LINE = '#D5DDE4';

/** The card's shapes for a W×H mm card at (ox, oy). */
function cardShapes(d: CardData, W: number, H: number, ox = 0, oy = 0): Shape[] {
  const st = ROLE_STYLE[d.role] ?? ROLE_STYLE.employee;
  const s = Math.min(W, H);
  const out: Shape[] = [];
  const P = (pt: number) => pt * PT; // a point size, as mm (for baselines)
  const rect = (x: number, y: number, w: number, h: number, fill: string, extra: Partial<Extract<Shape, { kind: 'rect' }>> = {}) => out.push({ kind: 'rect', x: ox + x, y: oy + y, w, h, fill, ...extra });
  const text = (x: number, y: number, size: number, t: string, font: Font, color: string, align: 'left' | 'center' | 'right' = 'left', spacing = 0) =>
    out.push({ kind: 'text', x: ox + x, y: oy + y, size, text: t, font, color, align, spacing });
  const line = (x1: number, y1: number, x2: number, y2: number, color: string, width: number, dash = false) => out.push({ kind: 'line', x1: ox + x1, y1: oy + y1, x2: ox + x2, y2: oy + y2, color, width, dash });
  /** Round (or rounded) photo with a white ring; initials when there's no photo. */
  const photo = (x: number, y: number, w: number, h: number, r: number) => {
    const ring = Math.max(0.5, w * 0.035);
    rect(x - ring, y - ring, w + ring * 2, h + ring * 2, '#FFFFFF', { r: r + ring, stroke: LINE, strokeWidth: 0.2 });
    if (d.photo) out.push({ kind: 'photo', x: ox + x, y: oy + y, w, h, src: d.photo, r });
    else {
      rect(x, y, w, h, '#DCEAF1', { r });
      const size = (Math.min(w, h) * 0.36) / PT;
      text(x + w / 2, y + h / 2 + P(size) * 0.36, size, initials(d.name), 'bold', '#0D5B7A', 'center');
    }
  };
  /** A pill with the role, centred on cx or starting at x (align). */
  const pill = (x: number, y: number, size: number, align: 'center' | 'left' | 'right') => {
    const label = st.label;
    const pad = P(size) * 0.9, h = P(size) * 1.75, w = textWidth(label, 'bold', size) + pad * 2;
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    rect(left, y, w, h, st.pill, { r: h / 2 });
    text(left + w / 2, y + h / 2 + P(size) * 0.35, size, label, 'bold', st.band, 'center');
    return h;
  };
  /** The QR in a framed white box. */
  const qr = (x: number, y: number, size: number) => {
    if (!d.qr) return;
    rect(x, y, size, size, '#FFFFFF', { r: size * 0.06, stroke: LINE, strokeWidth: 0.25 });
    const pad = size * 0.07;
    out.push({ kind: 'qr', x: ox + x + pad, y: oy + y + pad, size: size - pad * 2, modules: d.qr.size, cells: d.qr.cells });
  };
  /** "ACCESS CODE" over the spaced code, centred on cx (or left-aligned at cx). */
  const code = (cx: number, top: number, maxW: number, size: number, align: 'center' | 'left') => {
    if (!d.code) return 0;
    const label = fit('ACCESS CODE', 'bold', Math.max(4, size * 0.32), maxW, 3.5, size * 0.03);
    text(cx, top + P(label.size), label.size, label.text, 'bold', MUTED, align, size * 0.03);
    const c = fit(d.code, 'mono', size, maxW, 6, size * 0.06);
    const y = top + P(label.size) * 1.5 + P(c.size) * 0.85;
    text(cx, y, c.size, c.text, 'mono', INK, align, c.size * 0.06);
    return y - top + P(c.size) * 0.2;
  };
  /** VALID TILL / DAYS / HOURS (+ ISSUED when there's room) as labelled columns. */
  const columns = (x: number, y: number, w: number, h: number, withIssued: boolean) => {
    rect(x, y, w, h, FOOT);
    line(x, y, x + w, y, LINE, 0.2);
    const inner = w - s * 0.1;
    if (!d.access) {
      const t = fit('No access in force — the gate checks live', 'regular', (h * 0.3) / PT, inner, 3.5);
      text(x + w / 2, y + h / 2 + P(t.size) * 0.35, t.size, t.text, 'regular', MUTED, 'center');
      return;
    }
    const cols: [string, string][] = [['VALID TILL', d.access.till], ['DAYS', d.access.days], ['HOURS', d.access.hours]];
    if (withIssued) cols.push(['ISSUED', d.issued.replace(/^Issued /, '')]);
    const cw = inner / cols.length;
    const labelSize = Math.max(3.5, (h * 0.17) / PT), valueSize = (h * 0.27) / PT;
    cols.forEach(([k, v], i) => {
      const cx = x + s * 0.05 + cw * i;
      const lab = fit(k, 'bold', labelSize, cw - 1, 3, 0.15);
      text(cx, y + h * 0.4, lab.size, lab.text, 'bold', MUTED, 'left', 0.15);
      const val = fit(v, 'bold', valueSize, cw - 1, 3.8);
      text(cx, y + h * 0.4 + P(val.size) * 1.25, val.size, val.text, 'bold', INK);
    });
  };
  /** Two-line header: "EDC ENTRY PASS" / "IIM JAMMU · EDC", with the role's accent line under it. */
  const header = (h: number, align: 'left' | 'center', pad: number) => {
    rect(0, 0, W, h, st.band);
    rect(0, h, W, Math.max(0.6, s * 0.012), st.accent);
    const big = fit('EDC ENTRY PASS', 'bold', (h * 0.3) / PT, W - pad * 2 - (align === 'left' ? W * 0.3 : 0), 5, h * 0.03);
    const small = fit('IIM JAMMU · EDC', 'regular', big.size * 0.62, W - pad * 2, 3.5, h * 0.01);
    const x = align === 'left' ? pad : W / 2;
    text(x, h * 0.48, big.size, big.text, 'bold', '#FFFFFF', align, h * 0.03);
    text(x, h * 0.48 + P(small.size) * 1.45, small.size, small.text, 'regular', '#DCE7F2', align, h * 0.01);
  };

  rect(0, 0, W, H, BODY, { stroke: LINE, strokeWidth: 0.2 });

  if (W > H) {
    // ——— Landscape: photo | name, role, code | QR ———
    const m = s * 0.065;
    const headH = H * 0.2;
    header(headH, 'left', m);
    pill(W - m, headH * 0.28, Math.max(4.5, (headH * 0.24) / PT), 'right');
    const footH = H * 0.2;
    columns(0, H - footH, W, footH, true);
    const top = headH + m * 0.9, bottom = H - footH - m * 0.75, bodyH = bottom - top;
    // Passport-like photo (≈ 4:5), never wider than a quarter of the card; QR as tall as the body.
    const pw = Math.min(bodyH * 0.8, W * 0.24), phH = Math.min(bodyH, pw * 1.25);
    photo(m, top + (bodyH - phH) / 2, pw, phH, pw * 0.12);
    const qs = d.qr ? Math.min(bodyH, W * 0.29) : 0;
    if (d.qr) qr(W - m - qs, top + (bodyH - qs) / 2, qs);
    const tx = m + pw + m * 0.9, tw = W - tx - (d.qr ? qs + m * 1.4 : m * 1.2); // a little slack: screen fonts run wider than the PDF metrics
    const name = fitName(d.name, s * 0.2, tw, 6);
    let y = top + P(name.size) * 0.85;
    for (const l of name.lines) { text(tx, y, name.size, l, 'bold', INK); y += P(name.size) * 1.1; }
    if (d.subtitle) { const sub = fit(d.subtitle, 'regular', s * 0.11, tw, 4.5); text(tx, y + P(sub.size) * 0.15, sub.size, sub.text, 'regular', MUTED); }
    code(tx, bottom - (P(s * 0.2) * 1.55 + P(s * 0.2 * 0.32) * 1.5), tw, s * 0.2, 'left');
  } else {
    // ——— Portrait (ID card / gate pass): stacked and centred, like the on-screen pass ———
    const m = W * 0.08;
    const headH = H * 0.115;
    header(headH, 'left', m);
    const roomy = H >= 120; // A6 gate pass: a closing line, like the screen pass
    const noteH = roomy ? H * 0.05 : 0;
    const colH = H * (roomy ? 0.1 : 0.11);
    const footTop = H - noteH - colH;
    columns(0, footTop, W, colH, false);
    if (roomy) {
      rect(0, H - noteH, W, noteH, FOOT);
      line(m, H - noteH, W - m, H - noteH, LINE, 0.15);
      const n = fit(`Present this pass at the gate  ·  ${d.issued}`, 'regular', (noteH * 0.34) / PT, W - m * 2, 3.5);
      text(W / 2, H - noteH / 2 + P(n.size) * 0.35, n.size, n.text, 'regular', MUTED, 'center');
    }
    const top = headH + m * 0.75, bottom = footTop - m * 0.55, avail = bottom - top;
    const nameSize = W * (roomy ? 0.13 : 0.2), pillSize = Math.max(4.5, W * (roomy ? 0.08 : 0.11)), subSize = W * (roomy ? 0.075 : 0.1), codeSize = W * (roomy ? 0.165 : 0.25);
    // Photo, name, role, subtitle, QR, code — stacked. Two passes: measure the text with no photo
    // or QR, then give the height left to the photo and QR (the QR gets the larger share), and
    // centre the whole stack if there's still room.
    const stack = (ph: number, qs: number, startY: number) => {
      let y = startY;
      if (ph > 0) photo((W - ph) / 2, y, ph, ph, ph / 2);
      y += ph + m * 0.45;
      const name = fitName(d.name, nameSize, W - m * 2, 6);
      for (const l of name.lines) { y += P(name.size) * 1.0; text(W / 2, y, name.size, l, 'bold', INK, 'center'); }
      y += P(pillSize) * 0.5;
      y += pill(W / 2, y, pillSize, 'center');
      if (d.subtitle) { const sub = fit(d.subtitle, 'regular', subSize, W - m * 2, 4.5); y += P(sub.size) * 1.35; text(W / 2, y, sub.size, sub.text, 'regular', MUTED, 'center'); }
      y += m * 0.45;
      if (d.qr && qs > 0) qr((W - qs) / 2, y, qs);
      y += qs + (d.qr ? m * 0.35 : 0);
      return y + code(W / 2, y, W - m * 2, codeSize, 'center');
    };
    const mark = out.length;
    const rem = avail - (stack(0, 0, top) - top);
    out.length = mark; // that pass only measured
    const ph = Math.max(8, Math.min(rem * (d.qr ? (roomy ? 0.34 : 0.38) : 1), W * (roomy ? 0.32 : 0.36)));
    const qs = d.qr ? Math.max(10, Math.min(rem - ph, W * (roomy ? 0.64 : 0.6))) : 0;
    stack(ph, qs, top + Math.max(0, (rem - ph - qs) / 2));
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
