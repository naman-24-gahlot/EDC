'use client';

import { useEffect, useRef, useState } from 'react';

// The IIM Jammu logo drawn as ASCII, on a canvas. On arrival the characters flicker and settle
// into the logo (in its own colours), then the real logo fades in over them. While the page stays
// open, every ~10 s a scan line sweeps down and turns a band of the logo back into ASCII for a
// moment. Reduced motion, no JavaScript or a failed image: just the plain logo (the <img> below).
// The loops stop when the tab is hidden or the component unmounts. Writes pixels only, no React state per frame.
const SRC = '/brand/iim-jammu-logo.png';
const RATIO = 452 / 363; // the logo's height / width
const RAMP = ' .:-=+*#%@';
const NOISE = '!<>-_\\/[]{}=+*^?#%@$&01';
const CELL_PX = 4.6; // character width: big enough to read as ASCII
const LOAD_MS = 1100; // characters settling
const FADE_MS = 450; // ASCII → image
const SWEEP_MS = 1400;

type Cell = { x: number; y: number; ch: string; color: string; settle: number };

export function AsciiLogo({ width = 112, className = '' }: { width?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false); // the canvas has taken over from the <img>
  const height = Math.round(width * RATIO);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    let stopped = false;
    let frame = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    const img = new Image();
    img.src = SRC;
    img.onload = () => {
      if (stopped) return;
      // One sample per character cell: shrink the logo onto a tiny canvas and read it back.
      const COLS = Math.max(20, Math.round(width / CELL_PX));
      const cw = width / COLS;
      const chh = cw * 1.3; // characters are taller than wide
      const rows = Math.round(height / chh);
      const sample = document.createElement('canvas');
      sample.width = COLS;
      sample.height = rows;
      const sctx = sample.getContext('2d', { willReadFrequently: true });
      if (!sctx) return;
      sctx.drawImage(img, 0, 0, COLS, rows);
      const px = sctx.getImageData(0, 0, COLS, rows).data;
      const cells: Cell[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = (r * COLS + c) * 4;
          const a = px[i + 3];
          if (a < 40) continue;
          cells.push({
            x: c * cw, y: r * chh + chh * 0.85,
            ch: RAMP[Math.min(RAMP.length - 1, 1 + Math.floor((a / 255) * (RAMP.length - 1)))],
            color: `rgb(${px[i]} ${px[i + 1]} ${px[i + 2]})`,
            // Settles roughly bottom-up, like the bird rising, with some scatter.
            settle: (1 - r / rows) * LOAD_MS * 0.55 + Math.random() * LOAD_MS * 0.45,
          });
        }
      }
      ctx.font = `700 ${Math.round(chh * 1.05)}px ui-monospace, "Geist Mono", SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'alphabetic';
      const noise = () => NOISE[(Math.random() * NOISE.length) | 0];
      const drawCells = (t: number, y0 = -Infinity, y1 = Infinity, alpha = 1) => {
        for (const cell of cells) {
          if (cell.y < y0 || cell.y - chh > y1) continue;
          const settled = t >= cell.settle;
          ctx.globalAlpha = alpha * (settled ? 1 : 0.55);
          ctx.fillStyle = cell.color;
          ctx.fillText(settled ? cell.ch : noise(), cell.x, cell.y);
        }
        ctx.globalAlpha = 1;
      };

      setLive(true);
      const start = performance.now();
      const intro = (now: number) => {
        if (stopped) return;
        const t = now - start;
        ctx.clearRect(0, 0, width, height);
        if (t < LOAD_MS) {
          drawCells(t);
        } else {
          const k = Math.min(1, (t - LOAD_MS) / FADE_MS);
          drawCells(Infinity, -Infinity, Infinity, 1 - k);
          ctx.globalAlpha = k;
          ctx.drawImage(img, 0, 0, width, height);
          ctx.globalAlpha = 1;
          if (k >= 1) return scheduleSweep();
        }
        frame = requestAnimationFrame(intro);
      };
      frame = requestAnimationFrame(intro);

      // The idle scan: a band moves top to bottom; inside it the logo is ASCII (a few cells flicker).
      const sweep = (begin: number) => (now: number) => {
        if (stopped) return;
        const p = Math.min(1, (now - begin) / SWEEP_MS);
        const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // ease-in-out
        const band = height * 0.22;
        const yc = -band + eased * (height + band * 2);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        ctx.clearRect(0, yc - band / 2, width, band);
        for (const cell of cells) {
          if (cell.y < yc - band / 2 + chh * 0.85 || cell.y > yc + band / 2) continue;
          ctx.fillStyle = cell.color;
          ctx.globalAlpha = 0.9;
          ctx.fillText(Math.random() < 0.08 ? noise() : cell.ch, cell.x, cell.y);
        }
        ctx.globalAlpha = 1;
        // A thin bright scan line leads the band.
        ctx.fillStyle = 'rgb(0 126 196 / 0.35)';
        ctx.fillRect(0, yc + band / 2 - 1, width, 1.5);
        if (p < 1) frame = requestAnimationFrame(sweep(begin));
        else { ctx.clearRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height); scheduleSweep(); }
      };
      function scheduleSweep() {
        clearTimeout(idle);
        idle = setTimeout(() => {
          if (stopped) return;
          if (document.hidden) return scheduleSweep(); // nobody's looking: skip this one
          frame = requestAnimationFrame((now) => sweep(now)(now));
        }, 8000 + Math.random() * 4000);
      }
    };

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearTimeout(idle);
    };
  }, [width, height]);

  return (
    <span className={`relative inline-block ${className}`} style={{ width, height }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static brand image; the canvas replaces it */}
      <img src={SRC} alt="IIM Jammu" width={width} height={height} className={`ascii-fallback absolute inset-0 h-full w-full ${live ? 'invisible' : ''}`} />
      <canvas ref={canvas} aria-hidden style={{ width, height }} className={`absolute inset-0 ${live ? '' : 'invisible'}`} />
    </span>
  );
}
