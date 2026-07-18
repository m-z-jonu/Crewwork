# CrewWork E2EE Implementation Plan

## Current State

E2EE **core is implemented and working**:
- `src/lib/crypto/keys.ts` — Identity key (Ed25519), pre-keys (ECDH P-256), session keys (AES-256-GCM) stored in IndexedDB
- `src/lib/crypto/encrypt.ts` — Message encrypt/decrypt via AES-256-GCM with CipherEnvelope format
- `src/lib/crypto/exchange.ts` — X3DH key agreement (full DH logic implemented, server integration stubbed)
- `src/lib/local/sync.ts` — Messages encrypted before IndexedDB storage, decrypted on read
- Build passes. Messages are E2EE.

**Gaps to close:** file attachment encryption, X3DH server integration, multi-device key sync, channel key distribution.

---

## Task 1: File Attachment Encryption

### Problem
Files are stored as raw `Blob` in IndexedDB (`db.files`) and uploaded raw to Supabase Storage. No encryption.

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/crypto/encrypt.ts` | Add `encryptBlob()` and `decryptBlob()` functions |
| `src/lib/local/sync.ts` | Add `storeEncryptedFile()` and `getDecryptedFile()` |
| `src/components/chat/message-input.tsx` | Encrypt blob before `db.files.put()`, encrypt before Supabase upload |
| `src/app/api/upload/route.ts` | Accept encrypted blob (ciphertext + metadata) instead of raw file |

### Function Signatures

```typescript
// src/lib/crypto/encrypt.ts — ADD

/**
 * Encrypt a file blob using AES-256-GCM.
 * Returns encrypted blob envelope as ArrayBuffer (nonce + ciphertext).
 */
export async function encryptBlob(
  blob: Blob,
  key: CryptoKey
): Promise<{ ciphertext: ArrayBuffer; nonce: Uint8Array }>

/**
 * Decrypt an encrypted file blob.
 */
export async function decryptBlob(
  ciphertext: ArrayBuffer,
  nonce: Uint8Array,
  key: CryptoKey
): Promise<Blob>
```

```typescript
// src/lib/local/sync.ts — ADD

/**
 * Encrypt and store a file blob in IndexedDB.
 * Returns the encrypted blob envelope for Supabase upload.
 */
export async function storeEncryptedFile(params: {
  id: string
  message_id: string
  name: string
  blob: Blob
  type: string
  channelId: string
  senderId: string
}): Promise<{ encryptedBlob: ArrayBuffer; nonce: Uint8Array; key: CryptoKey }>

/**
 * Retrieve and decrypt a file blob from IndexedDB.
 */
export async function getDecryptedFile(
  fileId: string,
  channelId: string,
  senderId: string
): Promise<Blob | null>
```

### Implementation Steps

1. **Add `encryptBlob` / `decryptBlob` to `encrypt.ts`**
   - Use existing `generateMessageKey()` or accept a `CryptoKey`
   - 12-byte random nonce (same pattern as `encryptMessage`)
   - Return `{ ciphertext, nonce }` — caller stores both

2. **Update `LocalFile` interface in `db.ts`**
   ```typescript
   export interface LocalFile {
     id: string
     message_id: string
     name: string
     blob: Blob          // encrypted blob envelope (nonce prepended to ciphertext)
     type: string
     synced: boolean
     channelId: string   // NEW — needed for key derivation
     senderId: string    // NEW — needed for key derivation
   }
   ```
   - Migration: `db.version(2)` with updated schema

3. **Add `storeEncryptedFile` / `getDecryptedFile` to `sync.ts`**
   - `storeEncryptedFile`: derive session key via `getSessionKey(channelId, senderId)`, encrypt blob, store in IndexedDB, return envelope for upload
   - `getDecryptedFile`: read from IndexedDB, decrypt with session key

4. **Update `message-input.tsx` `uploadFiles()`**
   - After `file.arrayBuffer()`, call `storeEncryptedFile()` instead of raw `db.files.put()`
   - For Supabase upload: send encrypted blob envelope (not raw file)

5. **Update `api/upload/route.ts`**
   - Accept `encrypted_blob` (ArrayBuffer) + `nonce` (base64) + `key_version` instead of raw `File`
   - Store encrypted blob in Supabase Storage (it's already ciphertext)
   - Return URL pointing to encrypted blob

6. **Update file display components** to call `getDecryptedFile()` before rendering

### Database Changes
- `db.version(2)`: add `channelId` and `senderId` to `files` store
- No Supabase schema changes (files stored as opaque blobs)

---

## Task 2: X3DH Server Integration

### Problem
`exchange.ts` has `uploadPreKeyBundle()` and `fetchPreKeyBundle()` as stubs (just `console.log`). The profiles table already has `public_key` and `prekey_bundle` columns.

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/crypto/exchange.ts` | Implement `uploadPreKeyBundle()` and `fetchPreKeyBundle()` using Supabase |
| `src/lib/supabase/client.ts` | Export Supabase client (already exists, verify import) |
| `src/lib/supabase/migrations.ts` | Add `prekeys` table for one-time prekeys |
| Signup flow | Upload public key + prekey bundle on account creation |

### Function Signatures

```typescript
// src/lib/crypto/exchange.ts — REPLACE stubs

/**
 * Upload prekey bundle + one-time prekeys to Supabase.
 * Stores bundle in profiles table, one-time prekeys in prekeys table.
 */
export async function uploadPreKeyBundle(
  bundle: PreKeyBundle,
  preKeys: Array<{ id: string; publicKey: string }>
): Promise<void>

/**
 * Fetch a user's prekey bundle from Supabase.
 * Consumes one one-time prekey (marks as used).
 */
export async function fetchPreKeyBundle(userId: string): Promise<PreKeyBundle | null>

/**
 * Upload the user's identity public key to their profile.
 * Called after key generation or on profile update.
 */
export async function uploadPublicKey(publicKeyBase64: string): Promise<void>
```

### SQL Changes — New `prekeys` Table

```sql
CREATE TABLE IF NOT EXISTS prekeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  public_key text NOT NULL,
  used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- RLS: users can read any prekey, only mark own as used
ALTER TABLE prekeys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read prekeys"
  ON prekeys FOR SELECT
  USING (true);

CREATE POLICY "Users can mark own prekeys as used"
  ON prekeys FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own prekeys"
  ON prekeys FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

### Implementation Steps

1. **Add `prekeys` table migration** to `migrations.ts` (append to migrations array)

2. **Implement `uploadPreKeyBundle()`**
   ```typescript
   const supabase = getSupabaseClient()
   const { data: { user } } = await supabase.auth.getUser()
   if (!user) throw new Error('Not authenticated')

   // Store bundle in profiles
   await supabase.from('profiles').update({
     public_key: bundle.identityKey,
     prekey_bundle: {
       signedPreKey: bundle.signedPreKey,
       preKeySignature: bundle.preKeySignature,
     }
   }).eq('id', user.id)

   // Store one-time prekeys
   if (preKeys.length > 0) {
     await supabase.from('prekeys').insert(
       preKeys.map(pk => ({
         id: pk.id,
         user_id: user.id,
         public_key: pk.publicKey,
       }))
     )
   }
   ```

3. **Implement `fetchPreKeyBundle()`**
   ```typescript
   const supabase = getSupabaseClient()

   // Fetch profile
   const { data: profile } = await supabase
     .from('profiles')
     .select('public_key, prekey_bundle')
     .eq('id', userId)
     .single()

   if (!profile?.public_key || !profile?.prekey_bundle) return null

   // Fetch one unused one-time prekey
   const { data: otPreKey } = await supabase
     .from('prekeys')
     .select('id, public_key')
     .eq('user_id', userId)
     .eq('used', false)
     .limit(1)
     .single()

   // Mark it as used
   if (otPreKey) {
     await supabase
       .from('prekeys')
       .update({ used: true })
       .eq('id', otPreKey.id)
   }

   return {
     identityKey: profile.public_key,
     signedPreKey: profile.prekey_bundle.signedPreKey,
     preKeySignature: profile.prekey_bundle.preKeySignature,
     oneTimePreKey: otPreKey?.public_key,
   }
   ```

4. **Implement `uploadPublicKey()`**
   ```typescript
   const supabase = getSupabaseClient()
   const { data: { user } } = await supabase.auth.getUser()
   if (!user) throw new Error('Not authenticated')

   await supabase.from('profiles').update({
     public_key: publicKeyBase64
   }).eq('id', user.id)
   ```

5. **Hook into signup flow**
   - After `generateIdentityKeyPair()`, call `generatePreKeyBundle()`, then `uploadPreKeyBundle()`
   - Find the signup/auth callback and add this logic

### Integration Point
Find where user profile is created after auth (likely in `src/lib/supabase/provisioner.ts` or auth callback) and add:
```typescript
// After profile creation:
const bundle = await generatePreKeyBundle()
await uploadPreKeyBundle(bundle.bundle, bundle.preKeys)
```

---

## Task 3: Multi-Device Key Synchronization

### Problem
When a user logs in on a new device, their identity key pair is in that device's IndexedDB only. They can't decrypt old messages.

### Approach: Password-Derived Recovery Key

Encrypt the identity key with a key derived from the user's password, store the encrypted bundle on Supabase.

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/lib/crypto/recovery.ts` | **NEW** — Key recovery module |
| `src/lib/supabase/migrations.ts` | Add `encrypted_identity` column to profiles |
| `src/lib/crypto/index.ts` | Export recovery functions |
| Signup/login flows | Encrypt identity on creation, decrypt on login |

### Function Signatures

```typescript
// src/lib/crypto/recovery.ts — NEW FILE

/**
 * Derive a recovery key from user's password using PBKDF2.
 */
export async function deriveRecoveryKey(
  password: string,
  salt: string
): Promise<CryptoKey>

/**
 * Encrypt identity key pair for server storage.
 * Returns encrypted bundle as JSON-serializable object.
 */
export async function encryptIdentityForBackup(
  identityKey: IdentityKeyPair,
  password: string
): Promise<{
  encryptedPrivateKey: string   // base64
  encryptedPublicKey: string    // base64
  salt: string                  // random salt for PBKDF2
  iv: string                    // base64 nonce for AES-GCM
}>

/**
 * Decrypt identity key pair from server backup.
 */
export async function decryptIdentityFromBackup(
  backup: {
    encryptedPrivateKey: string
    encryptedPublicKey: string
    salt: string
    iv: string
  },
  password: string
): Promise<IdentityKeyPair>
```

### SQL Changes — profiles table

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS identity_backup jsonb;
-- Stores: { encryptedPrivateKey, encryptedPublicKey, salt, iv }
-- Encrypted with password-derived key; server never sees plaintext
```

### Implementation Steps

1. **Create `src/lib/crypto/recovery.ts`**
   - `deriveRecoveryKey(password, salt)`: PBKDF2 with 600,000 iterations, SHA-256
   - `encryptIdentityForBackup()`: export private key as JWK, encrypt with recovery key via AES-GCM
   - `decryptIdentityFromBackup()`: decrypt, import JWK back to CryptoKey

2. **Add `identity_backup` column** to profiles table migration

3. **Hook into signup flow**
   - After generating identity key, call `encryptIdentityForBackup(identityKey, password)`
   - Store result in `profiles.identity_backup`

4. **Hook into login flow**
   - After login, check if `profiles.identity_backup` exists
   - If yes, prompt for password (or use stored session password), call `decryptIdentityFromBackup()`
   - Import decrypted keys into IndexedDB
   - If no backup exists, generate new identity key

5. **Update `deleteAllKeys()` in `keys.ts`**
   - Also clear `identity_backup` from server on account deletion

### Security Notes
- PBKDF2 with 600K iterations (OWASP 2023 recommendation)
- Salt is random 32 bytes, stored with the backup
- Server never sees the plaintext password or key — only the encrypted blob
- If user changes password, re-encrypt the backup

---

## Task 4: Channel Key Distribution

### Problem
For group channels, all members need the same encryption key. Currently `encryptForStorage` uses per-session keys which don't work for groups.

### Approach: Channel Secret Key

Derive a channel key from `channel_id` + workspace-level secret. All channel members receive the secret via X3DH key exchange with a "channel admin" or via a shared channel key.

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/lib/crypto/channel.ts` | **NEW** — Channel key management |
| `src/lib/crypto/encrypt.ts` | Update `encryptForStorage` to use channel keys for group channels |
| `src/lib/supabase/migrations.ts` | Add `channel_secret` column to channels table |

### Function Signatures

```typescript
// src/lib/crypto/channel.ts — NEW FILE

/**
 * Generate a new channel encryption key.
 * Called by channel creator.
 */
export async function generateChannelKey(): Promise<CryptoKey>

/**
 * Encrypt channel key for a specific member using their prekey bundle.
 * Returns encrypted key envelope for storage.
 */
export async function encryptChannelKeyForMember(
  channelKey: CryptoKey,
  memberId: string
): Promise<string>  // JSON CipherEnvelope

/**
 * Decrypt channel key from an encrypted envelope.
 * Called by channel member on join.
 */
export async function decryptChannelKey(
  encryptedKey: string,
  channelId: string
): Promise<CryptoKey>

/**
 * Get or derive channel key.
 * Checks IndexedDB cache first, then fetches from server.
 */
export async function getChannelKey(channelId: string): Promise<CryptoKey>
```

### SQL Changes — channels table

```sql
ALTER TABLE channels ADD COLUMN IF NOT EXISTS encrypted_channel_keys jsonb;
-- Stores: { [userId]: "encrypted_key_envelope_json" }
-- Each member's copy of the channel key, encrypted to their identity
```

### Implementation Steps

1. **Create `src/lib/crypto/channel.ts`**
   - `generateChannelKey()`: random AES-256-GCM key
   - `encryptChannelKeyForMember()`: use member's public key (from profiles) to encrypt channel key via ECDH
   - `decryptChannelKey()`: use own private key to decrypt
   - `getChannelKey()`: check IndexedDB → fetch from server → cache

2. **Add `encrypted_channel_keys` column** to channels table

3. **Update `encryptForStorage()` in `encrypt.ts`**
   - Check if channel is group (channel_members count > 2)
   - If group: use `getChannelKey(channelId)` instead of per-session key
   - If DM: keep existing per-session behavior

4. **Hook into channel creation**
   - After creating channel, generate key, encrypt for creator, store in `encrypted_channel_keys`

5. **Hook into channel join**
   - When user joins channel, existing member encrypts key for new member
   - Or: channel creator re-encrypts for all members

6. **Update channel member add/remove**
   - On add: encrypt channel key for new member
   - On remove: re-encrypt for remaining members (key rotation)

### Channel Key Rotation
- Triggered when member is removed
- New key generated, encrypted for all remaining members
- Old messages remain encrypted with old key (stored in session keys)

---

## Implementation Order

### Phase 1: File Encryption (Task 1)
1. Add `encryptBlob` / `decryptBlob` to `encrypt.ts`
2. Update `LocalFile` interface in `db.ts` (add `channelId`, `senderId`)
3. Add `storeEncryptedFile` / `getDecryptedFile` to `sync.ts`
4. Update `message-input.tsx` `uploadFiles()`
5. Update `api/upload/route.ts` to accept encrypted blobs
6. Update file display components

### Phase 2: X3DH Server Integration (Task 2)
1. Add `prekeys` table migration
2. Implement `uploadPreKeyBundle()` with Supabase
3. Implement `fetchPreKeyBundle()` with Supabase
4. Implement `uploadPublicKey()`
5. Hook into signup flow

### Phase 3: Multi-Device Key Sync (Task 3)
1. Create `src/lib/crypto/recovery.ts`
2. Add `identity_backup` column migration
3. Hook into signup (encrypt backup)
4. Hook into login (decrypt backup)
5. Update `deleteAllKeys()` to clear server backup

### Phase 4: Channel Key Distribution (Task 4)
1. Create `src/lib/crypto/channel.ts`
2. Add `encrypted_channel_keys` column migration
3. Update `encryptForStorage()` for group channels
4. Hook into channel creation/join
5. Implement key rotation on member removal

---

## Database Migration Summary

New tables:
```sql
-- One-time prekeys for X3DH
CREATE TABLE IF NOT EXISTS prekeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  public_key text NOT NULL,
  used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```

Alterations:
```sql
-- profiles: add identity backup for multi-device
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS identity_backup jsonb;

-- channels: store per-member encrypted channel keys
ALTER TABLE channels ADD COLUMN IF NOT EXISTS encrypted_channel_keys jsonb;
```

---

## Key Design Decisions

1. **CipherEnvelope format** reused for files (not new format) — consistency
2. **PBKDF2 600K iterations** for password-derived recovery key — OWASP compliant
3. **Channel keys stored per-member** encrypted — avoids key re-encryption on every message
4. **One-time prekeys consumed on fetch** — prevents replay, limits reuse
5. **Encrypted blobs stored in Supabase Storage** — server sees ciphertext only
6. **Backward compatibility** — `isEncrypted()` check allows legacy plaintext messages

---

## Risk Areas

| Risk | Mitigation |
|------|------------|
| Large file encryption perf | Stream encryption for files > 5MB (future enhancement) |
| Password change breaks recovery | Re-encrypt backup on password change |
| Channel key rotation complexity | Simple: new key + re-encrypt for all members |
| Prekey exhaustion | Monitor prekey count, regenerate when < 3 remaining |
| IndexedDB quota for encrypted blobs | Monitor storage usage, add cleanup for old files |
