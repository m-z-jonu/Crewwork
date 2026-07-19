import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Setup',
  description: 'Set up your CrewWork instance by connecting to Supabase.',
  robots: { index: false, follow: false },
}

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return children
}
