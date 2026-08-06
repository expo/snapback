// Phase 2 of the offline cold-start proof: the backend is STOPPED before this
// runs. Relaunch the same persistent profile (a cold app start), and verify
// the client still shows conversation history from its offline cache.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:8095';
const PROFILE = new URL('./run/offline-profile', import.meta.url).pathname;
const ART = new URL('./artifacts/', import.meta.url).pathname;

// Sanity: the backend really is down.
const backendDown = await fetch('http://127.0.0.1:4287/inspect', {
  headers: { 'x-snapback-auth-client-protocol': '1' },
  signal: AbortSignal.timeout(2000),
}).then(
  (response) => response.status >= 500,
  () => true,
);
assert.equal(backendDown, true, 'backend must be stopped for this proof');
console.log('backend confirmed unreachable');

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 480, height: 860 },
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(APP_URL);
await page.waitForSelector('[data-testid="offline-banner"]', { timeout: 45_000 });
console.log('PASS offline banner shown on cold start with backend stopped');
await page.waitForSelector('[data-testid="conversation-conv_weekend_ride"]', { timeout: 15_000 });
console.log('PASS cached conversation list rendered');
await page.screenshot({ path: `${ART}12-offline-cold-start-list.png` });
await page.click('[data-testid="conversation-conv_weekend_ride"]');
await page.waitForSelector('[data-testid="message-msg_7"]', { timeout: 15_000 });
const body = await page.textContent('body');
assert.match(body, /coast road, 60km/u, 'seeded history text visible offline');
console.log('PASS cached message history rendered offline');
await page.screenshot({ path: `${ART}13-offline-cold-start-history.png` });
await context.close();
console.log('OFFLINE COLD-START PROOF OK');
