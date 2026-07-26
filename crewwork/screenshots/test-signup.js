const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  // 1. Go to auth page
  console.log('1. Navigating to auth page...');
  await page.goto('http://localhost:3000/auth', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/test-01-auth.png', fullPage: true });
  console.log('   URL:', page.url());

  // 2. Click Sign Up
  console.log('2. Clicking Sign Up...');
  const signUpLink = await page.locator('text=Sign Up').first();
  if (await signUpLink.isVisible()) {
    await signUpLink.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/test-02-signup.png', fullPage: true });
  }

  // 3. Fill form
  const testEmail = `testuser${Date.now()}@example.com`;
  console.log('3. Filling form with:', testEmail);
  
  const emailInput = await page.locator('input[type="email"], input[placeholder*="email" i]').first();
  if (await emailInput.isVisible()) await emailInput.fill(testEmail);
  
  const nameInput = await page.locator('input[placeholder*="name" i]').first();
  if (await nameInput.isVisible()) await nameInput.fill('Test User');
  
  const passwordInput = await page.locator('input[type="password"]').first();
  if (await passwordInput.isVisible()) await passwordInput.fill('TestPass123!');

  await page.screenshot({ path: 'screenshots/test-03-filled.png', fullPage: true });

  // 4. Submit
  console.log('4. Submitting...');
  const submitBtn = await page.locator('button:has-text("Sign Up"), button[type="submit"]').first();
  if (await submitBtn.isVisible()) {
    await submitBtn.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/test-04-submitted.png', fullPage: true });
    console.log('   After submit URL:', page.url());
    
    // Check for errors
    const errorBanner = await page.locator('[class*="destructive"], [role="alert"]').first();
    if (await errorBanner.isVisible()) {
      console.log('   ERROR:', await errorBanner.textContent());
    }
  }

  // 5. Final state
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/test-05-final.png', fullPage: true });
  console.log('5. Final URL:', page.url());

  if (errors.length > 0) {
    console.log('\nConsole errors:');
    errors.forEach(e => console.log('  -', e));
  }

  await browser.close();
})();
