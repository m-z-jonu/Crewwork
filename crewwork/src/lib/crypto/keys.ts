/**
 * CrewWork E2EE - Key Management
 *
 * Handles identity key generation, storage, and retrieval.
 * Uses WebCrypto API for all cryptographic operations.
 *
 * Key hierarchy:
 * - Identity Key (Ed25519): Long-term signing key, per-user
 * - Pre-keys (X25519): One-time keys for asynchronous key agreement
 * - Session Keys (AES-256-GCM): Derived from key agreement, per-conversation
 */

import { db } from '@/lib/local/db'

// ============================================================================
// Types
// ============================================================================

export interface IdentityKeyPair {
  publicKey: CryptoKey        // Ed25519 (for signing)
  privateKey: CryptoKey       // Ed25519
  publicKeyBase64: string
  // ECDH P-256 key pair for X3DH key agreement
  agreementPublicKey: CryptoKey
  agreementPrivateKey: CryptoKey
  agreementPublicKeyBase64: string
  createdAt: string
}

export interface PreKey {
  id: string
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyBase64: string
  createdAt: string
  used: boolean
}

export interface SessionKey {
  channelId: string
  participantId: string
  key: CryptoKey
  createdAt: string
}

// ============================================================================
// Constants
// ============================================================================

const IDENTITY_KEY_STORE = 'crewwork-identity-keys'
const PRE_KEY_STORE = 'crewwork-pre-keys'
const SESSION_KEY_STORE = 'crewwork-session-keys'

// ============================================================================
// IndexedDB Helpers
// ============================================================================

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('CrewWorkKeys', 1)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(IDENTITY_KEY_STORE)) {
        db.createObjectStore(IDENTITY_KEY_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(PRE_KEY_STORE)) {
        db.createObjectStore(PRE_KEY_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SESSION_KEY_STORE)) {
        db.createObjectStore(SESSION_KEY_STORE, { keyPath: 'id' })
      }
    }
  })
}

async function getKeyFromStore<T>(storeName: string, id: string): Promise<T | null> {
  const keyDB = await openKeyDB()
  return new Promise((resolve, reject) => {
    const tx = keyDB.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.get(id)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

async function putKeyInStore<T>(storeName: string, id: string, value: T): Promise<void> {
  const keyDB = await openKeyDB()
  return new Promise((resolve, reject) => {
    const tx = keyDB.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const request = store.put({ id, ...value })
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function deleteKeyFromStore(storeName: string, id: string): Promise<void> {
  const keyDB = await openKeyDB()
  return new Promise((resolve, reject) => {
    const tx = keyDB.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
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

// ============================================================================
// Identity Key Management
// ============================================================================

/**
 * Generate a new Ed25519 identity key pair for the user.
 * This is the long-term key used for signing and identity verification.
 */
export async function generateIdentityKeyPair(): Promise<IdentityKeyPair> {
  // Ed25519 key pair for signing (prekey signatures, identity verification)
  const signingKeyPair = await crypto.subtle.generateKey(
    {
      name: 'Ed25519',
    },
    false, // NON-extractable — prevents XSS from exporting private keys
    ['sign', 'verify']
  )

  const signingPublicBuffer = await crypto.subtle.exportKey('raw', signingKeyPair.publicKey)
  const publicKeyBase64 = bufferToBase64(signingPublicBuffer)

  // ECDH P-256 key pair for X3DH key agreement
  const agreementKeyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    false,
    ['deriveKey', 'deriveBits']
  )

  const agreementPublicBuffer = await crypto.subtle.exportKey('raw', agreementKeyPair.publicKey)
  const agreementPublicKeyBase64 = bufferToBase64(agreementPublicBuffer)

  const identityKey: IdentityKeyPair = {
    publicKey: signingKeyPair.publicKey,
    privateKey: signingKeyPair.privateKey,
    publicKeyBase64,
    agreementPublicKey: agreementKeyPair.publicKey,
    agreementPrivateKey: agreementKeyPair.privateKey,
    agreementPublicKeyBase64,
    createdAt: new Date().toISOString(),
  }

  // Store in IndexedDB
  await putKeyInStore(IDENTITY_KEY_STORE, 'current', {
    publicKey: signingKeyPair.publicKey,
    privateKey: signingKeyPair.privateKey,
    publicKeyBase64,
    agreementPublicKey: agreementKeyPair.publicKey,
    agreementPrivateKey: agreementKeyPair.privateKey,
    agreementPublicKeyBase64,
    createdAt: identityKey.createdAt,
  })

  return identityKey
}

/**
 * Get the current identity key pair.
 * Returns null if no key exists (user hasn't signed up yet).
 */
export async function getIdentityKeyPair(): Promise<IdentityKeyPair | null> {
  const stored = await getKeyFromStore<{
    publicKey: CryptoKey
    privateKey: CryptoKey
    publicKeyBase64: string
    agreementPublicKey?: CryptoKey
    agreementPrivateKey?: CryptoKey
    agreementPublicKeyBase64?: string
    createdAt: string
  }>(IDENTITY_KEY_STORE, 'current')

  if (!stored) return null

  // Backward compatibility: if agreement keys don't exist (pre-batch-2 keys),
  // generate them on the fly from a new key pair
  let agreementPublicKey = stored.agreementPublicKey
  let agreementPrivateKey = stored.agreementPrivateKey
  let agreementPublicKeyBase64 = stored.agreementPublicKeyBase64

  if (!agreementPublicKey || !agreementPrivateKey || !agreementPublicKeyBase64) {
    const agreementKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits']
    )
    const agreementPublicBuffer = await crypto.subtle.exportKey('raw', agreementKeyPair.publicKey)
    agreementPublicKey = agreementKeyPair.publicKey
    agreementPrivateKey = agreementKeyPair.privateKey
    agreementPublicKeyBase64 = bufferToBase64(agreementPublicBuffer)

    // Persist the new agreement keys alongside existing signing keys
    await putKeyInStore(IDENTITY_KEY_STORE, 'current', {
      publicKey: stored.publicKey,
      privateKey: stored.privateKey,
      publicKeyBase64: stored.publicKeyBase64,
      agreementPublicKey,
      agreementPrivateKey,
      agreementPublicKeyBase64,
      createdAt: stored.createdAt,
    })
  }

  return {
    publicKey: stored.publicKey,
    privateKey: stored.privateKey,
    publicKeyBase64: stored.publicKeyBase64,
    agreementPublicKey,
    agreementPrivateKey,
    agreementPublicKeyBase64,
    createdAt: stored.createdAt,
  }
}

/**
 * Get the public key as base64 for uploading to the server.
 */
export async function getPublicKeyBase64(): Promise<string | null> {
  const keyPair = await getIdentityKeyPair()
  return keyPair?.publicKeyBase64 || null
}

// ============================================================================
// Pre-key Management (for X3DH)
// ============================================================================

/**
 * Generate a batch of one-time pre-keys for asynchronous key agreement.
 * These are uploaded to the server and consumed when someone initiates a conversation.
 */
export async function generatePreKeys(count: number = 10): Promise<PreKey[]> {
  const preKeys: PreKey[] = []

  for (let i = 0; i < count; i++) {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      ['deriveKey', 'deriveBits']
    )

    const publicKeyBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey)
    const publicKeyBase64 = bufferToBase64(publicKeyBuffer)

    const preKey: PreKey = {
      id: crypto.randomUUID(),
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicKeyBase64,
      createdAt: new Date().toISOString(),
      used: false,
    }

    await putKeyInStore(PRE_KEY_STORE, preKey.id, {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicKeyBase64: preKey.publicKeyBase64,
      createdAt: preKey.createdAt,
      used: false,
    })

    preKeys.push(preKey)
  }

  return preKeys
}

/**
 * Get an unused pre-key for key agreement.
 */
export async function getUnusedPreKey(): Promise<PreKey | null> {
  const keyDB = await openKeyDB()
  return new Promise((resolve, reject) => {
    const tx = keyDB.transaction(PRE_KEY_STORE, 'readonly')
    const store = tx.objectStore(PRE_KEY_STORE)
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        const value = cursor.value
        if (!value.used) {
          resolve({
            id: cursor.key as string,
            publicKey: value.publicKey,
            privateKey: value.privateKey,
            publicKeyBase64: value.publicKeyBase64,
            createdAt: value.createdAt,
            used: false,
          })
        } else {
          cursor.continue()
        }
      } else {
        resolve(null)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Mark a pre-key as used.
 */
export async function markPreKeyUsed(preKeyId: string): Promise<void> {
  await putKeyInStore(PRE_KEY_STORE, preKeyId, { used: true })
}

// ============================================================================
// Session Key Management
// ============================================================================

/**
 * Derive a session key from a shared secret using HKDF.
 *
 * Both parties call this with the same channelId and participantPair
 * (the two user IDs sorted alphabetically, joined by ':').
 * This ensures both derive the same key regardless of who initiates.
 */
export async function deriveSessionKey(
  sharedSecret: ArrayBuffer,
  channelId: string,
  participantPair: string
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  )

  const sessionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(`crewwork-${channelId}`),
      info: new TextEncoder().encode(`session-${participantPair}`),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  // Store using the canonical participant pair as key
  await putKeyInStore(SESSION_KEY_STORE, `${channelId}:${participantPair}`, {
    key: sessionKey,
    channelId,
    participantId: participantPair,
    createdAt: new Date().toISOString(),
  })

  return sessionKey
}

/**
 * Build a canonical participant pair key from two user IDs.
 * Sorts alphabetically so both parties produce the same key.
 */
export function canonicalPair(userIdA: string, userIdB: string): string {
  return userIdA < userIdB ? `${userIdA}:${userIdB}` : `${userIdB}:${userIdA}`
}

/**
 * Get an existing session key.
 *
 * Looks up by canonical participant pair (sorted IDs), so both parties
 * find the same key regardless of who is querying.
 */
export async function getSessionKey(
  channelId: string,
  userIdA: string,
  userIdB: string
): Promise<CryptoKey | null> {
  const pair = canonicalPair(userIdA, userIdB)
  const stored = await getKeyFromStore<{ key: CryptoKey }>(
    SESSION_KEY_STORE,
    `${channelId}:${pair}`
  )
  return stored?.key || null
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Delete all keys (called on logout).
 */
export async function deleteAllKeys(): Promise<void> {
  const keyDB = await openKeyDB()
  const tx = keyDB.transaction([IDENTITY_KEY_STORE, PRE_KEY_STORE, SESSION_KEY_STORE], 'readwrite')
  tx.objectStore(IDENTITY_KEY_STORE).clear()
  tx.objectStore(PRE_KEY_STORE).clear()
  tx.objectStore(SESSION_KEY_STORE).clear()
}
