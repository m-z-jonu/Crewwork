const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('request', req => {
    if (req.url().includes('supabase') || req.url().includes('auth')) {
      console.log('REQ:', req.method(), req.url().substring(0, 150));
    }
  });
  page.on('response', resp => {
    if (resp.url().includes('supabase') || resp.url().includes('auth')) {
      console.log('RESP:', resp.status(), resp.url().substring(0, 150));
    }
  });
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log('CONSOLE ' + msg.type() + ':', msg.text().substring(0, 200));
    }
  });

  await page.goto('http://localhost:3000/auth', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(500);
  console.log('Auth page loaded, URL:', page.url());

  await page.locator('input[type="email"]').fill('pw-test-1784512725805@crewwork.test');
  await page.locator('input[type="password"]').fill('TestPass123!');
  
  console.log('Clicking Sign In...');
  await page.locator('button:has-text("Sign In")').click();
  await page.waitForTimeout(5000);

  console.log('Final URL:', page.url());
  
  const storage = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      items[key] = localStorage.getItem(key).substring(0, 80);
    }
    return items;
  });
  console.log('LocalStorage keys:', Object.keys(storage));
  if (storage['sb-frzctrindmbnkeprjoqb-auth-token']) {
    console.log('Auth token found!');
  }

  await browser.close();
})();
