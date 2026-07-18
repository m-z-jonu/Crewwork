# Research Brief: Fixing CrewWork's Remaining Security Vulnerabilities

## Date
2026-07-13

## Research Question
How to properly fix the remaining 10 security vulnerabilities in CrewWork's E2EE implementation, following industry best practices for Next.js + Supabase applications?

## Context
CrewWork is a Next.js 16 + Supabase team messaging app with E2EE implemented. A security audit found 21 vulnerabilities, 6 critical/high were fixed. 10 remain that need research-backed fixes.

## Remaining Vulnerabilities to Research

### CRITICAL (Must fix immediately)
1. **V-01**: Service role key exposed in `.env.local` — How to properly manage Supabase service role keys in production?
2. **V-05**: Unauthenticated `/api/invite/complete` endpoint — Best practices for securing Next.js API routes with Supabase auth?

### HIGH
3. **V-06**: Unauthenticated `/api/provision` endpoint — How to secure provisioning endpoints that need admin access?

### MEDIUM
4. **V-07**: No prekey signature verification in X3DH — How to verify signed prekeys in the Signal Protocol?
5. **V-09**: No key rotation mechanism — Best practices for cryptographic key rotation in messaging apps?
6. **V-12**: Setup endpoint env injection — How to securely handle environment variable setup in Next.js?
7. **V-13**: SVG injection via dangerouslySetInnerHTML — Safe SVG rendering patterns in React?

### LOW
8. **V-14**: Error details in console — Structured logging best practices for security-sensitive apps?
9. **V-15**: Shared signing/identity key — Should signing and identity keys be separate?
10. **V-16**: Asymmetric contacts RLS — Designing symmetric RLS policies for social features?

## Scope
- Next.js 16 App Router patterns
- Supabase RLS and auth best practices
- Signal Protocol implementation details
- React security patterns
- Cryptographic key management

## Depth
Standard (3-5 sub-agents, 15+ sources)

## Angles to Research

1. **Supabase Security Best Practices** — Service role key management, RLS patterns, auth middleware
2. **Next.js API Route Security** — Authentication, authorization, rate limiting patterns
3. **Signal Protocol Key Verification** — Prekey signature verification, key rotation
4. **React Security Patterns** — dangerouslySetInnerHTML alternatives, SVG sanitization
5. **Cryptographic Key Management** — Key rotation, key derivation, secure storage
