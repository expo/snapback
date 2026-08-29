import { chromium } from '/Users/ccheever/bench-0317-wave5/lanes/grok-explicit-0129-036-admitted2/run-choreo/social-messenger/choreography/node_modules/playwright/index.mjs';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:63210';
const image = resolve('/Users/ccheever/bench-0317-wave5/lanes/grok-explicit-0129-036-admitted2/instrument/fixtures/social-messenger/media/img-05.png');
function tid(page, id) { return page.locator(`[data-testid="${id}"]`); }

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 25000 });
await tid(page, 'sm-auth-email').fill('alice@example.com');
await tid(page, 'sm-auth-password').fill('Alice!Clique2026');
await tid(page, 'sm-auth-submit').click();
await tid(page, 'sm-feed-tab-global').click();
await tid(page, 'sm-compose-file').waitFor({ state: 'attached', timeout: 25000 });
const info = await tid(page, 'sm-compose-file').evaluate((el) => ({
  tag: el.tagName, type: el.getAttribute('type'), count: el.files?.length,
}));
console.log('INPUT', JSON.stringify(info));
await tid(page, 'sm-compose-file').setInputFiles(image);
await page.waitForTimeout(1000);
console.log('AFTER FILES', await tid(page, 'sm-compose-file').evaluate((el) => el.files?.[0]?.name));
console.log('ATTACH COUNT', await tid(page, 'sm-compose-attachment').count());
if (await tid(page, 'sm-compose-attachment').count()) {
  const att = tid(page, 'sm-compose-attachment').first();
  console.log('ATTACH ATTRS', await att.evaluate((el) => ({
    tag: el.tagName,
    value: el.getAttribute('data-value'),
    aria: el.getAttribute('aria-valuetext'),
    state: el.getAttribute('data-state'),
  })));
}
console.log('BODY', JSON.stringify((await page.locator('body').innerText()).slice(0, 400)));
await browser.close();
