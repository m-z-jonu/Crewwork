/* Discriminate: does recipient SELECT fail due to missing policy branch or null auth.uid()? */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const stamp = Date.now()
const PW = 'QaProbe123!'

const { data: a } = await admin.auth.admin.createUser({ email: `d-a-${stamp}@example.com`, password: PW, email_confirm: true, user_metadata: { display_name: 'D Alpha' } })
const { data: b } = await admin.auth.admin.createUser({ email: `d-b-${stamp}@example.com`, password: PW, email_confirm: true, user_metadata: { display_name: 'D Beta' } })

async function login(email) {
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PW })
  if (error) throw error
  return c
}
const ca = await login(`d-a-${stamp}@example.com`)
const cb = await login(`d-b-${stamp}@example.com`)

// 1. who am I (sanity)
const whoB = await cb.auth.getUser()
console.log('B auth.uid via getUser:', whoB.data.user?.id, '=== b.user.id:', b.user.id)

// 2. A inserts pending -> B
const ins = await ca.from('contacts').insert({ user_id: a.user.id, contact_id: b.user.id, status: 'pending' }).select().single()
console.log('insert:', ins.error ? ins.error.message : 'ok', ins.data?.id)

// 3. A selects their OWN sent row (tests uid + user_id branch)
const aOwn = await ca.from('contacts').select('id,status').eq('user_id', a.user.id)
console.log('A own-row select:', JSON.stringify(aOwn.error), 'rows:', aOwn.data?.length)

// 4. B selects received (contact_id branch)
const bRecv = await cb.from('contacts').select('id,status').eq('contact_id', b.user.id)
console.log('B received select:', JSON.stringify(bRecv.error), 'rows:', bRecv.data?.length)

// 5. B tries a raw select with NO filters at all (policy-only visibility test)
const bAll = await cb.from('contacts').select('id,user_id,contact_id')
console.log('B all-rows select:', JSON.stringify(bAll.error), 'rows:', bAll.data?.length)

// 6. B update + ADMIN ground truth afterwards
const upd = await cb.from('contacts').update({ status: 'accepted' }).eq('id', ins.data.id).select()
console.log('B update .select():', JSON.stringify(upd.error), 'rows:', upd.data?.length)
const adminView = await admin.from('contacts').select('id,status').eq('id', ins.data.id)
console.log('ADMIN ground truth after B update:', JSON.stringify(adminView.data))

// 7. reverse: B inserts -> A, then A selects received (contact_id branch for A)
const ins2 = await cb.from('contacts').insert({ user_id: b.user.id, contact_id: a.user.id, status: 'pending' }).select().single()
console.log('B insert to A:', ins2.error ? ins2.error.message : 'ok')
const aRecv = await ca.from('contacts').select('id,status').eq('contact_id', a.user.id)
console.log('A received select:', JSON.stringify(aRecv.error), 'rows:', aRecv.data?.length)

await admin.auth.admin.deleteUser(a.user.id)
await admin.auth.admin.deleteUser(b.user.id)
console.log('cleanup done')
