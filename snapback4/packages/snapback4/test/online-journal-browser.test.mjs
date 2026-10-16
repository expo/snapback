import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.013.000#9 — real Chromium, a real dev server, createApp with no
// device: a click survives page loss and executes at most once; no wasm is fetched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, root } from '../../../witness/lib.mjs';
import { until } from './helpers/app-server.mjs';

test('a device-less browser app journals clicks synchronously and sends each once', { timeout: hangBudget(120) }, async t => {
  const project = mkdtempSync(join(tmpdir(), 'sb4-online-journal-'));
  const sourceDir = join(project, 'snapback'); mkdirSync(sourceDir);
  // No table syncs: the app writes through the server only.
  writeFileSync(join(sourceDir, 'schema.q'), `use personas alice, bob
use identity password

table audit:
  total: int
  public 'A non-idempotent execution counter.'
  update <- allow

mutation click():
  row = audit['audit'] ! else NOT_FOUND
  update audit[row] { total: row.total + 1 }

query total():
  return audit['audit'].total
`);
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const path = name => join(root, 'packages/snapback4/src', name);
  const witness = await launch({ sourceDir, watch: true, seed: [{ table: 'audit', row: { id: 'audit', total: 0 } }], entrySource: `
import { createApp } from '${path('app.ts')}';
import { keepSession, localStorageSessionStore, sessionKey } from '${path('auth.ts')}';
import { mintId } from '${path('client.ts')}';
Object.assign(window, { createApp, keepSession, localStorageSessionStore, sessionKey, mintId });
window.clickOp = { kind: 'mutation', name: 'click' };
window.records = () => Object.keys(localStorage).filter(key => key.startsWith('snapback4-online-admission:'));
window.boot = async ({ url, session, holdPosts = false, fakeSync = false, malformed = false, schemaFailure = false, writes, persona }) => {
  if (session) await keepSession(url, session, localStorageSessionStore());
  window.posts = []; window.held = [];
  window.app = createApp({ url, ...(persona ? { persona } : { sessionStore: localStorageSessionStore() }), ...(writes ? { writes } : {}),
    fetch: async (input, init) => {
      const route = new URL(String(input)).pathname;
      if (route === '/schema' && schemaFailure) throw Error('schema offline');
      if (route === '/changes') return new Promise(() => {});
      if (route.startsWith('/m/')) {
        window.posts.push(JSON.parse(init.body).id);
        // The request reaches the server; only its response is held back.
        if (holdPosts) { void fetch(input, init); return new Promise(() => {}); }
      }
      const response = await fetch(input, init);
      if (route === '/schema' && malformed) { await response.body?.cancel(); return Response.json({ schema: { tables: [] } }); }
      if (route === '/schema' && fakeSync) {
        const json = await response.json();
        json.schema.tables.audit.sync = { audience: 'Public', horizon: null };
        return Response.json(json);
      }
      return response;
    } });
  return app.ready;
};
// Refuse the next online-journal commit in IndexedDB: the click's only custody is localStorage.
window.refuseJournalCommits = () => {
  const transaction = IDBDatabase.prototype.transaction;
  window.allowJournalCommits = () => { IDBDatabase.prototype.transaction = transaction; };
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = transaction.apply(this, args);
    if (this.name === 'snapback4-session-authority' && args[1] === 'readwrite') {
      const put = tx.objectStore('sessions').put.bind(tx.objectStore('sessions'));
      tx.objectStore('sessions').put = (value, key) => { if (String(key?.[1]).endsWith('.writes')) { tx.abort(); return; } return put(value, key); };
    }
    return tx;
  };
};
` });
  t.after(() => witness.close());
  const { page, api: url } = witness, errors = [], wasm = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\.wasm(\?|$)/.test(request.url())) wasm.push(request.url()); });
  let count = 0, last;
  const fresh = async () => {
    await witness.reload();
    const session = (await fetch(url + '/auth/signup', { method: 'POST', body: JSON.stringify({
      email: `journal-${++count}@example.com`, password: 'a-test-password-long-enough',
    }) }).then(r => r.json())).session;
    assert.ok(session); last = session; return session;
  };
  const total = async () => (await fetch(url + '/q/total', { method: 'POST', headers: { authorization: 'Bearer ' + last.token }, body: '{}' }).then(r => r.json())).data;
  const navigate = async suffix => {
    await page.evaluate(suffix => { location.assign('/?' + suffix); }, suffix);
    await page.waitForURL('**/?' + suffix); await page.waitForFunction(() => !!window.boot);
  };
  const results = {};

  await t.test('persona writes capture synchronously; reload replays one execution and keeps principals separate', async () => {
    await fresh();
    await page.evaluate(options => boot(options), { url, persona: 'alice', holdPosts: true });
    const before = await total();
    const captured = await page.evaluate(() => {
      const id = mintId(), write = app.mutate(clickOp, {}, { id, waitSeconds: 0 });
      return { id, records: records().length, state: write.state };
    });
    assert.equal(captured.records, 1); assert.equal(captured.state, undefined);
    await until(async () => await total() === before + 1);
    await navigate('persona-bob');
    assert.deepEqual(await page.evaluate(options => boot(options), { url, persona: 'bob' }), { ok: true });
    assert.deepEqual(await page.evaluate(() => posts), [], 'Bob never replays Alice');
    await page.evaluate(() => app.close());
    await navigate('persona-alice');
    await page.evaluate(options => boot(options), { url, persona: 'alice' });
    await until(() => page.evaluate(id => app.client.write(id).then(w => w?.state === 'sent' && w.replayed), captured.id));
    assert.deepEqual(await page.evaluate(() => posts), [captured.id]);
    assert.equal(await total(), before + 1);
    await page.evaluate(() => app.close());
  });

  await t.test('persona custody survives forward and rollback generations without replaying as a peer', async () => {
    await fresh();
    const original = readFileSync(join(witness.app, 'snapback/schema.q'), 'utf8');
    const headers = { 'x-snapback-persona': 'alice' };
    const backend = () => fetch(url + '/schema', { headers }).then(r => r.json());
    let generation = (await backend()).generation;
    const before = await total();
    await page.evaluate(options => boot(options), { url, persona: 'alice' });
    const id = await page.evaluate(() => {
      refuseJournalCommits(); const id = mintId(); app.mutate(clickOp, {}, { id, waitSeconds: 0 });
      location.assign('/?persona-release-capture'); return id;
    });
    await page.waitForURL('**/?persona-release-capture'); await page.waitForFunction(() => !!window.boot);
    assert.equal(await page.evaluate(() => records().length), 1);
    try {
      writeFileSync(join(witness.app, 'snapback/schema.q'), original + '\nquery releaseMarker():\n  return 2\n');
      await until(async () => (await backend()).generation > generation);
      generation = (await backend()).generation;
      await page.evaluate(options => boot(options), { url, persona: 'bob' });
      assert.deepEqual(await page.evaluate(() => posts), []);
      assert.equal(await page.evaluate(() => records().length), 1);
      await page.evaluate(() => app.close());
      writeFileSync(join(witness.app, 'snapback/schema.q'), original);
      await until(async () => (await backend()).generation > generation);
      await page.evaluate(options => boot(options), { url, persona: 'alice' });
      await until(async () => await total() === before + 1);
      assert.deepEqual(await page.evaluate(() => posts), [id]);
      await page.evaluate(() => app.close());
      await navigate('persona-release-reopen');
      await page.evaluate(options => boot(options), { url, persona: 'alice' });
      assert.equal(await total(), before + 1);
      assert.deepEqual(await page.evaluate(() => posts), []);
      await page.evaluate(() => app.close());
    } finally { writeFileSync(join(witness.app, 'snapback/schema.q'), original); }
  });

  await t.test('persona same-turn navigation before IndexedDB commit preserves the click', async () => {
    await fresh(); const before = await total();
    await page.evaluate(options => boot(options), { url, persona: 'alice' });
    const id = await page.evaluate(() => {
      refuseJournalCommits(); const id = mintId(); app.mutate(clickOp, {}, { id, waitSeconds: 0 });
      location.assign('/?persona-captured'); return id;
    });
    await page.waitForURL('**/?persona-captured'); await page.waitForFunction(() => !!window.boot);
    assert.equal(await total(), before); assert.equal(await page.evaluate(() => records().length), 1);
    await page.evaluate(options => boot(options), { url, persona: 'bob' });
    assert.equal(await page.evaluate(() => records().length), 1, 'Bob leaves Alice capture intact');
    await page.evaluate(() => app.close());
    await page.evaluate(options => boot(options), { url, persona: 'alice' });
    await until(async () => await total() === before + 1);
    assert.deepEqual(await page.evaluate(() => posts), [id]);
    await page.evaluate(() => app.close());
  });

  await t.test('persona syncing schema and invalid combinations publish opening refusals; explicit online works', async () => {
    await fresh();
    const refused = await page.evaluate(options => boot(options), { url, persona: 'alice', fakeSync: true });
    assert.equal(refused.ok, false); assert.equal(refused.why.code, 'E_ADMISSION');
    assert.match(refused.why.rewrite, /writes: "online"/);
    assert.equal(await page.evaluate(() => app.auth.why.code), 'E_ADMISSION');
    await page.evaluate(() => app.close());
    const invalid = await page.evaluate(async url => {
      let deviceOpens = 0, requests = 0;
      const refusedApp = createApp({ url, persona: 'alice', writes: 'online',
        device: async () => { deviceOpens++; throw Error('device must stay unopened'); },
        fetch: async () => { requests++; throw Error('transport must stay unopened'); },
      });
      try {
        const ready = await refusedApp.ready;
        return { ready, auth: refusedApp.auth.getSnapshot(), guest: await refusedApp.auth.guest(), deviceOpens, requests };
      } finally { await refusedApp.close(); }
    }, url);
    assert.equal(invalid.ready.ok, false); assert.equal(invalid.ready.why.code, 'E_CLIENT');
    assert.equal(invalid.ready.why.site, 'createApp.writes');
    assert.equal(invalid.auth.state, 'signed-out'); assert.equal(invalid.auth.viewer, null);
    assert.deepEqual(invalid.auth.why, invalid.ready.why);
    assert.deepEqual(invalid.guest, invalid.ready, 'sign-in keeps the configuration refusal visible');
    assert.equal(invalid.deviceOpens, 0); assert.equal(invalid.requests, 0);
    await page.evaluate(options => boot(options), { url, persona: 'alice', fakeSync: true, writes: 'online' });
    assert.equal((await page.evaluate(() => app.mutate(clickOp, {}))).state, 'sent');
    await page.evaluate(() => app.close());
  });

  await t.test('a syncing schema refuses new writes at opening while recovering older persona intent', async () => {
    await fresh(); const before = await total();
    await page.evaluate(options => boot(options), { url, persona: 'alice' });
    const id = await page.evaluate(() => {
      refuseJournalCommits(); const id = mintId(); app.mutate(clickOp, {}, { id, waitSeconds: 0 });
      location.assign('/?persona-schema-change'); return id;
    });
    await page.waitForURL('**/?persona-schema-change'); await page.waitForFunction(() => !!window.boot);
    const ready = await page.evaluate(options => boot(options), { url, persona: 'alice', fakeSync: true });
    assert.equal(ready.ok, false); assert.equal(ready.why.code, 'E_ADMISSION');
    const refused = await page.evaluate(() => app.mutate(clickOp, {}));
    assert.equal(refused.state, 'failed'); assert.equal(refused.why.code, 'E_ADMISSION');
    await until(async () => await total() === before + 1);
    assert.deepEqual(await page.evaluate(() => posts), [id]);
    await page.evaluate(() => app.close());
  });

  await t.test('unknown schema selection still recovers captured and committed persona intent', async () => {
    for (const schemaFailure of [false, true]) for (const captured of [false, true]) {
      await fresh(); const before = await total();
      await page.evaluate(options => boot(options), { url, persona: 'alice', holdPosts: !captured });
      let id;
      if (captured) {
        id = await page.evaluate(() => { refuseJournalCommits(); const id = mintId(); app.mutate(clickOp, {}, { id, waitSeconds: 0 }); location.assign('/?unknown-capture'); return id; });
        await page.waitForURL('**/?unknown-capture'); await page.waitForFunction(() => !!window.boot);
      } else {
        id = await page.evaluate(() => { const id = mintId(); app.mutate(clickOp, {}, { id, waitSeconds: 0 }); return id; });
        await until(async () => await total() === before + 1);
        await navigate('unknown-pending');
      }
      const ready = await page.evaluate(options => boot(options), { url, persona: 'alice', malformed: !schemaFailure, schemaFailure });
      assert.equal(ready.ok, false); assert.equal(ready.why.code, 'E_ADMISSION'); assert.equal(ready.why.retryable, true);
      const refusal = await page.evaluate(() => app.mutate(clickOp, {}));
      assert.equal(refusal.state, 'failed'); assert.equal(refusal.why.code, 'E_ADMISSION');
      await until(async () => await total() === before + 1);
      await until(() => page.evaluate(id => app.client.write(id).then(w => w?.state === 'sent'), id));
      assert.deepEqual(await page.evaluate(() => posts), [id]);
      await page.evaluate(() => app.close());
      assert.equal(await page.evaluate(async () => (await navigator.locks.query()).held.filter(l => l.name.startsWith('snapback4-online-runtime:')).length), 0);
    }
  });

  await t.test('persona reset observed by a read retires custody and releases the runtime lock', async () => {
    await fresh();
    await page.evaluate(options => boot(options), { url, persona: 'alice' });
    assert.equal(await page.evaluate(async () => (await navigator.locks.query()).held.filter(l => l.name.startsWith('snapback4-online-runtime:')).length), 1);
    await fetch(url + '/dev/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed: [{ table: 'audit', row: { id: 'audit', total: 0 } }] }) });
    const read = await page.evaluate(() => app.client.query({ kind: 'query', name: 'total' }, {}));
    assert.equal(read.denied?.code, 'E_STORE_REPLACED');
    await until(() => page.evaluate(async () => (await navigator.locks.query()).held.filter(l => l.name.startsWith('snapback4-online-runtime:')).length === 0));
    const write = await page.evaluate(() => app.mutate(clickOp, {}));
    assert.equal(write.state, 'failed'); assert.equal(write.why.code, 'E_STORE_REPLACED');
    await page.evaluate(() => app.close());
  });

  await t.test('failed persona retirement releases custody so reopening resolves the old-store capture', async () => {
    await fresh();
    await page.evaluate(options => boot(options), { url, persona: 'alice' });
    const id = await page.evaluate(async () => {
      refuseJournalCommits(); window.oldApp = app;
      const id = mintId(); const write = await app.mutate(clickOp, {}, { id, waitSeconds: 0 });
      if (write.state !== 'pending') throw Error(JSON.stringify(write)); return id;
    });
    assert.equal(await page.evaluate(() => records().length), 1);
    await fetch(url + '/dev/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed: [{ table: 'audit', row: { id: 'audit', total: 0 } }] }) });
    const read = await page.evaluate(() => app.client.query({ kind: 'query', name: 'total' }, {}));
    assert.equal(read.denied?.code, 'E_STORE_REPLACED');
    await until(() => page.evaluate(async () => (await navigator.locks.query()).held.filter(l => l.name.startsWith('snapback4-online-runtime:')).length === 0));
    await page.evaluate(() => allowJournalCommits());
    await page.evaluate(options => boot(options), { url, persona: 'alice' });
    await until(() => page.evaluate(id => app.client.write(id).then(w => w?.state === 'failed' && w.why.code === 'E_STORE_REPLACED'), id));
    await until(() => page.evaluate(() => records().length === 0));
    assert.deepEqual(await page.evaluate(() => posts), [], 'the captured store binding is refused before dispatch');
    const total = await fetch(url + '/q/total', { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: '{}' }).then(r => r.json());
    assert.equal(total.data, 0);
    await page.evaluate(async () => { await oldApp.close(); await app.close(); });
  });

  await t.test('failed IndexedDB opening leaves no persona runtime lock after ready or close', async () => {
    await fresh();
    const result = await page.evaluate(async url => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = () => { throw Error('injected IndexedDB opening failure'); };
      try {
        const failed = createApp({ url, persona: 'alice', writes: 'online' });
        const ready = await failed.ready;
        const locks = async () => (await navigator.locks.query()).held.filter(l => l.name.startsWith('snapback4-online-runtime:')).length;
        const before = await locks(); await failed.close();
        return { ready, before, after: await locks() };
      } finally { IDBFactory.prototype.open = open; }
    }, url);
    assert.equal(result.ready.ok, false); assert.equal(result.ready.why.code, 'E_CLIENT');
    assert.equal(result.before, 0); assert.equal(result.after, 0);
  });

  await t.test('signed in with no synced table, a click is captured before mutate returns and sent once', async () => {
    const session = await fresh(), before = await total();
    await page.evaluate(options => boot(options), { url, session });
    const captured = await page.evaluate(() => {
      const id = mintId(), write = app.mutate(clickOp, {}, { id, waitSeconds: 0 });
      return { id, immediate: write.state ?? null, records: records().length };
    });
    assert.equal(captured.immediate, null); assert.equal(captured.records, 1);
    await until(async () => await total() === before + 1, 'executed');
    await until(() => page.evaluate(() => records().length === 0), 'record removed after commit');
    assert.deepEqual(await page.evaluate(() => posts), [captured.id]);
    await page.evaluate(() => app.close());
  });

  await t.test('a same-turn navigation after a click whose journal commit never landed recovers it once', async () => {
    const session = await fresh(), before = await total();
    await page.evaluate(options => boot(options), { url, session });
    const id = await page.evaluate(() => {
      refuseJournalCommits();
      const id = mintId(); app.mutate(clickOp, {}, { id, waitSeconds: 0 });
      location.assign('/?after-click');
      return id;
    });
    await page.waitForURL('**/?after-click'); await page.waitForFunction(() => !!window.boot);
    assert.equal(await total(), before, 'not sent before the page was lost');
    assert.equal(await page.evaluate(() => records().length), 1, 'only localStorage held the click');
    await page.evaluate(options => boot(options), { url });
    await until(async () => await total() === before + 1, 'recovered and executed');
    await until(() => page.evaluate(() => records().length === 0));
    assert.deepEqual(await page.evaluate(() => posts), [id], 'one send, original id');
    await page.evaluate(() => app.close());
    await navigate('again');
    await page.evaluate(options => boot(options), { url });
    await page.evaluate(() => app.client.pendingWrites());
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await total(), before + 1, 'a later open does not re-admit it');
    assert.deepEqual(await page.evaluate(() => posts), []);
    await page.evaluate(() => app.close());
    results.navigation = { executions: 1 };
  });

  await t.test('a reload while the POST response is held replays the same id; the server executes it once', async () => {
    const session = await fresh(), before = await total();
    await page.evaluate(options => boot(options), { url, session, holdPosts: true });
    const id = await page.evaluate(() => { const id = mintId(); app.mutate(clickOp, {}, { id, waitSeconds: 0 }); return id; });
    await until(async () => await total() === before + 1, 'the held request executed');
    await navigate('held');
    await page.evaluate(options => boot(options), { url });
    await until(() => page.evaluate(id => app.client.write(id).then(write => write?.state === 'sent' && write.replayed === true), id), 'replayed');
    assert.deepEqual(await page.evaluate(() => posts), [id]);
    assert.equal(await total(), before + 1, 'at most once');
    await page.evaluate(() => app.close());
  });

  await t.test('a full localStorage refuses E_ADMISSION in the calling stack and sends nothing', async () => {
    const session = await fresh(), before = await total();
    await page.evaluate(options => boot(options), { url, session });
    const outcome = await page.evaluate(() => {
      const filler = 'x'.repeat(256 * 1024); let i = 0;
      try { for (;;) localStorage.setItem('filler:' + i++, filler); } catch {}
      const tail = 'y'.repeat(1024);
      try { for (;;) localStorage.setItem('filler-tail:' + i++, tail); } catch {}
      const id = mintId(), write = app.mutate(clickOp, {}, { id });
      const immediate = { state: write.state, code: write.why?.code, message: write.why?.message };
      for (const key of Object.keys(localStorage)) if (key.startsWith('filler')) localStorage.removeItem(key);
      return { id, immediate };
    });
    assert.equal(outcome.immediate.state, 'failed'); assert.equal(outcome.immediate.code, 'E_ADMISSION');
    assert.match(outcome.immediate.message, /localStorage could not keep the write/);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(await page.evaluate(() => posts), []); assert.equal(await total(), before);
    const retried = await page.evaluate(id => app.mutate(clickOp, {}, { id }), outcome.id);
    assert.equal(retried.state, 'sent', 'the same id is admitted after repair');
    assert.equal(await total(), before + 1);
    await page.evaluate(() => app.close());
  });

  await t.test('a schema that syncs refuses with both rewrites; writes: "online" admits; a malformed reply is unknown', async () => {
    const session = await fresh(), before = await total();
    const refused = await page.evaluate(options => boot(options), { url, session, fakeSync: true });
    assert.equal(refused.ok, false); assert.equal(refused.why.code, 'E_ADMISSION');
    assert.match(refused.why.message, /this schema syncs audit/);
    assert.match(refused.why.rewrite, /device: webDevice\(\)/); assert.match(refused.why.rewrite, /writes: "online"/);
    await page.evaluate(() => app.close());
    await page.evaluate(options => boot(options), { url, fakeSync: true, writes: 'online' });
    assert.equal((await page.evaluate(() => app.mutate(clickOp, {}))).state, 'sent');
    assert.equal(await total(), before + 1);
    await page.evaluate(() => app.close());
    // A malformed reply is an unknown decision, never "nothing syncs".
    await page.evaluate(options => boot(options), { url, malformed: true });
    const unknown = await page.evaluate(() => { const w = app.mutate(clickOp, {}); return { state: w.state, why: w.why }; });
    assert.equal(unknown.state, 'failed'); assert.equal(unknown.why.code, 'E_ADMISSION'); assert.equal(unknown.why.retryable, true);
    assert.match(unknown.why.message, /has not said whether its tables sync/);
    await page.evaluate(() => app.close());
  });

  await t.test('a live tab keeps its own click; once it closes, the next open adopts it once', async () => {
    const session = await fresh(), before = await total();
    await page.evaluate(options => boot(options), { url, session });
    const id = await page.evaluate(() => { refuseJournalCommits(); const id = mintId(); app.mutate(clickOp, {}, { id, waitSeconds: 0 }); return id; });
    await until(() => page.evaluate(() => records().length === 1));
    const peer = await page.context().newPage();
    peer.setDefaultTimeout(hangBudget()); peer.setDefaultNavigationTimeout(hangBudget());
    try {
      await peer.goto(page.url()); await peer.waitForFunction(() => !!window.boot);
      await peer.evaluate(options => boot(options), { url });
      await peer.evaluate(() => app.client.pendingWrites());
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.equal(await total(), before, 'the peer never adopts a live tab\'s click');
      const ownerRuntime = await page.evaluate(() => JSON.parse(localStorage.getItem(records()[0])).runtime);
      await page.close();
      const locksAfterClose = await peer.evaluate(() => navigator.locks.query());
      t.diagnostic(JSON.stringify({ ownerRuntime, locksAfterClose }));
      // page.close() can resolve before Chromium releases the renderer's
      // Web Locks. Recovery correctly refuses that still-live lock; establish
      // the dead-owner precondition before asking a new open to adopt it.
      await until(() => peer.evaluate(async runtime => {
        const snapshot = await navigator.locks.query();
        return ![...(snapshot.held ?? []), ...(snapshot.pending ?? [])]
          .some(lock => lock.name === 'snapback4-online-runtime:' + runtime);
      }, ownerRuntime), 'closed tab liveness lock released');
      await peer.evaluate(() => app.close());
      await peer.evaluate(options => boot(options), { url });
      await until(async () => await total() === before + 1, 'adopted after the tab closed');
      assert.deepEqual(await peer.evaluate(() => posts), [id]);
      await peer.evaluate(() => app.close());
    } finally { await peer.close(); }
  });

  await t.test('no wasm was fetched by any page', () => {
    assert.deepEqual(wasm, []);
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ wasmRequests: wasm.length, ...results }));
  });
});
