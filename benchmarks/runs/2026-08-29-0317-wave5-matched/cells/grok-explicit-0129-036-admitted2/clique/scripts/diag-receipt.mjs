import { chromium } from '/Users/ccheever/bench-0317-wave5/lanes/grok-explicit-0129-036-admitted2/run-choreo/social-messenger/choreography/node_modules/playwright/index.mjs';

const base = 'http://127.0.0.1:63210';
function tid(page, id) { return page.locator(`[data-testid="${id}"]`); }
async function login(page, email, password) {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await tid(page, 'sm-auth-email').fill(email);
  await tid(page, 'sm-auth-password').fill(password);
  await tid(page, 'sm-auth-submit').click();
  await tid(page, 'sm-feed-tab-following').waitFor({ state: 'visible', timeout: 25000 });
}

const browser = await chromium.launch({ headless: true });
const aCtx = await browser.newContext();
const bCtx = await browser.newContext();
const alice = await aCtx.newPage();
const bob = await bCtx.newPage();
alice.on('pageerror', (e) => console.log('A ERR', e.message));
bob.on('pageerror', (e) => console.log('B ERR', e.message));
await login(alice, 'alice@example.com', 'Alice!Clique2026');
await login(bob, 'bob@example.com', 'Bob!Clique2026');
await alice.goto(base + '/conversation/bob', { waitUntil: 'domcontentloaded' });
await tid(alice, 'sm-convo-input').waitFor({ state: 'visible', timeout: 15000 });
await bob.goto(base, { waitUntil: 'domcontentloaded' });
await bCtx.setOffline(true);
const text = 'receipt-probe-' + Date.now();
await tid(alice, 'sm-convo-input').fill(text);
await tid(alice, 'sm-convo-send').click();
const bubble = tid(alice, 'sm-convo-bubble').filter({ hasText: text }).last();
await bubble.waitFor({ state: 'visible', timeout: 15000 });
const rec = bubble.locator('[data-testid=sm-convo-receipt]');
const readVal = async () => rec.evaluate((el) => el.getAttribute('aria-valuetext') + '|' + el.getAttribute('data-value'));
console.log('AFTER SEND', await readVal());
await bCtx.setOffline(false);
console.log('BOB URL', bob.url());
console.log('BOB BRAND', await bob.locator('[data-testid=sm-debug-brand]').count());
console.log('BOB BODY', JSON.stringify((await bob.locator('body').innerText()).slice(0, 300)));
console.log('BOB STORAGE', await bob.evaluate(() => window.sessionStorage.getItem('clique-was-offline')));
for (let i = 0; i < 8; i++) {
  await alice.waitForTimeout(1000);
  console.log('T+' + (i+1), await readVal(), await bob.evaluate(() => JSON.stringify(window.__cliqueDeliver ?? null)));
}
await browser.close();
