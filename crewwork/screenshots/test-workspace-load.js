const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleMessages = [];
  page.on('console', msg => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });

  const networkErrors = [];
  page.on('requestfailed', req => {
    networkErrors.push(`${req.failure().errorText} - ${req.url()}`);
  });

  const apiResponses = [];
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('supabase')) {
      let body = '';
      try { body = await res.text(); } catch {}
      apiResponses.push(`${res.status()} ${url.split('.co')[1]?.substring(0, 80)} -> ${body.substring(0, 200)}`);
    }
  });

  // 1. Sign up first
  console.log('=== Signing up ===');
  await page.goto('http://localhost:3000/auth', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  
  // Switch to signup
  await page.locator('text=Sign Up').first().click();
  await page.waitForTimeout(500);
  
  const testEmail = `testuser${Date.now()}@example.com`;
  console.log('Email:', testEmail);
  
  await page.locator('input[placeholder*="name" i]').first().fill('Test User');
  await page.locator('input[type="email"]').first().fill(testEmail);
  await page.locator('input[type="password"]').first().fill('TestPass123!');
  await page.locator('button:has-text("Create Account")').click();
  
  // Wait for redirect to workspace
  console.log('Waiting for redirect to workspace...');
  try {
    await page.waitForURL('**/workspace', { timeout: 15000 });
    console.log('Redirected to:', page.url());
  } catch (e) {
    console.log('No redirect within 15s, current URL:', page.url());
    await page.screenshot({ path: 'screenshots/test-workspace-stuck-at-auth.png', fullPage: true });
  }

  // 2. Wait on workspace page and see what happens
  console.log('\n=== Monitoring workspace page for 30 seconds ===');
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    
    // Check page content
    const bodyText = await page.locator('body').textContent().catch(() => '');
    const hasLoader = await page.locator('.animate-spin').first().isVisible().catch(() => false);
    const hasError = await page.locator('text=Something went wrong').isVisible().catch(() => false);
    const hasSetup = await page.locator('text=Workspace Setup').isVisible().catch(() => false) || 
                     await page.locator('text=Create Workspace').isVisible().catch(() => false);
    const hasSidebar = await page.locator('nav, [role="navigation"], .sidebar').first().isVisible().catch(() => false);
    const hasChannels = await page.locator('text=general').first().isVisible().catch(() => false);
    
    const status = [
      `url=${currentUrl.split('?')[0]}`,
      `loader=${hasLoader}`,
      `error=${hasError}`,
      `setup=${hasSetup}`,
      `sidebar=${hasSidebar}`,
      `channels=${hasChannels}`,
    ].join(' | ');
    
    console.log(`  t+${i+1}s: ${status}`);
    
    // If we see a real error or the workspace loaded, take screenshot and report
    if (hasError || hasSetup || hasChannels) {
      await page.screenshot({ path: 'screenshots/test-workspace-result.png', fullPage: true });
      if (hasError) console.log('  -> ERROR VIEW detected');
      if (hasSetup) console.log('  -> WORKSPACE SETUP detected');
      if (hasChannels) console.log('  -> CHANNELS loaded!');
      break;
    }
  }

  // Final report
  console.log('\n=== Console messages (errors only) ===');
  consoleMessages.filter(m => m.startsWith('[error]')).forEach(m => console.log('  ', m));
  
  console.log('\n=== Network errors ===');
  networkErrors.forEach(r => console.log('  ', r));
  
  console.log('\n=== Supabase responses ===');
  apiResponses.forEach(r => console.log('  ', r));

  await page.screenshot({ path: 'screenshots/test-workspace-final.png', fullPage: true });
  
  await browser.close();
})();
