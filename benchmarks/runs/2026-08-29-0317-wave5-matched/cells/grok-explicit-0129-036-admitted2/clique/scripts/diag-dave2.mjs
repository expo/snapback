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
const dCtx = await browser.newContext();
const alice = await aCtx.newPage();
const dave = await dCtx.newPage();
dave.on('pageerror', (e) => console.log('DAVE ERR', e.message));
await login(alice, 'alice@example.com', 'Alice!Clique2026');
await login(dave, 'dave@example.com', 'Dave!Clique2026');
const g = encodeURIComponent('Weekend Plans');
await alice.goto(base + '/conversation/group/' + g + '/settings', { waitUntil: 'domcontentloaded' });
await tid(alice, 'sm-chatsettings-member-add').waitFor({ timeout: 15000 });
if (await tid(alice, 'sm-chatsettings-member-candidate').count() === 0) {
  await tid(alice, 'sm-chatsettings-member-add').click();
}
const cand = alice.locator('[data-testid=sm-chatsettings-member-candidate]').filter({ hasText: 'Dave' }).first();
if (await cand.count()) await cand.click();
else {
  const all = await alice.evaluate(() => [...document.querySelectorAll('[data-testid=sm-chatsettings-member-candidate]')].map((el) => el.getAttribute('aria-valuetext')));
  console.log('CANDS', all);
  const daveCand = alice.locator('[data-testid=sm-chatsettings-member-candidate][aria-valuetext=dave]');
  await daveCand.click({ timeout: 10000 });
}
await alice.waitForTimeout(2000);
console.log('MEMBERS', await alice.evaluate(() => [...document.querySelectorAll('[data-testid=sm-chatsettings-member]')].map((el) => el.getAttribute('aria-valuetext'))));
await Promise.all([
  alice.goto(base + '/conversation/group/' + g, { waitUntil: 'domcontentloaded' }),
  dave.goto(base + '/conversation/group/' + g, { waitUntil: 'domcontentloaded' }),
]);
await tid(alice, 'sm-convo-input').waitFor({ timeout: 15000 });
await tid(dave, 'sm-convo-input').waitFor({ timeout: 15000 });
const text = 'dave-see-' + Date.now();
await tid(alice, 'sm-convo-input').fill(text);
await tid(alice, 'sm-convo-send').click();
await tid(alice, 'sm-convo-bubble').filter({ hasText: text }).last().waitFor({ timeout: 15000 });
try {
  await tid(dave, 'sm-convo-bubble').filter({ hasText: text }).last().waitFor({ timeout: 15000 });
  console.log('DAVE SAW IT');
} catch (e) {
  console.log('DAVE MISS');
  console.log('DAVE BODY', JSON.stringify((await dave.locator('body').innerText()).slice(0, 500)));
  console.log('DAVE BUBBLES', await tid(dave, 'sm-convo-bubble').count());
}
await browser.close();
