import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CrewWork — Open-Source Team Messaging Platform',
    short_name: 'CrewWork',
    description:
      'Open-source team messaging with chat, video calls, AI assistant, and end-to-end encryption.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#DC2626',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
