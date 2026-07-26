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

  const apiRequests = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('supabase') || url.includes('api/')) {
      apiRequests.push(`${req.method()} ${url}`);
    }
  });

  const apiResponses = [];
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('supabase') || url.includes('api/')) {
      let body = '';
      try { body = await res.text(); } catch {}
      apiResponses.push(`${res.status()} ${url} -> ${body.substring(0, 500)}`);
    }
  });

  // 1. Navigate to auth
  console.log('=== Step 1: Navigate to auth page ===');
  await page.goto('http://localhost:3000/auth', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log('URL:', page.url());

  // Check Supabase config via __NEXT_DATA__ or window.__next
  const configInfo = await page.evaluate(() => {
    // Check if supabase client object exists in window
    const scripts = Array.from(document.querySelectorAll('script'));
    const nextData = document.getElementById('__NEXT_DATA__');
    return {
      hasNextData: !!nextData,
      nextDataContent: nextData ? nextData.textContent.substring(0, 200) : 'N/A',
    };
  });
  console.log('Config check:', JSON.stringify(configInfo));

  // 2. Click Sign Up
  console.log('\n=== Step 2: Switch to Sign Up ===');
  await page.locator('text=Sign Up').first().click();
  await page.waitForTimeout(500);

  // 3. Fill and submit
  const testEmail = `testuser${Date.now()}@example.com`;
  console.log('\n=== Step 3: Fill form with', testEmail, '===');
  
  await page.locator('input[placeholder*="name" i]').first().fill('Test User');
  await page.locator('input[type="email"]').first().fill(testEmail);
  await page.locator('input[type="password"]').first().fill('TestPass123!');

  // Clear captured data before submit
  apiRequests.length = 0;
  apiResponses.length = 0;
  networkErrors.length = 0;
  const preSubmitConsole = consoleMessages.length;

  // 4. Click Create Account
  console.log('\n=== Step 4: Submit form ===');
  await page.locator('button:has-text("Create Account")').click();
  
  // Wait with polling to detect changes
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    
    // Check various button states
    const btns = await page.locator('button').allTextContents();
    
    // Check for error text
    const errorDiv = page.locator('div:has(> p.text-destructive), div.bg-destructive\\/10');
    const hasError = await errorDiv.isVisible().catch(() => false);
    const errorText = hasError ? await errorDiv.first().textContent().catch(() => '') : '';
    
    // Check for loading spinner
    const hasLoader = await page.locator('svg.animate-spin').first().isVisible().catch(() => false);
    
    // Check for email confirmation view
    const hasConfirmation = await page.locator('text=Check your email').isVisible().catch(() => false);
    
    console.log(`  t+${i+1}s: URL=${currentUrl.split('?')[0]} | btns=[${btns.join(', ')}] | spinner=${hasLoader} | error="${errorText}" | confirmView=${hasConfirmation}`);
    
    if (currentUrl !== 'http://localhost:3000/auth') {
      console.log('  -> Redirected!');
      break;
    }
    if (hasConfirmation) {
      console.log('  -> Email confirmation view shown');
      break;
    }
    if (hasError && errorText) {
      console.log('  -> Error displayed');
      break;
    }
  }

  // 5. Report findings
  console.log('\n=== API Requests ===');
  apiRequests.forEach(r => console.log('  ', r));
  
  console.log('\n=== API Responses ===');
  apiResponses.forEach(r => console.log('  ', r));
  
  console.log('\n=== Network Errors ===');
  networkErrors.forEach(r => console.log('  ', r));
  
  console.log('\n=== Console messages after submit ===');
  consoleMessages.slice(preSubmitConsole).forEach(m => console.log('  ', m));

  // Screenshot final state
  await page.screenshot({ path: 'screenshots/test-debug-final.png', fullPage: true });
  console.log('\nFinal screenshot saved.');

  await browser.close();
})();
