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
await bob.goto(base + '/conversation/alice', { waitUntil: 'domcontentloaded' });
await tid(alice, 'sm-convo-input').waitFor({ state: 'visible', timeout: 15000 });
await tid(bob, 'sm-convo-input').waitFor({ state: 'visible', timeout: 15000 });
await bob.locator('[data-testid=sm-convo-input]').pressSequentially('hello-typing', { delay: 25 });
await alice.waitForTimeout(1500);
console.log('ALICE TYPING COUNT', await tid(alice, 'sm-convo-typing').count());
console.log('ALICE TYPING VIS', await tid(alice, 'sm-convo-typing').count() ? await tid(alice, 'sm-convo-typing').isVisible() : false);

await alice.goto(base + '/conversation/group/' + encodeURIComponent('Weekend Plans') + '/settings');
await alice.waitForTimeout(2000);
console.log('MEMBERS', await alice.evaluate(() => [...document.querySelectorAll('[data-testid=sm-chatsettings-member]')].map((el) => el.getAttribute('aria-valuetext'))));
console.log('CANDIDATES BEFORE', await alice.evaluate(() => [...document.querySelectorAll('[data-testid=sm-chatsettings-member-candidate]')].map((el) => el.getAttribute('aria-valuetext'))));
await tid(alice, 'sm-chatsettings-member-add').click();
await alice.waitForTimeout(1000);
console.log('CANDIDATES AFTER', await alice.evaluate(() => [...document.querySelectorAll('[data-testid=sm-chatsettings-member-candidate]')].map((el) => el.getAttribute('aria-valuetext'))));
await browser.close();
