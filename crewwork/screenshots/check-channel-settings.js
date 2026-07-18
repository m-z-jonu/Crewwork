const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Navigate to auth page and take screenshot
  await page.goto('http://localhost:3000/auth', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/auth-page.png', fullPage: true });

  // Check console for errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  // Try to navigate to workspace (will redirect to auth if not logged in)
  await page.goto('http://localhost:3000/workspace', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/workspace-page.png', fullPage: true });
  console.log('Workspace URL:', page.url());

  if (errors.length > 0) {
    console.log('Console errors:', errors);
  }

  await browser.close();
})();
