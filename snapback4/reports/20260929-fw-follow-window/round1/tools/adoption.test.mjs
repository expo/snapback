import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { chromiumExecutable } from '../../../../witness/lib.mjs';
import { server, fixture, honest } from './helpers.mjs';
const root = resolve(import.meta.dirname, '../../../..');
const require = createRequire(resolve(root, 'apps/chat/package.json'));
const { createServer } = require('vite');
const { chromium } = require('playwright-core');
for (const worker of [false, true]) for (const name of ['follow', 'unfollow']) test(`Chromium worker=${worker}: mounted Following tracks adopted ${name} custody`, { timeout: 60000 }, async t => {
  const { url } = await server(t, '', fixture);
  const seeded = await fetch(url + '/m/post', { method: 'POST', headers: { 'content-type': 'application/json', 'x-snapback-persona': 'alice' }, body: JSON.stringify({ args: { postId: 'first', parentId: null } }) });
  assert.equal((await seeded.json()).state, 'sent');
  if (name === 'unfollow') {
    const followed = await fetch(url + '/m/follow', { method: 'POST', headers: { 'content-type': 'application/json', 'x-snapback-persona': 'bob' }, body: JSON.stringify({ args: { actor: 'dev:alice' } }) });
    assert.equal((await followed.json()).state, 'sent');
  }
  const vite = await createServer({ configFile: false, root: import.meta.dirname, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    plugins: [{ name: 'fw-page', configureServer(server) { server.middlewares.use((req, res, next) => { if (req.url !== '/') return next(); res.setHeader('content-type', 'text/html'); res.end('<script type="module" src="/adoption-page.mjs"></script>'); }); } }] });
  await vite.listen(); t.after(() => vite.close());
  const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const guard = setTimeout(() => { console.error('browser deadlock guard'); void browser.close(); }, 40000);
  t.after(() => { clearTimeout(guard); return browser.close(); });
  const context = await browser.newContext();
  const errors = [];
  const stage = (...args) => { if (process.env.FW_TRACE) console.error(...args); };
  async function tab() {
    const page = await context.newPage(); page.on('pageerror', e => { errors.push(e.message); stage('pageerror', e.message); });
    await page.goto(vite.resolvedUrls.local[0]); await page.waitForFunction(() => window.openClient);
    stage('open', worker); await page.evaluate(options => window.openClient(options), { url, worker }); stage('opened'); return page;
  }
  const keeper = await tab();
  const donor = await tab();
  t.after(async () => { await keeper.evaluate(() => window.finish()).catch(() => {}); await donor.evaluate(() => window.finish()).catch(() => {}); });
  if (process.env.FW_EXPECT_ROUND0) assert.equal(await keeper.evaluate(() => window.implementation()), false, 'serve the actual round 0 SDK');
  await keeper.evaluate(() => window.sync()); // Discover the live donor and wait for its Web Lock release.
  const oldCount = name === 'follow' ? 0 : 1, newCount = 1 - oldCount;
  await keeper.evaluate(n => window.ready(n), oldCount);
  // Keep query retry timers runnable; write/apply gates own the causal boundary.
  {
    stage(name, 'offline'); await donor.evaluate(() => window.offline());
    await keeper.evaluate(() => window.hold());
    const write = await donor.evaluate(name => window.write(name, { actor: 'dev:alice' }), name);
    assert.equal(write.state, 'pending');
    const prior = await keeper.evaluate(() => window.snapshot());
    assert.equal(prior.complete, true); assert.equal(prior.data.length, oldCount, 'another live tab owns the pending write');
    stage(name, 'close donor'); await donor.evaluate(() => window.finish()); // Releases its Web Lock; keeper adopts via IndexedDB.
    await keeper.evaluate(() => window.atRequest()); // Adoption is durable; server has not executed it.
    stage(name, 'adopted');
    assert.ok(honest(await keeper.evaluate(() => window.custodySnapshot)), `${name}: committed custody marks the mounted answer synchronously`);
    const pending = await keeper.evaluate(() => window.pending());
    assert.ok(pending.some(entry => entry.id === write.id));
    assert.ok(honest(await keeper.evaluate(() => window.snapshot())), `${name}: custody must invalidate the mounted answer before transport`);
    await keeper.evaluate(() => window.beginQuery());
    assert.deepEqual(await keeper.evaluate(() => window.readStatus()), [{ cards: false, postState: false }], 'both dependent reads wait before POST execution');
    await keeper.evaluate(() => window.send()); await keeper.evaluate(() => window.atSync());
    assert.ok(honest(await keeper.evaluate(() => window.snapshot())), `${name}: receipt is not observation`);
    await keeper.evaluate(() => window.beginQuery()); // Independently exercise receipt custody with fresh reads.
    assert.deepEqual(await keeper.evaluate(() => window.readStatus()), [{ cards: false, postState: false }, { cards: false, postState: false }], 'both original and new dependent reads wait before apply');
    await keeper.evaluate(() => window.apply()); await keeper.evaluate(n => window.ready(n), newCount);
    const read = await keeper.evaluate(() => window.reading);
    assert.equal(read.data?.length, newCount); assert.equal(read.complete, true);
    const state = await keeper.evaluate(() => window.stateReading);
    assert.deepEqual(state.data, { liked: false, reposted: false }); assert.equal(state.complete, true);
    for (const pair of await keeper.evaluate(() => window.readResults())) {
      assert.equal(pair.cards.data?.length, newCount); assert.equal(pair.cards.complete, true);
      assert.deepEqual(pair.postState.data, { liked: false, reposted: false }); assert.equal(pair.postState.complete, true);
    }
    for (const read of await keeper.evaluate(() => window.publications)) assert.ok(honest(read) || read.data?.length === newCount, `${name}: ${JSON.stringify(read)}`);
    await keeper.evaluate(() => window.release()); await donor.close();
  }
  assert.deepEqual(errors, []);
});
