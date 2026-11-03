'use client';

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

// The curved, streaming row of campus photos behind the sign-in and registration cards on wide
// screens (components/brand/AuthScene.tsx; phones get a soft background instead).
// components/ui/TiltedGridHero.tsx: transform-only, paused as a still for reduced motion.
export function CampusHero({ className = '' }: { className?: string }) {
  return <TiltedGridHero images={CAMPUS_PHOTOS} className={className} tileHeight={30} axis={50} curve={72} fade={10} speed={4.5} gap={5} />;
}
