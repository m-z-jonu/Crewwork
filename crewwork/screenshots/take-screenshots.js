const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Collect console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  // Screenshot 1: Root page (will redirect)
  console.log('Navigating to root...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/01-root.png', fullPage: true });
  console.log('Root page URL:', page.url());

  // Screenshot 2: Auth page
  console.log('Navigating to auth...');
  await page.goto('http://localhost:3000/auth', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/02-auth.png', fullPage: true });

  // Screenshot 3: Setup page
  console.log('Navigating to setup...');
  await page.goto('http://localhost:3000/setup', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/03-setup.png', fullPage: true });

  // Screenshot 4: Workspace (will likely redirect to auth)
  console.log('Navigating to workspace...');
  await page.goto('http://localhost:3000/workspace', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/04-workspace.png', fullPage: true });
  console.log('Workspace URL:', page.url());

  // Print console errors
  if (errors.length > 0) {
    console.log('\nConsole errors:');
    errors.forEach(e => console.log('  -', e));
  } else {
    console.log('\nNo console errors detected.');
  }

  await browser.close();
  console.log('\nScreenshots saved to screenshots/');
})();
