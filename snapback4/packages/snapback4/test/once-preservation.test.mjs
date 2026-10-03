// @ref LLP 3000.023#12 — bytes-once retention never grants bytes or outlives hard withdrawals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture, source, opener, open, q, m, parked, until } from './helpers/answers-stay.mjs';
import { createClient } from '../dist/client.js';
import { createApp } from '../dist/app.js';
import { keepSession, memorySessionStore } from '../dist/auth.js';
import { episodeDeadline } from '../dist/read-episode.js';
import { Pages } from '../dist/react-pages.js';
import { hangBudget } from './helpers/wait.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const onceSource = source.replace('table messages:\n', 'table messages:\n  photo: image <=1000000 once ?\n') + `
mutation attach(photo: image <=1000000):
  update messages['item'] { photo }
`;

async function mediaFixture(t) {
  const f = await fixture(t, onceSource);
  const uploader = createClient({ url: f.url, persona: 'alice' });
  t.after(() => uploader.close());
  const upload = await uploader.upload(png);
  assert.equal(upload.ok, true);
  assert.equal((await uploader.mutate(m('attach'), { photo: { id: upload.asset.id } })).state, 'sent');
  return { ...f, asset: upload.asset };
}

test('online: once history and pages survive held settlement after the bytes were viewed', { timeout: hangBudget(20) }, async t => {
  const f = await mediaFixture(t), gate = Promise.withResolvers();
  let hold = false, held = 0;
  const client = await open(t, f, 'online', { fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes' || path === '/probe') return parked(init.signal);
    if (hold && path === '/q/history') { held++; await Promise.race([gate.promise, parked(init.signal)]); }
    return fetch(input, init);
  } });
  t.after(() => gate.resolve());
  const watch = client.observe(q('history'), { c: null });
  const pages = new Pages(client, q('history'), {}), stop = pages.subscribe(() => {});
  t.after(() => { stop(); watch.close(); });
  await until(() => watch.getSnapshot().data?.length === 1 && pages.getSnapshot().items.length === 1);
  const viewed = await client.asset(f.asset.id);
  assert.ok(viewed.url); viewed.revoke();
  assert.equal((await client.asset(f.asset.id)).denied?.code, 'E_ASSET_VIEWED');
  const before = watch.getSnapshot().data;
  assert.deepEqual(before[0].photo, f.asset);
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  hold = true;
  assert.equal((await client.mutate(m('send'), { body: 'after view' })).state, 'sent');
  await until(() => held > 0 && watch.getSnapshot().revalidating);
  now += 5000;
  assert.deepEqual(watch.getSnapshot().data, before, 'same rows, order, columns and consumed handle remain');
  assert.deepEqual(pages.getSnapshot().items, before);
  assert.equal(episodeDeadline(watch.getSnapshot()), undefined);
  t.mock.restoreAll(); hold = false; gate.resolve();
  await until(() => watch.getSnapshot().data?.length === 2 && !watch.getSnapshot().revalidating);
  assert.equal((await client.asset(f.asset.id)).denied?.code, 'E_ASSET_VIEWED');
});

for (const host of ['online', 'process', 'wasm']) {
  test(`${host}: a retained once handle cannot fetch twice; delete-for-everyone removes the row`, { timeout: hangBudget(20) }, async t => {
    const f = await mediaFixture(t), client = await open(t, f, host);
    const watch = client.observe(q('history'), { c: null });
    t.after(() => watch.close());
    await until(() => watch.getSnapshot().data?.[0]?.photo?.id === f.asset.id);
    const viewed = await client.asset(f.asset.id);
    assert.ok(viewed.url);
    assert.deepEqual(Buffer.from(await (await fetch(viewed.url)).arrayBuffer()), png);
    viewed.revoke();
    assert.equal((await client.asset(f.asset.id)).denied?.code, 'E_ASSET_VIEWED');
    const refused = await fetch(`${f.url}/assets/${f.asset.id}`, { headers: { 'x-snapback-persona': 'bob' } });
    assert.equal(refused.status, 410);
    assert.equal((await refused.json()).denied.code, 'E_ASSET_VIEWED');
    assert.deepEqual((await client.query(q('history'), { c: null })).data[0].photo, f.asset);
    assert.deepEqual(watch.getSnapshot().data[0].photo, f.asset);
    assert.equal((await f.post('/m/erase', { id: 'erase', args: {} })).state, 'sent');
    if (client.sync) await client.sync();
    await until(() => watch.getSnapshot().data?.length === 0, 'delete-for-everyone replaces the history');
    assert.equal((await client.asset(f.asset.id)).denied?.code, 'E_ASSET_UNKNOWN');
  });

  test(`${host}: revoked membership withdraws once history at its one-second deadline`, { timeout: hangBudget(20) }, async t => {
    const f = await mediaFixture(t), changes = Promise.withResolvers(), gate = Promise.withResolvers();
    let hold = false, held = 0;
    const extra = { fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') await Promise.race([changes.promise, parked(init.signal)]);
      if (hold && (path === '/sync' || path === '/q/history')) {
        held++; await Promise.race([gate.promise, parked(init.signal)]);
      }
      return fetch(input, init);
    } };
    if (host !== 'online') {
      const device = opener(host, join(f.dir, 'deadline'));
      extra.device = { async open(...args) {
        const core = await device.open(...args);
        return { ...core, async call(request, committed) {
          if (hold && request.op === 'query') { held++; await gate.promise; }
          return core.call(request, committed);
        } };
      } };
    }
    const client = await open(t, f, host, extra);
    t.after(() => { changes.resolve(); gate.resolve(); });
    const watch = client.observe(q('history'), { c: null });
    const pages = new Pages(client, q('history'), {}), stop = pages.subscribe(() => {});
    t.after(() => { stop(); watch.close(); });
    await until(() => watch.getSnapshot().data?.length === 1 && pages.getSnapshot().items.length === 1);
    let now = Date.now(); const start = now; t.mock.method(Date, 'now', () => now);
    hold = true;
    assert.equal((await f.post('/m/remove', { id: 'kick', args: {} })).state, 'sent');
    changes.resolve();
    await until(() => held > 0 && episodeDeadline(watch.getSnapshot()) !== undefined);
    assert.equal(episodeDeadline(watch.getSnapshot()), start + 1000);
    now = start + 999;
    assert.equal(watch.getSnapshot().data?.length, 1);
    now = start + 1000;
    assert.equal(watch.getSnapshot().loading, true);
    assert.equal(pages.getSnapshot().items.length, 0);
    t.mock.restoreAll(); hold = false; gate.resolve();
    if (client.sync) await client.sync();
    await until(() => watch.getSnapshot().data?.length === 0, 'revoked member cannot recover old history');
  });

  for (const boundary of ['account', 'store']) test(`${host}: ${boundary} switch withdraws once history`, { timeout: hangBudget(20) }, async t => {
    const f = await mediaFixture(t), next = boundary === 'store' ? await fixture(t, onceSource) : f;
    const sessionStore = memorySessionStore();
    const session = persona => ({ principal: `dev:${persona}`, token: persona, kind: 'user', expiresAt: Date.now() + 86400_000 });
    await keepSession(f.url, session('bob'), sessionStore);
    let replacement = false;
    const app = createApp({ url: f.url, sessionStore,
      ...(host === 'online' ? {} : { device: opener(host, join(f.dir, 'app')) }),
      fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (path === '/auth/refresh') return Response.json({ session: session(new Headers(init.headers).get('authorization').slice(7)) });
        if (path === '/auth/login') return Response.json({ session: session('alice') });
        if (path === '/auth/logout') return Response.json({ ok: true });
        if (path === '/changes') return parked(init.signal);
        const headers = new Headers(init.headers);
        headers.set('x-snapback-persona', headers.get('authorization')?.slice(7) ?? 'bob');
        headers.delete('authorization');
        return fetch((replacement ? next.url : f.url) + path + new URL(input).search, { ...init, headers });
      },
    });
    t.after(() => app.close()); await app.ready;
    const oldClient = app.client, watch = oldClient.observe(q('history'), { c: null });
    const pages = new Pages(oldClient, q('history'), {}), stop = pages.subscribe(() => {});
    t.after(() => { stop(); watch.close(); });
    await until(() => watch.getSnapshot().data?.[0]?.photo?.id === f.asset.id && pages.getSnapshot().items.length === 1);
    const seen = [];
    const unwatch = watch.subscribe(() => seen.push({ read: watch.getSnapshot(), items: pages.getSnapshot().items }));
    t.after(unwatch);
    if (boundary === 'account') {
      assert.equal((await app.auth.login('alice@example.com', 'password')).ok, true);
      assert.equal(app.auth.viewer, 'dev:alice');
    } else {
      replacement = true;
      if (host === 'online') await oldClient.query(q('history'), { c: null });
      else await oldClient.sync();
    }
    const withdrawal = seen.findIndex(event => !event.read.data && event.items.length === 0);
    assert.ok(withdrawal >= 0, 'switch withdraws the history and Pages before a new-scope answer');
    assert.ok(seen.slice(withdrawal).every(event => !event.read.data?.some(row => row.photo?.id === f.asset.id)), 'old store/account cannot republish its handle');
    if (boundary === 'account') assert.equal(watch.getSnapshot().data, undefined);
    else assert.ok(!watch.getSnapshot().data?.some(row => row.photo?.id === f.asset.id));
  });
}
