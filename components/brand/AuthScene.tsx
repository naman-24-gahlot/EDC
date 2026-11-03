import { AuthBackdrop } from '@/components/AuthBackdrop';
import { CAMPUS_PHOTOS, CampusHero } from './CampusHero';

// Everything behind the sign-in and registration cards, the same on both pages:
// - wide screens: the curved row of IIM Jammu photos, fixed at mid-screen, curving round the
//   centred card (it stays put while a long form scrolls);
// - phones: no row (it would take half the screen) — the photos instead fade softly one into the
//   next behind the card, with a slow zoom and a white veil so the form stays easy to read
//   (.ambient-slide in app/globals.css; still first photo for reduced motion).
const PHONE_PHOTOS = [0, 1, 2, 5, 3, 8].map((i) => CAMPUS_PHOTOS[i]);

export function AuthScene() {
  return (
    <>
      <AuthBackdrop />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-[5] hidden md:block">
        <CampusHero className="h-full w-full" />
      </div>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-[5] overflow-hidden md:hidden">
        {PHONE_PHOTOS.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- decorative background photos, already sized
          <img key={p.src} src={p.src} alt="" className="ambient-slide absolute inset-0 h-full w-full object-cover" style={{ animationDelay: `${i * 7}s` }} />
        ))}
        <div className="absolute inset-0 bg-gradient-to-b from-white/75 via-white/85 to-[#F5F8FC]/95" />
      </div>
    </>
  );
}
