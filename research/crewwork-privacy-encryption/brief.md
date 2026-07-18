# Research Brief: Privacy-First Encryption Architecture for CrewWork

## Date
2026-07-12

## Research Question
How can CrewWork implement true end-to-end encryption (E2EE) and user-owned data architecture that surpasses WhatsApp's security model — making it impossible for any single company, government, or group to access user data — while remaining cost-effective to operate?

## Context
CrewWork is a team collaboration platform (Next.js 16 + Supabase + LiveKit) currently using a local-first architecture with IndexedDB. The app has:
- 9 Supabase tables (profiles, workspaces, channels, messages, etc.)
- Local-first storage via Dexie.js
- Multi-device sync infrastructure (partially built)
- Real-time messaging, video/audio calls, Kanban todos

The current architecture stores encrypted data on Supabase servers — meaning Supabase (or any entity with server access) could theoretically access plaintext data. The goal is to move to a model where:
1. Data is encrypted client-side before leaving the device
2. No server (including Supabase) can read message content
3. Metadata is minimized or encrypted
4. User holds their own encryption keys
5. Multi-device sync still works securely

## Scope Boundaries
**In scope:**
- E2EE protocol design (Signal Protocol, Double Ratchet, X3DH)
- Client-side encryption implementation for Next.js/React
- Key management (device keys, identity keys, key distribution)
- Metadata protection strategies
- Decentralized/P2P alternatives to central servers
- Cost analysis for self-hosted vs. managed infrastructure
- WhatsApp's known encryption flaws and how to fix them
- Open-source reference implementations (Matrix, Session, Signal)

**Out of scope:**
- Full system redesign (we adapt the existing 9-table architecture)
- Legal/regulatory compliance deep-dive (GDPR mentioned only in passing)
- Mobile native apps (focus on web/PWA for now)

## Assumptions
- CrewWork targets small teams (3 people initially)
- Budget-conscious: prefer free/open-source solutions
- Must work with existing Vercel + Supabase hosting model (or explain alternatives)
- Web-first (PWA), mobile later

## Depth Mode
**Deep** — This is a critical architectural decision affecting the entire product. We need comprehensive evidence from multiple angles.

## Angles to Research

1. **Signal Protocol & E2EE Primitives** — How the Signal Protocol works (X3DH, Double Ratchet), what it provides, and its limitations for group chat
2. **WhatsApp's Known Flaws** — Documented vulnerabilities, metadata leaks, backup encryption gaps, and recent criticisms of WhatsApp's E2EE implementation
3. **Client-Side Encryption in JavaScript/TypeScript** — Libraries, patterns, and performance considerations for implementing E2EE in a Next.js web app (libsignal, Signal Protocol libraries, WebCrypto API)
4. **Key Management & Multi-Device Sync** — How to handle encryption keys across devices, key distribution without a central authority, and secure key recovery
5. **Metadata Protection & Minimization** — Strategies for hiding who talks to whom, when, and how often (onion routing, anonymous credentials, metadata encryption)
6. **Decentralized/P2P Alternatives** — Matrix, Session, Briar, and other open-source architectures that avoid single-server dependency
7. **Cost & Infrastructure Analysis** — What it costs to run encrypted messaging: self-hosted vs. managed, Supabase limitations for E2EE, LiveKit integration with E2EE, and monthly cost estimates
8. **Practical Implementation Roadmap** — How to incrementally add E2EE to CrewWork's existing architecture without a full rewrite
