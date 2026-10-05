import type { SupabaseClient } from '@supabase/supabase-js'
import type { Contact, Profile } from '@/types/database'

export const CONTACT_SELECT = '*, contact_profile:profiles!contact_id(*)'

/**
 * Supabase/PostgREST errors are plain objects ({ code, message, details, hint }),
 * not Error instances — surface their real message instead of a generic string.
 */
export function contactErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object') {
    const e = err as { code?: string; message?: string }
    if (e.code === '23505') return 'You have already sent this person a request.'
    if (typeof e.message === 'string' && e.message.trim()) return e.message
    if (typeof e.code === 'string' && e.code.trim()) return `Request failed (${e.code})`
  }
  return 'Something went wrong. Please try again.'
}

/**
 * Insert a pending contact request. If the unique constraint says the row
 * already exists (23505 — request sent in a previous session), fetch the
 * existing row instead of failing, so the UI can sync to the true state.
 */
export async function sendContactRequest(
  client: SupabaseClient,
  me: Profile,
  profile: Profile
): Promise<{ row: Contact | null; alreadyExisted: boolean; error: string | null }> {
  const { data, error } = await client
    .from('contacts')
    .insert({ user_id: me.id, contact_id: profile.id, status: 'pending' })
    .select(CONTACT_SELECT)
    .single()

  if (!error) {
    return { row: data as Contact | null, alreadyExisted: false, error: null }
  }

  if ((error as { code?: string }).code === '23505') {
    const { data: existing, error: fetchError } = await client
      .from('contacts')
      .select(CONTACT_SELECT)
      .eq('user_id', me.id)
      .eq('contact_id', profile.id)
      .maybeSingle()
    if (!fetchError && existing) {
      return { row: existing as Contact, alreadyExisted: true, error: null }
    }
  }

  return { row: null, alreadyExisted: false, error: contactErrorMessage(error) }
}

/**
 * Accept a received request: mark the requester's row accepted and upsert the
 * reverse row. Both operations are checked — a silent 0-row update previously
 * left the two sides permanently asymmetric.
 */
export async function acceptContactRequest(
  client: SupabaseClient,
  me: Profile,
  request: Contact
): Promise<{ reverseContact: Contact | null; error: string | null }> {
  const { data: updated, error: updateError } = await client
    .from('contacts')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'pending')
    .select('id')

  if (updateError) return { reverseContact: null, error: contactErrorMessage(updateError) }
  if (!updated || updated.length === 0) {
    return { reverseContact: null, error: 'Could not accept this request — it may no longer be pending.' }
  }

  const { data: reverse, error: reverseError } = await client
    .from('contacts')
    .upsert(
      { user_id: me.id, contact_id: request.user_id, status: 'accepted' },
      { onConflict: 'user_id,contact_id' }
    )
    .select(CONTACT_SELECT)
    .single()

  if (reverseError) return { reverseContact: null, error: contactErrorMessage(reverseError) }
  return { reverseContact: reverse as Contact, error: null }
}
