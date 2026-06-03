import type { MetadataRoute } from 'next';

export function buyLaneManifest(): MetadataRoute.Manifest {
  return {
    name: 'Predict Studio Buy',
    short_name: 'Predict Buy',
    description: 'Gasless mobile buy lane for Predict Studio structured notes.',
    start_url: '/buy',
    scope: '/',
    display: 'standalone',
    background_color: '#080a0f',
    theme_color: '#3ddc97',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
