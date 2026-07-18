import { type IdentityKeyPair } from './keys'

// Derive recovery key from password using PBKDF2
export async function deriveRecoveryKey(
  password: string,
  salt: string
): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 600000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// Encrypt identity key for server storage
export async function encryptIdentityForBackup(
  identityKey: IdentityKeyPair,
  password: string
): Promise<{
  encryptedData: string
  salt: string
  iv: string
}> {
  const salt = crypto.randomUUID()
  const recoveryKey = await deriveRecoveryKey(password, salt)

  // Export all keys as JWK
  const data = {
    signingPublic: await crypto.subtle.exportKey('jwk', identityKey.publicKey),
    signingPrivate: await crypto.subtle.exportKey('jwk', identityKey.privateKey),
    agreementPublic: await crypto.subtle.exportKey('jwk', identityKey.agreementPublicKey),
    agreementPrivate: await crypto.subtle.exportKey('jwk', identityKey.agreementPrivateKey),
    publicKeyBase64: identityKey.publicKeyBase64,
    agreementPublicKeyBase64: identityKey.agreementPublicKeyBase64,
    createdAt: identityKey.createdAt,
  }

  const encoder = new TextEncoder()
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    recoveryKey,
    encoder.encode(JSON.stringify(data))
  )

  function bufToBase64(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
  }

  return {
    encryptedData: bufToBase64(encrypted),
    salt,
    iv: bufToBase64(iv as unknown as ArrayBuffer),
  }
}

// Decrypt identity key from server backup
export async function decryptIdentityFromBackup(
  backup: {
    encryptedData: string
    salt: string
    iv: string
  },
  password: string
): Promise<IdentityKeyPair> {
  const recoveryKey = await deriveRecoveryKey(password, backup.salt)
  const decoder = new TextDecoder()

  function base64ToBuf(b64: string): ArrayBuffer {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.buffer
  }

  const iv = new Uint8Array(base64ToBuf(backup.iv))

  // Decrypt data
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    recoveryKey,
    base64ToBuf(backup.encryptedData)
  )
  const data = JSON.parse(decoder.decode(decrypted))

  // Import signing keys (Ed25519)
  const signingPrivateKey = await crypto.subtle.importKey('jwk', data.signingPrivate, { name: 'Ed25519' }, true, ['sign'])
  const signingPublicKey = await crypto.subtle.importKey('jwk', data.signingPublic, { name: 'Ed25519' }, true, ['verify'])

  // Import agreement keys (ECDH P-256)
  const agreementPrivateKey = await crypto.subtle.importKey('jwk', data.agreementPrivate, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'])
  const agreementPublicKey = await crypto.subtle.importKey('jwk', data.agreementPublic, { name: 'ECDH', namedCurve: 'P-256' }, true, [])

  return {
    publicKey: signingPublicKey,
    privateKey: signingPrivateKey,
    publicKeyBase64: data.publicKeyBase64,
    agreementPublicKey,
    agreementPrivateKey,
    agreementPublicKeyBase64: data.agreementPublicKeyBase64,
    createdAt: data.createdAt,
  }
}
