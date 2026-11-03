'use client';

import { useEffect, useState } from 'react';
import { TiltedGridHero, type TiltedGridImage } from '@/components/ui/TiltedGridHero';

// IIM Jammu photos (official site, iimj.ac.in — CEISD / business incubator, entrepreneurship
// programmes, campus life), cropped to 16:9 WebP in public/landing. Decorative: the row is aria-hidden.
export const CAMPUS_PHOTOS: TiltedGridImage[] = [
  { src: '/landing/ceisd-campus.webp', alt: 'IIM Jammu campus' },
  { src: '/landing/incubator-space.webp', alt: 'IIMJ Business Incubator workspace' },
  { src: '/landing/entrepreneurs.webp', alt: 'Entrepreneurship development programme batch' },
  { src: '/landing/convocation.webp', alt: 'IIM Jammu convocation' },
  { src: '/landing/incubator-team.webp', alt: 'IIMJ Business Incubator team' },
  { src: '/landing/sbdu-trainers.webp', alt: 'Small Business Development Units training' },
  { src: '/landing/orientation.webp', alt: 'Orientation programme' },
  { src: '/landing/incubator-board.webp', alt: 'Foundation for Entrepreneurship, Innovation and Skill Development' },
  { src: '/landing/cultural.webp', alt: 'Cultural programme' },
];

// The curved, streaming row of campus photos behind the sign-in and registration pages
// (components/ui/TiltedGridHero.tsx: transform-only, paused as a still for reduced motion).
// Tiles are larger on phones, where the row is a band above the card rather than around it.
export function CampusHero({ className = '', wideTile = 30, narrowTile = 62 }: { className?: string; wideTile?: number; narrowTile?: number }) {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return (
    <TiltedGridHero images={CAMPUS_PHOTOS} className={className} tileHeight={wide ? wideTile : narrowTile}
      axis={50} curve={wide ? 72 : 60} fade={wide ? 10 : 6} speed={4.5} gap={5} />
  );
}
