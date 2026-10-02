import { hangBudget } from './helpers/wait.mjs';
// Real Chromium, real app logout, and deterministic renderer-cache faults.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, root } from '../../../witness/lib.mjs';
import { until } from './helpers/app-server.mjs';

test('browser session authority commits through IndexedDB before releasing the session lock', { timeout: hangBudget(164) }, async t => {
  const project = mkdtempSync(join(tmpdir(), 'sb4-session-authority-'));
  const sourceDir = join(project, 'snapback'); mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'schema.q'), `use identity password

table audit:
  total: int
  public 'Non-idempotent session admission audit.'
  update <- allow

table notes:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  read <- .owner = viewer
  sync to .owner

query privateNotes():
  return notes[viewer] first 100 by byOwner

mutation click():
  row = audit['audit'] ! else NOT_FOUND
  update audit[row] { total: row.total + 1 }

query total():
  return audit['audit'].total
`);
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const path = name => join(root, 'packages/snapback4/src', name);
  const mutant = process.env.SNAPBACK4_SESSION_AUTHORITY_MUTANT, sourceOverrides = {};
  const replace = (file, before, after) => {
    const source = readFileSync(path(file), 'utf8'); assert.ok(source.includes(before), `mutant ${mutant} must match`);
    sourceOverrides[path(file)] = source.replace(before, after);
  };
  if (mutant === 'mirror') replace('admission-authority.ts', 'const raw = await context.read(stamp.key);', 'const raw = localStorage.getItem(stamp.key);');
  if (mutant === 'commit') replace('session-authority.ts', 'try { await committed; }', 'try { void committed; }');
  if (mutant === 'source') replace('admission-authority.ts', '!stamp.source || stamp.source !== current.source || ', '');
  if (mutant === 'ownership') replace('admission-authority.ts', 'else if (browserAdmission()) throw new StorageWarning(', 'else if (false) throw new StorageWarning(');
  if (mutant === 'refusal-fence') replace('web-journal.ts', 'if (!accepted) authority.recheck();', '/* mutant: retain the stale scope */');
  if (mutant === 'mirror-repair') replace('session-authority.ts', 'try { updateMirror(key, value); }', 'try { /* mutant: retain speculative mirror */ }');
  if (mutant === 'epoch-migration') replace('app.ts', 'await authority?.reconcileEpoch(sessionKey(url));', '/* mutant: discard the legacy epoch */');
  if (mutant === 'absence') replace('session-authority.ts', 'const value = (request.result ?? null) as string | null;', 'if (request.result === undefined) return null;\n      const value = (request.result ?? null) as string | null;');
  if (mutant === 'epoch-allocation') replace('session-authority.ts', 'if (BigInt(legacy) > BigInt(authoritative)) await write(epochKey, legacy, before);', 'if (true) await write(epochKey, BigInt(legacy) > BigInt(authoritative) ? legacy : authoritative, before);');
  if (mutant === 'higher-mirror') replace('session-authority.ts', 'if (BigInt(legacy) > BigInt(authoritative))', 'if (marker === "0" && BigInt(legacy) > BigInt(authoritative))');
  const witness = await launch({ sourceDir, seed: [{ table: 'audit', row: { id: 'audit', total: 0 } }], sourceOverrides, entrySource: `
import { createApp } from '${path('app.ts')}';
import { keepSession, localStorageSessionStore, sessionKey } from '${path('auth.ts')}';
import { mintId } from '${path('client.ts')}';
Object.assign(window, { createApp, keepSession, localStorageSessionStore, sessionKey, mintId });
window.clickOp = { kind: 'mutation', name: 'click' };
window.boot = async ({ url, session, holdAdmission = false, strippedDevice = false }) => {
  if (session) await keepSession(url, session, localStorageSessionStore());
  window.sent = []; window.lockDepth = 0; window.transactions = []; window.holdAdmission = holdAdmission;
  const request = navigator.locks.request.bind(navigator.locks);
  navigator.locks.request = (name, ...args) => {
    const callback = args.pop();
    return request(name, ...args, async lock => {
      if (name === sessionKey(url)) window.lockDepth++;
      try { return await callback(lock); }
      finally { if (name === sessionKey(url)) window.lockDepth--; }
    });
  };
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = transaction.apply(this, args);
    if (this.name === 'snapback4-session-authority' && args[1] === 'readwrite') {
      const entry = { strict: args[2]?.durability === 'strict', started: lockDepth };
      transactions.push(entry);
      tx.addEventListener('complete', () => entry.completed = lockDepth);
      tx.addEventListener('abort', () => entry.aborted = lockDepth);
    }
    return tx;
  };
  const persist = indexedDbPersistence(), save = persist.save;
  persist.save = async (name, changes) => {
    if (window.holdAdmission && changes.some(c => c.s === 'o' && c.v !== null)) {
      window.admissionHeld = true;
      await new Promise(resolve => window.releaseAdmission = () => { window.holdAdmission = false; resolve(); });
    }
    return save(name, changes);
  };
  const opener = webDevice({ persist });
  window.app = createApp({ url, sessionStore: { ...localStorageSessionStore() }, waitSeconds: 25,
    device: { async open(...args) {
      const core = await opener.open(...args); window.core = core;
      // A method-only adapter cannot silently turn an app into a raw client.
      return strippedDevice ? { call: core.call, close: core.close } : { ...core };
    } },
    fetch: async (input, init) => {
      const route = new URL(String(input)).pathname;
      if (route === '/changes') {
        window.pollHeld = true;
        await new Promise((_, reject) => {
          if (init.signal.aborted) reject(init.signal.reason);
          else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      }
      // Keep the old bearer valid at the backend: only local authority can
      // prevent the stale click, so server revocation cannot mask a failure.
      if (route === '/auth/logout') throw new TypeError('revocation is offline');
      if (route.startsWith('/m/')) window.sent.push(JSON.parse(init.body).id);
      return fetch(input, init);
    } });
  return app.ready;
};
window.capture = () => {
  const id = mintId(), returned = app.mutate(clickOp, {}, { id }); window.write = returned;
  const key = Object.keys(localStorage).find(key => key.startsWith('snapback4-admission:') && key.endsWith(id));
  return { id, immediate: returned.state ?? null, record: key ? JSON.parse(localStorage.getItem(key)) : null,
    store: key ? decodeURIComponent(key.split(':')[1]) : null };
};
` });
  t.after(() => witness.close());
  const { page, api: url } = witness, errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let count = 0;
  const fresh = async () => {
    await witness.reload();
    const session = (await fetch(url + '/auth/signup', { method: 'POST', body: JSON.stringify({
      email: `authority-${++count}@example.com`, password: 'a-test-password-long-enough',
    }) }).then(r => r.json())).session;
    assert.ok(session); return session;
  };
  const total = session => fetch(url + '/q/total', { method: 'POST', headers: { authorization: 'Bearer ' + session.token }, body: '{}' }).then(r => r.json()).then(r => r.data);
  const navigate = async suffix => {
    await page.evaluate(suffix => location.assign('/?' + suffix), suffix);
    await page.waitForURL('**/?' + suffix); await page.waitForFunction(() => !!window.boot);
  };

  await t.test('public authority checks read epoch and session in one fresh locked transaction', async () => {
    const session = await fresh();
    await page.evaluate(options => boot(options), { url, session });
    await page.waitForFunction(() => window.pollHeld);
    const evidence = await page.evaluate(async () => {
      await app.client.sync(); await app.client.residency();
      const transaction = IDBDatabase.prototype.transaction, reads = [];
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = transaction.apply(this, args);
        if (this.name === 'snapback4-session-authority' && args[1] === 'readonly') {
          const entry = { started: lockDepth }; reads.push(entry);
          tx.addEventListener('complete', () => entry.completed = lockDepth);
        }
        return tx;
      };
      try { await app.client.residency(); }
      finally { IDBDatabase.prototype.transaction = transaction; }
      await app.close(); return reads;
    });
    assert.equal(evidence.length, 2, 'the before/after checks each read one fresh authority snapshot');
    assert.ok(evidence.every(read => read.started > 0 && read.completed > 0), JSON.stringify(evidence));
  });

  await t.test('simultaneously queued authority checks share a read, later checks start fresh', async () => {
    const session = await fresh();
    await page.evaluate(options => boot(options), { url, session });
    await page.waitForFunction(() => window.pollHeld);
    const evidence = await page.evaluate(async () => {
      await app.client.sync(); await app.client.residency();
      const transaction = IDBDatabase.prototype.transaction, reads = [];
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = transaction.apply(this, args);
        if (this.name === 'snapback4-session-authority' && args[1] === 'readonly') {
          const entry = { started: lockDepth }; reads.push(entry);
          tx.addEventListener('complete', () => entry.completed = lockDepth);
        }
        return tx;
      };
      let simultaneous, later;
      try {
        await Promise.all([app.client.residency(), app.client.residency()]);
        simultaneous = reads.length;
        await app.client.residency(); later = reads.length - simultaneous;
      } finally { IDBDatabase.prototype.transaction = transaction; }
      await app.close(); return { simultaneous, later, reads };
    });
    assert.ok(evidence.simultaneous <= 3, JSON.stringify(evidence));
    assert.equal(evidence.later, 2, 'neither completed result is reused');
    assert.ok(evidence.reads.every(read => read.started > 0 && read.completed > 0), JSON.stringify(evidence));
  });

  await t.test('an aborted authority snapshot refuses publication after successful get requests', async () => {
    const session = await fresh();
    await page.evaluate(options => boot(options), { url, session });
    await page.waitForFunction(() => window.pollHeld);
    const evidence = await page.evaluate(async () => {
      await app.client.sync();
      const get = IDBObjectStore.prototype.get; let aborted = 0;
      IDBObjectStore.prototype.get = function (...args) {
        const request = get.apply(this, args), tx = this.transaction;
        if (tx.db.name === 'snapback4-session-authority' && tx.mode === 'readonly') {
          // Refuse every authority read during this query: a concurrent poll
          // may own the first transaction, independently of the query's read.
          request.addEventListener('success', () => { aborted = lockDepth; try { tx.abort(); } catch {} });
        }
        return request;
      };
      let read;
      try { read = await app.client.query({ kind: 'query', name: 'total' }, {}); }
      finally { IDBObjectStore.prototype.get = get; }
      await app.close(); return { read, aborted };
    });
    assert.ok(evidence.aborted > 0);
    assert.equal(evidence.read.denied?.code, 'E_CLIENT');
    assert.equal('data' in evidence.read, false);
  });

  await t.test('a peer logout commits before the next lock holder and refuses a click captured from a stale mirror', async () => {
    const session = await fresh(), before = await total(session);
    await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([{ table: 'notes', row: { id: 'private', owner: session.principal, body: 'private observation' } }]) });
    await page.evaluate(options => boot(options), { url, session });
    await page.evaluate(() => { window.old = app.client; window.observed = old.observe({ kind: 'query', name: 'privateNotes' }, {}); });
    await page.waitForFunction(() => window.pollHeld && observed.getSnapshot()?.data?.length === 1);
    assert.equal(await page.evaluate(() => old.acquired), true);
    const mirror = await page.evaluate(url => localStorage.getItem(sessionKey(url)), url);
    const peer = await page.context().newPage();
  peer.setDefaultTimeout(hangBudget()); peer.setDefaultNavigationTimeout(hangBudget());
    try {
      await peer.goto(page.url()); await peer.waitForFunction(() => !!window.boot);
      await peer.evaluate(options => boot(options), { url });
      assert.deepEqual(await peer.evaluate(() => app.auth.logout()), { ok: true });
      const authoritative = await page.evaluate(url => navigator.locks.request(sessionKey(url), () => localStorageSessionStore().get(sessionKey(url))), url);
      assert.ok(JSON.parse(authoritative).snapback4Logout, 'next holder must see the committed tombstone');
      const tx = await peer.evaluate(() => transactions);
      assert.ok(tx.length > 0 && tx.every(tx => tx.strict && tx.started > 0 && tx.completed > 0), JSON.stringify(tx));
      await peer.evaluate(url => new Promise(resolve => {
        void navigator.locks.request(sessionKey(url), async () => { resolve(); await new Promise(release => window.releaseLock = release); });
      }), url);
      const captured = await page.evaluate(({ url, mirror }) => {
        // Chromium's per-renderer cache may remain stale across the lock. Inject
        // exactly that read fault, not an authoritative write or a timing delay.
        const get = Storage.prototype.getItem, key = sessionKey(url);
        Storage.prototype.getItem = function (k) { return k === key ? mirror : k === key + '.epoch' ? null : get.call(this, k); };
        window.restoreMirror = () => Storage.prototype.getItem = get;
        return capture();
      }, { url, mirror });
      assert.equal(captured.immediate, null); assert.ok(captured.record, 'stale mirror still captures before return');
      await until(() => page.evaluate(async url => (await navigator.locks.query()).pending.some(lock => lock.name === sessionKey(url)), url), 'stale admission awaits the lock');
      await peer.evaluate(() => releaseLock());
      const result = await page.evaluate(() => write);
      assert.equal(result.state, 'failed'); assert.equal(result.why.code, 'E_AUTH');
      assert.equal(await page.evaluate(({ store, id }) => indexedDbPersistence().read(store, 'o', id), captured), null);
      assert.deepEqual(await page.evaluate(() => sent), []);
      assert.equal(await total(session), before);
      await page.waitForFunction(() => app.auth.state === 'signed-out', null, { timeout: hangBudget() });
      const fenced = await page.evaluate(() => ({ auth: app.auth.viewer, viewer: old.viewer(), acquired: old.acquired, observed: observed.getSnapshot() }));
      assert.equal(fenced.auth, null); assert.equal(fenced.viewer, null); assert.equal(fenced.acquired, false);
      assert.equal(fenced.observed.data, undefined); assert.ok(fenced.observed.denied);
      t.diagnostic(JSON.stringify({ captured: true, outcome: result.state, code: result.why.code, audit: before, strictCommitsUnderLock: tx.length }));
    } finally {
      await peer.evaluate(async () => { window.releaseLock?.(); await app.close(); }); await peer.close();
      await page.evaluate(async () => { window.restoreMirror?.(); observed.close(); await app.close(); });
    }
  });

  for (const fault of ['abort', 'quota']) await t.test(`a failed logout cannot commit after ${fault}`, async () => {
    const session = await fresh();
    await page.evaluate(options => boot(options), { url, session });
    const result = await page.evaluate(async ({ url, fault }) => {
      const key = sessionKey(url), store = localStorageSessionStore(), before = await store.get(key);
      const put = IDBObjectStore.prototype.put, set = Storage.prototype.setItem;
      if (fault === 'abort') IDBObjectStore.prototype.put = function (value, k) {
        const request = put.call(this, value, k);
        if (this.name === 'sessions' && k?.[1] === key && JSON.parse(value)?.snapback4Logout) {
          const tx = this.transaction; request.addEventListener('success', () => tx.abort());
        }
        return request;
      };
      else Storage.prototype.setItem = function (k, value) {
        if (k === key && JSON.parse(value)?.snapback4Logout) throw new DOMException('full', 'QuotaExceededError');
        return set.call(this, k, value);
      };
      let logout;
      try { logout = await app.auth.logout(); }
      finally { IDBObjectStore.prototype.put = put; Storage.prototype.setItem = set; }
      const mirror = localStorage.getItem(key), authority = await store.get(key);
      return { logout, before, mirror, authority, transactions };
    }, { url, fault });
    assert.equal(result.logout.ok, false); assert.equal(result.logout.why.code, 'E_CLIENT');
    assert.equal(result.authority, result.before); assert.equal(result.mirror, result.before);
    assert.ok(result.transactions.some(tx => tx.aborted > 0), JSON.stringify(result.transactions));
    await page.evaluate(() => app.close());
    await navigate('failed-logout=' + fault);
    await page.evaluate(options => boot(options), { url });
    assert.equal(await page.evaluate(() => app.auth.viewer), session.principal);
    await page.evaluate(() => app.close());
  });

  await t.test('a visible same-epoch tombstone refuses synchronously', async () => {
    const session = await fresh(); await page.evaluate(options => boot(options), { url, session });
    const result = await page.evaluate(url => {
      const key = sessionKey(url), kept = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ snapback4Logout: kept.snapback4Epoch ?? '0' }));
      const captured = capture(); return { captured, code: write.why?.code };
    }, url);
    assert.equal(result.captured.immediate, 'failed'); assert.equal(result.code, 'E_AUTH'); assert.equal(result.captured.record, null);
    await page.evaluate(() => app.close());
  });

  await t.test('principal replacement and login commit the epoch before unlocking and survive reopen', async () => {
    const session = await fresh(); await page.evaluate(options => boot(options), { url, session });
    const result = await page.evaluate(async ({ url, email }) => {
      transactions.length = 0;
      const key = sessionKey(url), store = localStorageSessionStore();
      const before = JSON.parse(await store.get(key));
      const replaced = await app.auth.signup(email, 'a-test-password-long-enough');
      const next = JSON.parse(await store.get(key));
      const ended = await app.auth.logout();
      const tombstone = JSON.parse(await store.get(key));
      const login = await app.auth.login(email, 'a-test-password-long-enough');
      const restored = JSON.parse(await store.get(key));
      await app.close();
      return { before, replaced, next, ended, tombstone, login, restored, transactions };
    }, { url, email: `replacement-${count}@example.com` });
    assert.equal(result.replaced.ok, true); assert.equal(result.ended.ok, true); assert.equal(result.login.ok, true);
    assert.notEqual(result.before.principal, result.next.principal);
    assert.equal(BigInt(result.next.snapback4Epoch), BigInt(result.before.snapback4Epoch ?? '0') + 1n);
    assert.equal(BigInt(result.tombstone.snapback4Logout), BigInt(result.next.snapback4Epoch) + 1n);
    assert.equal(result.restored.principal, result.next.principal);
    assert.equal(result.restored.snapback4Epoch, result.tombstone.snapback4Logout);
    assert.ok(result.transactions.length >= 3 && result.transactions.every(tx => tx.strict && tx.started > 0 && tx.completed > 0), JSON.stringify(result.transactions));
    await navigate('login-reopen=1'); await page.evaluate(options => boot(options), { url });
    assert.equal(await page.evaluate(() => app.auth.viewer), result.restored.principal);
    await page.evaluate(() => app.close());
  });

  await t.test('custom mirror namespaces isolate accounts and a missing namespace fails closed', async () => {
    const result = await page.evaluate(async () => {
      const mirror = prefix => ({ getItem: k => localStorage.getItem(prefix + k),
        setItem: (k, v) => localStorage.setItem(prefix + k, v), removeItem: k => localStorage.removeItem(prefix + k) });
      const a = localStorageSessionStore(mirror('a:'), 'account-a'), b = localStorageSessionStore(mirror('b:'), 'account-b');
      await navigator.locks.request('namespace-test', async () => { await a.set('namespace-test', 'A'); await b.set('namespace-test', 'B'); });
      let missing;
      try { await localStorageSessionStore(mirror('unknown:')).get('namespace-test'); }
      catch (error) { missing = error.why; }
      return { a: await a.get('namespace-test'), b: await b.get('namespace-test'), missing };
    });
    assert.equal(result.a, 'A'); assert.equal(result.b, 'B'); assert.equal(result.missing.code, 'E_CLIENT');
    assert.match(result.missing.message, /unique authority namespace/);
  });

  await t.test('a legacy mirror without IDB authority requires sign-in', async () => {
    const session = await fresh();
    // Unique backend key, same browser origin: no authority record exists yet.
    const legacyUrl = url + '/legacy';
    await page.evaluate(({ url, session }) => localStorage.setItem(sessionKey(url), JSON.stringify(session)), { url: legacyUrl, session });
    const result = await page.evaluate(options => boot(options), { url: legacyUrl });
    assert.equal(result.ok, true); assert.equal(await page.evaluate(() => app.auth.state), 'signed-out');
    assert.equal(await page.evaluate(url => localStorage.getItem(sessionKey(url)), legacyUrl), null, 'authoritative absence deletes the mirror');
    await page.evaluate(() => app.close());
  });

  for (const [legacy, storedEpoch, epoch] of [['5', null, '5'], ['5', '9', '9'], ['10', '9', '10']]) await t.test(`legacy epoch ${legacy} migrates before sign-in and mutation (IDB ${storedEpoch ?? 'absent'})`, async () => {
    const session = await fresh(), before = await total(session);
    await page.evaluate(async ({ url, session, storedEpoch, legacy }) => {
      const key = sessionKey(url);
      await navigator.locks.request(key, async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('snapback4-session-authority', 1);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        try {
          const tx = db.transaction('sessions', 'readwrite', { durability: 'strict' }), store = tx.objectStore('sessions');
          store.delete(['default', key]); store.delete(['default', key + '.epoch']);
          if (storedEpoch) store.put(storedEpoch, ['default', key + '.epoch']);
          await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
        } finally { db.close(); }
        localStorage.setItem(key, JSON.stringify(session)); localStorage.setItem(key + '.epoch', legacy);
      });
    }, { url, session, storedEpoch, legacy });
    assert.equal((await page.evaluate(options => boot(options), { url })).ok, true);
    assert.equal(await page.evaluate(() => app.auth.state), 'signed-out');
    const signed = await page.evaluate(email => app.auth.login(email, 'a-test-password-long-enough'), `authority-${count}@example.com`);
    assert.equal(signed.ok, true);
    const captured = await page.evaluate(() => capture());
    assert.equal(captured.immediate, null); assert.ok(captured.record);
    assert.equal(captured.record.authority.epoch, epoch);
    assert.equal((await page.evaluate(() => write)).state, 'sent');
    assert.equal(await total(signed.session), before + 1);
    assert.deepEqual(await page.evaluate(async url => {
      const key = sessionKey(url), store = localStorageSessionStore();
      return { mirror: localStorage.getItem(key + '.epoch'), idb: await store.get(key + '.epoch'), session: JSON.parse(await store.get(key)).snapback4Epoch };
    }, url), { mirror: epoch, idb: epoch, session: epoch });
    await page.evaluate(() => app.close());
  });

  await t.test('a committed session reopens with actually full localStorage and no separate epoch key', async () => {
    const session = await fresh();
    await page.evaluate(options => boot(options), { url, session });
    const filled = await page.evaluate(async url => {
      await app.close();
      const key = sessionKey(url), store = localStorageSessionStore();
      await navigator.locks.request(key, async () => {
        const kept = JSON.parse(await store.get(key));
        await store.set(key, JSON.stringify({ ...kept, snapback4Epoch: '9' }));
        await store.delete(key + '.epoch');
      });
      // Fill the real origin quota, not a mocked setItem failure. Binary search
      // leaves no room for even the separate epoch key that caused the bug.
      let low = 0, high = 6 * 1024 * 1024;
      while (low < high) {
        const next = Math.ceil((low + high) / 2);
        try { localStorage.setItem('quota-fill', 'x'.repeat(next)); low = next; }
        catch (error) { if (error.name !== 'QuotaExceededError') throw error; high = next - 1; }
      }
      let refused;
      try { localStorage.setItem(key + '.epoch', '9'); }
      catch (error) { refused = error.name; }
      return { filled: low, refused, epoch: localStorage.getItem(key + '.epoch') };
    }, url);
    assert.ok(filled.filled > 4 * 1024 * 1024); assert.equal(filled.refused, 'QuotaExceededError'); assert.equal(filled.epoch, null);
    try {
      await navigate('full-storage=1');
      const ready = await page.evaluate(options => boot(options), { url });
      assert.equal(ready.ok, true, JSON.stringify(ready));
      assert.equal(await page.evaluate(() => app.auth.viewer), session.principal);
      assert.equal(await page.evaluate(() => app.client.acquired), true);
      assert.equal(await page.evaluate(url => localStorage.getItem(sessionKey(url) + '.epoch'), url), null);
      const refused = await page.evaluate(() => { const captured = capture(); return { captured, code: write.why?.code }; });
      assert.equal(refused.captured.immediate, 'failed'); assert.equal(refused.code, 'E_ADMISSION');
      assert.equal(refused.captured.record, null);
      t.diagnostic(JSON.stringify({ fullStorageReopen: true, filledCharacters: filled.filled, mutationCode: refused.code }));
    } finally { await page.evaluate(async () => { localStorage.removeItem('quota-fill'); await app.close(); }); }
  });

  await t.test('reopen repairs speculative session B from committed session A before capturing a mutation', async () => {
    const session = await fresh(), before = await total(session);
    await page.evaluate(options => boot(options), { url, session });
    await page.evaluate(async url => {
      await app.close();
      const key = sessionKey(url), committed = JSON.parse(localStorage.getItem(key));
      // Model process loss between the fallible mirror write and IDB commit.
      localStorage.setItem(key, JSON.stringify({ ...committed, principal: 'user:speculative', token: 'speculative-bearer' }));
    }, url);
    await navigate('crash-mirror=1');
    assert.equal((await page.evaluate(options => boot(options), { url })).ok, true);
    assert.equal(await page.evaluate(() => app.auth.viewer), session.principal);
    assert.equal(await page.evaluate(url => JSON.parse(localStorage.getItem(sessionKey(url))).principal, url), session.principal);
    const captured = await page.evaluate(() => capture());
    assert.equal(captured.immediate, null); assert.ok(captured.record);
    assert.equal((await page.evaluate(() => write)).state, 'sent');
    assert.equal(await total(session), before + 1);
    await page.evaluate(() => app.close());
  });

  await t.test('an aborted epoch migration preserves the legacy fence for the next open', async () => {
    const session = await fresh();
    await page.evaluate(async ({ url, session }) => {
      const key = sessionKey(url), store = localStorageSessionStore();
      await navigator.locks.request(key, async () => {
        await store.set(key, JSON.stringify({ ...session, snapback4Epoch: '1' }));
        await store.set(key + '.epoch', '1');
        localStorage.setItem(key + '.epoch', '5');
      });
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, k) {
        const request = put.call(this, value, k);
        if (this.name === 'sessions' && k?.[1] === key + '.epoch') {
          const tx = this.transaction; request.addEventListener('success', () => tx.abort());
        }
        return request;
      };
      window.restorePut = () => IDBObjectStore.prototype.put = put;
    }, { url, session });
    try {
      const result = await page.evaluate(options => boot(options), { url });
      assert.equal(result.ok, false); assert.equal(result.why.code, 'E_CLIENT');
      assert.equal(await page.evaluate(url => localStorage.getItem(sessionKey(url) + '.epoch'), url), '5');
    } finally { await page.evaluate(async () => { restorePut(); await app.close(); }); }
    await navigate('migration-retry=1');
    assert.equal((await page.evaluate(options => boot(options), { url })).ok, true);
    const captured = await page.evaluate(() => capture());
    assert.equal(captured.record.authority.epoch, '5');
    assert.equal((await page.evaluate(() => write)).state, 'sent');
    await page.evaluate(() => app.close());
  });

  for (const strippedDevice of [false, true]) await t.test(strippedDevice ? 'a device adapter dropping ownership refuses before journal recovery' : 'a pre-IDB stamp cannot be promoted by a matching new login epoch', async () => {
    const session = await fresh(), before = await total(session);
    await page.evaluate(options => boot(options), { url, session, holdAdmission: true });
    const captured = await page.evaluate(() => capture());
    await page.evaluate(({ record, strippedDevice }) => {
      if (strippedDevice) delete record.authority; else delete record.authority.source;
      localStorage.setItem(record.key, JSON.stringify(record));
    }, { ...captured, strippedDevice });
    await navigate('legacy-authority=' + strippedDevice);
    const result = await page.evaluate(options => boot(options), { url, strippedDevice });
    if (strippedDevice) {
      assert.equal(result.ok, false); assert.equal(result.why.code, 'E_ADMISSION'); assert.match(result.why.message, /ownership/);
      assert.equal(await page.evaluate(() => app.auth.state), 'signed-out');
    } else {
      assert.equal(result.ok, true); assert.equal(await page.evaluate(id => app.client.write(id), captured.id), undefined);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), captured.record.key), null);
    }
    assert.equal(await total(session), before); assert.deepEqual(await page.evaluate(() => sent), []);
    await page.evaluate(() => app.close());
  });
  assert.deepEqual(errors, []);
});
