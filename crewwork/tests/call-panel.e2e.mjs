import { chromium } from 'playwright'

const BASE = process.env.CALLTEST_BASE || 'http://localhost:3210'

const STUB = `
window.JitsiMeetExternalAPI = class {
  constructor(domain, options) {
    this._options = options
    this._handlers = {}
    this._node = document.createElement('div')
    this._node.setAttribute('data-room', options.roomName)
    this._node.setAttribute('data-jitsi-stub', 'true')
    options.parentNode.appendChild(this._node)
    setTimeout(() => { if (this._handlers.ready) this._handlers.ready({}) }, 0)
  }
  addEventListener(event, cb) { this._handlers[event] = cb }
  executeCommand() {}
  dispose() { if (this._node && this._node.parentNode) this._node.parentNode.removeChild(this._node) }
}
`

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rooms(page) {
  return page.$$eval('[data-room]', (ns) => ns.map((n) => n.getAttribute('data-room')))
}

async function step(fn, name) {
  try {
    return await fn()
  } catch (err) {
    check(name, false, `step error: ${err.message.split('\n')[0]}`)
    return undefined
  }
}

async function joinFromLobby(page) {
  const join = page.getByRole('button', { name: 'Join Call' })
  await join.waitFor({ timeout: 8000 })
  await join.click()
}

async function newHarnessPage(browser) {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 300))
  })
  await page.route('**/external_api.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: STUB })
  )
  const resp = await step(() => page.goto(BASE + '/calltest', { waitUntil: 'domcontentloaded', timeout: 120000 }), 'harness loads')
  if (resp) check('harness loads with 200', resp.status() === 200, `status=${resp.status()}`)
  await step(() => page.waitForFunction(() => window.__calltestReady === true, null, { timeout: 60000 }), 'hydration completes')
  await page.getByTestId('start-chan-a').waitFor({ timeout: 30000 })
  return page
}

async function startAndJoin(page, testId) {
  await page.getByTestId(testId).click()
  await joinFromLobby(page)
  try {
    await page.waitForSelector('[data-room]', { state: 'attached', timeout: 15000 })
  } catch (err) {
    const diag = await page.evaluate(() => ({
      scriptTag: !!document.getElementById('jitsi-api-script'),
      apiType: typeof window.JitsiMeetExternalAPI,
      roomDivs: document.querySelectorAll('[data-room]').length,
      iframes: document.querySelectorAll('iframe').length,
      connecting: document.body.innerText.includes('Connecting to call'),
      inCall: document.body.innerText.includes('Call in Progress'),
      lobby: document.body.innerText.includes('Ready to join'),
      containerHtml: (document.querySelector('.relative.w-full.h-full') || {}).outerHTML?.slice(0, 200) ?? 'no-container',
    }))
    console.log('  [diag]', JSON.stringify(diag))
    throw err
  }
  return (await rooms(page))[0]
}

const browser = await chromium.launch()

// --- T2a: user 1 starts call in channel A (first call of a fresh session) ---
const page1 = await newHarnessPage(browser)
let roomA
await step(async () => {
  roomA = await startAndJoin(page1, 'start-chan-a')
  check('T2a: first call in channel A creates a room', !!roomA, 'no room node')
}, 'T2a flow')

// --- T1: user 2 in channel B (separate fresh session) must get a DIFFERENT room ---
const page2 = await newHarnessPage(browser)
let roomB
await step(async () => {
  roomB = await startAndJoin(page2, 'start-chan-b')
}, 'T1 flow')
if (roomA && roomB) {
  check('T1: different channels -> different Jitsi rooms (isolation)', roomA !== roomB, `A=${roomA} B=${roomB}`)
} else {
  check('T1: different channels -> different Jitsi rooms (isolation)', false, `missing rooms A=${roomA} B=${roomB}`)
}

// --- T2b: user 3 joins channel A (separate fresh session) must land in the SAME room ---
const page3 = await newHarnessPage(browser)
let roomA2
await step(async () => {
  roomA2 = await startAndJoin(page3, 'start-chan-a-again')
}, 'T2b flow')
if (roomA && roomA2) {
  check('T2b: same channel -> same Jitsi room (two users converge)', roomA === roomA2, `1=${roomA} 2=${roomA2}`)
} else {
  check('T2b: same channel -> same Jitsi room (two users converge)', false, `missing rooms A=${roomA} A2=${roomA2}`)
}

// --- T3: user 1 hangs up (Leave Call) and starts another call -> must be able to join again ---
await step(async () => {
  await page1.locator('button[title="End call"]').click()
  await page1.waitForSelector('[data-room]', { state: 'detached' })
}, 'T3 leave')
await step(async () => {
  await sleep(5)
  const roomAgain = await startAndJoin(page1, 'start-chan-a-again')
  check('T3: second call after hangup joins a room', !!roomAgain, 'no room node after reopen')
  globalThis.roomAgain = roomAgain
}, 'T3 reopen flow')
if (roomA && globalThis.roomAgain) {
  check('T3: reopened call rejoins the same channel room', globalThis.roomAgain === roomA, `first=${roomA} again=${globalThis.roomAgain}`)
}

await browser.close()
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
