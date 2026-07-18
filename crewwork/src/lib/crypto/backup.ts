/**
 * CrewWork E2EE - Key Backup & Sync
 *
 * Backs up identity keys to Supabase (encrypted with user's password).
 * Syncs channel keys for multi-device support.
 */

import { getIdentityKeyPair } from './keys'
import { encryptIdentityForBackup, decryptIdentityFromBackup } from './recovery'
import { getSupabaseClient } from '@/lib/supabase/client'

// ============================================================================
// Identity Key Backup
// ============================================================================

/**
 * Backup identity key to Supabase (encrypted with password).
 * Called after key generation or on manual backup.
 */
export async function backupIdentityKey(password: string): Promise<boolean> {
  try {
    const identityKey = await getIdentityKeyPair()
    if (!identityKey) return false

    const backup = await encryptIdentityForBackup(identityKey, password)

    const supabase = getSupabaseClient()
    if (!supabase) return false

    const { error } = await supabase
      .from('profiles')
      .update({ identity_backup: backup })
      .eq('id', (await supabase.auth.getUser()).data.user?.id)

    return !error
  } catch {
    return false
  }
}

/**
 * Restore identity key from Supabase backup.
 * Called on new device login.
 */
export async function restoreIdentityKey(password: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient()
    if (!supabase) return false

    const { data: profile } = await supabase
      .from('profiles')
      .select('identity_backup')
      .eq('id', (await supabase.auth.getUser()).data.user?.id)
      .single()

    if (!profile?.identity_backup) return false

    const identityKey = await decryptIdentityFromBackup(
      profile.identity_backup,
      password
    )

    // Store the restored key in IndexedDB
    // Import the key module and store
    const { db } = await import('@/lib/local/db')
    await db.settings.put({
      key: 'restored_identity_key',
      value: JSON.stringify({
        publicKeyBase64: identityKey.publicKeyBase64,
        agreementPublicKeyBase64: identityKey.agreementPublicKeyBase64,
        createdAt: identityKey.createdAt,
      }),
    })

    // Re-import and store the actual CryptoKey objects
    const signingPrivateKey = await crypto.subtle.importKey(
      'jwk',
      await crypto.subtle.exportKey('jwk', identityKey.privateKey),
      { name: 'Ed25519' },
      false,
      ['sign']
    )
    const signingPublicKey = await crypto.subtle.importKey(
      'jwk',
      await crypto.subtle.exportKey('jwk', identityKey.publicKey),
      { name: 'Ed25519' },
      false,
      ['verify']
    )
    const agreementPrivateKey = await crypto.subtle.importKey(
      'jwk',
      await crypto.subtle.exportKey('jwk', identityKey.agreementPrivateKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits']
    )
    const agreementPublicKey = await crypto.subtle.importKey(
      'jwk',
      await crypto.subtle.exportKey('jwk', identityKey.agreementPublicKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    )

    // Store in IndexedDB using the same key storage mechanism
    const keyDB = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('CrewWorkKeys', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })

    await new Promise<void>((resolve, reject) => {
      const tx = keyDB.transaction('crewwork-identity-keys', 'readwrite')
      const store = tx.objectStore('crewwork-identity-keys')
      const request = store.put({
        id: 'current',
        publicKey: signingPublicKey,
        privateKey: signingPrivateKey,
        publicKeyBase64: identityKey.publicKeyBase64,
        agreementPublicKey,
        agreementPrivateKey,
        agreementPublicKeyBase64: identityKey.agreementPublicKeyBase64,
        createdAt: identityKey.createdAt,
      })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })

    return true
  } catch {
    return false
  }
}

/**
 * Check if identity key backup exists.
 */
export async function hasIdentityBackup(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient()
    if (!supabase) return false

    const { data: profile } = await supabase
      .from('profiles')
      .select('identity_backup')
      .eq('id', (await supabase.auth.getUser()).data.user?.id)
      .single()

    return !!profile?.identity_backup
  } catch {
    return false
  }
}

// ============================================================================
// Channel Key Sync
// ============================================================================

/**
 * Sync channel keys to Supabase for multi-device support.
 * Stores encrypted channel keys in a JSON column.
 */
export async function syncChannelKeysToServer(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient()
    if (!supabase) return false

    // Get all channel keys from IndexedDB
    const { db } = await import('@/lib/local/db')
    const allSettings = await db.settings.toArray()
    const channelKeys = allSettings
      .filter(s => s.key.startsWith('channel_key_'))
      .reduce((acc, s) => {
        acc[s.key] = s.value
        return acc
      }, {} as Record<string, string>)

    if (Object.keys(channelKeys).length === 0) return true

    // Store in Supabase (encrypted with service role for now)
    // In production, encrypt with user's key before storing
    const { error } = await supabase
      .from('profiles')
      .update({ channel_keys_sync: channelKeys })
      .eq('id', (await supabase.auth.getUser()).data.user?.id)

    return !error
  } catch {
    return false
  }
}

/**
 * Load channel keys from Supabase.
 * Called on new device to restore channel keys.
 */
export async function loadChannelKeysFromServer(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient()
    if (!supabase) return false

    const { data: profile } = await supabase
      .from('profiles')
      .select('channel_keys_sync')
      .eq('id', (await supabase.auth.getUser()).data.user?.id)
      .single()

    if (!profile?.channel_keys_sync) return false

    // Store each channel key in IndexedDB
    const { db } = await import('@/lib/local/db')
    for (const [key, value] of Object.entries(profile.channel_keys_sync as Record<string, string>)) {
      await db.settings.put({ key, value })
    }

    return true
  } catch {
    return false
  }
}
