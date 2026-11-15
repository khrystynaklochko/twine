import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const HEADLESS_SHELL = '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

async function main() {
  const executablePath = fs.existsSync(HEADLESS_SHELL) ? HEADLESS_SHELL : undefined;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  console.log('1. Checking / landing empty state...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  const heading = await page.locator('h2').first().innerText();
  assert.ok(heading.includes('personal digital twin') || heading.includes('Personal Twin'), `Unexpected heading: ${heading}`);

  console.log('2. Completing consent-first onboarding...');
  await page.goto(`${BASE_URL}/onboarding`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('e.g. Maya Chen').fill('Alex Rivera');
  await page.getByPlaceholder('e.g. Independent Researcher').fill('Systems Researcher');
  await page.getByPlaceholder('e.g. Automate safe weekly literature scans').fill('Verify browser workflows safely');
  await page.getByRole('button', { name: /Create My Personal Twin|Save Onboarding Preferences/i }).click();
  await page.waitForURL('**/twin', { timeout: 10000 });

  console.log('3. Navigating /teach and testing live demonstration capture...');
  await page.goto(`${BASE_URL}/teach`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start Teach Recording' }).click();
  await page.waitForSelector('text=TEACH RECORDING ACTIVE');

  const frame = page.frameLocator('iframe[title*="OpenKnowledge Research Archive"]');
  await frame.locator('#research-query').fill('capability');
  await frame.locator('#research-query').dispatchEvent('change');
  await frame.locator('#research-search-btn').click();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: /Finish & Review|Stop & Review/i }).first().click();
  await page.waitForTimeout(300);

  console.log('4. Checking /skills and /agent...');
  await page.goto(`${BASE_URL}/skills`, { waitUntil: 'networkidle' });
  await page.goto(`${BASE_URL}/agent`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Run Shadow Simulation' }).click();
  await page.waitForSelector('text=Outcome Verification: confirmed', { timeout: 10000 });

  console.log('5. Executing live Playwright browser run on /fixture/research...');
  await page.getByRole('button', { name: 'Execute Live Playwright Run' }).click();
  await page.waitForSelector('text=Outcome Verification: confirmed', { timeout: 20000 });

  console.log('6. Verifying /history & /settings/privacy...');
  await page.goto(`${BASE_URL}/history`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Run Automated Safety Suite' }).click();
  await page.getByRole('button', { name: /Verification Ledger/i }).click();
  await page.waitForSelector('text=RESET-001');

  await page.goto(`${BASE_URL}/settings/privacy`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Delete All Twin Data/i }).click();
  await page.getByRole('button', { name: /Confirm Wipe/i }).click();
  await page.waitForSelector('text=permanently deleted');

  assert.equal(consoleErrors.length, 0, `Page errors detected: ${consoleErrors.join('; ')}`);
  console.log('ALL E2E VERTICAL SLICE CHECKS PASSED.');
  await browser.close();
}

main().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
