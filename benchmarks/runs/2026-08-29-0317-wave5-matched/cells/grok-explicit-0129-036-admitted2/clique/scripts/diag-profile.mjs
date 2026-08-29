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
const aliceCtx = await browser.newContext();
const bobCtx = await browser.newContext();
const alice = await aliceCtx.newPage();
const bob = await bobCtx.newPage();
alice.on('pageerror', (err) => console.log('ALICE PAGEERROR', err.message));
bob.on('pageerror', (err) => console.log('BOB PAGEERROR', err.message));
alice.on('console', (msg) => { if (msg.type() === 'error') console.log('ALICE CONSOLE', msg.text().slice(0, 400)); });
bob.on('console', (msg) => { if (msg.type() === 'error') console.log('BOB CONSOLE', msg.text().slice(0, 400)); });

await login(alice, 'alice@example.com', 'Alice!Clique2026');
await login(bob, 'bob@example.com', 'Bob!Clique2026');
await bob.goto(base + '/profile/alice', { waitUntil: 'domcontentloaded', timeout: 25000 });
await tid(bob, 'sm-profile').waitFor({ state: 'visible', timeout: 25000 });
console.log('BOB BEFORE', JSON.stringify((await tid(bob, 'sm-profile').innerText()).slice(0, 400)));

await alice.goto(base + '/profile/edit', { waitUntil: 'domcontentloaded', timeout: 25000 });
await tid(alice, 'sm-profile-field-displayname').waitFor({ state: 'visible', timeout: 25000 });
const fieldInfo = await tid(alice, 'sm-profile-field-displayname').evaluate((el) => ({
  tag: el.tagName,
  type: el.getAttribute('type'),
  value: el.value,
  testid: el.getAttribute('data-testid'),
}));
console.log('FIELD', JSON.stringify(fieldInfo));
const stamp = String(Date.now()).slice(-8);
const displayName = `Alice Live ${stamp}`;
const bio = `Live bio ${stamp}`;
await tid(alice, 'sm-profile-field-displayname').fill(displayName);
await tid(alice, 'sm-profile-field-bio').fill(bio);
const afterFill = await alice.evaluate(() => ({
  name: document.querySelector('[data-testid="sm-profile-field-displayname"]')?.value,
  bio: document.querySelector('[data-testid="sm-profile-field-bio"]')?.value,
  handle: document.querySelector('[data-testid="sm-profile-field-handle"]')?.value,
  err: document.querySelector('[data-testid="sm-profile-error"]')?.textContent,
}));
console.log('AFTER FILL', JSON.stringify(afterFill));
await tid(alice, 'sm-profile-save').click();
await alice.waitForTimeout(3000);
console.log('ALICE URL', alice.url());
console.log('ALICE ERR', await tid(alice, 'sm-profile-error').count());
if (await tid(alice, 'sm-profile-error').count()) {
  console.log('ALICE ERR TEXT', await tid(alice, 'sm-profile-error').innerText());
}
console.log('BOB PROFILE COUNT', await tid(bob, 'sm-profile').count());
console.log('BOB BODY', JSON.stringify((await bob.locator('body').innerText()).slice(0, 800)));
console.log('ALICE PROFILE COUNT', await tid(alice, 'sm-profile').count());
console.log('ALICE PAGE TEXT', JSON.stringify((await alice.locator('body').innerText()).slice(0, 500)));
await browser.close();
