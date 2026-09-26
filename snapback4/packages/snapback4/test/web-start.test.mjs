// Real Chromium navigation: admission is asserted in the click's own stack,
// then a new document recovers the original ID through IndexedDB and /m.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { launch, root, binary } from '../../../witness/lib.mjs';
import { until } from './helpers/app-server.mjs';
const source = `use identity

table members:
  room: text <=40
  principal: principal
  admin: bool
  unique room, principal
  read <- exists members[.room, viewer]
  delete <- exists members[.room, viewer, admin = true]
  sync to members[.room]

table removals:
  total: int
  public 'Non-idempotent audit for navigation tests.'
  update <- allow
  online only

mutation removeMember(room: text <=40, principal: principal):
  require exists members[room, viewer, admin = true] else NOT_ADMIN
  delete members[room, principal]
  audit = removals['audit'] ! else NOT_FOUND
  update removals[audit] { total: audit.total + 1 }

query roster(room: text <=40):
  return members where .room = room first 50
query total():
  return removals['audit'].total
`;
const require = createRequire(join(root, 'apps/chat/package.json'));

test('web startup: immediate admin navigation, synchronous refusals and acquisition hook', { timeout: 120_000 }, async t => {
  const project = mkdtempSync(join(tmpdir(), 'sb4-web-start-'));
  const sourceDir = join(project, 'snapback'); mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'schema.q'), source);
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const checked = spawnSync(binary(), ['check'], { cwd: project, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const sourceOverrides = process.env.SNAPBACK4_WEB_START_OLD_GUARD === '1'
    ? { [join(root, 'packages/snapback4/src/app-client.ts')]: execFileSync('git', ['show', 'a52b48cad:snapback4/packages/snapback4/src/app-client.ts'], { cwd: root, encoding: 'utf8' }) } : {};
  if (process.env.SNAPBACK4_WEB_START_AUTHORITY_MUTANT === '1') {
    const path = join(root, 'packages/snapback4/src/web-journal.ts');
    sourceOverrides[path] = readFileSync(path, 'utf8').replace(
      'return storeLock(stamp.key, async () => await sameAdmissionAuthority(stamp, this.authority!, record.entry.viewer) ? admitted() : refused());', 'return admitted();');
  }
  if (process.env.SNAPBACK4_WEB_START_AUTHORITY_MUTANT === 'recovery') {
    const path = join(root, 'packages/snapback4/src/web-journal.ts');
    sourceOverrides[path] = readFileSync(path, 'utf8').replace('await this.authorize(record, async () => {',
      'await (async (_record, admitted) => admitted())(record, async () => {');
  }
  if (process.env.SNAPBACK4_WEB_START_AUTHORITY_MUTANT === 'fence') {
    const path = join(root, 'packages/snapback4/src/app.ts');
    sourceOverrides[path] = readFileSync(path, 'utf8').replace(
      'void authorized().catch(() => {});',
      'fence(scope, new SessionEpochChanged());');
  }
  const witness = await launch({ seed: [], sourceDir, sourceOverrides, entrySource: `
import { createApp } from '${join(root, 'packages/snapback4/src/app.ts')}';
import { keepSession, localStorageSessionStore, sessionKey } from '${join(root, 'packages/snapback4/src/auth.ts')}';
import { mintId, createClient } from '${join(root, 'packages/snapback4/src/client.ts')}';
import { memoryPersistence } from '${join(root, 'packages/snapback4/src/web.ts')}';
import { api } from '${join(sourceDir, 'generated/api.ts')}';
import { AppProvider, useAcquisition, useAcquired, useQuery } from '${join(root, 'packages/snapback4/src/react.tsx')}';
import { createElement as h } from '${require.resolve('react')}';
import { createRoot } from '${require.resolve('react-dom/client')}';
Object.assign(window, { createApp, keepSession, localStorageSessionStore, mintId, createClient, memoryPersistence, api, sessionKey });
window.mountProgress = (app) => {
  const target = document.createElement('div'); document.body.append(target);
  window.progress = [];
  function Status() {
    const value = useAcquisition(), acquired = useAcquired();
    window.progress.push({ ...value, acquiredLegacy: acquired });
    return h('p', { id: 'progress' }, value.acquired ? 'Offline ready' : 'Preparing offline: ' + value.rows);
  }
  createRoot(target).render(h(AppProvider, { app }, h(Status)));
};
` });
  t.after(() => witness.close());
  const { page, api } = witness;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const signed = await fetch(api + '/auth/guest', { method: 'POST' }).then(r => r.json());
  assert.ok(signed.session?.principal, 'guest session issued');
  let session = signed.session;
  const seed = [{ table: 'removals', row: { id: 'audit', total: 0 } }];
  for (let room = 0; room < 5; room++) seed.push(
    { table: 'members', row: { id: `a${room}`, room: `room${room}`, principal: session.principal, admin: true } },
    { table: 'members', row: { id: `b${room}`, room: `room${room}`, principal: 'user:other', admin: false } });
  const seeded = await fetch(api + '/seed', { method: 'POST', body: JSON.stringify(seed) }).then(r => r.json());
  assert.equal(seeded.seeded, seed.length, JSON.stringify(seeded));
  const sent = []; page.on('request', request => { if (request.url().endsWith('/m/removeMember')) sent.push(JSON.parse(request.postData())); });
  const prepare = async ({ holdSync = false, holdAdmission = false } = {}) => {
    await page.evaluate(async ({ api, session, holdSync, holdAdmission }) => {
      const storage = localStorageSessionStore();
      await keepSession(api, session, storage);
      const persist = indexedDbPersistence(), save = persist.save;
      persist.save = (name, changes) => holdAdmission && changes.some(c => c.s === 'o') ? new Promise(() => {}) : save(name, changes);
      let release; const gate = new Promise(resolve => release = resolve);
      window.releaseSync = release;
      window.app = createApp({ url: api, sessionStore: storage, device: webDevice({ persist }), waitSeconds: 1,
        fetch: async (url, init) => { if (holdSync && String(url).endsWith('/sync')) await gate; return fetch(url, init); } });
      mountProgress(app);
      if (!holdSync) await app.ready;
    }, { api, session, holdSync, holdAdmission });
  };
  await t.test('createApp and generated api journal before immediate location.assign', async () => {
    await prepare({ holdAdmission: true });
    // Force the old guard's asynchronous epoch check to stay pending until
    // document teardown. The new guard can synchronously validate the stored
    // epoch and journal while another session operation holds this lock.
    await page.evaluate(api => new Promise(resolve => {
      void navigator.locks.request(sessionKey(api), async () => { resolve(); await new Promise(() => {}); });
    }), api);
    await page.evaluate(() => {
      const button = document.createElement('button'); button.textContent = 'Remove member'; document.body.append(button);
      button.onclick = () => {
        const id = mintId();
        app.mutate(api.removeMember, { room: 'room0', principal: 'user:other' }, { id });
        const journal = Object.keys(localStorage).filter(key => key.startsWith('snapback4-admission:')).map(key => JSON.parse(localStorage.getItem(key)));
        sessionStorage.setItem('click', JSON.stringify({ id, journal }));
        location.assign('/?removed=1');
      };
    });
    await page.getByRole('button', { name: 'Remove member', exact: true }).click({ noWaitAfter: true });
    await page.waitForURL('**/?removed=1'); await page.waitForFunction(() => !!window.createApp);
    const click = await page.evaluate(() => JSON.parse(sessionStorage.getItem('click')));
    if (process.env.SNAPBACK4_WEB_START_OLD_GUARD === '1' && click.journal.length === 0) {
      await page.evaluate(async api => {
        window.app = createApp({ url: api, sessionStore: localStorageSessionStore(), device: webDevice(), waitSeconds: 1 });
        await app.ready;
      }, api);
      const total = await page.evaluate(() => app.client.query(api.total, {}));
      t.diagnostic(JSON.stringify({ oldGuard: true, synchronousJournalRecords: click.journal.length, mutationRequests: sent.length, removalsAfterReopen: total.data }));
      assert.equal(total.data, 1, 'the admin click must recover after navigation');
    }
    assert.equal(click.journal.length, 1); assert.equal(click.journal[0].entry.id, click.id);
    await page.evaluate(async api => {
      window.app = createApp({ url: api, sessionStore: localStorageSessionStore(), device: webDevice(), waitSeconds: 1 });
      await app.ready;
    }, api);
    await until(() => page.evaluate(async id => (await app.client.write(id))?.state === 'sent', click.id), 'recovered write sent');
    const total = await page.evaluate(() => app.client.query(api.total, {}));
    assert.equal(total.data, 1);
    assert.ok(sent.length > 0); assert.ok(sent.every(write => write.id === click.id));
    await page.evaluate(() => app.close());
  });
  if (process.env.SNAPBACK4_WEB_START_OLD_GUARD === '1') return;
  await t.test('restored identified device journals while its first sync is held', async () => {
    await witness.reload();
    await prepare({ holdSync: true, holdAdmission: true });
    await page.waitForFunction(() => app.auth.state === 'signed-in');
    await page.evaluate(() => {
      const id = mintId();
      app.client.mutate(api.removeMember, { room: 'room2', principal: 'user:other' }, { id });
      const journal = Object.keys(localStorage).filter(key => key.startsWith('snapback4-admission:')).map(key => JSON.parse(localStorage.getItem(key)));
      sessionStorage.setItem('click', JSON.stringify({ id, journal }));
      location.assign('/?removed=2');
    });
    await page.waitForURL('**/?removed=2'); await page.waitForFunction(() => !!window.createApp);
    const click = await page.evaluate(() => JSON.parse(sessionStorage.getItem('click')));
    assert.equal(click.journal.length, 1); assert.equal(click.journal[0].entry.id, click.id);
    await page.evaluate(async api => {
      window.app = createApp({ url: api, sessionStore: localStorageSessionStore(), device: webDevice(), waitSeconds: 1 });
      await app.ready;
    }, api);
    await until(() => page.evaluate(async id => (await app.client.write(id))?.state === 'sent', click.id), 'recovered write sent');
    assert.equal((await page.evaluate(() => app.client.query(api.total, {}))).data, 2);
    assert.ok(sent.some(write => write.id === click.id));
    await page.evaluate(() => app.close());
  });
  for (const phase of ['restoring', 'no-device', 'no-claim', 'ephemeral-device', 'storage-full', 'before-first-sync']) await t.test(`synchronous refusal: ${phase}`, async () => {
    await witness.reload();
    const result = await page.evaluate(async ({ api, phase, session }) => {
      const storage = localStorageSessionStore(); await keepSession(api, session, storage);
      let release; const gate = new Promise(resolve => release = resolve);
      const persist = phase === 'ephemeral-device' ? memoryPersistence() : indexedDbPersistence();
      if (phase === 'no-claim') persist.claim = async () => null;
      const opener = webDevice({ persist });
      // A genuinely empty device has no durable backend identity.
      const device = { open: (name, backend) => opener.open(name + ':fresh-' + phase, backend) };
      window.app = createApp({ url: api, sessionStore: storage, ...(phase === 'no-device' ? {} : { device }), waitSeconds: 1,
        fetch: async (url, init) => { if (phase === 'before-first-sync' && String(url).endsWith('/sync')) await gate; return fetch(url, init); } });
      if (phase === 'before-first-sync') while (app.auth.state !== 'signed-in') await new Promise(r => setTimeout(r, 5));
      else if (phase !== 'restoring') await app.ready;
      const original = Storage.prototype.setItem;
      if (phase === 'storage-full') Storage.prototype.setItem = function (key, value) { if (key.startsWith('snapback4-admission:')) throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); };
      const id = mintId(), returned = app.mutate(window.api.removeMember, { room: 'room1', principal: 'user:other' }, { id });
      const immediate = { state: returned.state, code: returned.why?.code, id: returned.id };
      Storage.prototype.setItem = original;
      release();
      const outcome = await returned;
      await app.ready; await app.close();
      return { immediate, outcome, journal: Object.keys(localStorage).filter(key => key.startsWith('snapback4-admission:')).length };
    }, { api, phase, session });
    assert.equal(result.immediate.state, 'failed'); assert.equal(result.immediate.code, 'E_ADMISSION');
    assert.deepEqual(result.immediate, { state: result.outcome.state, code: result.outcome.why.code, id: result.outcome.id });
    assert.equal(result.journal, 0);
  });
  await t.test('repairing storage permits the refused id to be retried', async () => {
    await witness.reload(); await prepare();
    const result = await page.evaluate(async () => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key.startsWith('snapback4-admission:')) throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); };
      const id = mintId(), args = { room: 'room4', principal: 'user:other' };
      const first = app.client.mutate(api.removeMember, args, { id });
      const immediate = first.state;
      Storage.prototype.setItem = original;
      const retry = await app.client.mutate(api.removeMember, args, { id });
      await app.close();
      return { immediate, refused: (await first).why.code, retry };
    });
    assert.equal(result.immediate, 'failed'); assert.equal(result.refused, 'E_ADMISSION'); assert.equal(result.retry.state, 'sent');
  });
  await t.test('useAcquisition reports committed snapshot pages and completion', async () => {
    await witness.reload();
    await page.evaluate(async ({ api, session }) => {
      await keepSession(api, session, localStorageSessionStore());
      const opener = webDevice();
      window.app = createApp({ url: api, sessionStore: localStorageSessionStore(), device: { open: (name, backend) => opener.open(name + ':progress', backend) }, waitSeconds: 1,
        fetch: async (url, init) => {
          if (String(url).endsWith('/sync')) {
            init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), limit: 2 }) };
            await new Promise(r => setTimeout(r, 20));
          }
          return fetch(url, init);
        } });
      mountProgress(app); await app.ready;
    }, { api, session });
    await page.waitForFunction(() => window.progress.some(p => p.acquired));
    const progress = await page.evaluate(() => window.progress);
    assert.ok(progress.some(p => !p.acquired && p.rows > 0));
    assert.ok(progress.some(p => p.acquired && p.rows === 7 && p.tables.members === 7), JSON.stringify(progress));
    assert.ok(progress.every(p => p.acquired === p.acquiredLegacy));
    await page.evaluate(() => app.close());
  });
  for (const change of ['logout', 'principal', 'epoch', 'recovery']) await t.test(`session-locked journal refuses stale authority: ${change}`, async () => {
    session = (await fetch(api + '/auth/guest', { method: 'POST' }).then(r => r.json())).session;
    await fetch(api + '/seed', { method: 'POST', body: JSON.stringify([{ table: 'members', row: { id: 'authority-' + change, room: 'room3', principal: session.principal, admin: true } }]) });
    await witness.reload(); await prepare();
    const peer = await page.context().newPage();
    await peer.goto(page.url()); await peer.waitForFunction(() => !!window.sessionKey);
    try {
      await peer.evaluate(api => new Promise(resolve => {
        void navigator.locks.request(sessionKey(api), async () => {
          resolve(); await new Promise(release => window.releaseSession = release);
        });
      }), api);
      const before = sent.length;
      const captured = await page.evaluate(() => {
        const id = mintId();
        window.racingWrite = app.mutate(api.removeMember, { room: 'room3', principal: 'user:other' }, { id });
        const key = Object.keys(localStorage).find(k => k.startsWith('snapback4-admission:'));
        const record = JSON.parse(localStorage.getItem(key));
        return { id, record, store: decodeURIComponent(key.split(':')[1]) };
      });
      assert.equal(captured.record.authority.principal, session.principal);
      await until(() => page.evaluate(async api => (await navigator.locks.query()).pending.some(lock => lock.name === sessionKey(api)), api), 'admission queued on the session lock');
      const outbox = await page.evaluate(async ({ store, id }) => indexedDbPersistence().read(store, 'o', id), captured);
      assert.equal(outbox, null, 'the journal must wait for the session lock before device admission');
      assert.equal(sent.length, before);
      if (change === 'recovery') {
        await page.evaluate(() => location.assign('/?logout-recovery=1'));
        await page.waitForURL('**/?logout-recovery=1'); await page.waitForFunction(() => !!window.createApp);
      }
      const other = change === 'principal' ? (await fetch(api + '/auth/guest', { method: 'POST' }).then(r => r.json())).session : session;
      await peer.evaluate(async ({ api, change, other, epoch }) => {
        const value = change === 'principal' ? { ...other, snapback4Epoch: epoch }
          : change === 'epoch' ? { ...other, snapback4Epoch: String(BigInt(epoch) + 1n) }
          : { snapback4Logout: String(BigInt(epoch) + 1n) };
        await localStorageSessionStore().set(sessionKey(api), JSON.stringify(value));
        window.releaseSession();
      }, { api, change, other, epoch: captured.record.authority.epoch });
      if (change === 'recovery') {
        await page.evaluate(async ({ api, session, epoch }) => {
          // A subsequent sign-in must not promote the older unadmitted click.
          await navigator.locks.request(sessionKey(api), () => localStorageSessionStore().set(sessionKey(api), JSON.stringify({ ...session, snapback4Epoch: String(BigInt(epoch) + 1n) })));
          window.app = createApp({ url: api, sessionStore: localStorageSessionStore(), device: webDevice(), waitSeconds: 1 });
          await app.ready;
        }, { api, session, epoch: captured.record.authority.epoch });
        await page.waitForFunction(id => !Object.keys(localStorage).some(key => key.startsWith('snapback4-admission:') && key.endsWith(id)), captured.id);
        assert.equal(await page.evaluate(id => app.client.write(id), captured.id), undefined, 'recovery must cancel the stale intent before adding it to the outbox');
      } else {
        const outcome = await page.evaluate(() => racingWrite);
        assert.equal(outcome.state, 'failed'); assert.equal(outcome.why.code, 'E_AUTH');
      }
      await page.evaluate(() => app.close());
      assert.equal(sent.length, before, 'no stale journal may send /m');
      const observer = (await fetch(api + '/auth/guest', { method: 'POST' }).then(r => r.json())).session;
      const total = await fetch(api + '/q/total', { method: 'POST', headers: { authorization: `Bearer ${observer.token}` }, body: '{}' }).then(r => r.json());
      assert.equal(total.data, 3, JSON.stringify(total));
      t.diagnostic(JSON.stringify({ change, journaled: true, outboxWhileLocked: outbox, mutationRequests: sent.length - before, serverTotal: total.data }));
    } finally {
      await peer.evaluate(() => window.releaseSession?.());
      await peer.close();
    }
  });
  await t.test('a transient unlocked epoch observation refuses only that call', async () => {
    await witness.reload(); await prepare();
    const result = await page.evaluate(async apiUrl => {
      const client = app.client, get = Storage.prototype.getItem, key = sessionKey(apiUrl) + '.epoch';
      Storage.prototype.getItem = function (name) { return name === key ? '9999999' : get.call(this, name); };
      let write;
      try { write = client.mutate(api.removeMember, { room: 'room3', principal: 'user:other' }); }
      finally { Storage.prototype.getItem = get; }
      const immediate = { state: write.state, code: write.why?.code };
      const roster = await client.query(api.roster, { room: 'room3' });
      await app.close();
      return { immediate, rows: roster.data?.length, denied: roster.denied };
    }, api);
    assert.deepEqual(result.immediate, { state: 'failed', code: 'E_AUTH' });
    assert.equal(result.denied, undefined); assert.ok(result.rows > 0);
  });
  await t.test('the bare online browser transport refuses without custody', async () => {
    const outcome = await page.evaluate(async ({ api, session }) => {
      let sends = 0;
      const client = createClient({ url: api, session, fetch: () => { sends++; throw Error('must not dispatch'); } });
      const returned = client.mutate(window.api.removeMember, { room: 'room3', principal: 'user:other' });
      const immediate = { state: returned.state, code: returned.why?.code };
      await client.close(); return { immediate, outcome: (await returned).state, sends };
    }, { api, session });
    assert.deepEqual(outcome, { immediate: { state: 'failed', code: 'E_ADMISSION' }, outcome: 'failed', sends: 0 });
  });
  for (const legacy of [false, true]) await t.test(`IndexedDB ${legacy ? 'legacy' : 'packed'} rows retain atomic abort and reopen`, async () => {
    const result = await page.evaluate(async legacy => {
      const name = 'row-format-' + legacy;
      if (legacy) await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('changes', { keyPath: ['s', 'k'] });
        request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
      });
      const store = indexedDbPersistence();
      const initial = Array.from({ length: 1000 }, (_, n) => ({ s: 'r', k: 'row-' + n, v: 'old-' + n }));
      initial.push({ s: 'm', k: 'watermark', v: '1' }, { s: 'o', k: 'queued', v: 'intent' });
      await store.save(name, initial);
      const before = await store.load(name);
      const update = initial.map(c => c.s === 'r' ? { ...c, v: 'new-' + c.k } : { ...c, v: c.s === 'm' ? '2' : null });
      const put = IDBObjectStore.prototype.put;
      let aborted = false;
      IDBObjectStore.prototype.put = function (value) {
        const request = put.call(this, value);
        if (this.transaction.db.name === name && (value.s === '$bucket' || value.s === 'r')) { this.transaction.abort(); aborted = true; }
        return request;
      };
      let failed = false;
      try { await store.save(name, update); } catch { failed = true; }
      finally { IDBObjectStore.prototype.put = put; }
      const after = await indexedDbPersistence().load(name);
      await indexedDbPersistence().save(name, update);
      await indexedDbPersistence().save(name, [{ s: 'r', k: 'row-0', v: null }]);
      const final = await indexedDbPersistence().load(name);
      const same = values => JSON.stringify(values.sort((a, b) => (a.s + a.k).localeCompare(b.s + b.k)));
      return { aborted, failed, unchanged: same(before) === same(after), rows: final.filter(c => c.s === 'r').length,
        watermark: await store.read(name, 'm', 'watermark'), deleted: await store.read(name, 'r', 'row-0'),
        changed: await store.read(name, 'r', 'row-1'), queued: await store.read(name, 'o', 'queued') };
    }, legacy);
    assert.deepEqual(result, { aborted: true, failed: true, unchanged: true, rows: 999, watermark: '2', deleted: null, changed: 'new-row-1', queued: null });
  });
  assert.deepEqual(errors, []);
});
