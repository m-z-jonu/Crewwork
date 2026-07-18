import { db, type LocalMessage } from './db'
import { encryptForStorage, decryptFromStorage, isEncrypted } from '@/lib/crypto'
import { encryptBlob, decryptBlob } from '@/lib/crypto/encrypt'
import { getSessionKey, getIdentityKeyPair } from '@/lib/crypto/keys'
import {
  generateAnonymousSenderId,
  minimizeTimestamp,
  encryptMetadata,
} from '@/lib/crypto/metadata'

const SYNC_SETTING_KEY = 'sync_started_at'
const MULTI_DEVICE_KEY = 'multi_device_enabled'

export async function isMultiDeviceEnabled(): Promise<boolean> {
  const setting = await db.settings.get(MULTI_DEVICE_KEY)
  return setting?.value === 'true'
}

export async function getSyncStartTime(): Promise<string | null> {
  const setting = await db.settings.get(SYNC_SETTING_KEY)
  return setting?.value || null
}

export async function shouldSyncMessage(createdAt: string): Promise<boolean> {
  const enabled = await isMultiDeviceEnabled()
  if (!enabled) return false
  const syncStart = await getSyncStartTime()
  if (!syncStart) return true
  return createdAt >= syncStart
}

export async function enableMultiDevice(): Promise<void> {
  const now = new Date().toISOString()
  await db.settings.put({ key: MULTI_DEVICE_KEY, value: 'true' })
  await db.settings.put({ key: SYNC_SETTING_KEY, value: now })
}

/**
 * Encrypt content before storing.
 * This is the core E2EE function - all messages are encrypted before IndexedDB.
 */
async function encryptContent(
  content: string,
  channelId: string,
  senderId: string
): Promise<string> {
  // Encrypt the message content
  return encryptForStorage(content, channelId, senderId)
}

/**
 * Decrypt content when reading from storage.
 */
export async function decryptContent(
  encryptedContent: string,
  channelId: string,
  senderId: string
): Promise<string> {
  // Check if content is already encrypted
  if (!isEncrypted(encryptedContent)) {
    // Legacy plaintext content
    return encryptedContent
  }

  try {
    return await decryptFromStorage(encryptedContent, channelId, senderId)
  } catch (error) {
    console.error('Decryption failed:', error)
    return '[Encrypted message - cannot decrypt]'
  }
}

export async function storeMessage(msg: {
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
  // Encrypt content before storing
  const encryptedContent = await encryptContent(
    msg.content,
    msg.channel_id,
    msg.sender_id
  )

  // Metadata minimization: use anonymous sender ID and rounded timestamp
  const anonymousSenderId = await generateAnonymousSenderId(msg.channel_id, msg.sender_id)
  const minimizedTimestamp = minimizeTimestamp(msg.created_at)

  await db.messages.put({
    id: msg.id,
    channel_id: msg.channel_id,
    sender_id: anonymousSenderId,  // Store anonymous ID instead of real sender
    content: encryptedContent,  // Store encrypted content
    created_at: minimizedTimestamp,  // Rounded timestamp prevents timing correlation
    is_deleted: msg.is_deleted ?? false,
    parent_id: msg.parent_id ?? null,
    synced: msg.synced ?? false,
    sender_name: msg.sender_name,
    sender_avatar: msg.sender_avatar,
  })
}

/**
 * Encrypt thread metadata for storage.
 * Thread relationships (parent_id, reply counts) are metadata that
 * could leak conversation structure if stored in plaintext.
 */
export async function encryptThreadMetadata(
  threadId: string,
  channelId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const identity = await getIdentityKeyPair()
  if (!identity) return

  const channelKey = await getSessionKey(channelId, identity.publicKeyBase64, 'thread-meta')
  if (!channelKey) return

  const encrypted = await encryptMetadata(metadata, channelKey)
  await db.settings.put({ key: `thread-meta:${threadId}`, value: encrypted })
}

export async function getChannelMessages(channelId: string): Promise<LocalMessage[]> {
  return db.messages
    .where('channel_id')
    .equals(channelId)
    .and(m => !m.is_deleted && !m.parent_id)
    .sortBy('created_at')
}

export async function markMessageSynced(id: string): Promise<void> {
  await db.messages.update(id, { synced: true })
}

/**
 * Encrypt a file blob and store it in IndexedDB.
 * The blob is encrypted with AES-GCM before storage.
 */
export async function storeEncryptedFile(params: {
  id: string
  message_id: string
  name: string
  blob: Blob
  type: string
  channelId: string
  senderId: string
}): Promise<void> {
  // Get the current user's identity to form canonical session key pair
  const identity = await getIdentityKeyPair()
  if (!identity) {
    throw new Error('No identity key found. Cannot encrypt file.')
  }
  const myId = identity.publicKeyBase64

  // Look up session key using canonical participant pair
  const sessionKey = await getSessionKey(params.channelId, myId, params.senderId)
  if (!sessionKey) {
    throw new Error(
      `No session key for channel ${params.channelId}. ` +
      `Perform X3DH key exchange before encrypting files.`
    )
  }

  // Encrypt the blob
  const { ciphertext, nonce } = await encryptBlob(params.blob, sessionKey)

  // Combine nonce + ciphertext into a single Blob for IndexedDB storage
  const nonceArray = new Uint8Array(nonce)
  const cipherArray = new Uint8Array(ciphertext)
  const envelope = new Blob([nonceArray.buffer, cipherArray.buffer])

  await db.files.put({
    id: params.id,
    message_id: params.message_id,
    name: params.name,
    blob: envelope,
    type: params.type,
    synced: false,
    channelId: params.channelId,
    senderId: params.senderId,
  })
}

/**
 * Retrieve and decrypt a file from IndexedDB.
 * Throws on failure — never returns the encrypted blob to the caller.
 */
export async function getDecryptedFile(
  fileId: string,
  channelId: string,
  senderId: string
): Promise<Blob | null> {
  const file = await db.files.get(fileId)
  if (!file) return null

  // Get the current user's identity to form canonical session key pair
  const identity = await getIdentityKeyPair()
  if (!identity) {
    throw new Error('No identity key found. Cannot decrypt file.')
  }
  const myId = identity.publicKeyBase64

  const sessionKey = await getSessionKey(channelId, myId, senderId)
  if (!sessionKey) {
    throw new Error(
      `No session key for channel ${channelId}. ` +
      `Perform X3DH key exchange before decrypting files.`
    )
  }

  // Extract nonce (first 12 bytes) and ciphertext (rest)
  const arrayBuffer = await file.blob.arrayBuffer()
  if (arrayBuffer.byteLength < 12) {
    throw new Error('Encrypted blob is too small — expected at least 12-byte nonce prefix.')
  }
  const nonce = new Uint8Array(arrayBuffer.slice(0, 12))
  const ciphertext = arrayBuffer.slice(12)

  return await decryptBlob(ciphertext, nonce, sessionKey)
}
