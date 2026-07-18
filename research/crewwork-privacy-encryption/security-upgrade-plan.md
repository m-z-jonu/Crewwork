# CrewWork E2EE Security Upgrade Plan

## Executive Summary

CrewWork currently implements basic E2EE with static session keys derived from X3DH. This plan adds three critical security layers:

1. **Double Ratchet Algorithm** — Per-message key derivation with forward secrecy and post-compromise security
2. **Key Verification** — Safety numbers and QR codes for out-of-band identity verification
3. **Metadata Minimization** — Reduce server-side knowledge of who messages whom and when

**Target**: Signal Protocol-grade security in a browser-based team messaging app.

---

## Current State Analysis

### Existing Crypto Architecture (`src/lib/crypto/`)

| File | Purpose | Limitations |
|------|---------|-------------|
| `keys.ts` | Identity keys (Ed25519), pre-keys (ECDH P-256), session keys (AES-256-GCM) | Session keys are static — no ratcheting |
| `exchange.ts` | X3DH key agreement (Alice initiates, Bob responds) | One-time shared secret, no forward secrecy after establishment |
| `encrypt.ts` | AES-256-GCM encrypt/decrypt, CipherEnvelope format | Single key per session, key compromise exposes all messages |
| `channel.ts` | Group channel key storage/retrieval | Static AES key shared across all members |
| `recovery.ts` | PBKDF2-derived recovery key for identity backup | Complete — no changes needed |
| `index.ts` | Public API exports | Will export new modules |

### Key Problem

```
Current flow:
  X3DH → shared secret → HKDF → single session key → encrypt ALL messages

After key compromise:
  Attacker can decrypt ALL past messages (no forward secrecy)
  Attacker can decrypt ALL future messages (no post-compromise security)
```

### Target Flow

```
X3DH → initial shared secret → Double Ratchet state
  → per-message derived keys → each message uses unique key
  → key compromise only exposes messages in transit (not past/future)
```

---

## Task 1: Double Ratchet Algorithm

### 1.1 Architecture Overview

The Double Ratchet combines two ratcheting mechanisms:

```
┌─────────────────────────────────────────────────────────┐
│                   DOUBLE RATCHET                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────┐    ┌─────────────────────┐    │
│  │  DH RATCHET (Step)  │    │  CHAIN RATCHET       │    │
│  │                     │    │  (Symmetric Ratchet) │    │
│  │  New DH key pair    │    │                      │    │
│  │  New root key       │    │  Root Chain Key      │    │
│  │  New chain keys     │    │     ↓                │    │
│  │                     │    │  Sending Chain Key   │    │
│  │  Triggered when:    │    │     ↓                │    │
│  │  - Receiving new    │    │  Message Keys        │    │
│  │    DH public key    │    │                      │    │
│  │  - Sending first    │    │  Triggered on:       │    │
│  │    message (if no   │    │  - Every sent msg    │    │
│  │    ratchet yet)     │    │  - Every recv msg    │    │
│  └─────────────────────┘    └─────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.2 File: `src/lib/crypto/double-ratchet.ts` (NEW)

#### Types

```typescript
// Double Ratchet state for a single conversation
export interface RatchetState {
  // Root chain
  rootKey: CryptoKey                    // RK: 256-bit root key
  
  // Sending chain
  sendingChainKey: CryptoKey | null     // CKs: chain key for sending
  sendingMessageNumber: number          // NS: messages sent in current chain
  
  // Receiving chain
  receivingChainKey: CryptoKey | null   // CKr: chain key for receiving
  receivingMessageNumber: number        // NR: messages received in current chain
  receivingPreviousChainLength: number  // RN: length of previous receiving chain
  
  // DH ratchet
  currentDHKeyPair: CryptoKeyPair | null // Current DH key pair
  remotePublicKey: CryptoKey | null      // Remote party's DH public key
  
  // Metadata
  channelId: string
  partnerId: string
  lastRatchetTimestamp: string
}

// Message key derived from chain
export interface MessageKey {
  key: CryptoKey                        // The AES-256-GCM message key
  messageNumber: number                 // Position in chain
  chainKey: string                      // Base64 of chain key at this point
}

// Ratchet-encrypted message envelope (extends CipherEnvelope)
export interface RatchetEnvelope {
  version: 2                            // New version for ratcheted messages
  algorithm: 'AES-GCM'
  
  // DH ratchet public key (if ratchet step occurred)
  dhPublicKey: string | null            // Base64 of sender's current DH public key
  
  // Previous chain info (for out-of-order messages)
  previousChainLength: number
  
  // Message position in current chain
  messageNumber: number
  
  // Encrypted content
  nonce: string                         // Base64
  ciphertext: string                    // Base64
  
  // Timestamp
  timestamp: string
}

// Ratchet header (sent with message for key derivation)
export interface RatchetHeader {
  dhPublicKey: string | null            // Sender's current DH public key (base64)
  previousChainLength: number
  messageNumber: number
}
```

#### Core Functions

```typescript
import { getIdentityKeyPair, getSessionKey } from './keys'

// ============================================================================
// Key Derivation Functions
// ============================================================================

/**
 * KDF Chain: Derive next chain key and message key from current chain key.
 * 
 * Uses HMAC-SHA256 as per Signal Protocol specification:
 *   CK_next = HMAC-SHA256(CK, 0x01)
 *   MK = HMAC-SHA256(CK, 0x02)
 * 
 * @param chainKey - Current chain key (CryptoKey)
 * @returns [nextChainKey, messageKey]
 */
export async function kdfChain(
  chainKey: CryptoKey
): Promise<{ nextChainKey: CryptoKey; messageKey: Uint8Array }> {
  const ckRaw = await crypto.subtle.exportKey('raw', chainKey)
  
  // Derive next chain key: HMAC-SHA256(CK, 0x01)
  const nextCkBytes = await hmacSha256(ckRaw, new Uint8Array([0x01]))
  const nextChainKey = await crypto.subtle.importKey(
    'raw',
    nextCkBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
  
  // Derive message key: HMAC-SHA256(CK, 0x02)
  const messageKey = await hmacSha256(ckRaw, new Uint8Array([0x02]))
  
  return { nextChainKey, messageKey }
}

/**
 * KDF Root: Derive new root key and chain key from DH output + current root key.
 * 
 * Uses HKDF-SHA256:
 *   [RK_next, CK] = HKDF(DH_output, RK, "CrewWorkRatchet")
 * 
 * @param dhOutput - Raw DH output (ArrayBuffer)
 * @param currentRootKey - Current root key (CryptoKey)
 * @returns [nextRootKey, chainKey]
 */
export async function kdfRoot(
  dhOutput: ArrayBuffer,
  currentRootKey: CryptoKey
): Promise<{ nextRootKey: CryptoKey; chainKey: CryptoKey }> {
  const rootKeyRaw = await crypto.subtle.exportKey('raw', currentRootKey)
  
  // Import DH output as HKDF key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    dhOutput,
    { name: 'HKDF' },
    false,
    ['deriveKey', 'deriveBits']
  )
  
  // Derive 512 bits (256 for RK + 256 for CK)
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: rootKeyRaw,
      info: new TextEncoder().encode('CrewWorkRatchet'),
    },
    keyMaterial,
    512
  )
  
  // Split: first 256 bits = new root key, next 256 bits = chain key
  const derivedBytes = new Uint8Array(derivedBits)
  const nextRootKeyBytes = derivedBytes.slice(0, 32)
  const chainKeyBytes = derivedBytes.slice(32, 64)
  
  const nextRootKey = await crypto.subtle.importKey(
    'raw',
    nextRootKeyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
  
  const chainKey = await crypto.subtle.importKey(
    'raw',
    chainKeyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
  
  return { nextRootKey, chainKey }
}

// ============================================================================
// Ratchet Initialization
// ============================================================================

/**
 * Initialize ratchet state from X3DH shared secret.
 * 
 * Called after X3DH completes to start the double ratchet.
 * 
 * @param sharedSecret - The X3DH shared secret (ArrayBuffer)
 * @param channelId - Conversation/channel ID
 * @param partnerId - Remote party's user ID
 * @param isAlice - true if we initiated the conversation
 */
export async function initializeRatchet(
  sharedSecret: ArrayBuffer,
  channelId: string,
  partnerId: string,
  isAlice: boolean
): Promise<RatchetState> {
  // Import shared secret as root key
  const rootKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
  
  // Generate initial DH key pair (X25519 or P-256)
  const dhKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )
  
  return {
    rootKey,
    sendingChainKey: null,
    sendingMessageNumber: 0,
    receivingChainKey: null,
    receivingMessageNumber: 0,
    receivingPreviousChainLength: 0,
    currentDHKeyPair: dhKeyPair,
    remotePublicKey: null,
    channelId,
    partnerId,
    lastRatchetTimestamp: new Date().toISOString(),
  }
}

// ============================================================================
// Sending Operations
// ============================================================================

/**
 * Perform a DH ratchet step (sending side).
 * 
 * Called when we need to send but haven't received from the remote party yet,
 * or when we receive a new DH public key from them.
 * 
 * @param state - Current ratchet state
 */
export async function ratchetStep(
  state: RatchetState
): Promise<RatchetState> {
  // Generate new DH key pair
  const newKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )
  
  // Perform DH with remote public key if available
  if (state.remotePublicKey) {
    // DH(new_private, remote_public)
    const dhOutput = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: state.remotePublicKey },
      newKeyPair.privateKey,
      256
    )
    
    // KDF Root to get new root key and receiving chain key
    const { nextRootKey, chainKey } = await kdfRoot(dhOutput, state.rootKey)
    
    return {
      ...state,
      rootKey: nextRootKey,
      currentDHKeyPair: newKeyPair,
      sendingChainKey: chainKey,
      sendingMessageNumber: 0,
      lastRatchetTimestamp: new Date().toISOString(),
    }
  }
  
  // No remote key yet — just update DH pair
  return {
    ...state,
    currentDHKeyPair: newKeyPair,
    lastRatchetTimestamp: new Date().toISOString(),
  }
}

/**
 * Encrypt a message using the ratchet.
 * 
 * @param plaintext - Message content
 * @param state - Current ratchet state
 * @returns [encryptedEnvelope, newState]
 */
export async function ratchetEncrypt(
  plaintext: string,
  state: RatchetState
): Promise<{ envelope: RatchetEnvelope; state: RatchetState }> {
  // If no sending chain, perform ratchet step
  if (!state.sendingChainKey) {
    state = await ratchetStep(state)
  }
  
  // Derive message key from sending chain
  const { nextChainKey, messageKey } = await kdfChain(state.sendingChainKey!)
  
  // Encrypt with message key
  const messageKeyCrypto = await crypto.subtle.importKey(
    'raw',
    messageKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
  
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as ArrayBuffer },
    messageKeyCrypto,
    encoded
  )
  
  // Export DH public key if we have one
  let dhPublicKeyBase64: string | null = null
  if (state.currentDHKeyPair) {
    const pubRaw = await crypto.subtle.exportKey('raw', state.currentDHKeyPair.publicKey)
    dhPublicKeyBase64 = bufferToBase64(pubRaw)
  }
  
  const envelope: RatchetEnvelope = {
    version: 2,
    algorithm: 'AES-GCM',
    dhPublicKey: dhPublicKeyBase64,
    previousChainLength: state.receivingPreviousChainLength,
    messageNumber: state.sendingMessageNumber,
    nonce: bufferToBase64(nonce as unknown as ArrayBuffer),
    ciphertext: bufferToBase64(ciphertext),
    timestamp: new Date().toISOString(),
  }
  
  // Update state
  const newState: RatchetState = {
    ...state,
    sendingChainKey: nextChainKey,
    sendingMessageNumber: state.sendingMessageNumber + 1,
    lastRatchetTimestamp: new Date().toISOString(),
  }
  
  return { envelope, state: newState }
}

// ============================================================================
// Receiving Operations
// ============================================================================

/**
 * Decrypt a ratchet-encrypted message.
 * 
 * Handles out-of-order messages by caching skipped message keys.
 * 
 * @param envelope - RatchetEnvelope to decrypt
 * @param state - Current ratchet state
 * @returns [plaintext, newState]
 */
export async function ratchetDecrypt(
  envelope: RatchetEnvelope,
  state: RatchetState
): Promise<{ plaintext: string; state: RatchetState }> {
  // Check if we need a DH ratchet step
  if (envelope.dhPublicKey) {
    const remotePubKey = await crypto.subtle.importKey(
      'raw',
      base64ToBuffer(envelope.dhPublicKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    )
    
    // If new remote public key, perform ratchet step
    if (!state.remotePublicKey || 
        !cryptoKeysEqual(remotePubKey, state.remotePublicKey)) {
      
      // Save previous receiving chain length
      const previousChainLength = state.receivingMessageNumber
      
      // Perform DH ratchet
      if (state.currentDHKeyPair) {
        const dhOutput = await crypto.subtle.deriveBits(
          { name: 'ECDH', public: remotePubKey },
          state.currentDHKeyPair.privateKey,
          256
        )
        
        const { nextRootKey, chainKey } = await kdfRoot(dhOutput, state.rootKey)
        
        state = {
          ...state,
          rootKey: nextRootKey,
          receivingChainKey: chainKey,
          receivingMessageNumber: 0,
          receivingPreviousChainLength: previousChainLength,
          remotePublicKey: remotePubKey,
          lastRatchetTimestamp: new Date().toISOString(),
        }
      }
    }
  }
  
  // Skip chain keys if needed for out-of-order messages
  if (envelope.messageNumber > state.receivingMessageNumber) {
    // Skip forward in receiving chain
    const skipCount = envelope.messageNumber - state.receivingMessageNumber
    if (state.receivingChainKey) {
      let chainKey = state.receivingChainKey
      for (let i = 0; i < skipCount; i++) {
        const { nextChainKey } = await kdfChain(chainKey)
        chainKey = nextChainKey
      }
      state = {
        ...state,
        receivingChainKey: chainKey,
        receivingMessageNumber: envelope.messageNumber,
      }
    }
  }
  
  // Derive message key
  if (!state.receivingChainKey) {
    throw new Error('No receiving chain key — cannot decrypt')
  }
  
  const { nextChainKey, messageKey } = await kdfChain(state.receivingChainKey)
  
  // Decrypt
  const messageKeyCrypto = await crypto.subtle.importKey(
    'raw',
    messageKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )
  
  const nonce = base64ToBuffer(envelope.nonce)
  const ciphertext = base64ToBuffer(envelope.ciphertext)
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(nonce) as unknown as ArrayBuffer },
    messageKeyCrypto,
    ciphertext
  )
  
  const plaintext = new TextDecoder().decode(decrypted)
  
  // Update state
  const newState: RatchetState = {
    ...state,
    receivingChainKey: nextChainKey,
    receivingMessageNumber: state.receivingMessageNumber + 1,
    lastRatchetTimestamp: new Date().toISOString(),
  }
  
  return { plaintext, state: newState }
}

// ============================================================================
// State Persistence
// ============================================================================

/**
 * Save ratchet state to IndexedDB.
 */
export async function saveRatchetState(state: RatchetState): Promise<void> {
  // Export CryptoKeys to JWK for storage
  const exportable = {
    ...state,
    rootKey: await crypto.subtle.exportKey('jwk', state.rootKey),
    sendingChainKey: state.sendingChainKey 
      ? await crypto.subtle.exportKey('jwk', state.sendingChainKey) 
      : null,
    receivingChainKey: state.receivingChainKey
      ? await crypto.subtle.exportKey('jwk', state.receivingChainKey)
      : null,
    currentDHKeyPair: state.currentDHKeyPair
      ? {
          publicKey: await crypto.subtle.exportKey('jwk', state.currentDHKeyPair.publicKey),
          privateKey: await crypto.subtle.exportKey('jwk', state.currentDHKeyPair.privateKey),
        }
      : null,
    remotePublicKey: state.remotePublicKey
      ? await crypto.subtle.exportKey('jwk', state.remotePublicKey)
      : null,
  }
  
  await putKeyInStore(RATCHET_STATE_STORE, `${state.channelId}:${state.partnerId}`, exportable)
}

/**
 * Load ratchet state from IndexedDB.
 */
export async function loadRatchetState(
  channelId: string,
  partnerId: string
): Promise<RatchetState | null> {
  const stored = await getKeyFromStore<any>(RATCHET_STATE_STORE, `${channelId}:${partnerId}`)
  if (!stored) return null
  
  // Import JWK back to CryptoKeys
  return {
    ...stored,
    rootKey: await crypto.subtle.importKey('jwk', stored.rootKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
    sendingChainKey: stored.sendingChainKey
      ? await crypto.subtle.importKey('jwk', stored.sendingChainKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
      : null,
    receivingChainKey: stored.receivingChainKey
      ? await crypto.subtle.importKey('jwk', stored.receivingChainKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
      : null,
    currentDHKeyPair: stored.currentDHKeyPair
      ? {
          publicKey: await crypto.subtle.importKey('jwk', stored.currentDHKeyPair.publicKey, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
          privateKey: await crypto.subtle.importKey('jwk', stored.currentDHKeyPair.privateKey, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']),
        }
      : null,
    remotePublicKey: stored.remotePublicKey
      ? await crypto.subtle.importKey('jwk', stored.remotePublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
      : null,
  }
}

// ============================================================================
// Utility Helpers
// ============================================================================

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

async function hmacSha256(key: ArrayBuffer, data: Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, data)
}

async function cryptoKeysEqual(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const aRaw = await crypto.subtle.exportKey('raw', a)
  const bRaw = await crypto.subtle.exportKey('raw', b)
  const aBytes = new Uint8Array(aRaw)
  const bBytes = new Uint8Array(bRaw)
  if (aBytes.length !== bBytes.length) return false
  for (let i = 0; i < aBytes.length; i++) {
    if (aBytes[i] !== bBytes[i]) return false
  }
  return true
}

const RATCHET_STATE_STORE = 'crewwork-ratchet-states'
```

### 1.3 Integration with Existing Code

#### Modify `src/lib/crypto/encrypt.ts`

```typescript
// Add to encrypt.ts:

import { 
  RatchetState, 
  RatchetEnvelope, 
  ratchetEncrypt, 
  ratchetDecrypt, 
  loadRatchetState, 
  saveRatchetState,
  initializeRatchet 
} from './double-ratchet'

/**
 * Encrypt a message with Double Ratchet (v2).
 * 
 * Falls back to v1 static key encryption for group channels
 * or when ratchet state is not available.
 */
export async function encryptForStorageV2(
  plaintext: string,
  channelId: string,
  recipientId: string
): Promise<string> {
  const isDM = channelId.startsWith('dm-') || channelId.startsWith('gdm-')
  
  if (isDM) {
    // Try ratchet encryption
    const ratchetState = await loadRatchetState(channelId, recipientId)
    if (ratchetState) {
      const { envelope, state } = await ratchetEncrypt(plaintext, ratchetState)
      await saveRatchetState(state)
      return JSON.stringify(envelope)
    }
    
    // Fallback: initialize ratchet from session key
    // This happens on first message after X3DH
    const identityKey = await getIdentityKeyPair()
    if (!identityKey) throw new Error('No identity key')
    
    const sessionKey = await getSessionKey(channelId, identityKey.publicKeyBase64, recipientId)
    if (!sessionKey) throw new Error('No session key — perform X3DH first')
    
    // Export session key as shared secret for ratchet initialization
    const sharedSecret = await crypto.subtle.exportKey('raw', sessionKey)
    const newState = await initializeRatchet(sharedSecret, channelId, recipientId, true)
    
    // Encrypt with new ratchet
    const { envelope, state } = await ratchetEncrypt(plaintext, newState)
    await saveRatchetState(state)
    return JSON.stringify(envelope)
  }
  
  // Group channels: use static channel key (no ratchet)
  return encryptForStorage(plaintext, channelId, recipientId)
}

/**
 * Decrypt a message with Double Ratchet (v2).
 */
export async function decryptFromStorageV2(
  encryptedContent: string,
  channelId: string,
  senderId: string
): Promise<string> {
  let envelope: RatchetEnvelope
  try {
    envelope = JSON.parse(encryptedContent)
  } catch {
    return encryptedContent // Legacy plaintext
  }
  
  // Check if this is a v2 ratcheted message
  if (envelope.version === 2 && envelope.algorithm === 'AES-GCM') {
    const ratchetState = await loadRatchetState(channelId, senderId)
    if (!ratchetState) {
      throw new Error('No ratchet state — cannot decrypt v2 message')
    }
    
    const { plaintext, state } = await ratchetDecrypt(envelope, ratchetState)
    await saveRatchetState(state)
    return plaintext
  }
  
  // Fallback to v1 decryption
  return decryptFromStorage(encryptedContent, channelId, senderId)
}
```

#### Modify `src/lib/crypto/index.ts`

```typescript
// Add to index.ts exports:

// Double Ratchet
export {
  initializeRatchet,
  ratchetEncrypt,
  ratchetDecrypt,
  loadRatchetState,
  saveRatchetState,
  kdfChain,
  kdfRoot,
} from './double-ratchet'

export type { RatchetState, RatchetEnvelope, RatchetHeader, MessageKey } from './double-ratchet'
```

### 1.4 Implementation Steps

1. **Create `double-ratchet.ts`** with types and utility functions
2. **Implement `kdfChain`** — HMAC-SHA256 chain key derivation
3. **Implement `kdfRoot`** — HKDF-SHA256 root key + chain key derivation
4. **Implement `initializeRatchet`** — Set up initial state from X3DH secret
5. **Implement `ratchetStep`** — DH ratchet when sending first message or receiving new DH key
6. **Implement `ratchetEncrypt`** — Derive message key, encrypt, update state
7. **Implement `ratchetDecrypt`** — Handle ratchet step if needed, derive key, decrypt, update state
8. **Implement state persistence** — Save/load CryptoKeys via IndexedDB
9. **Modify `encrypt.ts`** — Add v2 encryption with ratchet fallback
10. **Update `index.ts`** — Export new functions
11. **Update `sync.ts`** — Use v2 encryption for DM messages

### 1.5 Testing Strategy

```typescript
// Test: Ratchet provides forward secrecy
test('compromised key cannot decrypt past messages', async () => {
  const state1 = await initializeRatchet(secret, 'dm-123', 'user-b', true)
  
  // Encrypt message 1
  const { envelope: env1, state: state2 } = await ratchetEncrypt('msg1', state1)
  
  // Encrypt message 2
  const { envelope: env2, state: state3 } = await ratchetEncrypt('msg2', state2)
  
  // Simulate key compromise: attacker has state3
  // They cannot derive state1's message keys (forward secrecy)
  const msg1Key = await getMessageKeyForMessageNumber(state3, 0)
  expect(msg1Key).toBeNull() // Cannot recover
  
  // Test: Decrypt out-of-order messages
  const { plaintext } = await ratchetDecrypt(env2, state1)
  expect(plaintext).toBe('msg2')
})
```

---

## Task 2: Key Verification (QR Code + Safety Numbers)

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│              KEY VERIFICATION FLOW                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  User A                    User B                       │
│     │                         │                         │
│     │  1. Fetch both identity │                         │
│     │     keys from server    │                         │
│     │◄───────────────────────►│                         │
│     │                         │                         │
│  2. Compute safety number:   2. Compute safety number: │
│     SN = SHA256(              SN = SHA256(              │
│       IK_A || IK_B             IK_A || IK_B            │
│     )                         )                         │
│     │                         │                         │
│  3. Display as:            3. Display as:              │
│     - QR code (in-person)     - QR code (in-person)    │
│     - 30-digit number         - 30-digit number        │
│       (remote comparison)       (remote comparison)     │
│     │                         │                         │
│  4. Verify match            4. Verify match            │
│     │                         │                         │
│  5. Mark conversation       5. Mark conversation       │
│     as verified                as verified              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Safety Number Format

Following Signal's safety number format:

```
Safety Number = SHA-256(IK_A || IK_B)

Where:
  IK_A = Alice's Ed25519 identity public key (32 bytes)
  IK_B = Bob's Ed25519 identity public key (32 bytes)

Display format:
  Split into 12 groups of 5 digits each
  Each digit = nibble (0-15) mapped to 0-9, A-F
  Total: 12 groups × 5 digits = 60 hex characters = 32 bytes
  
  Example: 12345 67890 ABCDE FGHIJ KLMNO PQRST UVWXY Z1234 56789 0ABCDE FGHIJ KLMNO
```

### 2.3 File: `src/lib/crypto/verify.ts` (NEW)

```typescript
/**
 * CrewWork E2EE - Key Verification
 * 
 * Implements safety number generation and QR code creation
 * for out-of-band identity verification.
 * 
 * Reference: Signal Protocol key verification
 */

import { getIdentityKeyPair } from './keys'
import { getSupabaseClient } from '@/lib/supabase/client'

// ============================================================================
// Types
// ============================================================================

export interface SafetyNumber {
  // The raw safety number bytes (32 bytes)
  hash: Uint8Array
  
  // Formatted for display: array of 12 groups, each 5 hex chars
  formatted: string[]
  
  // Version (for future format changes)
  version: 1
  
  // Timestamp when generated
  generatedAt: string
}

export interface VerificationResult {
  verified: boolean
  safetyNumber: SafetyNumber
  matchedWith: string // Partner's user ID
  verifiedAt: string
}

// ============================================================================
// Safety Number Generation
// ============================================================================

/**
 * Generate a safety number for a conversation.
 * 
 * The safety number is computed from both parties' identity keys:
 *   SN = SHA-256(IK_me || IK_partner)
 * 
 * Order matters: IK_me || IK_partner ensures consistent computation.
 * 
 * @param partnerUserId - The other party's user ID
 * @returns Safety number for display/QR code
 */
export async function generateSafetyNumber(
  partnerUserId: string
): Promise<SafetyNumber> {
  // Get my identity key
  const myIdentity = await getIdentityKeyPair()
  if (!myIdentity) {
    throw new Error('No identity key found')
  }
  
  // Fetch partner's identity key from server
  const partnerKey = await fetchPartnerIdentityKey(partnerUserId)
  if (!partnerKey) {
    throw new Error(`Could not fetch identity key for user ${partnerUserId}`)
  }
  
  // Decode both keys from base64
  const myKeyBytes = base64ToUint8Array(myIdentity.publicKeyBase64)
  const partnerKeyBytes = base64ToUint8Array(partnerKey)
  
  // Concatenate: IK_me || IK_partner
  const concatenated = new Uint8Array(64)
  concatenated.set(myKeyBytes, 0)
  concatenated.set(partnerKeyBytes, 32)
  
  // SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', concatenated)
  const hashBytes = new Uint8Array(hashBuffer)
  
  // Format as 12 groups of 5 hex characters
  const hexString = uint8ArrayToHex(hashBytes)
  const formatted: string[] = []
  for (let i = 0; i < 12; i++) {
    formatted.push(hexString.slice(i * 5, (i + 1) * 5).toUpperCase())
  }
  
  return {
    hash: hashBytes,
    formatted,
    version: 1,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Compare two safety numbers for equality.
 * 
 * Uses constant-time comparison to prevent timing attacks.
 * 
 * @param a - First safety number
 * @param b - Second safety number
 * @returns true if they match
 */
export function compareSafetyNumbers(a: SafetyNumber, b: SafetyNumber): boolean {
  if (a.hash.length !== b.hash.length) return false
  
  // Constant-time comparison
  let result = 0
  for (let i = 0; i < a.hash.length; i++) {
    result |= a.hash[i] ^ b.hash[i]
  }
  return result === 0
}

// ============================================================================
// QR Code Generation
// ============================================================================

/**
 * Generate QR code data for a safety number.
 * 
 * Returns data suitable for a QR code library (e.g., qrcode.react).
 * The QR code encodes: crewwork-verify://<user_id_a>:<user_id_b>:<safety_number_hex>
 * 
 * @param safetyNumber - The safety number to encode
 * @param myUserId - Current user's ID
 * @param partnerUserId - Partner's user ID
 * @returns QR code data string
 */
export function generateQRCodeData(
  safetyNumber: SafetyNumber,
  myUserId: string,
  partnerUserId: string
): string {
  const hexHash = uint8ArrayToHex(safetyNumber.hash)
  return `crewwork-verify://${myUserId}:${partnerUserId}:${hexHash}`
}

/**
 * Parse QR code data scanned from another user.
 * 
 * @param qrData - Raw QR code string
 * @returns Parsed verification data or null if invalid
 */
export function parseQRCodeData(
  qrData: string
): { myUserId: string; partnerUserId: string; safetyNumberHex: string } | null {
  const match = qrData.match(/^crewwork-verify:\/\/([^:]+):([^:]+):([a-f0-9]{64})$/)
  if (!match) return null
  
  return {
    myUserId: match[1],
    partnerUserId: match[2],
    safetyNumberHex: match[3],
  }
}

// ============================================================================
// Verification State Management
// ============================================================================

/**
 * Mark a conversation as verified.
 * 
 * Stores verification state in IndexedDB.
 * 
 * @param channelId - The conversation/channel ID
 * @param partnerId - Partner's user ID
 * @param safetyNumber - The verified safety number
 */
export async function markConversationVerified(
  channelId: string,
  partnerId: string,
  safetyNumber: SafetyNumber
): Promise<void> {
  const verification: VerificationResult = {
    verified: true,
    safetyNumber,
    matchedWith: partnerId,
    verifiedAt: new Date().toISOString(),
  }
  
  await db.settings.put({
    key: `verified_${channelId}_${partnerId}`,
    value: JSON.stringify(verification),
  })
}

/**
 * Check if a conversation is verified.
 */
export async function isConversationVerified(
  channelId: string,
  partnerId: string
): Promise<boolean> {
  const setting = await db.settings.get(`verified_${channelId}_${partnerId}`)
  if (!setting?.value) return false
  
  const verification: VerificationResult = JSON.parse(setting.value)
  return verification.verified
}

/**
 * Get verification details for a conversation.
 */
export async function getVerificationDetails(
  channelId: string,
  partnerId: string
): Promise<VerificationResult | null> {
  const setting = await db.settings.get(`verified_${channelId}_${partnerId}`)
  if (!setting?.value) return null
  
  return JSON.parse(setting.value)
}

// ============================================================================
// Server Integration
// ============================================================================

/**
 * Fetch a partner's identity key from the server.
 */
async function fetchPartnerIdentityKey(userId: string): Promise<string | null> {
  const supabase = getSupabaseClient()
  if (!supabase) return null
  
  const { data, error } = await supabase
    .from('profiles')
    .select('public_key')
    .eq('id', userId)
    .single()
  
  if (error || !data?.public_key) return null
  return data.public_key
}

// ============================================================================
// Utility Functions
// ============================================================================

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
```

### 2.4 UI Component: `src/components/chat/key-verification.tsx` (NEW)

```tsx
/**
 * CrewWork E2EE - Key Verification UI
 * 
 * Displays safety numbers and QR codes for identity verification.
 */

'use client'

import { useState, useEffect } from 'react'
import { generateSafetyNumber, generateQRCodeData, compareSafetyNumbers } from '@/lib/crypto/verify'
import type { SafetyNumber } from '@/lib/crypto/verify'

interface KeyVerificationProps {
  channelId: string
  partnerId: string
  partnerName: string
  onVerified?: () => void
}

export function KeyVerification({ channelId, partnerId, partnerName, onVerified }: KeyVerificationProps) {
  const [safetyNumber, setSafetyNumber] = useState<SafetyNumber | null>(null)
  const [view, setView] = useState<'qr' | 'number' | 'compare'>('qr')
  const [isVerified, setIsVerified] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    generateSafetyNumber(partnerId)
      .then(setSafetyNumber)
      .finally(() => setLoading(false))
  }, [partnerId])

  if (loading) return <div>Loading verification...</div>
  if (!safetyNumber) return <div>Could not generate safety number</div>

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-semibold">Verify Your Safety Number</h3>
        <p className="text-sm text-muted-foreground">
          Confirm this matches what {partnerName} sees on their device
        </p>
      </div>

      {/* View toggle */}
      <div className="flex justify-center gap-2">
        <button
          onClick={() => setView('qr')}
          className={view === 'qr' ? 'bg-primary text-primary-foreground' : ''}
        >
          QR Code
        </button>
        <button
          onClick={() => setView('number')}
          className={view === 'number' ? 'bg-primary text-primary-foreground' : ''}
        >
          Safety Number
        </button>
      </div>

      {/* QR Code View */}
      {view === 'qr' && safetyNumber && (
        <div className="flex flex-col items-center gap-4">
          <div className="bg-white p-4 rounded-lg">
            {/* QR code would be rendered here using qrcode.react */}
            <div className="w-48 h-48 bg-gray-100 flex items-center justify-center">
              QR Code: {generateQRCodeData(safetyNumber, 'my-id', partnerId).slice(0, 50)}...
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Scan this QR code on {partnerName}'s device
          </p>
        </div>
      )}

      {/* Safety Number View */}
      {view === 'number' && safetyNumber && (
        <div className="flex flex-col items-center gap-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-lg tracking-wider">
            {safetyNumber.formatted.map((group, i) => (
              <span key={i}>
                {group}
                {i < 11 && <span className="mx-1"> </span>}
              </span>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Compare this number with {partnerName}'s device
          </p>
        </div>
      )}

      {/* Verification actions */}
      <div className="flex justify-center gap-2">
        <button
          onClick={() => setIsVerified(true)}
          disabled={isVerified}
        >
          {isVerified ? 'Verified' : 'They Match'}
        </button>
        <button
          onClick={() => {/* Report mismatch */}}
          disabled={isVerified}
          variant="destructive"
        >
          They Don't Match
        </button>
      </div>
    </div>
  )
}
```

### 2.5 Implementation Steps

1. **Create `verify.ts`** with safety number generation
2. **Implement `generateSafetyNumber`** — SHA-256 of concatenated identity keys
3. **Implement `compareSafetyNumbers`** — Constant-time comparison
4. **Implement QR code helpers** — Generate/parse QR data strings
5. **Implement verification state storage** — IndexedDB persistence
6. **Create `key-verification.tsx`** — UI component
7. **Add to channel settings** — Verification button/dialog
8. **Add to user profile panel** — "Verify Identity" option
9. **Update `index.ts`** — Export verification functions

---

## Task 3: Metadata Minimization

### 3.1 Current Metadata Exposure

| Metadata | Current Exposure | Risk |
|----------|------------------|------|
| `sender_id` | Stored in plaintext in Supabase | Server knows who sends what |
| `created_at` | Full ISO timestamp | Timing analysis possible |
| `channel_id` | Stored in plaintext | Server knows conversation structure |
| `parent_id` | Stored in plaintext | Thread structure visible |
| `is_deleted` | Boolean flag | Deletion patterns visible |
| `sender_name` | Stored in plaintext | Identity linkage |
| `sender_avatar` | Stored in plaintext | Identity linkage |

### 3.2 Metadata Minimization Strategies

#### Strategy 1: Anonymous Sender Identifiers (Per-Channel)

```typescript
// Instead of storing user_id in messages, store a per-channel anonymous ID
// Each channel gets a unique mapping: user_id <-> anonymous_id

interface AnonymousMapping {
  channelId: string
  userId: string
  anonymousId: string  // Random UUID, regenerated per channel
  createdAt: string
}

// Server stores: anonymous_id instead of sender_id
// Mapping stored locally in IndexedDB, never sent to server
```

#### Strategy 2: Timestamp Precision Reduction

```typescript
// Round timestamps to nearest hour (or configurable interval)
// Preserves relative ordering, hides exact timing

function minimizeTimestamp(iso: string, precision: 'hour' | 'day' = 'hour'): string {
  const date = new Date(iso)
  
  if (precision === 'hour') {
    date.setMinutes(0, 0, 0)
  } else {
    date.setHours(0, 0, 0, 0)
  }
  
  return date.toISOString()
}
```

#### Strategy 3: Encrypted Metadata Envelope

```typescript
// Encrypt metadata along with message content
// Server sees only encrypted blob + minimal routing info

interface MetadataEnvelope {
  // Encrypted metadata
  metadataCiphertext: string  // Base64
  
  // Minimal routing info (cannot be avoided)
  channelId: string           // Needed for routing
  messageHash: string         // SHA-256 for deduplication
  
  // Everything else encrypted
  // senderId, timestamp, threadId, editStatus, etc.
}
```

#### Strategy 4: Sealed Sender Pattern

```typescript
// Server cannot see who sent the message
// Only the recipient can decrypt the sender info

interface SealedMessage {
  // Server-visible (encrypted)
  encryptedPayload: string    // Contains { senderId, content, metadata }
  
  // Server-visible (for routing)
  recipientId: string         // Who to deliver to
  channelId: string           // Which channel
  
  // NOT visible to server
  // senderId is inside encryptedPayload
}
```

### 3.3 File: `src/lib/crypto/metadata.ts` (NEW)

```typescript
/**
 * CrewWork E2EE - Metadata Minimization
 * 
 * Functions to reduce metadata exposure to the server.
 * Implements anonymous identifiers, timestamp minimization,
 * and encrypted metadata envelopes.
 */

import { db } from '@/lib/local/db'
import { getIdentityKeyPair } from './keys'

// ============================================================================
// Types
// ============================================================================

export interface AnonymousIdentifier {
  channelId: string
  realUserId: string
  anonymousId: string
  createdAt: string
}

export interface MinimizedMetadata {
  anonymousSenderId: string
  minimizedTimestamp: string
  threadId?: string  // Encrypted if present
  editStatus?: 'original' | 'edited' | 'deleted'  // Encrypted
}

export interface MetadataEnvelope {
  version: 1
  // Minimal server-visible fields
  channelId: string
  messageHash: string  // For deduplication
  
  // Encrypted metadata
  metadataCiphertext: string
  metadataNonce: string
  
  // Encrypted content (already encrypted, but wrapped)
  contentCiphertext: string
  contentNonce: string
}

// ============================================================================
// Anonymous Sender Identifiers
// ============================================================================

const ANONYMOUS_ID_STORE = 'crewwork-anonymous-ids'

/**
 * Generate or retrieve an anonymous identifier for a user in a channel.
 * 
 * The server never sees the real user ID — only this random identifier.
 * The mapping is stored locally and never sent to the server.
 */
export async function getAnonymousSenderId(
  channelId: string,
  realUserId: string
): Promise<string> {
  // Check if we already have an anonymous ID for this channel+user
  const existing = await db.settings.get(`anon_${channelId}_${realUserId}`)
  if (existing?.value) {
    return existing.value
  }
  
  // Generate new anonymous ID
  const anonymousId = crypto.randomUUID()
  
  // Store mapping locally (never sent to server)
  await db.settings.put({
    key: `anon_${channelId}_${realUserId}`,
    value: anonymousId,
  })
  
  // Also store reverse mapping for decryption
  await db.settings.put({
    key: `anon_reverse_${channelId}_${anonymousId}`,
    value: realUserId,
  })
  
  return anonymousId
}

/**
 * Resolve an anonymous ID back to a real user ID.
 * 
 * Used locally when displaying messages.
 */
export async function resolveAnonymousSenderId(
  channelId: string,
  anonymousId: string
): Promise<string | null> {
  const setting = await db.settings.get(`anon_reverse_${channelId}:${anonymousId}`)
  return setting?.value || null
}

/**
 * Get all anonymous IDs for a channel (for UI display).
 */
export async function getChannelAnonymousIds(
  channelId: string
): Promise<AnonymousIdentifier[]> {
  const mappings: AnonymousIdentifier[] = []
  
  // Iterate through settings to find anonymous mappings for this channel
  const allSettings = await db.settings.toArray()
  for (const setting of allSettings) {
    if (setting.key.startsWith(`anon_${channelId}_`) && !setting.key.includes('reverse')) {
      const parts = setting.key.split('_')
      const realUserId = parts.slice(2).join('_') // Handle IDs with underscores
      mappings.push({
        channelId,
        realUserId,
        anonymousId: setting.value,
        createdAt: new Date().toISOString(), // Would need to store this separately
      })
    }
  }
  
  return mappings
}

// ============================================================================
// Timestamp Minimization
// ============================================================================

/**
 * Minimize timestamp precision to reduce timing metadata.
 * 
 * Options:
 * - 'hour': Round to nearest hour (default)
 * - 'day': Round to start of day
 * - 'none': Keep full precision (not recommended for E2EE)
 */
export function minimizeTimestamp(
  iso: string,
  precision: 'hour' | 'day' = 'hour'
): string {
  const date = new Date(iso)
  
  if (precision === 'hour') {
    // Round to nearest hour
    const minutes = date.getUTCMinutes()
    if (minutes >= 30) {
      date.setUTCHours(date.getUTCHours() + 1)
    }
    date.setUTCMinutes(0, 0, 0)
  } else {
    // Round to start of day (UTC)
    date.setUTCHours(0, 0, 0, 0)
  }
  
  return date.toISOString()
}

/**
 * Add jitter to timestamp to prevent correlation attacks.
 * 
 * Adds random offset within the precision window.
 */
export function addTimestampJitter(
  iso: string,
  precision: 'hour' | 'day' = 'hour'
): string {
  const date = new Date(iso)
  const jitterMs = precision === 'hour' 
    ? Math.random() * 3600000  // 0-1 hour
    : Math.random() * 86400000  // 0-1 day
  
  date.setTime(date.getTime() + jitterMs)
  return minimizeTimestamp(date.toISOString(), precision)
}

// ============================================================================
// Encrypted Metadata Envelope
// ============================================================================

/**
 * Create a metadata envelope that encrypts sensitive metadata.
 * 
 * Only channelId and messageHash are visible to the server.
 * Everything else (sender, timestamp, thread info) is encrypted.
 */
export async function createMetadataEnvelope(
  channelId: string,
  content: string,
  senderId: string,
  metadata: {
    timestamp: string
    threadId?: string
    editStatus?: 'original' | 'edited' | 'deleted'
  },
  encryptionKey: CryptoKey
): Promise<MetadataEnvelope> {
  // Create metadata object
  const metadataObj = {
    senderId,
    timestamp: minimizeTimestamp(metadata.timestamp),
    threadId: metadata.threadId,
    editStatus: metadata.editStatus || 'original',
  }
  
  // Encrypt metadata
  const metadataJson = JSON.stringify(metadataObj)
  const metadataEncoded = new TextEncoder().encode(metadataJson)
  const metadataNonce = crypto.getRandomValues(new Uint8Array(12))
  
  const metadataCiphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: metadataNonce as unknown as ArrayBuffer },
    encryptionKey,
    metadataEncoded
  )
  
  // Encrypt content (if not already encrypted)
  const contentEncoded = new TextEncoder().encode(content)
  const contentNonce = crypto.getRandomValues(new Uint8Array(12))
  
  const contentCiphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: contentNonce as unknown as ArrayBuffer },
    encryptionKey,
    contentEncoded
  )
  
  // Create message hash for deduplication
  const hashInput = new TextEncoder().encode(channelId + content + metadata.timestamp)
  const hashBuffer = await crypto.subtle.digest('SHA-256', hashInput)
  const messageHash = bufferToBase64(hashBuffer)
  
  return {
    version: 1,
    channelId,
    messageHash,
    metadataCiphertext: bufferToBase64(metadataCiphertext),
    metadataNonce: bufferToBase64(metadataNonce as unknown as ArrayBuffer),
    contentCiphertext: bufferToBase64(contentCiphertext),
    contentNonce: bufferToBase64(contentNonce as unknown as ArrayBuffer),
  }
}

/**
 * Decrypt a metadata envelope to recover content and metadata.
 */
export async function decryptMetadataEnvelope(
  envelope: MetadataEnvelope,
  encryptionKey: CryptoKey
): Promise<{
  content: string
  metadata: {
    senderId: string
    timestamp: string
    threadId?: string
    editStatus: 'original' | 'edited' | 'deleted'
  }
}> {
  // Decrypt metadata
  const metadataNonce = base64ToBuffer(envelope.metadataNonce)
  const metadataCiphertext = base64ToBuffer(envelope.metadataCiphertext)
  
  const metadataDecrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(metadataNonce) as unknown as ArrayBuffer },
    encryptionKey,
    metadataCiphertext
  )
  
  const metadata = JSON.parse(new TextDecoder().decode(metadataDecrypted))
  
  // Decrypt content
  const contentNonce = base64ToBuffer(envelope.contentNonce)
  const contentCiphertext = base64ToBuffer(envelope.contentCiphertext)
  
  const contentDecrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(contentNonce) as unknown as ArrayBuffer },
    encryptionKey,
    contentCiphertext
  )
  
  return {
    content: new TextDecoder().decode(contentDecrypted),
    metadata,
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}
```

### 3.4 Modify `src/lib/local/sync.ts`

```typescript
// Add to sync.ts:

import { 
  getAnonymousSenderId, 
  minimizeTimestamp, 
  createMetadataEnvelope,
  decryptMetadataEnvelope 
} from '@/lib/crypto/metadata'

/**
 * Store a message with minimized metadata.
 * 
 * Uses anonymous sender IDs and reduced timestamp precision.
 */
export async function storeMessageMinimized(msg: {
  id: string
  channel_id: string
  sender_id: string
  content: string
  created_at: string
  is_deleted?: boolean
  parent_id?: string | null
  synced?: boolean
  sender_name: string
  sender_avatar: string | null
}): Promise<void> {
  // Get anonymous sender ID for this channel
  const anonymousSenderId = await getAnonymousSenderId(msg.channel_id, msg.sender_id)
  
  // Minimize timestamp
  const minimizedTimestamp = minimizeTimestamp(msg.created_at)
  
  // Encrypt content (existing behavior)
  const encryptedContent = await encryptContent(msg.content, msg.channel_id, msg.sender_id)
  
  // Store with minimized metadata
  // Note: sender_name and sender_avatar would need separate handling
  // (either encrypt or store locally only)
  await db.messages.put({
    id: msg.id,
    channel_id: msg.channel_id,
    sender_id: anonymousSenderId,  // Anonymous ID instead of real ID
    content: encryptedContent,
    created_at: minimizedTimestamp,  // Reduced precision
    is_deleted: msg.is_deleted ?? false,
    parent_id: msg.parent_id ?? null,
    synced: msg.synced ?? false,
    sender_name: msg.sender_name,  // Would need encryption in production
    sender_avatar: msg.sender_avatar,
  })
}
```

### 3.5 Database Schema Changes (Supabase)

```sql
-- Add anonymous sender support
ALTER TABLE messages 
  ADD COLUMN anonymous_sender_id UUID,
  ADD COLUMN metadata_encrypted TEXT;

-- Index for anonymous sender lookup
CREATE INDEX idx_messages_anonymous_sender 
  ON messages(anonymous_sender_id);

-- Update RLS policies to use anonymous IDs
-- (Policies would need to validate anonymous_sender_id matches the authenticated user's mapping)
```

### 3.6 Implementation Steps

1. **Create `metadata.ts`** with anonymous ID generation
2. **Implement `getAnonymousSenderId`** — Generate/retrieve per-channel anonymous IDs
3. **Implement `resolveAnonymousSenderId`** — Reverse lookup for display
4. **Implement `minimizeTimestamp`** — Round timestamps to hour/day
5. **Implement `createMetadataEnvelope`** — Encrypt metadata with content
6. **Implement `decryptMetadataEnvelope`** — Decrypt to recover metadata
7. **Modify `sync.ts`** — Use anonymous IDs and minimized timestamps
8. **Update database schema** — Add anonymous_sender_id column
9. **Update RLS policies** — Validate anonymous sender mappings
10. **Update `index.ts`** — Export metadata functions

---

## Integration Matrix

### File Changes Summary

| File | Action | Task |
|------|--------|------|
| `src/lib/crypto/double-ratchet.ts` | CREATE | 1 |
| `src/lib/crypto/verify.ts` | CREATE | 2 |
| `src/lib/crypto/metadata.ts` | CREATE | 3 |
| `src/components/chat/key-verification.tsx` | CREATE | 2 |
| `src/lib/crypto/encrypt.ts` | MODIFY | 1 |
| `src/lib/crypto/index.ts` | MODIFY | 1, 2, 3 |
| `src/lib/local/sync.ts` | MODIFY | 1, 3 |
| `src/lib/local/db.ts` | MODIFY | 1, 3 |
| `src/components/chat/channel-settings-dialog.tsx` | MODIFY | 2 |
| `src/components/chat/user-profile-panel.tsx` | MODIFY | 2 |

### Dependency Order

```
Phase 1: Double Ratchet (Task 1)
  └─► No dependencies on other tasks
  
Phase 2: Key Verification (Task 2)
  └─► Depends on Task 1 (uses identity keys from keys.ts)
  
Phase 3: Metadata Minimization (Task 3)
  └─► Can run in parallel with Task 2
  └─► Uses encryption from Task 1
```

### Testing Checklist

- [ ] Double Ratchet forward secrecy test
- [ ] Double Ratchet post-compromise security test
- [ ] Out-of-order message decryption test
- [ ] Safety number generation test
- [ ] Safety number comparison test
- [ ] QR code generation/parsing test
- [ ] Anonymous sender ID generation test
- [ ] Timestamp minimization test
- [ ] Metadata envelope encryption/decryption test
- [ ] Integration test: full message flow with all three features

---

## Security Considerations

### 1. Key Storage

- Private keys stored in IndexedDB (browser-only)
- Never sent to server
- Encrypted with device passphrase for at-rest protection

### 2. Ratchet State Persistence

- Ratchet state must persist across sessions
- State saved to IndexedDB after each message
- Loss of state = loss of ability to decrypt future messages
- Consider: periodic state backup to encrypted storage

### 3. Group Channels

- Double Ratchet is per-pair (1:1 only)
- Group channels use static channel keys (current behavior)
- Future: Sender Keys protocol for group ratcheting

### 4. Key Rotation

- Identity keys should rotate periodically
- Pre-keys should be refreshed when depleted
- Ratchet handles per-message rotation automatically

### 5. Metadata Resistance

- Anonymous IDs prevent sender correlation
- Timestamp minimization prevents timing attacks
- Encrypted metadata prevents content inference
- Consider: padding to prevent message size analysis

---

## References

1. Signal Protocol Double Ratchet: https://signal.org/docs/specifications/doubleratchet/
2. X3DH Key Agreement: https://signal.org/docs/specifications/x3dh/
3. Safety Numbers: https://signal.org/docs/specifications/safenumbers/
4. Sealed Sender: https://signal.org/blog/sealed-sender/
5. Metadata Resistance: https://signal.org/blog/private-contact-discovery/
