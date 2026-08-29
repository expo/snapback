import { chromium } from '/Users/ccheever/bench-0317-wave5/lanes/grok-explicit-0129-036-admitted2/run-choreo/social-messenger/choreography/node_modules/playwright/index.mjs';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:63210';
const image = resolve('/Users/ccheever/bench-0317-wave5/lanes/grok-explicit-0129-036-admitted2/instrument/fixtures/social-messenger/media/img-05.png');
function tid(page, id) { return page.locator(`[data-testid="${id}"]`); }

const browser = await chromium.launch({ headless: true });
const alice = await browser.newPage();
const bob = await browser.newPage();
alice.on('pageerror', (err) => console.log('ALICE PAGEERROR', err.message.slice(0, 300)));
alice.on('console', (msg) => { if (msg.type() === 'error') console.log('ALICE CONSOLE', msg.text().slice(0, 400)); });
await alice.goto(base, { waitUntil: 'domcontentloaded', timeout: 25000 });
await tid(alice, 'sm-auth-email').fill('alice@example.com');
await tid(alice, 'sm-auth-password').fill('Alice!Clique2026');
await tid(alice, 'sm-auth-submit').click();
await tid(alice, 'sm-feed-tab-global').click();
await bob.goto(base, { waitUntil: 'domcontentloaded', timeout: 25000 });
await tid(bob, 'sm-auth-email').fill('bob@example.com');
await tid(bob, 'sm-auth-password').fill('Bob!Clique2026');
await tid(bob, 'sm-auth-submit').click();
await tid(bob, 'sm-feed-tab-global').click();
const caption = `diag-image-${Date.now()}`;
await tid(alice, 'sm-compose-file').setInputFiles(image);
await alice.waitForTimeout(500);
console.log('ATTACH', await tid(alice, 'sm-compose-attachment').count());
await tid(alice, 'sm-compose-input').fill(caption);
await tid(alice, 'sm-compose-submit').click();
await alice.waitForTimeout(4000);
const aliceCard = tid(alice, 'sm-feed-item').filter({ hasText: caption });
const bobCard = tid(bob, 'sm-feed-item').filter({ hasText: caption });
console.log('ALICE CARD', await aliceCard.count(), 'MEDIA', await tid(aliceCard, 'sm-feed-media').count(), 'IMG', await aliceCard.locator('img').count());
if (await aliceCard.locator('img').count()) {
  console.log('ALICE IMG', await aliceCard.locator('img').first().evaluate((el) => ({
    src: el.getAttribute('src')?.slice(0, 180),
    complete: el.complete,
    w: el.naturalWidth,
  })));
}
console.log('BOB CARD', await bobCard.count(), 'MEDIA', await tid(bobCard, 'sm-feed-media').count(), 'IMG', await bobCard.locator('img').count());
if (await bobCard.locator('img').count()) {
  console.log('BOB IMG', await bobCard.locator('img').first().evaluate((el) => ({
    src: el.getAttribute('src')?.slice(0, 180),
    complete: el.complete,
    w: el.naturalWidth,
  })));
}
await browser.close();
