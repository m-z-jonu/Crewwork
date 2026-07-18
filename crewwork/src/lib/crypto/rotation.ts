import { db } from '@/lib/local/db'
import { getIdentityKeyPair } from './keys'
import { uploadPreKeyBundle, generatePreKeyBundle } from './exchange'

const SIGNED_PREKEY_ROTATION_INTERVAL = 7 * 24 * 60 * 60 * 1000 // 7 days
const MIN_PREKEY_POOL_SIZE = 10
const PREKEY_UPLOAD_BATCH_SIZE = 50

export async function checkAndRotatePrekeys(): Promise<void> {
  const lastRotation = await db.settings.get('last_prekey_rotation')
  const now = Date.now()

  if (!lastRotation || now - parseInt(lastRotation.value) > SIGNED_PREKEY_ROTATION_INTERVAL) {
    try {
      const bundle = await generatePreKeyBundle()
      await uploadPreKeyBundle(bundle.bundle, bundle.preKeys)
      await db.settings.put({ key: 'last_prekey_rotation', value: now.toString() })
    } catch (error) {
      console.error('Prekey rotation failed')
    }
  }
}

export async function initKeyRotation(): Promise<void> {
  await checkAndRotatePrekeys()
}