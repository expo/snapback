import { chromium } from '/Users/ccheever/bench-0317-wave5/lanes/grok-explicit-0129-036-admitted2/run-choreo/social-messenger/choreography/node_modules/playwright/index.mjs';

const base = 'http://127.0.0.1:63210';
function tid(page, id) { return page.locator(`[data-testid="${id}"]`); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));
page.on('console', (msg) => { if (msg.type() === 'error') console.log('CONSOLE', msg.text().slice(0, 500)); });

await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 25000 });
await tid(page, 'sm-auth-email').fill('alice@example.com');
await tid(page, 'sm-auth-password').fill('Alice!Clique2026');
await tid(page, 'sm-auth-submit').click();
await tid(page, 'sm-feed-tab-following').waitFor({ state: 'visible', timeout: 25000 });
console.log('LOGGED IN');

await page.goto(base + '/conversation/bob', { waitUntil: 'domcontentloaded', timeout: 25000 });
await page.waitForTimeout(3000);
const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid')));
console.log('IDS', JSON.stringify(ids));
console.log('URL', page.url());
console.log('BODY', JSON.stringify((await page.locator('body').innerText()).slice(0, 800)));
console.log('INPUT COUNT', await tid(page, 'sm-convo-input').count());

await page.goto(base + '/conversation/group/' + encodeURIComponent('Weekend Plans'), { waitUntil: 'domcontentloaded', timeout: 25000 });
await page.waitForTimeout(3000);
const gids = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid')));
console.log('GROUP IDS', JSON.stringify(gids));
console.log('GROUP BODY', JSON.stringify((await page.locator('body').innerText()).slice(0, 800)));

await page.goto(base + '/conversation/group/' + encodeURIComponent('Weekend Plans') + '/settings', { waitUntil: 'domcontentloaded', timeout: 25000 });
await page.waitForTimeout(3000);
const sids = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid')));
console.log('SETTINGS IDS', JSON.stringify(sids));
console.log('SETTINGS BODY', JSON.stringify((await page.locator('body').innerText()).slice(0, 1200)));
await browser.close();
