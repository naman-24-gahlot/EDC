import type { MetadataRoute } from 'next';

// Makes the site installable ("Add to home screen"): its own icon, opens full screen without the
// browser bar. Guards land on the scanner and members on their pass after signing in.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'EDC Access — IIM Jammu',
    short_name: 'EDC Access',
    description: 'Entry passes and gate checks for EDC, IIM Jammu.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0D5B7A',
    icons: [
      { src: '/app-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
