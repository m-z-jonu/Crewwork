/* Contacts E2E: add → reload status persistence → accept flow.
   Run: node tests/contacts-e2e.mjs   (BASE default http://localhost:3000) */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const BASE = process.env.CONTACTTEST_BASE || 'http://localhost:3000'
const PW = 'QaContacts123!'
const stamp = Date.now()
const emailA = `qa-alpha-${stamp}@example.com`
const emailB = `qa-beta-${stamp}@example.com`
const nameA = `QA Alpha ${stamp}`
const nameB = `QA Beta ${stamp}`

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

async function main() {
  // ---- setup: two confirmed users + shared business workspace ----
  const { data: ua, error: ea } = await admin.auth.admin.createUser({
    email: emailA, password: PW, email_confirm: true, user_metadata: { display_name: nameA },
  })
  const { data: ub, error: eb } = await admin.auth.admin.createUser({
    email: emailB, password: PW, email_confirm: true, user_metadata: { display_name: nameB },
  })
  if (ea || eb) throw new Error(`signup failed: ${ea?.message || ''} ${eb?.message || ''}`)

  const { data: ws, error: wse } = await admin
    .from('workspaces')
    .insert({ name: 'QA Contacts WS', slug: `qa-contacts-${stamp}`, workspace_type: 'business' })
    .select()
    .single()
  if (wse) throw new Error(`workspace create failed: ${wse.message}`)
  await admin.from('workspace_members').insert([
    { workspace_id: ws.id, profile_id: ua.user.id, role: 'owner' },
    { workspace_id: ws.id, profile_id: ub.user.id, role: 'member' },
  ])
  console.log(`setup ok: A=${ua.user.id} B=${ub.user.id} ws=${ws.id}`)

  // T0: DB health — recipient must be able to SELECT rows addressed to them
  const probe = await admin
    .from('contacts')
    .insert({ user_id: ua.user.id, contact_id: ub.user.id, status: 'pending' })
    .select('id')
    .single()
  const cbProbe = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  })
  await cbProbe.auth.signInWithPassword({ email: emailB, password: PW })
  const seen = await cbProbe.from('contacts').select('id').eq('contact_id', ub.user.id)
  const rlsOk = !seen.error && (seen.data?.length > 0)
  check(
    'T0: recipient can see requests addressed to them (RLS healthy)',
    rlsOk,
    rlsOk ? '' : 'STALE RLS POLICIES on contacts table — T3/T4 will fail until the repair SQL is applied'
  )
  if (probe.data) await admin.from('contacts').delete().eq('id', probe.data.id)

  const browser = await chromium.launch()
  try {
    // ---- user A: login ----
    const ctxA = await browser.newContext({ viewport: { width: 1360, height: 900 } })
    const pageA = await ctxA.newPage()
    pageA.setDefaultTimeout(30000)
    const errorsA = []
    const hook = (page, sink) => {
      page.on('pageerror', (e) => sink.push(`pageerror: ${String(e).slice(0, 300)}`))
      page.on('console', async (m) => {
        if (m.type() !== 'error') return
        const args = await Promise.all(m.args().map((a) => a.jsonValue().catch(() => '<handle>')))
        if (args.length === 0) {
          console.log('  [console.error with no args — ignored]')
          return
        }
        sink.push(args)
      })
    }
    hook(pageA, errorsA)

    async function step(fn, name) {
      try {
        return await fn()
      } catch (err) {
        check(name, false, `step error: ${String(err.message).split('\n')[0]}`)
        return undefined
      }
    }

    async function login(page, email) {
      await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.fill('input[placeholder="you@example.com"]', email)
      await page.fill('input[placeholder="Password"]', PW)
      await page.click('button[type="submit"]')
      await page.waitForURL('**/workspace**', { timeout: 60000 })
      await page.getByText('Contacts', { exact: true }).first().waitFor({ timeout: 60000 })
    }

    async function openAddDialog(page) {
      await page.getByRole('button', { name: 'Add contacts' }).click()
      await page.getByRole('button', { name: 'Add', exact: true }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor({ timeout: 15000 })
      return dialog
    }

    async function searchInDialog(dialog, query) {
      await dialog.locator('input[placeholder="Search by name or email..."]').fill(query)
    }

    // T1: A sends request to B
    await login(pageA, emailA)
    let dialog = await openAddDialog(pageA)
    await searchInDialog(dialog, nameB)
    const addBtn = dialog.getByRole('button', { name: 'Add', exact: true })
    await addBtn.first().waitFor({ timeout: 15000 })
    check('T1a: B found in search', (await addBtn.count()) === 1, `count=${await addBtn.count()}`)
    await addBtn.first().click()
    let sentVisible = true
    try {
      await dialog.getByText('Sent', { exact: true }).waitFor({ timeout: 8000 })
    } catch {
      sentVisible = false
    }
    check('T1b: first Add succeeds (shows Sent)', sentVisible, `console: ${JSON.stringify(errorsA).slice(0, 400)}`)
    check('T1c: no console errors during first Add', errorsA.length === 0, JSON.stringify(errorsA).slice(0, 400))

    // T2: reload — sent request status must persist
    await pageA.reload({ waitUntil: 'domcontentloaded' })
    await pageA.getByText('Contacts', { exact: true }).first().waitFor({ timeout: 60000 })
    dialog = await openAddDialog(pageA)
    await searchInDialog(dialog, nameB)
    await dialog.getByText(nameB).first().waitFor({ timeout: 15000 })
    let statusAfterReload = 'missing'
    if (await dialog.getByText('Sent', { exact: true }).count()) statusAfterReload = 'Sent'
    else if (await dialog.getByRole('button', { name: 'Add', exact: true }).count()) statusAfterReload = 'Add'
    check('T2: after reload shows Sent (not Add)', statusAfterReload === 'Sent', `status=${statusAfterReload}`)
    await pageA.keyboard.press('Escape')

    // T3: B accepts the request
    const ctxB = await browser.newContext({ viewport: { width: 1360, height: 900 } })
    const pageB = await ctxB.newPage()
    pageB.setDefaultTimeout(30000)
    const errorsB = []
    hook(pageB, errorsB)
    await step(() => login(pageB, emailB), 'T3: B logs in')
    await step(async () => {
      await pageB.getByRole('button', { name: 'Add contacts' }).click()
      await pageB.locator('button[title="Accept"]').waitFor({ timeout: 15000 })
    }, 'T3: B sees pending section (Accept button)')
    check('T3a: B sees pending request from A', (await pageB.locator('button[title="Accept"]').count()) > 0)
    await step(async () => {
      await pageB.locator('button[title="Accept"]').click()
      await pageB.getByText('Pending Requests').waitFor({ state: 'detached', timeout: 8000 })
    }, 'T3b: accept clears pending')
    check('T3c: A appears in B contacts', (await pageB.locator('button[title="Remove contact"]').count()) > 0, 'contact row with remove button')
    check('T3d: no console errors for B', errorsB.length === 0, JSON.stringify(errorsB).slice(0, 400))

    // T4: after accept, A sees B as contact (fresh load)
    await step(async () => {
      await pageA.reload({ waitUntil: 'domcontentloaded' })
      await pageA.getByText('Contacts', { exact: true }).first().waitFor({ timeout: 60000 })
      await pageA.locator('button').filter({ hasText: nameB.slice(0, 12) }).first().waitFor({ timeout: 20000 })
    }, 'T4: A sees B as contact after reload')
    const contactRow = pageA.locator('button').filter({ hasText: nameB.slice(0, 12) })
    check('T4: A sees B as contact after reload', (await contactRow.count()) > 0)
  } finally {
    await browser.close()
    // ---- cleanup ----
    try { await admin.auth.admin.deleteUser(ua.user.id) } catch {}
    try { await admin.auth.admin.deleteUser(ub.user.id) } catch {}
    try { await admin.from('workspaces').delete().eq('id', ws.id) } catch {}
    console.log('cleanup done')
  }

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
