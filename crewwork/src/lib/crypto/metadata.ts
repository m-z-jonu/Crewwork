/**
 * CrewWork E2EE - Metadata Minimization
 *
 * Reduces metadata leakage in stored and transmitted data.
 * Prevents cross-channel correlation, timing attacks, and
 * metadata-based surveillance.
 */

// ============================================================================
// Anonymous Sender IDs
// ============================================================================

/**
 * Generate anonymous sender ID for a channel.
 * Different per channel — prevents cross-channel correlation.
 * The real user ID never appears in storage.
 *
 * Uses HMAC-SHA256 with a domain-separated key to prevent
 * collisions and preimage attacks that the previous djb2 hash allowed.
 */
export async function generateAnonymousSenderId(channelId: string, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('CrewWork Anonymous Sender ID'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const data = new TextEncoder().encode(channelId + ':' + userId)
  const signature = await crypto.subtle.sign('HMAC', key, data)
  const hashBytes = new Uint8Array(signature).slice(0, 16)

  let binary = ''
  for (let i = 0; i < hashBytes.length; i++) {
    binary += String.fromCharCode(hashBytes[i])
  }
  return btoa(binary).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)
}

// ============================================================================
// Timestamp Minimization
// ============================================================================

/**
 * Reduce timestamp precision to prevent timing correlation.
 * Rounds to nearest hour — preserves general time context
 * while preventing fine-grained correlation attacks.
 */
export function minimizeTimestamp(iso: string): string {
  const date = new Date(iso)
  date.setMinutes(0, 0, 0) // Round to hour
  return date.toISOString()
}

/**
 * Strip timezone information and round to nearest 15 minutes.
 * Less aggressive than minimizeTimestamp but still prevents
 * sub-minute correlation.
 */
export function truncateTimestamp(iso: string): string {
  const date = new Date(iso)
  const minutes = date.getMinutes()
  const rounded = Math.floor(minutes / 15) * 15
  date.setMinutes(rounded, 0, 0)
  return date.toISOString()
}

// ============================================================================
// Metadata Encryption
// ============================================================================

/**
 * Encrypt metadata envelope with AES-GCM.
 * Metadata (thread info, reactions, read receipts) is encrypted
 * separately from message content to limit key scope.
 */
export async function encryptMetadata(
  metadata: Record<string, unknown>,
  key: CryptoKey
): Promise<string> {
  const json = JSON.stringify(metadata)
  const encoded = new TextEncoder().encode(json)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    key,
    encoded
  )
  return JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  })
}

/**
 * Decrypt metadata envelope.
 */
export async function decryptMetadata(
  encryptedMetadata: string,
  key: CryptoKey
): Promise<Record<string, unknown>> {
  const { iv, data } = JSON.parse(encryptedMetadata)
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0))
  const ciphertext = Uint8Array.from(atob(data), c => c.charCodeAt(0))

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes as unknown as ArrayBuffer },
    key,
    ciphertext
  )

  return JSON.parse(new TextDecoder().decode(decrypted))
}

// ============================================================================
// Metadata Sanitization
// ============================================================================

/**
 * Sanitize metadata before storage — strips sensitive fields
 * and applies minimization transforms.
 */
export function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(metadata)) {
    // Strip fields that leak identity
    if (['sender_id', 'user_id', 'author_id', 'from'].includes(key)) {
      continue // Skip — caller should use anonymous ID
    }

    // Minimize timestamps
    if (['created_at', 'updated_at', 'timestamp', 'time'].includes(key)) {
      if (typeof value === 'string') {
        sanitized[key] = minimizeTimestamp(value)
        continue
      }
    }

    // Strip IP addresses and device info
    if (['ip', 'ip_address', 'user_agent', 'device', 'fingerprint'].includes(key)) {
      continue
    }

    sanitized[key] = value
  }

  return sanitized
}
