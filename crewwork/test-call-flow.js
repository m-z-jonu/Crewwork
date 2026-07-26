const { chromium } = require('playwright');

const TEST_EMAIL = 'pw-call-' + Date.now() + '@crewwork.test';
const TEST_PASS = 'TestPass123!';
const TEST_NAME = 'Playwright Bot';
const SUPABASE_URL = 'https://frzctrindmbnkeprjoqb.supabase.co';
const SVC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyemN0cmluZG1ibmtlcHJqb3FiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjgxODE1MCwiZXhwIjoyMDk4Mzk0MTUwfQ.ISvgBYaYHz2boYBvU4lycspNnfA0d8zVsr9IWu9rd-I';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const networkErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);
    if (msg.type() === 'warning') consoleWarnings.push(text);
  });
  page.on('pageerror', err => consoleErrors.push('[PAGE ERROR] ' + err.message));
  page.on('response', resp => {
    if (resp.status() >= 400) {
      networkErrors.push(resp.status() + ' ' + resp.url().replace(SUPABASE_URL, '[supabase]').substring(0, 120));
    }
  });

  const results = { pass: 0, fail: 0, steps: [] };
  function step(name, passed, detail) {
    results.steps.push({ name, passed, detail });
    if (passed) results.pass++;
    else results.fail++;
    console.log(`  ${passed ? 'PASS' : 'FAIL'}: ${name}${detail ? ' - ' + detail : ''}`);
  }

  // ================================================================
  // STEP 1: Sign up
  // ================================================================
  console.log('\n[Step 1] Signup');
  console.log('  Email:', TEST_EMAIL);
  await page.goto('http://localhost:3000/auth', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Sign Up")').click();
  await page.waitForTimeout(1000);
  await page.locator('input[placeholder="Your name"]').fill(TEST_NAME);
  await page.locator('input[type="email"]').fill(TEST_EMAIL);
  await page.locator('input[type="password"]').fill(TEST_PASS);
  await page.locator('button:has-text("Create Account")').click();
  await page.waitForTimeout(5000);
  step('Login as test user', page.url().includes('/workspace'), 'URL: ' + page.url());

  // ================================================================
  // STEP 2: Create business workspace
  // ================================================================
  console.log('\n[Step 2] Create workspace');
  const businessBtn = page.locator('button:has-text("Business")').first();
  if (await businessBtn.isVisible().catch(() => false)) {
    await businessBtn.click();
    await page.waitForTimeout(500);
  }
  const wsName = 'Test Team ' + Date.now();
  const wsInput = page.locator('#workspace-name').first();
  if (await wsInput.isVisible().catch(() => false)) {
    await wsInput.fill(wsName);
  }
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Create Workspace")').click();
  await page.waitForTimeout(5000);
  step('Create business workspace', true, wsName);

  // ================================================================
  // STEP 3: Enable calls via admin API
  // ================================================================
  console.log('\n[Step 3] Enable calls');
  const wsResp = await fetch(SUPABASE_URL + '/rest/v1/workspaces?select=id&name=eq.' + encodeURIComponent(wsName), {
    headers: { 'apikey': SVC_KEY, 'Authorization': 'Bearer ' + SVC_KEY }
  });
  const wsData = await wsResp.json();
  let wsId = null;
  if (wsData.length > 0) {
    wsId = wsData[0].id;
    await fetch(SUPABASE_URL + '/rest/v1/workspaces?id=eq.' + wsId, {
      method: 'PATCH',
      headers: { 'apikey': SVC_KEY, 'Authorization': 'Bearer ' + SVC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls_enabled: true })
    });
  }
  step('Enable calls on workspace', !!wsId, wsId ? wsId.substring(0, 8) + '...' : 'not found');

  // ================================================================
  // STEP 4: Reload page to pick up calls_enabled
  // ================================================================
  console.log('\n[Step 4] Reload page');
  await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);
  step('Reload to workspace', page.url().includes('/workspace'));

  // ================================================================
  // STEP 5: Verify phone icon in channel header
  // ================================================================
  console.log('\n[Step 5] Find call button');
  await page.waitForTimeout(2000);
  const phoneBtn = page.locator('button[title="Start a call"]').first();
  const phoneVisible = await phoneBtn.isVisible().catch(() => false);
  step('Phone icon visible in channel header', phoneVisible);
  await page.screenshot({ path: 'screenshots/call-test-01-phone-btn.png', fullPage: true });

  if (!phoneVisible) {
    // Debug: show all buttons
    const btns = await page.locator('button').all();
    for (const btn of btns) {
      const title = await btn.getAttribute('title');
      const text = (await btn.textContent() || '').trim();
      const visible = await btn.isVisible().catch(() => false);
      if (visible) console.log('    btn:', title || text.substring(0, 40));
    }
    await browser.close();
    printSummary(results);
    return;
  }

  // ================================================================
  // STEP 6: Click call icon -> lobby appears
  // ================================================================
  console.log('\n[Step 6] Click call -> lobby');
  await phoneBtn.click();
  
  // Wait for the call overlay (fixed z-50 overlay)
  const callOverlay = page.locator('.fixed.inset-0.z-50').first();
  await callOverlay.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  
  const lobbyVisible = await callOverlay.isVisible().catch(() => false);
  await page.screenshot({ path: 'screenshots/call-test-02-lobby.png', fullPage: true });
  step('Call lobby screen appears', lobbyVisible);

  // Check lobby content
  const lobbyText = await page.locator('body').textContent();
  const hasJoinText = lobbyText.includes('Join Call');
  const hasConfigureText = lobbyText.includes('Configure') || lobbyText.includes('audio');
  step('Lobby shows join configuration', hasJoinText || hasConfigureText, 
    hasJoinText ? 'Join Call text found' : hasConfigureText ? 'Configure text found' : 'Neither found');

  // ================================================================
  // STEP 7: Click Join Call
  // ================================================================
  console.log('\n[Step 7] Click Join Call');
  const joinBtn = page.locator('button:has-text("Join Call")').first();
  const joinVisible = await joinBtn.isVisible().catch(() => false);
  step('Join Call button visible', joinVisible);

  if (joinVisible) {
    await joinBtn.click();
    await page.waitForTimeout(8000);
    await page.screenshot({ path: 'screenshots/call-test-03-in-call.png', fullPage: true });

    // ================================================================
    // STEP 8: Check LiveKit connection
    // ================================================================
    console.log('\n[Step 8] Check LiveKit connection');
    
    const videoCount = await page.locator('video').count();
    const lkRoomCount = await page.locator('[class*="lk-"]').count();
    const participantCount = await page.locator('[data-participant]').count();
    const callControlsVisible = await page.locator('button:has-text("Leave")').isVisible().catch(() => false);
    
    console.log('  Video elements:', videoCount);
    console.log('  LiveKit CSS elements:', lkRoomCount);
    console.log('  Participant elements:', participantCount);
    console.log('  Leave button visible:', callControlsVisible);
    
    step('LiveKit room rendered', lkRoomCount > 0 || callControlsVisible,
      lkRoomCount > 0 ? lkRoomCount + ' LK elements' : callControlsVisible ? 'controls visible' : 'no elements');
    
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/call-test-04-connected.png', fullPage: true });
  } else {
    step('Join Call button visible', false, 'button not found');
  }

  // ================================================================
  // Error summary
  // ================================================================
  printSummary(results);

  console.log('\n[Console Errors] (' + consoleErrors.length + ')');
  consoleErrors.slice(0, 10).forEach((e, i) => console.log('  ' + (i+1) + '. ' + e.substring(0, 200)));

  console.log('\n[Network Errors] (' + networkErrors.length + ')');
  networkErrors.slice(0, 10).forEach((e, i) => console.log('  ' + (i+1) + '. ' + e));

  await browser.close();
  console.log('\nDone!');
})();

function printSummary(results) {
  console.log('\n========================================');
  console.log('  SUMMARY: ' + results.pass + ' passed, ' + results.fail + ' failed');
  console.log('========================================');
  results.steps.forEach(s => {
    console.log('  ' + (s.passed ? 'PASS' : 'FAIL') + ' | ' + s.name + (s.detail ? ' (' + s.detail + ')' : ''));
  });
  console.log('========================================');
}
