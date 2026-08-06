// Phase 1 of the offline cold-start proof: browse the app online in a
// PERSISTENT browser profile so the app-level history cache is primed.
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:8095';
const PROFILE = new URL('./run/offline-profile', import.meta.url).pathname;
const ART = new URL('./artifacts/', import.meta.url).pathname;

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 480, height: 860 },
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(APP_URL);
await page.waitForSelector('[data-testid="conversation-conv_weekend_ride"]', { timeout: 60_000 });
await page.click('[data-testid="conversation-conv_weekend_ride"]');
await page.waitForSelector('[data-testid="message-msg_7"]', { timeout: 30_000 });
await page.waitForTimeout(1500);
await page.click('[data-testid="back-button"]');
await page.waitForSelector('[data-testid="conversation-conv_dm_ada_grace"]', { timeout: 30_000 });
await page.click('[data-testid="conversation-conv_dm_ada_grace"]');
await page.waitForSelector('[data-testid="message-msg_1"]', { timeout: 30_000 });
await page.waitForTimeout(1500);
const cached = await page.evaluate(() => window.localStorage.getItem('rematch.offline.v1')?.length ?? 0);
console.log('cache primed, bytes:', cached);
if (!cached) {
  console.log('FAIL: cache empty');
  process.exitCode = 1;
}
await page.screenshot({ path: `${ART}11-online-before-offline-restart.png` });
await context.close();
console.log('PRIME OK');
