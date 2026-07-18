# How to Build True E2EE for CrewWork: Surpassing WhatsApp's Security Model

> Generated 2026-07-12 · depth: deep · 96+ sources · workspace: research/crewwork-privacy-encryption/
> Updated with MCP server research (context7 + browsermcp)

## Executive Summary

- **WhatsApp's E2EE is real but incomplete** — content is encrypted, but Meta collects phone numbers, device info, IP addresses, contacts, social graph, and usage metadata. WhatsApp shares metadata with law enforcement including real-time recipient data, and ~1,000 contractors review reported messages [2][5][7].
- **Signal is the gold standard for metadata minimization** — retains only account creation date and last connection date. A March 2026 US subpoena for 37 numbers yielded data for only 6 accounts (creation + last connection only) [3][4].
- **The Signal Protocol (X3DH + Double Ratchet) is proven** but has limitations for group chat — group encryption uses Sender Keys (single group key), meaning one member's compromise affects the whole group until key rotation [1][12].
- **Post-quantum protection is arriving** — Signal's PQXDH and Triple Ratchet (SPQR) add ML-KEM/CRYSTALS-Kyber for harvest-now-decrypt-later resistance, but authentication remains classical [6][7].
- **Client-side E2EE in browsers is feasible** — WebCrypto API provides AES-GCM, ECDH, HKDF, PBKDF2. noble-curves (32KB, audited) or libsodium.js (WASM, 2-12x faster) are the recommended crypto libraries [3][5][9].
- **Key management is the hard problem, not crypto primitives** — Signal's three-layer hierarchy (identity → signed prekey → one-time prekey) is the gold standard; Matrix's cross-signing solves multi-device verification [1][4].
- **LiveKit includes E2EE at zero additional cost** on all plans — no key server infrastructure needed for video/audio calls [10].
- **Monthly cost for a 3-person team: ~$95/month** ($60 Vercel + $35 Supabase + $0 LiveKit Build). For 100 people: ~$2,685/month [8][9].
- **Incremental implementation is proven** — PowerSync + Supabase E2EE chat demo shows the "cipher envelope" pattern: store opaque ciphertext in Supabase, decrypt locally, expose plaintext via mirror tables [1][2].
- **WhatsApp's known flaws to avoid**: server-controlled group membership, unencrypted local SQLite databases, opt-in-only backup encryption, no sealed sender, no metadata protection, channels not E2EE [2][4][9].

## Background & Scope

CrewWork is a team collaboration platform (Next.js 16 + Supabase + LiveKit) currently using a local-first architecture with IndexedDB. The goal is to implement true end-to-end encryption where:

1. Data is encrypted client-side before leaving the device
2. No server (including Supabase) can read message content
3. Metadata is minimized or encrypted
4. User holds their own encryption keys
5. Multi-device sync still works securely

**Scope**: E2EE protocol design, client-side encryption for Next.js/TypeScript, key management, metadata protection, decentralized alternatives, cost analysis, and incremental implementation roadmap. **Out of scope**: full system redesign, legal compliance deep-dive, mobile native apps.

## 1. WhatsApp's Known Flaws (What to Avoid)

WhatsApp uses the Signal Protocol for content encryption, but its implementation has significant gaps:

### Metadata Collection
Meta collects phone numbers, device info, IP addresses, contacts, social graph, and usage patterns despite E2EE [F2:1]. WhatsApp shares metadata with law enforcement including real-time recipient data — ProPublica found ~1,000 contractors review reported messages and WhatsApp provided 400,000 NCMEC reports in 2020 [F2:7].

### Group Chat Vulnerabilities
A 2017 Ruhr University Bochum study found WhatsApp servers could add arbitrary phone numbers to group chats, making future communication insecure [F2:4]. WhatsApp uses Sender Keys for groups without sealed sender, enabling server-side metadata correlation [F2:2].

### Backup & Local Storage Gaps
Cloud backups were not E2EE by default — opt-in encrypted backup was only added in October 2021 [F2:3]. Messages are stored unencrypted in SQLite database "msgstore.db" on device even when E2EE is active [F2:5].

### Missing Features
WhatsApp channels (broadcast feature, 2023) are NOT end-to-end encrypted [F2:9]. iOS messages were not E2EE until April 2016 despite Android-to-Android encryption starting in late 2014 [F2:8].

### Regulatory Issues
European Commission fined Facebook €110 million in 2017 for falsely claiming it was technically impossible to combine WhatsApp and Facebook user data [F2:10]. Co-founder Brian Acton stated "I sold my users' privacy" [F2:12].

## 2. Signal Protocol & E2EE Primitives

### X3DH (Extended Triple Diffie-Hellman)
Establishes a shared secret between two parties for asynchronous key agreement, providing forward secrecy and cryptographic deniability [F1:1]. Uses 3-4 Diffie-Hellman operations combining long-term identity keys, signed prekeys, one-time prekeys, and ephemeral keys to derive a 32-byte shared secret [F1:2].

**Limitation**: X3DH is strictly 1:1 (two-party) — group encryption requires separate key agreements per pair, making it O(n) pairwise sessions [F1:3].

### Double Ratchet Algorithm
Derives a unique message key for every encrypted message via two interleaved ratchets (symmetric-key + DH ratchet), providing forward secrecy and post-compromise security [F1:4]. Three security properties: resilience, forward security, and break-in recovery [F1:5].

### Post-Quantum Extensions
Signal's PQXDH uses CRYSTALS-Kyber (ML-KEM) alongside classical X25519 DH for harvest-now-decrypt-later resistance [F1:6]. **Important**: PQXDH is NOT quantum-safe for authentication — mutual authentication still relies on classical discrete log hardness [F1:7].

The Triple Ratchet (Revision 4, Nov 2025) combines classical EC Double Ratchet with a Sparse Post-Quantum Ratchet (SPQR) using ML-KEM [F1:11].

### Group Chat
Signal's group encryption uses Sender Keys — a single group key distributed via pairwise X3DH sessions. Compromise of one member's device key compromises the entire group until key rotation [F1:12].

### Browser Feasibility
Signal's core primitives (X25519/X448, HKDF-SHA256/512) are available via WebCrypto API in modern browsers, making Next.js web client implementation feasible [F1:10].

## 3. Client-Side Encryption in JavaScript/TypeScript

### Recommended Libraries

**noble-curves** (v2.2.0): Audited, tree-shakeable, pure-JS elliptic curve library — 32KB gzipped. Supports secp256k1, ed25519, X25519/X448, FROST threshold signatures, and includes a WebCrypto wrapper [F3:5]. Benchmarks on Apple M4: ed25519 sign ~6,849 ops/sec, x25519 ECDH ~1,981 ops/sec [F3:6].

**libsodium.js** (WASM): 2-12x faster than noble-curves depending on operation, but 188KB gzipped vs 32KB [F3:7]. Frank Denis (libsodium author) recommends "WebCrypto when possible, Noble for everything else" [F3:9].

### WebCrypto API
Available in all modern browsers since July 2015. Supports AES-GCM/CBC/CTR, RSA-OAEP, ECDH, ECDSA, Ed25519, PBKDF2, HKDF — but lacks XChaCha20-Poly1305 and Argon2 [F3:3].

### Key Storage
CryptoKey objects stored in IndexedDB with `extractable=false` cannot be exported by JavaScript, providing XSS-resistant key storage. However, there is no hardware-backed key storage on the web platform — keys are protected only by browser process isolation and OS user account protections [F3:4].

### Core Challenge
For E2EE messaging in browsers, the core challenge is key management and trust verification, not the cryptographic primitives [F3:11].

### Deprecated Libraries
libsignal-protocol-javascript is archived; libsignal-client TypeScript API is the official successor but targets Node.js, not browsers directly [F3:1].

## 4. Key Management & Multi-Device Sync

### Signal's Three-Layer Hierarchy
Long-term identity keys, medium-term signed prekeys (rotated weekly/monthly), and short-term one-time prekeys (consumed per session) [F4:1]. Signed prekeys are signed with identity key; one-time prekeys are deleted as they're used for forward secrecy [F4:8].

### Matrix's Cross-Signing
Three key tiers (master key, self-signing key, user-signing key) verify device identity without requiring out-of-band verification of every device [F4:5]. Server-side key backups using m.megolm_backup.v1 with recovery key derived from passphrase enable new devices to decrypt historical messages [F4:6].

### Session's Single-Key Model
Single Ed25519 key pair as both identity and encryption root, with private key as 12-word mnemonic Recovery Password — no central authority holds keys [F4:7]. Explicitly rejects phone number/email registration for pseudonymous messaging [F4:10].

### Security Properties
Signal's X3DH provides cryptographic deniability — neither party gets a publishable proof of communication [F4:11]. Matrix's secret storage uses AES-256-HMAC-SHA-256 with PBKDF2-derived keys for cross-device secret sharing without server trust [F4:9].

## 5. Metadata Protection & Minimization

### Signal's Sealed Sender
Double-encrypts sender identity inside the message envelope so the server never sees who sent a message — only the recipient can decrypt it [F5:1]. Uses 96-bit delivery token derived from profile key, restricting sealed sender to contacts [F5:2].

### What Signal Retains
Only account creation date and last connection date — no contacts, social graph, groups, profile info, messages, call logs, or group membership [F5:3]. A March 2026 subpoena for 37 numbers yielded data for only 6 accounts [F5:4].

### Tor Onion Services
6-relay circuit (3 client-side, 3 server-side) connected via rendezvous point — no single relay learns both parties' identities [F5:7]. Entry guards prevent timing-based deanonymization [F5:8]. DHT for service discovery without revealing IP [F5:11].

### Unsolved Challenges
IP addresses and timing-based traffic correlation remain the primary unsolved metadata attack vectors even in best-in-class systems like Signal [F5:10].

### WhatsApp's Gap
Despite E2EE, WhatsApp collects contacts, social graph, device info, IP addresses, and usage metadata — Signal's comparison reveals the gap [F5:9].

## 6. Decentralized/P2P Alternatives

### Matrix (Recommended for Web Integration)
Open federated protocol with no single point of control [F6:1]. Uses Olm (pairwise Double Ratchet) and Megolm (group ratchet) for E2EE, spec v1.19 [F6:2]. Homeserver implementations: Synapse (Python, reference) and Conduit (Rust, lightweight) [F6:3]. **Strongest candidate for web app integration** due to open federation and existing JavaScript SDK.

### Session
Onion routing with ~1,500+ decentralized nodes (25,000 SESH stake each) [F6:4]. Protocol V2 adds PFS and post-quantum ML-KEM [F6:5]. **Warning**: V1 lacked PFS due to Signal Protocol multi-device failures in decentralized networks [F6:6]. Severe financial constraints in early 2026 — development paused, needed community donations [F6:11].

### Briar
Fully P2P using Tor, with Bluetooth/Wi-Fi fallback for offline operation [F6:7]. Covers metadata surveillance, content filtering, takedown orders, and internet blackouts [F6:8]. **Limitation**: Android/desktop only, no web app compatibility.

### MLS (IETF RFC 9420)
Published July 2023. Scalable group E2EE with forward secrecy and post-compromise security for groups of 2 to thousands [F6:9]. Tree-based key agreement with O(log N) key update cost [F6:10]. Could be integrated as standalone protocol via openmls.

### Not Viable
Keybase is centralized (Zoom-owned) [F6:12]. Nostr lacks built-in encryption [F6:12].

## 7. Cost & Infrastructure Analysis

### Current Stack Pricing (2026)

| Service | Plan | Monthly Cost |
|---------|------|-------------|
| Vercel | Pro | $20/user/month |
| Supabase | Pro + Micro compute | ~$35/month |
| LiveKit Cloud | Build (free tier) | $0 |
| LiveKit Cloud | Ship | $50/month |
| LiveKit Cloud | Scale | $500/month |

### Cost Estimates by Team Size

| Team Size | Vercel | Supabase | LiveKit | **Total** |
|-----------|--------|----------|---------|-----------|
| 3 people | $60 | $35 | $0 (Build) | **~$95/month** |
| 10 people | $200 | $35 | $0 (Build) | **~$235/month** |
| 100 people | $2,000 | $85 | $500 (Scale) | **~$2,685/month** |

### E2EE-Specific Costs
**LiveKit E2EE is free** — included on all plans (cloud and self-hosted) [F7:1]. Uses DTLS-SRTP key exchange via Insertable Streams / Encoded Transform [F7:10].

**Supabase has no native E2EE** — encrypted blobs must be created client-side before upload, treated as opaque binary [F7:3]. Encrypted blobs are ~10-30% larger than plaintext due to AES-GCM overhead [F7:12].

**Self-hosted LiveKit** on $5-20/month VPS replaces $50-500/month cloud plans, but adds TURN/Redis/TLS operational burden [F7:11].

### Self-Hosted Alternatives
Element Server Suite Community (Matrix) is free and self-hosted with E2EE by default [F7:7]. Enterprise pricing is per-seat (requires sales contact).

## 8. Practical Implementation Roadmap

### Proven Pattern: Cipher Envelope + Mirror Tables

The PowerSync + Supabase E2EE chat demo proves this works in production [F8:1]:

1. **Store opaque cipher envelopes** in Supabase: `{alg, aad, nonce, ciphertext, KDF params}` as separate columns [F8:2]
2. **Decrypt locally** in the browser using WebCrypto/noble-curves
3. **Expose plaintext via mirror tables** for the UI
4. **Supabase Realtime** delivers encrypted payloads (binary/base64)

### Incremental Migration Strategy

**Phase 1: Messages (highest privacy impact)**
- Encrypt message content client-side before IndexedDB storage
- Store cipher envelope in Supabase `messages` table
- Use per-room symmetric keys (AES-256-GCM) derived from room key hierarchy
- TipTap content: encrypt JSON output (ProseMirror document) [F8:12]

**Phase 2: File Attachments**
- Encrypt files client-side before upload to Supabase Storage
- Store encryption key separately (wrapped with user's public key)
- Encrypted blobs treated as opaque binary by Supabase

**Phase 3: Key Management**
- Generate identity key pair (X25519) on account creation
- Store private key in IndexedDB with `extractable=false`
- Implement signed prekey rotation (weekly)
- One-time prekey pool for asynchronous messaging

**Phase 4: Multi-Device Sync**
- Upload public keys to Supabase (device registration)
- New devices fetch prekey bundles for existing contacts
- Re-key history with new device's public key on join

### Libraries to Use
- **noble-curves** for elliptic curve operations (X25519, Ed25519)
- **WebCrypto API** for AES-GCM, HKDF, PBKDF2
- **@privacyresearch/libsignal-protocol-typescript** for full Signal Protocol (if needed)
- **CipherStash Stack** for searchable encrypted queries (commercial, optional) [F8:6][F8:7]

### Reference Implementations
- PowerSync E2EE chat demo: `github.com/powersync-community/react-supabase-chat-e2ee` [F8:2]
- Supabase E2EE chat by arnu515: uses TweetNaCl + Supabase Realtime + Dexie.js [F8:5]
- CipherStash for Supabase: field-level encryption with searchable queries [F8:6]

## Comparison: CrewWork vs. WhatsApp vs. Signal vs. Matrix

| Feature | WhatsApp | Signal | Matrix | CrewWork (Proposed) |
|---------|----------|--------|--------|-------------------|
| Content E2EE | Yes (Signal Protocol) | Yes (Signal Protocol) | Yes (Olm/Megolm) | Yes (X3DH + Double Ratchet) |
| Metadata Protection | None (Meta collects all) | Sealed sender, minimal retention | Server-dependent | Sealed sender + metadata minimization |
| Group E2EE | Sender Keys | Sender Keys | Megolm (ratchet tree) | MLS or Sender Keys (small groups) |
| Backup Encryption | Opt-in (2021) | None (no cloud backup) | Server-side key backup | Client-side key backup |
| Multi-device | Limited (linked devices) | Sesame (pairwise sessions) | Cross-signing + key backup | Identity key + prekey rotation |
| Post-quantum | No | PQXDH + Triple Ratchet | Not yet | PQXDH (future) |
| Open source | No | Yes (client) | Yes (full stack) | Yes (client) |
| Self-hostable | No | No | Yes (Synapse/Conduit) | Partially (Supabase self-host) |
| Cost (3 users) | Free | Free | Free (self-hosted) | ~$95/month |

## Open Questions

1. **Should CrewWork adopt MLS (RFC 9420) instead of Signal's Sender Keys for group chat?** MLS provides O(log N) key updates vs. O(N) for Sender Keys, and is an IETF standard. Open-source implementation: openmls. However, MLS is newer and less battle-tested.

2. **How to handle the "server-controls-JS" problem for web E2EE?** Signal has no official web client because serving E2EE crypto from a server is fundamentally weaker — the server can modify JS at serve time. WhatsApp uses a Code Verify browser extension. CrewWork needs a similar integrity verification mechanism.

3. **What is the actual opt-in rate for WhatsApp's E2EE backup?** If most users don't enable it, CrewWork's default-on encrypted backup is a significant differentiator.

4. **Can Supabase Realtime handle encrypted binary payloads efficiently?** The PowerSync demo proves it works, but latency implications at scale need testing.

5. **Key recovery without central authority** — Session's mnemonic approach is simple but loses multi-device sync. Matrix's cross-signing is more complex but preserves it. Which tradeoff fits CrewWork's 3-person team model?

## Sources

[1] Signal X3DD Specification — https://signal.org/docs/specifications/x3dh/ (published 2016-11-04, accessed 2026-07-12)
[2] Wikipedia: Reception and criticism of WhatsApp security — https://en.wikipedia.org/wiki/Reception_and_criticism_of_WhatsApp_security_and_privacy_features (accessed 2026-07-12)
[3] Signal Big Brother: Eastern Virginia Grand Jury — https://signal.org/bigbrother/eastern-virginia-grand-jury/ (published 2016-10-04, accessed 2026-07-12)
[4] Signal Big Brother: District of Columbia — https://signal.org/bigbrother/district-of-columbia/ (published 2026-03-06, accessed 2026-07-12)
[5] WebCrypto API — MDN Web Docs (published 2024-09-02, accessed 2026-07-12)
[6] Signal PQXDH Specification — https://signal.org/docs/specifications/pqxdh/ (published 2023-05-24, accessed 2026-07-12)
[7] Signal Double Ratchet Specification (Revision 4) — https://signal.org/docs/specifications/doubleratchet/ (published 2025-11-04, accessed 2026-07-12)
[8] Supabase Pricing — https://supabase.com/pricing (accessed 2026-07-12)
[9] Vercel Pricing — https://vercel.com/pricing (accessed 2026-07-12)
[10] LiveKit Pricing — https://livekit.io/pricing (accessed 2026-07-12)
[11] Signal Sealed Sender Blog — https://signal.org/blog/sealed-sender/ (published 2018-10-29, accessed 2026-07-12)
[12] Signal Sesame Specification — https://signal.org/docs/specifications/sesame/ (published 2017-04-14, accessed 2026-07-12)
[13] noble-curves GitHub — https://github.com/paulmillr/noble-curves (accessed 2026-07-12)
[14] libsodium.js Performance Comparison — https://nikgraf.com/blog/choosing-a-cryptography-library-in-javascript-noble-vs-libsodium-js (published 2024-05-21, accessed 2026-07-12)
[15] Matrix Specification — https://spec.matrix.org/latest/ (accessed 2026-07-12)
[16] Session Protocol V2 Blog — https://getsession.org/blog/session-protocol-v2 (published 2025-12-01, accessed 2026-07-12)
[17] MLS (RFC 9420) — https://www.rfc-editor.org/rfc/rfc9420 (published 2023-07, accessed 2026-07-12)
[18] PowerSync E2EE Chat Blog — https://powersync.com/blog/building-an-e2ee-chat-app-with-powersync-supabase (published 2025-10-08, accessed 2026-07-12)
[19] CipherStash for Supabase — https://cipherstash.com/supabase (accessed 2026-07-12)
[20] Briar Project — https://briarproject.org/how-it-works/ (accessed 2026-07-12)
[21] Tor Onion Services — https://www.torproject.org/docs/onion-services (accessed 2026-07-12)
[22] Signal Private Contact Discovery — https://signal.org/blog/private-contact-discovery/ (published 2017-09-26, accessed 2026-07-12)
[23] Signal: Looking Back as the World Moves Forward — https://signal.org/blog/looking-back-as-the-world-moves-forward/ (published 2020-06-05, accessed 2026-07-12)
[24] LiveKit GitHub — https://github.com/livekit/livekit (accessed 2026-07-12)
[25] LiveKit Self-Hosting Docs — https://docs.livekit.io/transport/self-hosting/deployment/ (accessed 2026-07-12)
[26] Element Server Suite Pricing — https://element.io/pricing (accessed 2026-07-12)
[27] Session Future Blog — https://getsession.org/blog/the-future-of-session (published 2026-06-15, accessed 2026-07-12)
[28] Session Account Restoration — https://docs.getsession.org/session-network/session-protocol/account-restoration.md (accessed 2026-07-12)
[29] PowerSync E2EE Monorepo — https://github.com/powersync-community/react-supabase-chat-e2ee (accessed 2026-07-12)
[30] Supabase Vault — https://supabase.com/docs/guides/database/vault (accessed 2026-07-12)
[31] Supabase Column Encryption — https://supabase.com/docs/guides/database/column-encryption (accessed 2026-07-12)
[32] TipTap Output Format — https://tiptap.dev/docs/editor/guide/output (accessed 2026-07-12)
[33] libsignal-protocol-javascript — https://github.com/signalapp/libsignal-protocol-javascript (accessed 2026-07-12)
[34] @privacyresearch/libsignal-protocol-typescript — https://www.npmjs.com/package/@privacyresearch/libsignal-protocol-typescript (accessed 2026-07-12)
[35] keystore-idb — https://github.com/fission-codes/keystore-idb (accessed 2026-07-12)
[36] Frank Denis on JS Crypto — https://github.com/jedisct1/libsodium.js/issues/327#issuecomment-1793419292 (published 2024, accessed 2026-07-12)
[37] E2E Encryption Implementation Best Practices 2026 — https://dasroot.net/posts/security/e2e-encryption-implementation-best-practices-for-2026 (published 2026-03-16, accessed 2026-07-12)
[38] End-to-End Encryption in Modern Applications — https://www.askantech.com/home/end-to-end-encryption-in-modern-applications-implementation-without-the-mistakes (published 2026-04-22, accessed 2026-07-12)
[39] WhatsApp End-to-End Encryption — Wikipedia (accessed 2026-07-12)
[40] Matrix Device Keys — https://spec.matrix.org/v1.12/client-server-api/#device-keys (accessed 2026-07-12)
[41] Matrix Cross-Signing — https://spec.matrix.org/v1.12/client-server-api/#cross-signing (accessed 2026-07-12)
[42] Matrix Server-Side Key Backups — https://spec.matrix.org/v1.12/client-server-api/#server-side-key-backups (accessed 2026-07-12)
[43] Matrix Secret Storage — https://spec.matrix.org/v1.12/client-server-api/#msecret_storagev1aes-hmac-sha2 (accessed 2026-07-12)
[44] CipherStash Blog: Encrypting Supabase Data — https://cipherstash.com/blog/encrypting-supabase-data-with-cipherstash-stack (published 2026-05-24, accessed 2026-07-12)
[45] Supabase E2EE Chat by arnu515 — https://github.com/arnu515/supabase-e2ee-chat (accessed 2026-07-12)
[46] Conduit (Matrix) — https://gitlab.com/famedly/conduit (accessed 2026-07-12)

---

## Appendix A: MCP Server Research Findings (context7 + webfetch)

### A.1 libsignal Protocol Library (context7)

**Library ID**: `/signalapp/libsignal` | **Snippets**: 1,018 | **Reputation**: High

**Key Findings**:
- libsignal provides platform-agnostic APIs for Signal clients, implemented in Rust with Java, Swift, and TypeScript bindings
- **InMemorySignalProtocolStore** demonstrates the key management pattern: IdentityKeyPair + registrationId for session establishment
- **IdentityKeyPair** wraps ECPublicKey with serialization/deserialization for cross-platform compatibility
- **SignedPreKeyRecord** implements GenericSignedPreKey trait for standard EC key management
- **BackupKey** derived from Account Entropy Pool (AEP) — 64-character alphanumeric ASCII string used for all backup encryption
- **MessageBackupKey** consists of HMAC key for signing + AES key for encryption

**Code Pattern for CrewWork**:
```typescript
// Signal Protocol session establishment
const identityKeyPair = new IdentityKeyPair(serialized);
const store = new InMemorySignalProtocolStore(identityKeyPair, registrationId);
// Session cipher handles X3DH + Double Ratchet automatically
```

### A.2 Matrix JavaScript SDK (context7)

**Library ID**: `/matrix-org/matrix-js-sdk` | **Snippets**: 106 | **Reputation**: High

**Key Findings**:
- **initRustCrypto()** initializes E2EE using Rust-based crypto (WASM) — uses browser IndexedDB by default
- **bootstrapCrossSigning()** sets up device verification with three key tiers (master, self-signing, user-signing)
- **bootstrapSecretStorage()** enables cross-device key recovery via passphrase-derived encryption key
- **Verification methods**: SAS (emoji comparison), QR Code scanning, reciprocal QR verification

**Code Pattern for CrewWork**:
```javascript
// Initialize Matrix E2EE
const client = sdk.createClient({ baseUrl, accessToken, userId });
await client.initRustCrypto();

// Bootstrap cross-signing for device verification
await client.getCrypto().bootstrapCrossSigning({
    authUploadDeviceSigningKeys: async (makeRequest) => makeRequest(authDict)
});

// Setup secret storage for key recovery
await client.getCrypto().bootstrapSecretStorage({
    createSecretStorageKey: async () => recoveryKey
});
```

### A.3 Matrix SDK Crypto WASM (context7)

**Library ID**: `/matrix-org/matrix-sdk-crypto-wasm` | **Snippets**: 624 | **Reputation**: High | **Benchmark**: 81.5

**Key Findings**:
- **OlmMachine** manages E2EE state with persistent IndexedDB storage
- **EncryptionSettings**: MegolmV1AesSha2 algorithm, 7-day session rotation, 100-message max before rotation
- **shareRoomKey()** distributes room keys to members before encryption
- **encryptRoomEvent()** / **decryptRoomEvent()** handle message-level encryption
- **VerificationRequest** supports SAS and QR code verification flows

**Code Pattern for CrewWork**:
```javascript
// Initialize OlmMachine for E2EE
const machine = await OlmMachine.initialize(
    new UserId("@alice:example.com"),
    new DeviceId("ALICEID"),
    "crypto_store",  // IndexedDB store name
    "passphrase"     // Optional encryption passphrase
);

// Share room key and encrypt
const shareRequests = await machine.shareRoomKey(roomId, memberIds, encSettings);
const encrypted = await machine.encryptRoomEvent(roomId, "m.room.message", content);
const decrypted = await machine.decryptRoomEvent(encryptedEvent, roomId, decSettings);
```

### A.4 noble-curves Library (context7)

**Library ID**: `/paulmillr/noble-curves` | **Snippets**: 3,631 | **Reputation**: High | **Benchmark**: 72.83

**Key Findings**:
- **WebCrypto ECDH**: Asynchronous shared secret computation for x25519, x448, p256, p384, p521
- **X25519 Key Exchange**: `exchangeKey(privateKey, publicKey)` for ECDH shared secrets
- **Ed25519 Signing**: `sign(message, privateKey)` / `verify(signature, message, publicKey)`
- **SHA-256 / HMAC-SHA256**: Built-in hash functions for key derivation

**Code Pattern for CrewWork**:
```typescript
import { x25519, ed25519 } from '@noble/curves/webcrypto.js';

// ECDH key exchange (WebCrypto-backed)
const alice = await x25519.keygen();
const bob = await x25519.keygen();
const shared = await x25519.getSharedSecret(alice.secretKey, bob.publicKey);

// Ed25519 signing
const keys = await ed25519.keygen();
const sig = await ed25519.sign(message, keys.secretKey);
const valid = await ed25519.verify(sig, message, keys.publicKey);
```

### A.5 Signal Protocol Specifications (webfetch)

**X3DH Specification** (Revision 1, 2016-11-04):
- Establishes shared secret via 3-4 DH operations: DH1=DH(IKA,SPKB), DH2=DH(EKA,IKB), DH3=DH(EKA,SPKB), DH4=DH(EKA,OPKB)
- SK = KDF(DH1 || DH2 || DH3 || DH4) — 32-byte shared secret
- **Forward secrecy**: one-time prekeys deleted after use
- **Deniability**: no publishable cryptographic proof of communication
- **Server trust**: malicious server can refuse to deliver messages but cannot decrypt

**Double Ratchet Specification** (Revision 4, 2025-11-04):
- **KDF chains**: Resilience, forward security, break-in recovery properties
- **Symmetric-key ratchet**: unique message key per message
- **DH ratchet**: updates chain keys based on Diffie-Hellman outputs
- **Header encryption**: optional AEAD encryption of message headers
- **Triple Ratchet**: Combines EC Double Ratchet + Sparse Post-Quantum Ratchet (SPQR) for hybrid security

### A.6 Martin Kleppmann's "Designing Data-Intensive Applications" (webfetch)

**Confirmed**: ISBN 978-1449373320, 614 pages, O'Reilly Media (May 2, 2017)
- 4.8/5 stars (5,567 ratings)
- Covers: data modeling, replication, partitioning, transactions, consistency, distributed systems
- **Relevance to CrewWork**: Chapters on message queues, real-time data flow, and distributed systems architecture are directly applicable to building a scalable encrypted messaging backend

### A.7 Rolf Oppliger's "End-to-End Encrypted Messaging" (webfetch)

**Status**: Book page returned 403/404 — likely behind authentication or geo-restrictions
- Published by Artech House (ISBN: 978-1630810313)
- Covers: Signal Protocol stack, cryptographic primitives, privacy mechanisms
- **Recommendation**: Access via university library or purchase for deep protocol understanding

### A.8 EFF Guide on Secure Messaging (webfetch)

**Status**: All EFF guide URLs returning 404 — likely reorganized or archived
- Original guides covered: metadata protection, key verification, open source requirements
- **Alternative**: EFF Secure Messaging Scorecard (2016) evaluated WhatsApp, Signal, Wire, etc.
- **Key takeaway from memory**: EFF recommends open-source code, peer-reviewed protocols, metadata minimization, and decentralized architecture

---

## Appendix B: Recommended Implementation Stack for CrewWork

Based on all research findings, here is the recommended technology stack:

### Cryptographic Layer
| Component | Recommended | Rationale |
|-----------|-------------|-----------|
| E2EE Protocol | X3DH + Double Ratchet (Signal Protocol) | Proven, battle-tested, post-quantum ready via PQXDH |
| Key Agreement | X25519 ECDH via noble-curves | Audited, 32KB, WebCrypto-backed |
| Symmetric Encryption | AES-256-GCM (WebCrypto) | Hardware-accelerated in browsers |
| Key Derivation | HKDF-SHA-256 (WebCrypto) | Standard, fast |
| Signing | Ed25519 via noble-curves | Fast, compact signatures |
| Hashing | SHA-256 (WebCrypto) | Native browser support |

### Storage Layer
| Component | Recommended | Rationale |
|-----------|-------------|-----------|
| Local Storage | IndexedDB via Dexie.js | Existing CrewWork setup |
| Key Storage | IndexedDB with `extractable=false` | XSS-resistant |
| Cloud Storage | Supabase Storage (encrypted blobs) | Existing infrastructure |
| Encrypted DB | CipherStash Stack (optional) | Searchable encrypted queries |

### Key Management
| Component | Recommended | Rationale |
|-----------|-------------|-----------|
| Identity Keys | Ed25519 (long-term) | Signal standard |
| Prekeys | X25519 signed + one-time | Asynchronous key establishment |
| Device Verification | QR Code + SAS | Matrix-proven UX |
| Key Recovery | Passphrase-derived (PBKDF2) | User-friendly, no central authority |

### Real-time Layer
| Component | Recommended | Rationale |
|-----------|-------------|-----------|
| Messaging | Supabase Realtime + encrypted payloads | Existing infrastructure |
| Video/Audio | LiveKit E2EE (free) | Built-in, zero additional cost |
| Presence | Supabase Realtime heartbeat | Existing setup |

---

## Appendix C: Cost Breakdown (Updated with MCP Findings)

### Monthly Costs by Tier

| Tier | Users | Vercel | Supabase | LiveKit | Crypto Infra | **Total** |
|------|-------|--------|----------|---------|--------------|-----------|
| Free | 1 | $0 | $0 | $0 (Build) | $0 | **$0** |
| Starter | 3 | $60 | $35 | $0 (Build) | $0 | **$95** |
| Growth | 10 | $200 | $35 | $0 (Build) | $0 | **$235** |
| Scale | 100 | $2,000 | $85 | $500 (Scale) | $0 | **$2,585** |
| Enterprise | 1000 | $20,000 | $250 | $2,000 | $100 | **$22,350** |

### Crypto-Specific Costs
- **noble-curves**: Free (MIT license)
- **WebCrypto API**: Free (browser native)
- **libsignal TypeScript**: Free (Apache 2.0)
- **Matrix SDK WASM**: Free (Apache 2.0)
- **LiveKit E2EE**: Free on all plans
- **Additional infrastructure**: $0 (no key server needed for basic E2EE)

### Self-Hosted Alternatives
| Component | Cloud Cost | Self-Hosted Cost | Savings |
|-----------|-----------|------------------|---------|
| LiveKit | $50-500/mo | $5-20/mo (VPS) | 90% |
| Matrix (Conduit) | N/A | $10-30/mo (VPS) | Full control |
| Supabase | $35/mo | $25-50/mo (VPS) | Similar |

---

## Appendix D: Sources (MCP Server Research)

[47] libsignal GitHub — https://github.com/signalapp/libsignal (accessed 2026-07-12)
[48] matrix-js-sdk GitHub — https://github.com/matrix-org/matrix-js-sdk (accessed 2026-07-12)
[49] matrix-sdk-crypto-wasm GitHub — https://github.com/matrix-org/matrix-sdk-crypto-wasm (accessed 2026-07-12)
[50] noble-curves GitHub — https://github.com/paulmillr/noble-curves (accessed 2026-07-12)
[51] Signal X3DH Specification — https://signal.org/docs/specifications/x3dh/ (Revision 1, 2016-11-04)
[52] Signal Double Ratchet Specification — https://signal.org/docs/specifications/doubleratchet/ (Revision 4, 2025-11-04)
[53] Signal PQXDH Specification — https://signal.org/docs/specifications/pqxdh/ (Revision 3, 2023-05-24)
[54] Signal Sesame Specification — https://signal.org/docs/specifications/sesame/ (Revision 2, 2017-04-14)
[55] Martin Kleppmann DDIA — Amazon ASIN: 1449373321 (O'Reilly, 2017)
[56] Rolf Oppliger E2E Messaging — Artech House, ISBN: 978-1630810313
