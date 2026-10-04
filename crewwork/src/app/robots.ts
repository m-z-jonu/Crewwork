import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo/faq'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth', '/setup', '/workspace'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
