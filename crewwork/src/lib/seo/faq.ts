export interface FaqItem {
  question: string
  answer: string
}

export const SITE_URL = 'https://crewwork-cp8n.onrender.com'
export const GITHUB_URL = 'https://github.com/m-z-jonu/Crewwork'
export const SITE_NAME = 'CrewWork'

export const faqs: FaqItem[] = [
  {
    question: 'What is CrewWork?',
    answer:
      'CrewWork is a free, open-source team messaging platform for real-time chat, channels, direct messages, threaded replies, and file sharing. It also includes video and audio calls, an AI assistant, and end-to-end encryption — a self-hosted alternative to Slack and Microsoft Teams.',
  },
  {
    question: 'Is CrewWork free to use?',
    answer:
      'Yes. CrewWork is 100% free and open-source under the MIT license. There are no seat limits, no paid tiers, and no vendor lock-in. You bring your own Supabase instance and run CrewWork on your own infrastructure at no cost.',
  },
  {
    question: 'Is CrewWork open source and self-hostable?',
    answer:
      'Yes. CrewWork is fully open source on GitHub under the MIT license. Because it uses a Supabase backend, you can self-host the entire stack in minutes with the built-in setup wizard — no proprietary services required.',
  },
  {
    question: 'Does CrewWork have video and audio calls?',
    answer:
      'Yes. CrewWork supports group video and audio calls powered by LiveKit WebRTC, including screen sharing, camera and microphone controls, incoming call notifications, and calls in channels, direct messages, and group DMs.',
  },
  {
    question: 'Is CrewWork end-to-end encrypted?',
    answer:
      'Yes. CrewWork provides end-to-end encryption (E2EE) for messages using a Double Ratchet protocol with per-session key exchange, key verification, and encrypted backups — so only conversation participants can read your messages.',
  },
  {
    question: 'What is CrewWork built with?',
    answer:
      'CrewWork is built with Next.js, React, and TypeScript on the frontend, and Supabase (PostgreSQL, Auth, Realtime, Storage) on the backend. Calls run on LiveKit WebRTC, the rich text editor uses TipTap, and state is managed with Zustand.',
  },
  {
    question: 'How is CrewWork different from Slack?',
    answer:
      'CrewWork is free and open source, while Slack is proprietary and priced per seat. CrewWork can be self-hosted on your own infrastructure, includes end-to-end encryption, ships an AI assistant, and has no message history limits or vendor lock-in.',
  },
  {
    question: 'How do I set up CrewWork?',
    answer:
      'Run npm install and npm run dev, then open the app in your browser. The built-in setup wizard connects your Supabase project and auto-provisions all 23 database tables. You can deploy to Vercel, Render, or any Node.js host in minutes.',
  },
]
