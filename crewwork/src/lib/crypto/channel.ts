/**
 * CrewWork E2EE - Channel Key Management
 *
 * Stores and retrieves encryption keys for group channels.
 * Channel keys must be explicitly stored via storeChannelKey() —
 * they are NOT derived from known strings (which would be insecure).
 */

import { db } from '@/lib/local/db'

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generate a new channel encryption key.
 */
export async function generateChannelKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

// ============================================================================
// Key Derivation & Caching
// ============================================================================

/**
 * Get channel key from IndexedDB cache.
 * If no key exists, generate one and store it (for group channels).
 */
export async function getChannelKey(channelId: string): Promise<CryptoKey> {
  const cached = await db.settings.get(`channel_key_${channelId}`)
  if (cached?.value) {
    const keyData = JSON.parse(cached.value)
    return crypto.subtle.importKey(
      'jwk',
      keyData,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    )
  }

  // No key exists — generate one and store it
  // This is the first user in this channel, so they create the key
  const newKey = await generateChannelKey()
  await storeChannelKey(channelId, newKey)
  return newKey
}

// ============================================================================
// Key Storage
// ============================================================================

/**
 * Store channel key in IndexedDB.
 */
export async function storeChannelKey(channelId: string, key: CryptoKey): Promise<void> {
  const exported = await crypto.subtle.exportKey('jwk', key)
  await db.settings.put({
    key: `channel_key_${channelId}`,
    value: JSON.stringify(exported),
  })
}

/**
 * Remove channel key from IndexedDB.
 */
export async function removeChannelKey(channelId: string): Promise<void> {
  await db.settings.delete(`channel_key_${channelId}`)
}
