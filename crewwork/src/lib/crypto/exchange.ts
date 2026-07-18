/**
 * CrewWork E2EE - Key Exchange (X3DH)
 *
 * Implements Extended Triple Diffie-Hellman for asynchronous key agreement.
 * This allows two users to establish a shared secret without being online simultaneously.
 *
 * Protocol flow:
 * 1. Bob publishes identity key + signed prekey + one-time prekeys to server
 * 2. Alice fetches Bob's prekey bundle
 * 3. Alice performs X3DH to derive shared secret
 * 4. Alice encrypts first message with shared secret
 * 5. Bob receives message and performs X3DH to derive same shared secret
 * 6. Both parties can now encrypt/decrypt messages
 *
 * Reference: https://signal.org/docs/specifications/x3dh/
 */

import { getIdentityKeyPair, generatePreKeys, deriveSessionKey } from './keys'
import { getSupabaseClient } from '@/lib/supabase/client'

// ============================================================================
// Types
// ============================================================================

export interface PreKeyBundle {
  identityKey: string          // Bob's ECDH P-256 identity public key (base64)
  identitySigningKey: string   // Bob's Ed25519 identity signing public key (base64)
  signedPreKey: string         // Bob's signed prekey (base64)
  preKeySignature: string      // Ed25519 signature over signed prekey (base64)
  oneTimePreKey?: string       // Bob's one-time prekey (base64, optional)
}

export interface KeyExchangeResult {
  sharedSecret: ArrayBuffer
  sessionKey: CryptoKey
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
// X3DH Implementation
// ============================================================================

/**
 * Generate a prekey bundle for uploading to the server.
 *
 * This is called during signup or when refreshing prekeys.
 * The bundle is stored in the profiles table and fetched by other users.
 */
export async function generatePreKeyBundle(): Promise<{
  bundle: PreKeyBundle
  preKeys: Array<{ id: string; publicKey: string }>
}> {
  const identityKey = await getIdentityKeyPair()
  if (!identityKey) {
    throw new Error('No identity key found. Generate identity key first.')
  }

  // Generate signed prekey
  const signedPreKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )

  const signedPreKeyPublic = await crypto.subtle.exportKey('raw', signedPreKeyPair.publicKey)
  const signedPreKeyBase64 = bufferToBase64(signedPreKeyPublic)

  // Sign the prekey with Ed25519 identity signing key
  const signature = await crypto.subtle.sign(
    'Ed25519',
    identityKey.privateKey,
    signedPreKeyPublic
  )
  const signatureBase64 = bufferToBase64(signature)

  // Generate one-time prekeys
  const oneTimePreKeys = await generatePreKeys(10)

  const bundle: PreKeyBundle = {
    identityKey: identityKey.agreementPublicKeyBase64,
    identitySigningKey: identityKey.publicKeyBase64,
    signedPreKey: signedPreKeyBase64,
    preKeySignature: signatureBase64,
    oneTimePreKey: oneTimePreKeys[0]?.publicKeyBase64,
  }

  return {
    bundle,
    preKeys: oneTimePreKeys.map((pk) => ({
      id: pk.id,
      publicKey: pk.publicKeyBase64,
    })),
  }
}

/**
 * Perform X3DH key agreement as Alice (the initiator).
 *
 * @param bobBundle - Bob's prekey bundle fetched from server
 * @returns Shared secret and derived session key
 */
export async function performX3DH(
  bobBundle: PreKeyBundle
): Promise<KeyExchangeResult> {
  // Get Alice's identity key
  const aliceIdentity = await getIdentityKeyPair()
  if (!aliceIdentity) {
    throw new Error('No identity key found. Generate identity key first.')
  }

  // Verify signed prekey signature using Bob's Ed25519 signing key
  const bobSigningKeyForVerify = await crypto.subtle.importKey(
    'raw',
    base64ToBuffer(bobBundle.identitySigningKey),
    { name: 'Ed25519' },
    false,
    ['verify']
  )

  const signatureValid = await crypto.subtle.verify(
    'Ed25519',
    bobSigningKeyForVerify,
    base64ToBuffer(bobBundle.preKeySignature),
    base64ToBuffer(bobBundle.signedPreKey)
  )

  if (!signatureValid) {
    throw new Error('Invalid signed prekey signature — possible MITM attack')
  }

  // Generate ephemeral key pair
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )

  // Import Bob's ECDH P-256 identity key for key agreement
  const bobIdentityKey = await crypto.subtle.importKey(
    'raw',
    base64ToBuffer(bobBundle.identityKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )

  const bobSignedPreKey = await crypto.subtle.importKey(
    'raw',
    base64ToBuffer(bobBundle.signedPreKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits']
  )

  // Perform 4 Diffie-Hellman calculations
  // DH1 = DH(IKA, SPKB) — Alice's ECDH agreement key with Bob's signed prekey
  const dh1 = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: bobSignedPreKey },
    aliceIdentity.agreementPrivateKey,
    256
  )

  // DH2 = DH(EKA, IKB) — Alice's ephemeral key with Bob's ECDH identity key
  const dh2 = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: bobIdentityKey },
    ephemeralKeyPair.privateKey,
    256
  )

  // DH3 = DH(EKA, SPKB)
  const dh3 = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: bobSignedPreKey },
    ephemeralKeyPair.privateKey,
    256
  )

  // DH4 = DH(EKA, OPKB) - if one-time prekey exists
  let dh4: ArrayBuffer | null = null
  if (bobBundle.oneTimePreKey) {
    const bobOneTimePreKey = await crypto.subtle.importKey(
      'raw',
      base64ToBuffer(bobBundle.oneTimePreKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits']
    )

    dh4 = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: bobOneTimePreKey },
      ephemeralKeyPair.privateKey,
      256
    )
  }

  // Combine DH outputs using HKDF
  const dhOutputs = dh4
    ? concatBuffers([dh1, dh2, dh3, dh4])
    : concatBuffers([dh1, dh2, dh3])

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    dhOutputs,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  )

  // Derive the final shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32), // Zero salt as per X3DH spec
      info: new TextEncoder().encode('CrewWorkX3DH'),
    },
    keyMaterial,
    256
  )

  // Derive session key for encryption
  const ephemeralPublic = await crypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey)
  const sessionKey = await deriveSessionKey(
    sharedSecret,
    'initial', // Will be replaced with actual channel ID
    bufferToBase64(ephemeralPublic)
  )

  return {
    sharedSecret,
    sessionKey,
  }
}

/**
 * Perform X3DH key agreement as Bob (the responder).
 *
 * This is called when Bob receives Alice's first message.
 *
 * @param aliceIdentityKeyBase64 - Alice's identity public key
 * @param aliceEphemeralKeyBase64 - Alice's ephemeral public key
 * @param bobSignedPreKeyPrivate - Bob's signed prekey private key (CryptoKey)
 * @param bobOneTimePreKeyPrivate - Bob's one-time prekey private key (optional)
 * @returns Shared secret and derived session key
 */
export async function performX3DHAsBob(
  aliceIdentityKeyBase64: string,
  aliceEphemeralKeyBase64: string,
  bobSignedPreKeyPrivate: CryptoKey,
  bobOneTimePreKeyPrivate?: CryptoKey
): Promise<KeyExchangeResult> {
  // Get Bob's identity key
  const bobIdentity = await getIdentityKeyPair()
  if (!bobIdentity) {
    throw new Error('No identity key found. Generate identity key first.')
  }

  // Import Alice's ECDH P-256 identity key for key agreement
  const aliceIdentityKey = await crypto.subtle.importKey(
    'raw',
    base64ToBuffer(aliceIdentityKeyBase64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )

  const aliceEphemeralKey = await crypto.subtle.importKey(
    'raw',
    base64ToBuffer(aliceEphemeralKeyBase64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits']
  )

  // Perform DH calculations (mirrored from Alice's perspective)
  // DH1 = DH(SPKB, IKA) — Bob's signed prekey with Alice's ECDH identity key
  const dh1 = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: aliceIdentityKey },
    bobSignedPreKeyPrivate,
    256
  )

  // DH2 = DH(IKB, EKA) — Bob's ECDH agreement key with Alice's ephemeral key
  const dh2 = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: aliceEphemeralKey },
    bobIdentity.agreementPrivateKey,
    256
  )

  // DH3 = DH(SPKB, EKA)
  const dh3 = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: aliceEphemeralKey },
    bobSignedPreKeyPrivate,
    256
  )

  // DH4 = DH(OPKB, EKA) - if one-time prekey was used
  let dh4: ArrayBuffer | null = null
  if (bobOneTimePreKeyPrivate) {
    dh4 = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: aliceEphemeralKey },
      bobOneTimePreKeyPrivate,
      256
    )
  }

  // Combine DH outputs
  const dhOutputs = dh4
    ? concatBuffers([dh1, dh2, dh3, dh4])
    : concatBuffers([dh1, dh2, dh3])

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    dhOutputs,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  )

  // Derive the final shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('CrewWorkX3DH'),
    },
    keyMaterial,
    256
  )

  // Derive session key
  const sessionKey = await deriveSessionKey(
    sharedSecret,
    'initial',
    aliceIdentityKeyBase64
  )

  return {
    sharedSecret,
    sessionKey,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function concatBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((acc, buf) => acc + buf.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  }

  return result.buffer
}

// ============================================================================
// Server Integration (Supabase)
// ============================================================================

/**
 * Upload prekey bundle to server.
 *
 * Stores identity key + signed prekey + signature in profiles,
 * and one-time prekeys in the prekeys table.
 */
export async function uploadPreKeyBundle(
  bundle: PreKeyBundle,
  preKeys: Array<{ id: string; publicKey: string }>
): Promise<void> {
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    throw new Error('Not authenticated')
  }

  // Update profile with identity key and signed prekey bundle
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      public_key: bundle.identityKey,
      prekey_bundle: {
        signedPreKey: bundle.signedPreKey,
        preKeySignature: bundle.preKeySignature,
        identitySigningKey: bundle.identitySigningKey,
      },
    })
    .eq('id', user.id)

  if (profileError) {
    throw new Error(`Failed to update profile: ${profileError.message}`)
  }

  // Insert one-time prekeys into prekeys table
  if (preKeys.length > 0) {
    const { error: prekeysError } = await supabase
      .from('prekeys')
      .insert(
        preKeys.map((pk) => ({
          user_id: user.id,
          public_key: pk.publicKey,
        }))
      )

    if (prekeysError) {
      throw new Error(`Failed to insert prekeys: ${prekeysError.message}`)
    }
  }
}

/**
 * Fetch prekey bundle from server for a user.
 *
 * Returns the identity key, signed prekey, signature, and one unused one-time prekey.
 */
export async function fetchPreKeyBundle(userId: string): Promise<PreKeyBundle | null> {
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  // Fetch profile's identity key and signed prekey bundle
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('public_key, prekey_bundle')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    throw new Error(`Failed to fetch profile: ${profileError?.message || 'Not found'}`)
  }

  if (!profile.public_key || !profile.prekey_bundle) {
    return null // User hasn't published a prekey bundle
  }

  // Fetch one unused one-time prekey
  const { data: preKey, error: preKeyError } = await supabase
    .from('prekeys')
    .select('id, public_key')
    .eq('user_id', userId)
    .eq('used', false)
    .limit(1)
    .single()

  if (preKeyError && preKeyError.code !== 'PGRST116') { // PGRST116 = no rows found
    throw new Error(`Failed to fetch prekey: ${preKeyError.message}`)
  }

  // Mark the one-time prekey as used (atomic: only if still unused)
  if (preKey) {
    const { error: markError } = await supabase
      .from('prekeys')
      .update({ used: true })
      .eq('id', preKey.id)
      .eq('used', false)

    if (markError) {
      throw new Error(`Failed to mark prekey as used: ${markError.message}`)
    }
  }

  const bundle = profile.prekey_bundle as Record<string, string>

  return {
    identityKey: profile.public_key,
    identitySigningKey: bundle.identitySigningKey || '',
    signedPreKey: bundle.signedPreKey,
    preKeySignature: bundle.preKeySignature,
    oneTimePreKey: preKey?.public_key,
  }
}

// ============================================================================
// Public Key Management
// ============================================================================

/**
 * Upload the user's identity public key to the server.
 *
 * Simple function to store the public key in the profiles table.
 */
export async function uploadPublicKey(publicKeyBase64: string): Promise<void> {
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    throw new Error('Not authenticated')
  }

  const { error } = await supabase
    .from('profiles')
    .update({ public_key: publicKeyBase64 })
    .eq('id', user.id)

  if (error) {
    throw new Error(`Failed to upload public key: ${error.message}`)
  }
}
