const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Go to a public group members page
  await page.goto('https://www.facebook.com/groups/457345977993363/members', { waitUntil: 'networkidle' });
  
  // Log the top bar buttons
  const buttons = await page.locator('role=button').all();
  console.log(`Found ${buttons.length} buttons.`);
  for (const btn of buttons) {
      const name = await btn.getAttribute('aria-label') || await btn.textContent();
      if (name) {
          console.log(`Button: ${name.trim()}`);
      }
  }

  await browser.close();
})();
