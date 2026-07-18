# How to Fix CrewWork's Remaining Security Vulnerabilities

> Generated 2026-07-13 · depth: standard · 5 research angles · 46+ sources

## Executive Summary

CrewWork has 10 remaining security vulnerabilities from the audit. This report provides research-backed fixes for each, based on official documentation from Supabase, Next.js, Signal Protocol, React, and MDN Web Crypto.

**Key findings:**
1. Service role key must NEVER be in client-accessible code — use Vercel env vars or secret manager [1]
2. All API routes need independent auth checks — Proxy (middleware) alone is insufficient [2]
3. Signed prekey verification is MANDATORY in X3DH — without it, "weak forward secrecy" attacks are possible [3]
4. DOMPurify with `USE_PROFILES: { svg: true }` is the minimum safe config for SVG rendering [4]
5. Identity keys should be non-extractable; signed prekeys rotate weekly; one-time prekeys pool of 100+ [5]

---

## V-01: Service Role Key Exposed (CRITICAL)

### Problem
The Supabase `service_role` key is in `.env.local` which could be committed to repo.

### Research Findings
- "Service role key must never be exposed to the browser or clients" — Supabase docs [F1:1]
- "API keys should be stored in encrypted stores, never in code or client bundles" — Supabase Shared Responsibility Model [F1:3]
- "NEXT_PUBLIC_ prefix env var is for the anon key only, never the service_role key" — Supabase Next.js docs [F1:4]

### Fix

**Step 1: Rotate the compromised key immediately**
1. Go to Supabase Dashboard → Settings → API
2. Click "Regulate" next to `service_role`
3. Copy the new key

**Step 2: Store securely in Vercel**
```bash
# In Vercel Dashboard → Settings → Environment Variables
# Add: SUPABASE_SERVICE_ROLE_KEY = <new-key>
# Do NOT prefix with NEXT_PUBLIC_
```

**Step 3: Update .env.local (for local dev only)**
```bash
# .env.local should be in .gitignore
# Never commit this file
SUPABASE_SERVICE_ROLE_KEY=<new-key>
```

**Step 4: Verify .gitignore**
```bash
# .gitignore must include:
.env.local
.env*.local
```

### Verification
```bash
# Check if .env.local is tracked
git ls-files .env.local
# Should return empty (not tracked)
```

---

## V-05: Unauthenticated Invite Endpoint (CRITICAL)

### Problem
`/api/invite/complete` has no auth check — anyone can create accounts or reset passwords.

### Research Findings
- "Route Handlers are public HTTP endpoints by default — always add auth checks" [F2:1]
- "Server Functions bypass Proxy matchers entirely — auth must be verified inside every Server Action independently" [F2:2]
- "IDOR is the #1 authorization bug: check resource ownership against authenticated user" [F2:3]

### Fix

```typescript
// src/app/api/invite/complete/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  // 1. Extract auth header
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // 2. Verify the caller is authenticated
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  // 3. Verify caller is admin of the target workspace
  const { email, password, displayName, workspaceId } = await request.json()

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', user.id)
    .single()

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only admins can complete invites' }, { status: 403 })
  }

  // 4. Now safe to create user/reset password
  // ... existing logic ...
}
```

---

## V-06: Unauthenticated Provisioning Endpoint (HIGH)

### Problem
`/api/provision` is in the public paths list, allowing unauthenticated SQL execution.

### Research Findings
- "Proxy uses the Node.js runtime by default in v16" — use for auth checks [F2:1]
- "Route Handlers are public HTTP endpoints by default" [F2:1]

### Fix

**Step 1: Remove from public paths**
```typescript
// src/middleware.ts (or proxy.ts in Next.js 16)
const publicPaths = ['/auth', '/setup', '/api/setup']
// Remove '/api/provision' from this list
```

**Step 2: Add auth check to provision endpoint**
```typescript
// src/app/api/provision/route.ts
export async function POST(request: NextRequest) {
  // Verify caller is authenticated and is admin
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // ... verify user is admin before executing SQL ...
}
```

---

## V-07: No Prekey Signature Verification (MEDIUM)

### Problem
`performX3DH()` doesn't verify the signed prekey signature, allowing MITM attacks.

### Research Findings
- "Alice MUST verify the prekey signature before proceeding" — X3DH §3.3 [F3:1]
- "Without verification, a malicious server could provide Alice a prekey bundle with forged prekeys" — X3DH §4.5 [F3:2]
- libsignal reference: `process_prekey_bundle()` verifies both signed EC prekey AND kyber prekey signatures [F3:3]

### Fix

```typescript
// src/lib/crypto/exchange.ts — in performX3DH
export async function performX3DH(
  bobBundle: PreKeyBundle
): Promise<KeyExchangeResult> {
  // ... existing code ...

  // VERIFY signed prekey signature (CRITICAL)
  const bobIdentityKey = await crypto.subtle.importKey(
    'raw',
    base64ToBuffer(bobBundle.identityKey),
    { name: 'Ed25519' },
    false,
    ['verify']
  )

  const signatureValid = await crypto.subtle.verify(
    'Ed25519',
    bobIdentityKey,
    base64ToBuffer(bobBundle.preKeySignature),
    base64ToBuffer(bobBundle.signedPreKey)
  )

  if (!signatureValid) {
    throw new Error('Invalid signed prekey signature — possible MITM attack')
  }

  // Only proceed if signature is valid
  // ... rest of X3DH ...
}
```

---

## V-09: No Key Rotation Mechanism (MEDIUM)

### Problem
No automatic key rotation for identity keys or prekeys.

### Research Findings
- "Signed prekeys should rotate weekly to monthly" — X3DH §3.2 [F5:6]
- "Maintain a pool of 100+ one-time prekeys, replenish when < 10 remain" [F5:7][F5:8]
- "Old signed prekey private keys should be retained briefly for delayed messages, then deleted" [F5:9]
- "Identity keys are long-term and rarely rotated — rotation triggers a new trust establishment" [F5:1]

### Fix

```typescript
// src/lib/crypto/rotation.ts (NEW)

const SIGNED_PREKEY_ROTATION_INTERVAL = 7 * 24 * 60 * 60 * 1000 // 7 days
const OLD_PREKEY_RETENTION = 14 * 24 * 60 * 60 * 1000 // 14 days
const MIN_PREKEY_POOL_SIZE = 10
const PREKEY_UPLOAD_BATCH_SIZE = 50

export async function checkAndRotatePrekeys(): Promise<void> {
  const lastRotation = await db.settings.get('last_prekey_rotation')
  const now = Date.now()

  // Check if signed prekey needs rotation
  if (!lastRotation || now - parseInt(lastRotation.value) > SIGNED_PREKEY_ROTATION_INTERVAL) {
    await rotateSignedPrekey()
    await db.settings.put({ key: 'last_prekey_rotation', value: now.toString() })
  }

  // Check if one-time prekey pool is low
  const prekeyCount = await countUnusedPrekeys()
  if (prekeyCount < MIN_PREKEY_POOL_SIZE) {
    await uploadNewPrekeys(PREKEY_UPLOAD_BATCH_SIZE)
  }
}

async function rotateSignedPrekey(): Promise<void> {
  // Generate new signed prekey
  const newSignedPreKey = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )

  // Sign with identity key
  const identityKey = await getIdentityKeyPair()
  const publicKeyBuffer = await crypto.subtle.exportKey('raw', newSignedPreKey.publicKey)
  const signature = await crypto.subtle.sign(
    'Ed25519',
    identityKey.privateKey,
    publicKeyBuffer
  )

  // Upload to server (replaces old signed prekey)
  await uploadPreKeyBundle({
    identityKey: identityKey.publicKeyBase64,
    signedPreKey: bufferToBase64(publicKeyBuffer),
    preKeySignature: bufferToBase64(signature),
  })

  // Schedule deletion of old signed prekey private key
  await db.settings.put({
    key: 'old_signed_prekey_delete_at',
    value: (Date.now() + OLD_PREKEY_RETENTION).toString()
  })
}
```

---

## V-12: Setup Endpoint Env Injection (MEDIUM)

### Problem
`/api/setup` writes arbitrary content to `.env.local` without sanitization.

### Research Findings
- "Validate all client input — never trust data from request bodies" [F2:4]
- "Use Zod for input validation" [F2:4]

### Fix

```typescript
// src/app/api/setup/route.ts
import { z } from 'zod'

const SetupSchema = z.object({
  supabaseUrl: z.string().url().regex(/^https:\/\/[a-z0-9]+\.supabase\.co$/),
  anonKey: z.string().min(20).regex(/^[A-Za-z0-9_-]+$/),
  serviceRoleKey: z.string().min(20).regex(/^[A-Za-z0-9_-]+$/),
})

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Setup not available in production' }, { status: 403 })
  }

  const body = await request.json()
  const validated = SetupSchema.safeParse(body)

  if (!validated.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  // Sanitize: strip any newlines or special characters
  const sanitize = (s: string) => s.replace(/[\n\r]/g, '')

  // Write sanitized values to .env.local
  // ...
}
```

---

## V-13: SVG Injection Risk (MEDIUM)

### Problem
`dangerouslySetInnerHTML` used for SVG rendering without sanitization.

### Research Findings
- "DOMPurify with `USE_PROFILES: { svg: true }` is the minimum safe config" [F4:2]
- "Never sanitize-then-modify — DOMPurify output must be rendered immediately" [F4:2]
- "`require-trusted-types-for 'script'` is the only control that eliminates DOM XSS classes" [F4:5]

### Fix

```typescript
// src/components/chat/key-verification.tsx
import DOMPurify from 'dompurify'

// BEFORE (unsafe):
<div dangerouslySetInnerHTML={{ __html: generateVerificationVisual(safetyNumber) }} />

// AFTER (safe):
const cleanSvg = DOMPurify.sanitize(
  generateVerificationVisual(safetyNumber),
  {
    USE_PROFILES: { svg: true },
    RETURN_TRUSTED_TYPE: true,
  }
)
<div dangerouslySetInnerHTML={{ __html: cleanSvg }} />
```

**Better long-term:** Replace with JSX-based SVG rendering using SVGR.

---

## V-14: Error Details in Console (LOW)

### Problem
`batchDecrypt` logs full error objects to console.

### Research Findings
- "In production, Next.js replaces error messages with hashes" [F2:5]
- "Use a structured logger with redaction" — security best practice

### Fix

```typescript
// src/lib/crypto/encrypt.ts
export async function batchDecrypt(...) {
  for (const msg of messages) {
    try {
      // ... decryption ...
    } catch (error) {
      // BEFORE: console.error(`Failed to decrypt message ${msg.id}:`, error)
      // AFTER:
      console.error(`Decryption failed for message ${msg.id}`)
      // Never log error details in production
    }
  }
}
```

---

## V-15: Shared Signing/Identity Key (LOW)

### Problem
Same Ed25519 key used for signing and identity verification.

### Research Findings
- "Identity keys are long-term and rarely rotated" [F5:1]
- "Matrix uses separate Ed25519 signing key and Curve25519 identity key per device" [F5:31]

### Recommendation
Acceptable for current threat model. Consider separate keys in future version:
- Identity key (Ed25519): Long-term, for X3DH and safety numbers
- Signing key (Ed25519): Separate, for prekey signatures

---

## V-16: Asymmetric Contacts RLS (LOW)

### Problem
Contacts RLS only allows `user_id = auth.uid()`, creating asymmetry.

### Research Findings
- "Use `(select auth.uid())` instead of bare `auth.uid()` in policies" — 95%+ perf improvement [F1:7]
- "Always specify TO roles in policies to prevent unnecessary evaluation" [F1:8]

### Fix

```sql
-- BEFORE:
CREATE POLICY "contacts_select" ON contacts
  FOR SELECT USING (user_id = auth.uid());

-- AFTER (symmetric):
CREATE POLICY "contacts_select" ON contacts
  FOR SELECT USING (
    (user_id = (select auth.uid()))
    OR (contact_id = (select auth.uid()))
  );
```

---

## Implementation Priority

| Priority | Vulnerability | Effort | Impact |
|----------|---------------|--------|--------|
| 1 | V-01: Rotate service role key | 10 min | Critical |
| 2 | V-05: Add auth to invite endpoint | 1 hour | Critical |
| 3 | V-06: Remove provision from public paths | 10 min | High |
| 4 | V-07: Add prekey signature verification | 2 hours | Medium |
| 5 | V-13: Add DOMPurify to SVG rendering | 30 min | Medium |
| 6 | V-12: Validate setup endpoint input | 1 hour | Medium |
| 7 | V-09: Implement key rotation | 4 hours | Medium |
| 8 | V-14: Remove error details from console | 10 min | Low |
| 9 | V-16: Make contacts RLS symmetric | 10 min | Low |
| 10 | V-15: Separate signing/identity keys | Future | Low |

---

## Sources

| # | Source | URL | Date |
|---|--------|-----|------|
| [F1:1] | Supabase RLS Docs | https://supabase.com/docs/guides/auth/row-level-security | Current |
| [F1:3] | Supabase Shared Responsibility | https://supabase.com/docs/guides/platform/shared-responsibility-model | Current |
| [F1:4] | Supabase Next.js Auth | https://supabase.com/docs/guides/auth/server-side/nextjs | Current |
| [F1:7] | Supabase RLS Performance | https://supabase.com/docs/guides/auth/row-level-security | Current |
| [F1:8] | Supabase RLS Roles | https://supabase.com/docs/guides/auth/row-level-security | Current |
| [F2:1] | Next.js Route Handlers | https://nextjs.org/docs/app/api-reference/file-conventions/route | v16.2.10 |
| [F2:2] | Next.js Data Security | https://nextjs.org/docs/app/guides/data-security | v16.2.10 |
| [F2:3] | Next.js Authentication | https://nextjs.org/docs/app/guides/authentication | v16.2.10 |
| [F2:4] | Next.js Proxy | https://nextjs.org/docs/app/api-reference/file-conventions/proxy | v16.2.10 |
| [F3:1] | Signal X3DH Spec | https://signal.org/docs/specifications/x3dh/ | 2016-11-04 |
| [F3:2] | Signal X3DH §4.5 | https://signal.org/docs/specifications/x3dh/ | 2016-11-04 |
| [F3:3] | libsignal session.rs | https://github.com/signalapp/libsignal | 2026 |
| [F4:2] | DOMPurify v3.4.12 | https://github.com/cure53/DOMPurify | 2026-07-11 |
| [F4:5] | Trusted Types | https://web.dev/articles/trusted-types | 2020-03-25 |
| [F5:1] | Signal X3DH Identity Keys | https://signal.org/docs/specifications/x3dh/ | 2016-11-04 |
| [F5:6] | Signal X3DH Key Rotation | https://signal.org/docs/specifications/x3dh/ | 2016-11-04 |
| [F5:7] | Signal X3DH Prekey Management | https://signal.org/docs/specifications/x3dh/ | 2016-11-04 |
| [F5:8] | Signal X3DH Prekey Deletion | https://signal.org/docs/specifications/x3dh/ | 2016-11-04 |
| [F5:9] | Signal X3DH Old Prekey Retention | https://signal.org/docs/specifications/x3dh/ | 2016-11-04 |
| [F5:31] | Matrix Olm/Megolm | https://matrix.org/v1.19/olm-megolm/ | v1.19 |
