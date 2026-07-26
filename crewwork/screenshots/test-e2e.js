const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('409')) {
      errors.push(msg.text());
    }
  });

  // 1. Sign up
  console.log('=== 1. Sign up ===');
  await page.goto('http://localhost:3000/auth', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.locator('text=Sign Up').first().click();
  await page.waitForTimeout(500);
  
  const testEmail = `testuser${Date.now()}@example.com`;
  await page.locator('input[placeholder*="name" i]').first().fill('Test User');
  await page.locator('input[type="email"]').first().fill(testEmail);
  await page.locator('input[type="password"]').first().fill('TestPass123!');
  await page.locator('button:has-text("Create Account")').click();
  
  await page.waitForURL('**/workspace', { timeout: 15000 });
  console.log('Redirected to workspace');

  // 2. Wait for workspace setup
  console.log('\n=== 2. Workspace setup ===');
  await page.waitForSelector('text=Create your workspace', { timeout: 10000 });
  console.log('Workspace setup screen visible');
  await page.screenshot({ path: 'screenshots/test-e2e-01-setup.png', fullPage: true });

  // 3. Fill workspace name and create
  console.log('\n=== 3. Create business workspace ===');
  await page.locator('#workspace-name').fill('My Team');
  await page.screenshot({ path: 'screenshots/test-e2e-02-filled.png', fullPage: true });
  
  await page.locator('button:has-text("Create Workspace")').click();
  
  // Wait for workspace to load
  console.log('Waiting for workspace to load...');
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const hasSidebar = await page.locator('nav').first().isVisible().catch(() => false);
    const hasChannels = await page.locator('text=general').first().isVisible().catch(() => false);
    const hasLoading = await page.locator('.animate-spin').first().isVisible().catch(() => false);
    
    console.log(`  t+${i+1}s: sidebar=${hasSidebar} | channels=${hasChannels} | loading=${hasLoading}`);
    
    if (hasSidebar && hasChannels) {
      console.log('  -> Workspace loaded!');
      break;
    }
  }

  await page.screenshot({ path: 'screenshots/test-e2e-03-workspace.png', fullPage: true });
  console.log('Final URL:', page.url());

  if (errors.length > 0) {
    console.log('\nConsole errors (excluding 409):');
    errors.forEach(e => console.log('  -', e));
  } else {
    console.log('\nNo console errors (excluding expected 409 from StrictMode)');
  }

  await browser.close();
})();
