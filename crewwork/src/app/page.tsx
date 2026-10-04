import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Check,
  ListChecks,
  Lock,
  MessageSquare,
  MessagesSquare,
  Sparkles,
  Video,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Logo } from '@/components/ui/logo'
import { GITHUB_URL, faqs } from '@/lib/seo/faq'

export const metadata: Metadata = {
  title: 'CrewWork — Open-Source Team Messaging & Video Calls',
  description:
    'CrewWork is a free, MIT-licensed Slack alternative: real-time channels, video calls, E2EE, and an AI assistant. Self-hosted with Next.js and Supabase.',
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
}

type Feature = {
  title: string
  description: string
  icon: LucideIcon
}

const features: Feature[] = [
  {
    title: 'Real-Time Messaging',
    description:
      'Channels, direct messages, and group DMs with instant delivery, typing indicators, mentions, and unread counts powered by Supabase Realtime.',
    icon: MessageSquare,
  },
  {
    title: 'Video & Audio Calls (LiveKit)',
    description:
      'Group video and audio calls over LiveKit WebRTC with screen sharing, incoming call notifications, and controls in channels and DMs.',
    icon: Video,
  },
  {
    title: 'End-to-End Encryption',
    description:
      'Optional E2EE for messages using a Double Ratchet protocol with per-session keys, so only conversation participants can read your content.',
    icon: Lock,
  },
  {
    title: 'AI Assistant',
    description:
      'A built-in AI assistant that answers questions, drafts replies, and helps your team find answers without leaving the conversation.',
    icon: Sparkles,
  },
  {
    title: 'Threads & Reactions',
    description:
      'Keep discussions organised with threaded replies, emoji reactions, bookmarks, and an activity feed that surfaces what matters.',
    icon: MessagesSquare,
  },
  {
    title: 'Todo Boards + Knowledge Management',
    description:
      'Track work with todo boards and capture institutional knowledge in searchable docs your whole team can contribute to.',
    icon: ListChecks,
  },
]

type Screenshot = {
  src: string
  alt: string
  caption: string
  width: number
  height: number
  className: string
}

const screenshots: Screenshot[] = [
  {
    src: '/screenshots/workspace-overview.png',
    alt: 'CrewWork workspace overview showing channels, direct messages, and the activity feed',
    caption: 'Workspace overview — channels, DMs, and activity in one view',
    width: 3018,
    height: 1478,
    className: 'md:col-span-2',
  },
  {
    src: '/screenshots/video-call.png',
    alt: 'CrewWork video call grid view with participants and screen sharing controls',
    caption: 'Video calls with screen sharing, powered by LiveKit WebRTC',
    width: 2884,
    height: 1516,
    className: '',
  },
  {
    src: '/screenshots/channel-members.png',
    alt: 'CrewWork channel members panel listing teammates and roles in a channel',
    caption: 'Manage channel members, roles, and access in a click',
    width: 2016,
    height: 1432,
    className: '',
  },
  {
    src: '/screenshots/incoming-call.png',
    alt: 'CrewWork incoming call notification banner offering accept or decline actions',
    caption: 'Incoming call notifications appear anywhere in the app',
    width: 3018,
    height: 532,
    className: 'md:col-span-2',
  },
]

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="text-lg font-semibold tracking-tight">CrewWork</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-2 sm:gap-5">
            <a
              href="#features"
              className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Features
            </a>
            <a
              href="#faq"
              className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              FAQ
            </a>
            <Button asChild size="sm">
              <Link href="/auth">Open App</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b border-border">
          <div className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 sm:py-28">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              Free &amp; open source under the MIT license
            </p>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Open-Source Team Messaging &amp; Video Calls —{' '}
              <span className="text-primary">Self-Hosted Slack Alternative</span>
            </h1>
            <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              CrewWork is a free, MIT-licensed collaboration platform with real-time chat, channels,
              video and audio calls, end-to-end encryption, and an AI assistant — built with Next.js
              and Supabase so you can self-host your team&apos;s communication in minutes.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/auth">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  View on GitHub
                </a>
              </Button>
            </div>
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {['No seat limits', 'No vendor lock-in', 'Self-hosted setup wizard'].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="features" className="scroll-mt-20 border-b border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Everything your team needs
              </h2>
              <p className="mt-4 text-muted-foreground">
                Messaging, calls, security, and knowledge management in a single self-hosted app —
                no paid tiers required.
              </p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <Card key={feature.title}>
                  <CardHeader>
                    <feature.icon className="mb-2 h-6 w-6 text-primary" aria-hidden="true" />
                    <h3 className="text-lg font-semibold">{feature.title}</h3>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="screenshots" className="scroll-mt-20 border-b border-border bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                See CrewWork in action
              </h2>
              <p className="mt-4 text-muted-foreground">
                A look at the workspace, video calls, channel management, and incoming call
                notifications.
              </p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {screenshots.map((shot) => (
                <figure
                  key={shot.src}
                  className={`overflow-hidden rounded-xl border border-border bg-card shadow-sm ${shot.className}`}
                >
                  <Image
                    src={shot.src}
                    alt={shot.alt}
                    width={shot.width}
                    height={shot.height}
                    sizes="(max-width: 768px) 100vw, 640px"
                    className="h-auto w-full"
                  />
                  <figcaption className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                    {shot.caption}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 border-b border-border">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Frequently Asked Questions
              </h2>
              <p className="mt-4 text-muted-foreground">
                Everything you need to know about CrewWork, licensing, and self-hosting.
              </p>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-2">
              {faqs.map((faq) => (
                <div key={faq.question}>
                  <h3 className="text-base font-semibold">{faq.question}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {faq.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-muted/40">
          <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Start chatting with your team today
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Spin up CrewWork locally or connect your Supabase project with the built-in setup
              wizard. Free forever, MIT-licensed, and yours to self-host.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/auth">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  Star on GitHub
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-background">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Logo className="h-6 w-6" />
            <span className="text-sm font-semibold">CrewWork</span>
            <span className="text-sm text-muted-foreground">— MIT licensed</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <a
              href="#features"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Features
            </a>
            <a href="#faq" className="text-muted-foreground transition-colors hover:text-foreground">
              FAQ
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              GitHub
            </a>
            <Link href="/auth" className="text-muted-foreground transition-colors hover:text-foreground">
              Open App
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">
            Open source software released under the MIT License.
          </p>
        </div>
      </footer>
    </div>
  )
}
