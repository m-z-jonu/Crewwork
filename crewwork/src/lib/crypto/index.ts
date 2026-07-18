/**
 * CrewWork E2EE - Main Export
 *
 * This module provides the public API for end-to-end encryption.
 * Import from here to use E2EE in your components.
 *
 * Usage:
 *   import { encryptForStorage, decryptFromStorage, isEncrypted } from '@/lib/crypto'
 */

// Key management
export {
  generateIdentityKeyPair,
  getIdentityKeyPair,
  getPublicKeyBase64,
  generatePreKeys,
  getUnusedPreKey,
  markPreKeyUsed,
  deriveSessionKey,
  getSessionKey,
  canonicalPair,
  deleteAllKeys,
} from './keys'

export type { IdentityKeyPair, PreKey, SessionKey } from './keys'

// Encryption/Decryption
export {
  encryptMessage,
  decryptMessage,
  encryptForStorage,
  decryptFromStorage,
  encryptForStorageV2,
  decryptFromStorageV2,
  isEncrypted,
  batchDecrypt,
  generateMessageKey,
  encryptBlob,
  decryptBlob,
} from './encrypt'

export type { CipherEnvelope } from './encrypt'

// Key Exchange (X3DH)
export {
  generatePreKeyBundle,
  performX3DH,
  performX3DHAsBob,
  uploadPreKeyBundle,
  fetchPreKeyBundle,
  uploadPublicKey,
} from './exchange'

export type { PreKeyBundle, KeyExchangeResult } from './exchange'

// Channel Key Management
export {
  generateChannelKey,
  getChannelKey,
  storeChannelKey,
  removeChannelKey,
} from './channel'

// Recovery (multi-device key sync)
export {
  deriveRecoveryKey,
  encryptIdentityForBackup,
  decryptIdentityFromBackup,
} from './recovery'

// Double Ratchet (per-message key derivation for forward secrecy)
export {
  initializeRatchet,
  ratchetEncrypt,
  ratchetDecrypt,
  loadRatchetState,
  saveRatchetState,
  kdfChain,
  kdfRoot,
  ratchetStep,
} from './double-ratchet'

export type { RatchetState, RatchetEnvelope, RatchetHeader } from './double-ratchet'

// Key Verification
export {
  generateSafetyNumber,
  generateVerificationQR,
  parseVerificationQR,
  generateVerificationVisual,
} from './verify'

// Metadata Minimization
export {
  generateAnonymousSenderId,
  minimizeTimestamp,
  truncateTimestamp,
  encryptMetadata,
  decryptMetadata,
  sanitizeMetadata,
} from './metadata'

// Key Rotation
export {
  checkAndRotatePrekeys,
  initKeyRotation,
} from './rotation'
