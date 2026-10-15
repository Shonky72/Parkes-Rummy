import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/', name: 'Parkes Rummy', short_name: 'Parkes Rummy',
    description: 'Your table, your friends, your house rules.',
    lang: 'en-AU', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#062e23', theme_color: '#062c22',
    icons: [
      { src: '/app-icon/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icon/512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    prefer_related_applications: false,
  };
}
