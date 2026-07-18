/**
 * CrewWork E2EE - Encryption & Decryption
 *
 * Handles message encryption/decryption using AES-256-GCM.
 * All encryption happens client-side before storage.
 *
 * Cipher envelope format:
 * {
 *   version: 1,
 *   algorithm: 'AES-GCM',
 *   nonce: base64,      // 12-byte nonce
 *   ciphertext: base64, // encrypted content
 *   senderKey: base64,  // sender's public key (for key agreement)
 *   timestamp: string,  // ISO timestamp
 * }
 */

import { getIdentityKeyPair, getSessionKey, deriveSessionKey, canonicalPair } from './keys'
import { getChannelKey } from './channel'
import {
  RatchetEnvelope,
  ratchetEncrypt,
  ratchetDecrypt,
  loadRatchetState,
  saveRatchetState,
  initializeRatchet,
} from './double-ratchet'

// ============================================================================
// Types
// ============================================================================

export interface CipherEnvelope {
  version: 1
  algorithm: string
  nonce: string
  ciphertext: string
  senderKey: string
  timestamp: string
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
// Key Generation
// ============================================================================

/**
 * Generate a random AES-256-GCM key for message encryption.
 */
export async function generateMessageKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable for key agreement
    ['encrypt', 'decrypt']
  )
}

/**
 * Generate a random 12-byte nonce for AES-GCM.
 */
function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

// ============================================================================
// Encryption
// ============================================================================

/**
 * Encrypt a plaintext message using AES-256-GCM.
 *
 * @param plaintext - The message content to encrypt
 * @param key - The encryption key (session key or channel key)
 * @param senderPublicKey - The sender's public key base64
 * @returns CipherEnvelope containing the encrypted data
 */
export async function encryptMessage(
  plaintext: string,
  key: CryptoKey,
  senderPublicKey: string
): Promise<CipherEnvelope> {
  const nonce = generateNonce()
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as ArrayBuffer },
    key,
    encoded
  )

  return {
    version: 1,
    algorithm: 'AES-GCM',
    nonce: bufferToBase64(nonce as unknown as ArrayBuffer),
    ciphertext: bufferToBase64(ciphertext),
    senderKey: senderPublicKey,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Decrypt a CipherEnvelope to recover the original plaintext.
 *
 * @param envelope - The CipherEnvelope to decrypt
 * @param key - The decryption key (session key or channel key)
 * @returns The decrypted plaintext string
 */
export async function decryptMessage(
  envelope: CipherEnvelope,
  key: CryptoKey
): Promise<string> {
  const nonce = base64ToBuffer(envelope.nonce)
  const ciphertext = base64ToBuffer(envelope.ciphertext)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(nonce) as unknown as ArrayBuffer },
    key,
    ciphertext
  )

  return new TextDecoder().decode(decrypted)
}

// ============================================================================
// High-Level API
// ============================================================================

/**
 * Encrypt a message for storage.
 *
 * This is the main function called before storing a message in IndexedDB.
 * It handles key derivation and creates the cipher envelope.
 *
 * @param plaintext - The message content
 * @param channelId - The channel/conversation ID
 * @param recipientId - The recipient's user ID (or 'channel' for group channels)
 * @returns CipherEnvelope as a JSON string for storage
 */
export async function encryptForStorage(
  plaintext: string,
  channelId: string,
  recipientId: string
): Promise<string> {
  // Get sender's identity key
  const identityKey = await getIdentityKeyPair()
  if (!identityKey) {
    throw new Error('No identity key found. User must sign up first.')
  }

  // Determine if this is a DM (uses session keys) or group channel (uses channel keys)
  const isDM = channelId.startsWith('dm-') || channelId.startsWith('gdm-')

  let encryptionKey: CryptoKey

  if (isDM) {
    // DMs: use per-session key via key agreement
    const myId = identityKey.publicKeyBase64
    let sessionKey = await getSessionKey(channelId, myId, recipientId)
    if (!sessionKey) {
      // In full X3DH implementation, performX3DH() would establish the shared
      // secret and derive the session key before first message. Without it,
      // we cannot safely encrypt — generating a random key here would make the
      // message undecryptable by the recipient.
      throw new Error(
        `No session key for channel ${channelId}. ` +
        `Perform X3DH key exchange before sending DM messages.`
      )
    }
    encryptionKey = sessionKey
  } else {
    // Group channels: derive shared key from channel ID
    encryptionKey = await getChannelKey(channelId)
  }

  // Encrypt the message
  const envelope = await encryptMessage(plaintext, encryptionKey, identityKey.publicKeyBase64)

  // Return as JSON string for storage
  return JSON.stringify(envelope)
}

/**
 * Decrypt a message from storage.
 *
 * This is the main function called when displaying a message.
 * It parses the cipher envelope and decrypts the content.
 *
 * @param encryptedContent - The encrypted content string from storage
 * @param channelId - The channel/conversation ID
 * @param senderId - The sender's user ID
 * @returns The decrypted plaintext
 */
export async function decryptFromStorage(
  encryptedContent: string,
  channelId: string,
  senderId: string
): Promise<string> {
  // Parse the cipher envelope
  let envelope: CipherEnvelope
  try {
    envelope = JSON.parse(encryptedContent)
  } catch {
    // Content is not a valid cipher envelope — refuse to return plaintext
    throw new Error(
      'Invalid cipher envelope: content is not encrypted. ' +
      'All messages must be encrypted before storage.'
    )
  }

  // Validate envelope
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-GCM') {
    throw new Error(`Unsupported cipher envelope version: ${envelope.version}`)
  }

  // Determine if this is a DM (uses session keys) or group channel (uses channel keys)
  const isDM = channelId.startsWith('dm-') || channelId.startsWith('gdm-')

  let decryptionKey: CryptoKey

  if (isDM) {
    // DMs: use per-session key via key agreement
    // We need the current user's ID to build the canonical pair.
    // The senderId from the envelope and our own identity form the pair.
    const identityKey = await getIdentityKeyPair()
    if (!identityKey) {
      throw new Error('No identity key found. Cannot decrypt DM messages.')
    }
    const myId = identityKey.publicKeyBase64
    const sessionKey = await getSessionKey(channelId, myId, senderId)
    if (!sessionKey) {
      throw new Error(`No session key found for channel ${channelId}, sender ${senderId}`)
    }
    decryptionKey = sessionKey
  } else {
    // Group channels: derive shared key from channel ID
    decryptionKey = await getChannelKey(channelId)
  }

  // Decrypt
  return decryptMessage(envelope, decryptionKey)
}

// ============================================================================
// Blob Encryption (for file attachments)
// ============================================================================

/**
 * Encrypt a Blob using AES-256-GCM.
 *
 * @param blob - The file content to encrypt
 * @param key - The encryption key
 * @returns ciphertext and nonce (12 bytes) needed for decryption
 */
export async function encryptBlob(
  blob: Blob,
  key: CryptoKey
): Promise<{ ciphertext: ArrayBuffer; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const arrayBuffer = await blob.arrayBuffer()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as ArrayBuffer },
    key,
    arrayBuffer
  )
  return { ciphertext, nonce }
}

/**
 * Decrypt an AES-256-GCM ciphertext back to a Blob.
 *
 * @param ciphertext - The encrypted data
 * @param nonce - The 12-byte nonce used during encryption
 * @param key - The decryption key (must match the encryption key)
 * @returns Decrypted Blob
 */
export async function decryptBlob(
  ciphertext: ArrayBuffer,
  nonce: Uint8Array,
  key: CryptoKey
): Promise<Blob> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as unknown as ArrayBuffer },
    key,
    ciphertext
  )
  return new Blob([decrypted])
}

/**
 * Check if content is encrypted (has cipher envelope format, v1 or v2).
 */
export function isEncrypted(content: string): boolean {
  try {
    const envelope = JSON.parse(content)
    if (typeof envelope !== 'object' || envelope === null) return false
    if (envelope.algorithm !== 'AES-GCM') return false
    if (typeof envelope.nonce !== 'string') return false
    if (typeof envelope.ciphertext !== 'string') return false

    // v1: requires senderKey
    if (envelope.version === 1) {
      return typeof envelope.senderKey === 'string'
    }

    // v2: requires dhPublicKey, previousChainLength, messageNumber
    if (envelope.version === 2) {
      return (
        typeof envelope.previousChainLength === 'number' &&
        typeof envelope.messageNumber === 'number'
      )
    }

    return false
  } catch {
    return false
  }
}

/**
 * Batch decrypt multiple messages.
 *
 * @param messages - Array of { id, content, channelId, senderId }
 * @returns Array of { id, plaintext }
 */
export async function batchDecrypt(
  messages: Array<{ id: string; content: string; channelId: string; senderId: string }>
): Promise<Array<{ id: string; plaintext: string }>> {
  const results: Array<{ id: string; plaintext: string }> = []

  for (const msg of messages) {
    try {
      if (isEncrypted(msg.content)) {
        const plaintext = await decryptFromStorage(
          msg.content,
          msg.channelId,
          msg.senderId
        )
        results.push({ id: msg.id, plaintext })
      } else {
        // Legacy plaintext
        results.push({ id: msg.id, plaintext: msg.content })
      }
    } catch (error) {
      console.error(`Failed to decrypt message ${msg.id}`)
      // Return placeholder for failed decryption
      results.push({ id: msg.id, plaintext: '[Encrypted message - cannot decrypt]' })
    }
  }

  return results
}

// ============================================================================
// Double Ratchet (v2) - Per-Message Key Derivation
// ============================================================================

/**
 * Encrypt a message with Double Ratchet (v2).
 *
 * For DMs, uses the ratchet for forward secrecy. Falls back to v1 static key
 * encryption for group channels or when ratchet state is not available.
 *
 * @param plaintext - The message content
 * @param channelId - The channel/conversation ID
 * @param recipientId - The recipient's user ID
 * @returns Encrypted content as a JSON string (v1 or v2 envelope)
 */
export async function encryptForStorageV2(
  plaintext: string,
  channelId: string,
  recipientId: string
): Promise<string> {
  const isDM = channelId.startsWith('dm-') || channelId.startsWith('gdm-')

  if (isDM) {
    // Try ratchet encryption (with existing state)
    const ratchetState = await loadRatchetState(channelId, recipientId)
    if (ratchetState && ratchetState.sendingChainKey) {
      try {
        const { envelope, state } = await ratchetEncrypt(plaintext, ratchetState)
        await saveRatchetState(state)
        return JSON.stringify(envelope)
      } catch {
        // Ratchet failed, fall through to v1
      }
    }

    // No ratchet state or ratchet failed — fall back to v1 static key encryption.
    // In a full implementation, we would initialize the ratchet from the X3DH shared
    // secret and pass the remote public key to derive the initial sending chain.
  }

  // Group channels or DM fallback: use static channel/session key (v1)
  return encryptForStorage(plaintext, channelId, recipientId)
}

/**
 * Decrypt a message with Double Ratchet (v2).
 *
 * Automatically detects v1 vs v2 envelopes and uses the appropriate method.
 *
 * @param encryptedContent - The encrypted content string from storage
 * @param channelId - The channel/conversation ID
 * @param senderId - The sender's user ID
 * @returns The decrypted plaintext
 */
export async function decryptFromStorageV2(
  encryptedContent: string,
  channelId: string,
  senderId: string
): Promise<string> {
  let envelope: RatchetEnvelope | CipherEnvelope
  try {
    envelope = JSON.parse(encryptedContent)
  } catch {
    return encryptedContent // Legacy plaintext
  }

  // Check if this is a v2 ratcheted message
  if (
    'version' in envelope &&
    envelope.version === 2 &&
    envelope.algorithm === 'AES-GCM'
  ) {
    let ratchetState = await loadRatchetState(channelId, senderId)

    // If no ratchet state exists (receiver's first message), initialize from session key
    if (!ratchetState) {
      const identityKey = await getIdentityKeyPair()
      if (!identityKey) {
        throw new Error('No identity key found. Cannot initialize ratchet state.')
      }

      const sessionKey = await getSessionKey(channelId, identityKey.publicKeyBase64, senderId)
      if (!sessionKey) {
        throw new Error(
          `No session key for channel ${channelId}. ` +
          `Perform X3DH key exchange before decrypting ratchet messages.`
        )
      }

      // Export session key as shared secret for ratchet initialization
      const sharedSecret = await crypto.subtle.exportKey('raw', sessionKey)
      ratchetState = await initializeRatchet(
        sharedSecret,
        channelId,
        senderId,
        false // receiver side
      )
    }

    const { plaintext, state } = await ratchetDecrypt(
      envelope as RatchetEnvelope,
      ratchetState
    )
    await saveRatchetState(state)
    return plaintext
  }

  // Fallback to v1 decryption
  return decryptFromStorage(encryptedContent, channelId, senderId)
}
