import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_SIZES, ROLE_STYLE, passLayout, roleKey, textWidth, type CardData } from '@/lib/passCard';
import { passPdf } from '@/lib/passPdf';

const card = (over: Partial<CardData> = {}): CardData => ({
  name: 'Aanya Raghunathan-Iyer Venkatasubramanian', role: 'employee', subtitle: 'Under Rahul Sharma', code: 'EDC12345',
  access: { till: '24 Jan 2027', days: 'Mon–Fri', hours: '09:00–17:00' }, photo: null, qr: { size: 25, cells: [0, 1, 2, 30, 624] }, issued: 'Issued 27 Oct 2026', ...over,
});

test('every size lays out inside its page, text never wider than the card', () => {
  for (const s of CARD_SIZES) {
    const { w, h, shapes } = passLayout(card(), s.id);
    assert.equal(w, s.w); assert.equal(h, s.h);
    for (const sh of shapes) {
      if (sh.kind === 'rect' || sh.kind === 'photo') { assert.ok(sh.x >= -0.01 && sh.y >= -0.01 && sh.x + sh.w <= w + 0.01 && sh.y + sh.h <= h + 0.01, `${s.id} ${sh.kind} inside`); }
      if (sh.kind === 'qr') assert.ok(sh.x + sh.size <= w && sh.y + sh.size <= h, `${s.id} qr inside`);
      if (sh.kind === 'text') {
        const tw = textWidth(sh.text, sh.font, sh.size, sh.spacing ?? 0);
        const left = sh.align === 'center' ? sh.x - tw / 2 : sh.align === 'right' ? sh.x - tw : sh.x;
        assert.ok(left >= -0.5 && left + tw <= w + 0.5, `${s.id} "${sh.text}" fits (${left.toFixed(1)}..${(left + tw).toFixed(1)} of ${w})`);
        assert.ok(sh.size >= 3.5, `${s.id} "${sh.text}" readable size`);
      }
    }
  }
});

test('nothing overlaps: photo, QR and every line of text keep apart, on every size', () => {
  for (const s of CARD_SIZES) for (const variant of [card(), card({ subtitle: null, name: 'Om Rao' }), card({ qr: null, access: null })]) {
    const boxes = passLayout(variant, s.id).shapes.flatMap((sh) => {
      if (sh.kind === 'photo') return [{ what: 'photo', x1: sh.x, y1: sh.y, x2: sh.x + sh.w, y2: sh.y + sh.h }];
      if (sh.kind === 'qr') return [{ what: 'qr', x1: sh.x, y1: sh.y, x2: sh.x + sh.size, y2: sh.y + sh.size }];
      if (sh.kind === 'text') {
        const tw = textWidth(sh.text, sh.font, sh.size, sh.spacing ?? 0);
        const x1 = sh.align === 'center' ? sh.x - tw / 2 : sh.align === 'right' ? sh.x - tw : sh.x;
        return [{ what: `"${sh.text}"`, x1, y1: sh.y - sh.size * 0.3528 * 0.72, x2: x1 + tw, y2: sh.y + sh.size * 0.3528 * 0.2 }];
      }
      return [];
    });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x1 < b.x2 - 0.05 && b.x1 < a.x2 - 0.05 && a.y1 < b.y2 - 0.05 && b.y1 < a.y2 - 0.05;
      assert.ok(!overlap, `${s.id}: ${a.what} overlaps ${b.what}`);
    }
  }
});

test('roles get their colours; VVIP and Master stand out; no QR without access', () => {
  assert.equal(roleKey({ systemRole: 'master', profileType: 'employee' }), 'master');
  assert.equal(roleKey({ profileType: 'visitor', vvip: true }), 'vvip');
  assert.equal(roleKey({ profileType: 'driver' }), 'driver');
  for (const k of ['employee', 'incubee', 'event_guest', 'visitor', 'driver', 'relative', 'bodyguard', 'master', 'vvip']) assert.ok(ROLE_STYLE[k]);
  assert.ok(!passLayout(card({ qr: null }), 'cr80').shapes.some((s) => s.kind === 'qr'));
});

test('PDF: valid structure, exact page size, one page', () => {
  const pdf = passPdf([passLayout(card(), 'cr80')]).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
  const start = Number(pdf.match(/startxref\n(\d+)/)![1]);
  assert.equal(pdf.slice(start, start + 4), 'xref');
  const offsets = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((off, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj`, off), `object ${i + 1} at its offset`));
  const [, w, h] = pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
  assert.ok(Math.abs(Number(w) / 72 * 25.4 - 85.6) < 0.05 && Math.abs(Number(h) / 72 * 25.4 - 54) < 0.05);
  assert.equal((pdf.match(/\/Type \/Page /g) ?? []).length, 1);
  // Text the standard fonts can't show becomes "?", never breaks the file.
  assert.ok(passPdf([passLayout(card({ name: 'नमन गहलोत' }), 'cr80')]).toString('latin1').includes('%%EOF'));
});
