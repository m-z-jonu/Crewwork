import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { StructuredData } from '@/components/seo/structured-data'
import './globals.css'

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://crewwork-cp8n.onrender.com'),
  title: {
    default: 'CrewWork — Open-Source Team Communication Platform',
    template: '%s | CrewWork',
  },
  description: 'CrewWork is a free, open-source team messaging platform with real-time chat, video calls, AI assistant, end-to-end encryption, and knowledge management. Built with Next.js and Supabase.',
  keywords: ['team messaging', 'open source', 'video calls', 'real-time chat', 'E2EE', 'AI assistant', 'Supabase', 'Next.js', 'collaboration'],
  authors: [{ name: 'CrewWork' }],
  openGraph: {
    title: 'CrewWork — Open-Source Team Communication Platform',
    description: 'Free, open-source team messaging with real-time chat, video calls, AI assistant, and end-to-end encryption.',
    url: 'https://crewwork-cp8n.onrender.com',
    siteName: 'CrewWork',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'CrewWork — Open-Source Team Messaging Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CrewWork — Open-Source Team Communication Platform',
    description: 'Free, open-source team messaging with real-time chat, video calls, AI assistant, and end-to-end encryption.',
    images: ['/opengraph-image'],
  },
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`} style={{ fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
        <StructuredData />
        {children}
      </body>
    </html>
  )
}
