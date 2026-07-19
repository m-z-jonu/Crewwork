import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
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
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CrewWork — Open-Source Team Communication Platform',
    description: 'Free, open-source team messaging with real-time chat, video calls, AI assistant, and end-to-end encryption.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
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
      <body className={`${inter.variable} antialiased`} style={{ fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>{children}</body>
    </html>
  )
}
