import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth', '/setup', '/workspace'],
      },
    ],
    sitemap: 'https://crewwork-cp8n.onrender.com/sitemap.xml',
  }
}
