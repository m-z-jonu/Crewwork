/**
 * CrewWork E2EE - Double Ratchet Algorithm
 *
 * Implements the Signal Protocol Double Ratchet for per-message key derivation.
 * Provides forward secrecy and post-compromise security for 1:1 DMs.
 *
 * Reference: https://signal.org/docs/specifications/doubleratchet/
 *
 * Key hierarchy:
 *   Root Key (RK) → KDF Root → New RK + Chain Key (CK)
 *   Chain Key (CK) → KDF Chain → New CK + Message Key (MK)
 *   Message Key (MK) → AES-256-GCM → encrypt/decrypt message
 *
 * Two ratcheting mechanisms:
 *   1. Symmetric ratchet: chain key advances on every send/receive
 *   2. DH ratchet: root key rekeyed when new DH public key received
 */

// ============================================================================
// Types
// ============================================================================

/** Double Ratchet state for a single 1:1 conversation. */
export interface RatchetState {
  // Root chain
  rootKey: CryptoKey

  // Sending chain
  sendingChainKey: CryptoKey | null
  sendingMessageNumber: number

  // Receiving chain
  receivingChainKey: CryptoKey | null
  receivingMessageNumber: number
  receivingPreviousChainLength: number

  // DH ratchet
  currentDHKeyPair: CryptoKeyPair | null
  remotePublicKey: CryptoKey | null

  // Metadata
  channelId: string
  partnerId: string
  lastRatchetTimestamp: string
}

/** Ratchet-encrypted message envelope (extends CipherEnvelope). */
export interface RatchetEnvelope {
  version: 2
  algorithm: 'AES-GCM'

  // DH ratchet public key (if ratchet step occurred)
  dhPublicKey: string | null

  // Previous chain info (for out-of-order messages)
  previousChainLength: number

  // Message position in current chain
  messageNumber: number

  // Encrypted content
  nonce: string
  ciphertext: string

  // Timestamp
  timestamp: string
}

/** Ratchet header sent alongside messages for key derivation. */
export interface RatchetHeader {
  dhPublicKey: string | null
  previousChainLength: number
  messageNumber: number
}

// ============================================================================
// Constants
// ============================================================================

const RATCHET_STATE_STORE = 'crewwork-ratchet-states'

// ============================================================================
// IndexedDB Helpers (mirrors keys.ts pattern)
// ============================================================================

function openRatchetDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('CrewWorkRatchet', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(RATCHET_STATE_STORE)) {
        db.createObjectStore(RATCHET_STATE_STORE, { keyPath: 'id' })
      }
    }
  })
}

async function getKeyFromStore<T>(storeName: string, id: string): Promise<T | null> {
  const ratchetDB = await openRatchetDB()
  return new Promise((resolve, reject) => {
    const tx = ratchetDB.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.get(id)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

async function putKeyInStore<T>(storeName: string, id: string, value: T): Promise<void> {
  const ratchetDB = await openRatchetDB()
  return new Promise((resolve, reject) => {
    const tx = ratchetDB.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const request = store.put({ id, ...value })
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

async function hmacSha256(key: ArrayBuffer, data: Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, data as unknown as ArrayBuffer)
}

async function cryptoKeysEqual(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const aRaw = await crypto.subtle.exportKey('raw', a)
  const bRaw = await crypto.subtle.exportKey('raw', b)
  const aBytes = new Uint8Array(aRaw)
  const bBytes = new Uint8Array(bRaw)
  if (aBytes.length !== bBytes.length) return false
  // Constant-time comparison to prevent timing side-channel attacks
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i]
  }
  return diff === 0
}

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
// Key Derivation Functions
// ============================================================================

/**
 * KDF Chain: Derive next chain key and message key from current chain key.
 *
 * Uses HMAC-SHA256 as per Signal Protocol:
 *   CK_next = HMAC-SHA256(CK, 0x01)
 *   MK      = HMAC-SHA256(CK, 0x02)
 */
export async function kdfChain(
  chainKey: CryptoKey
): Promise<{ nextChainKey: CryptoKey; messageKey: ArrayBuffer }> {
  const ckRaw = await crypto.subtle.exportKey('raw', chainKey)

  // Next chain key: HMAC-SHA256(CK, 0x01)
  const nextCkBytes = await hmacSha256(ckRaw, new Uint8Array([0x01]))
  const nextChainKey = await crypto.subtle.importKey(
    'raw',
    nextCkBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )

  // Message key: HMAC-SHA256(CK, 0x02)
  const messageKey = await hmacSha256(ckRaw, new Uint8Array([0x02]))

  return { nextChainKey, messageKey }
}

/**
 * KDF Root: Derive new root key and chain key from DH output + current root key.
 *
 * Uses HKDF-SHA256:
 *   [RK_next, CK] = HKDF(DH_output, salt=RK, info="CrewWorkRatchet")
 *
 * @param dhOutput - Raw DH shared secret (ArrayBuffer)
 * @param currentRootKey - Current root key (CryptoKey)
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

  // Derive 512 bits: first 256 = new root key, next 256 = chain key
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
 * If remotePublicKey is provided (initiator side), performs an initial
 * DH ratchet step to derive the sending chain key.
 *
 * @param sharedSecret - The X3DH shared secret (ArrayBuffer, 32 bytes)
 * @param channelId - Conversation/channel ID
 * @param partnerId - Remote party's user ID
 * @param isAlice - true if we initiated the conversation
 * @param remotePublicKey - Optional remote DH public key (from X3DH bundle) for initial ratchet step
 */
export async function initializeRatchet(
  sharedSecret: ArrayBuffer,
  channelId: string,
  partnerId: string,
  isAlice: boolean,
  remotePublicKey?: CryptoKey
): Promise<RatchetState> {
  // Import shared secret as root key
  const rootKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )

  // Generate initial DH key pair (P-256, matching existing X3DH)
  const dhKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )

  // If remote public key is available (initiator), derive initial sending chain
  if (remotePublicKey) {
    const dhOutput = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: remotePublicKey },
      dhKeyPair.privateKey,
      256
    )

    const { nextRootKey, chainKey } = await kdfRoot(dhOutput, rootKey)

    return {
      rootKey: nextRootKey,
      sendingChainKey: chainKey,
      sendingMessageNumber: 0,
      receivingChainKey: null,
      receivingMessageNumber: 0,
      receivingPreviousChainLength: 0,
      currentDHKeyPair: dhKeyPair,
      remotePublicKey,
      channelId,
      partnerId,
      lastRatchetTimestamp: new Date().toISOString(),
    }
  }

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
 * Generates a new DH key pair and derives a sending chain key if a remote
 * public key is available.
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

  if (state.remotePublicKey) {
    // DH(new_private, remote_public)
    const dhOutput = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: state.remotePublicKey },
      newKeyPair.privateKey,
      256
    )

    // KDF Root → new root key + sending chain key
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
 * Derives a message key from the sending chain, encrypts with AES-256-GCM,
 * and returns the envelope plus updated state.
 */
export async function ratchetEncrypt(
  plaintext: string,
  state: RatchetState
): Promise<{ envelope: RatchetEnvelope; state: RatchetState }> {
  // If no sending chain, perform ratchet step
  if (!state.sendingChainKey) {
    state = await ratchetStep(state)
  }

  // If still no sending chain after ratchet step, we can't encrypt
  // (remote public key not yet established)
  if (!state.sendingChainKey) {
    throw new Error(
      'No sending chain key — remote public key not established. ' +
      'Ensure X3DH key exchange is complete before sending ratchet messages.'
    )
  }

  // Derive message key from sending chain
  const { nextChainKey, messageKey } = await kdfChain(state.sendingChainKey)

  // Import message key for AES-GCM
  const messageKeyCrypto = await crypto.subtle.importKey(
    'raw',
    messageKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  // Encrypt
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
 * Handles:
 * 1. DH ratchet step when a new remote public key is received
 * 2. Skipping chain keys for out-of-order messages
 * 3. Message key derivation and AES-GCM decryption
 */
export async function ratchetDecrypt(
  envelope: RatchetEnvelope,
  state: RatchetState
): Promise<{ plaintext: string; state: RatchetState }> {
  let currentState = { ...state }

  // Check if we need a DH ratchet step (new remote public key)
  if (envelope.dhPublicKey) {
    const remotePubKey = await crypto.subtle.importKey(
      'raw',
      base64ToBuffer(envelope.dhPublicKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    )

    // If new remote public key, perform receiving ratchet step
    if (
      !currentState.remotePublicKey ||
      !(await cryptoKeysEqual(remotePubKey, currentState.remotePublicKey))
    ) {
      const previousChainLength = currentState.receivingMessageNumber

      // If current DH private key is not available (not persisted for security V-04),
      // generate a fresh key pair to perform the DH operation.
      let dhKeyPair = currentState.currentDHKeyPair
      if (!dhKeyPair || !dhKeyPair.privateKey) {
        dhKeyPair = await crypto.subtle.generateKey(
          { name: 'ECDH', namedCurve: 'P-256' },
          true,
          ['deriveKey', 'deriveBits']
        )
      }

      // DH(current_private, remote_public)
      const dhOutput = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: remotePubKey },
        dhKeyPair.privateKey,
        256
      )

      const { nextRootKey, chainKey } = await kdfRoot(dhOutput, currentState.rootKey)

      currentState = {
        ...currentState,
        rootKey: nextRootKey,
        receivingChainKey: chainKey,
        receivingMessageNumber: 0,
        receivingPreviousChainLength: previousChainLength,
        currentDHKeyPair: dhKeyPair,
        remotePublicKey: remotePubKey,
        lastRatchetTimestamp: new Date().toISOString(),
      }
    }
  }

  // Handle out-of-order messages: skip forward in receiving chain
  if (
    envelope.messageNumber > currentState.receivingMessageNumber &&
    currentState.receivingChainKey
  ) {
    const skipCount = envelope.messageNumber - currentState.receivingMessageNumber
    let chainKey = currentState.receivingChainKey
    for (let i = 0; i < skipCount; i++) {
      const { nextChainKey } = await kdfChain(chainKey)
      chainKey = nextChainKey
    }
    currentState = {
      ...currentState,
      receivingChainKey: chainKey,
      receivingMessageNumber: envelope.messageNumber,
    }
  }

  // Derive message key
  if (!currentState.receivingChainKey) {
    throw new Error('No receiving chain key — cannot decrypt')
  }

  const { nextChainKey, messageKey } = await kdfChain(currentState.receivingChainKey)

  // Import message key for AES-GCM
  const messageKeyCrypto = await crypto.subtle.importKey(
    'raw',
    messageKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  // Decrypt
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
    ...currentState,
    receivingChainKey: nextChainKey,
    receivingMessageNumber: currentState.receivingMessageNumber + 1,
    lastRatchetTimestamp: new Date().toISOString(),
  }

  return { plaintext, state: newState }
}

// ============================================================================
// State Persistence
// ============================================================================

/**
 * Save ratchet state to IndexedDB.
 *
 * Exports CryptoKeys to JWK format for structured storage.
 */
export async function saveRatchetState(state: RatchetState): Promise<void> {
  const exportable: Record<string, unknown> = {
    ...state,
    rootKey: await crypto.subtle.exportKey('jwk', state.rootKey),
    sendingChainKey: state.sendingChainKey
      ? await crypto.subtle.exportKey('jwk', state.sendingChainKey)
      : null,
    receivingChainKey: state.receivingChainKey
      ? await crypto.subtle.exportKey('jwk', state.receivingChainKey)
      : null,
    // DH private key is NOT exported — kept in memory only to prevent
    // IndexedDB extraction via XSS or browser extension attacks
    currentDHKeyPair: state.currentDHKeyPair
      ? {
          publicKey: await crypto.subtle.exportKey('jwk', state.currentDHKeyPair.publicKey),
        }
      : null,
    remotePublicKey: state.remotePublicKey
      ? await crypto.subtle.exportKey('jwk', state.remotePublicKey)
      : null,
  }

  await putKeyInStore(
    RATCHET_STATE_STORE,
    `${state.channelId}:${state.partnerId}`,
    exportable
  )
}

/**
 * Load ratchet state from IndexedDB.
 *
 * Returns null if no state exists for this conversation.
 */
export async function loadRatchetState(
  channelId: string,
  partnerId: string
): Promise<RatchetState | null> {
  const stored = await getKeyFromStore<{
    rootKey: JsonWebKey
    sendingChainKey: JsonWebKey | null
    receivingChainKey: JsonWebKey | null
    currentDHKeyPair: { publicKey: JsonWebKey } | null
    remotePublicKey: JsonWebKey | null
    sendingMessageNumber: number
    receivingMessageNumber: number
    receivingPreviousChainLength: number
    channelId: string
    partnerId: string
    lastRatchetTimestamp: string
  }>(RATCHET_STATE_STORE, `${channelId}:${partnerId}`)

  if (!stored) return null

  // DH private keys are not persisted in IndexedDB (security fix V-04).
  // currentDHKeyPair is always null on load — the ratchet will generate a
  // fresh DH key pair on the next step and derive a new sending chain from
  // the remote public key if one exists.

  return {
    rootKey: await crypto.subtle.importKey(
      'jwk',
      stored.rootKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    ),
    sendingChainKey: stored.sendingChainKey
      ? await crypto.subtle.importKey(
          'jwk',
          stored.sendingChainKey,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign', 'verify']
        )
      : null,
    receivingChainKey: stored.receivingChainKey
      ? await crypto.subtle.importKey(
          'jwk',
          stored.receivingChainKey,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign', 'verify']
        )
      : null,
    currentDHKeyPair: null,  // DH private keys not persisted (V-04 fix)
    remotePublicKey: stored.remotePublicKey
      ? await crypto.subtle.importKey(
          'jwk',
          stored.remotePublicKey,
          { name: 'ECDH', namedCurve: 'P-256' },
          false,
          []
        )
      : null,
    sendingMessageNumber: stored.sendingMessageNumber,
    receivingMessageNumber: stored.receivingMessageNumber,
    receivingPreviousChainLength: stored.receivingPreviousChainLength,
    channelId: stored.channelId,
    partnerId: stored.partnerId,
    lastRatchetTimestamp: stored.lastRatchetTimestamp,
  }
}
