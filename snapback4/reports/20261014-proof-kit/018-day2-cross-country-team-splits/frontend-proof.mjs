import assert from 'node:assert/strict';
import { startDev, startStatic, withBrowser, cleanup } from 'snapback4/proof';
import { wire, seed, assertRead } from './harness.mjs';

const dev = await startDev();
let web;
try {
  const post = wire(dev.url);
  await seed(post);
  web = await startStatic('dist');
  await withBrowser({ executablePath: process.env.CHROME }, async context => {
  const browser = context.browser();
  const failures = [];
  const open = async persona => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(web.url + '/?demo=1&api=' + encodeURIComponent(dev.url), { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: new RegExp('^' + persona + ' ·') }).click();
    await page.getByRole('heading', { name: 'Autumn Invitational · 3 km' }).waitFor();
    return page;
  };
  const alice = await open('Alice');
  const bob = await open('Bob');
  const pat = await open('Pat');
  const sam = await open('Sam');
  await pat.getByText('Splits awaiting release').waitFor();
  assert.equal(await pat.getByRole('heading', { name: 'Noah Rivera' }).count(), 0);
  assert.equal(await sam.getByRole('heading', { name: 'Maya Chen' }).count(), 0);
  const capture = async (page, runner, checkpoint, elapsed) => {
    await page.getByLabel('Runner', { exact: true }).selectOption(runner);
    await page.getByLabel('Checkpoint', { exact: true }).selectOption(String(checkpoint));
    await page.getByLabel('Elapsed time', { exact: true }).fill(elapsed);
    // Observe the HTTP write from the actual form and require a commit, not just a predicted row.
    const response = page.waitForResponse(r => r.url().includes('/m/recordSplit') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save split', exact: true }).click();
    const result = await (await response).json();
    assert.equal(result.state, 'sent', JSON.stringify(result));
    await page.getByText(`Split saved: ${elapsed} at ${['1 km', '2 km', 'Finish'][checkpoint - 1]}.`, { exact: true }).waitFor();
  };
  await capture(alice, 'r2', 1, '4:20');
  await alice.getByRole('row').filter({ hasText: 'Noah Rivera' }).getByText('4:20', { exact: true }).waitFor();
  await bob.getByRole('row').filter({ hasText: 'Noah Rivera' }).getByText('4:20', { exact: true }).waitFor({ timeout: 15000 });
  await capture(bob, 'r1', 2, '8:20');
  await capture(alice, 'r1', 3, '12:30');
  await capture(alice, 'r2', 2, '8:40');
  await capture(bob, 'r2', 3, '13:00');
  await alice.getByRole('button', { name: 'Finish', exact: true }).click();
  await alice.getByRole('row').filter({ hasText: 'Maya Chen' }).getByText('12:30', { exact: true }).waitFor();
  const release = alice.waitForResponse(r => r.url().includes('/m/setPublication') && r.request().method() === 'POST');
  await alice.getByRole('button', { name: 'Release results', exact: true }).click();
  assert.equal((await (await release).json()).state, 'sent');
  await pat.getByText('12:30', { exact: true }).waitFor({ timeout: 15000 });
  await sam.getByText('13:00', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await pat.getByText('13:00', { exact: true }).count(), 0);
  assert.equal(await sam.getByText('12:30', { exact: true }).count(), 0);
  await pat.screenshot({ path: 'artifacts/parent-results.png', fullPage: true });
  await alice.screenshot({ path: 'artifacts/coach-leaderboard.png', fullPage: true });
  await alice.getByRole('button', { name: 'Embargo results', exact: true }).click();
  await pat.getByText('Splits awaiting release').waitFor({ timeout: 15000 });
  assert.equal(await pat.getByText('12:30', { exact: true }).count(), 0);
  await alice.getByText('Add a runner', { exact: true }).click();
  await alice.getByLabel('Runner name', { exact: true }).fill('Ava Brooks');
  await alice.getByLabel('Bib number', { exact: true }).fill('103');
  const add = alice.waitForResponse(r => r.url().includes('/m/addRunner') && r.request().method() === 'POST');
  await alice.getByRole('button', { name: 'Add runner', exact: true }).click();
  assert.equal((await (await add).json()).state, 'sent');
  await alice.getByText('Runner added.', { exact: true }).waitFor();
  await pat.getByRole('heading', { name: 'Ava Brooks', exact: true }).waitFor({ timeout: 15000 });
  const roster = assertRead(await post('/q/roster', { args: { meet: 'autumn' } }, 'bob'));
  assert(roster.some(r => r.name === 'Ava Brooks'));
  // At phone width, the same capture controls must still be reachable.
  await alice.setViewportSize({ width: 390, height: 844 });
  await alice.getByLabel('Elapsed time', { exact: true }).scrollIntoViewIfNeeded();
  assert(await alice.getByLabel('Elapsed time', { exact: true }).isVisible());
  await alice.screenshot({ path: 'artifacts/coach-mobile.png', fullPage: true });
  assert.deepEqual(failures, []);
  console.log('PASS: real Chromium UI picks personas, records 5 splits across 2 coaches, live-merges views, releases/re-embargoes private parent results, and adds a runner.');
  });
} finally { await cleanup(() => web?.stop(), () => dev.stop()); }
