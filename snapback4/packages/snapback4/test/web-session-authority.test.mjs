// Real Chromium, real app logout, and deterministic renderer-cache faults.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, root } from '../../../witness/lib.mjs';
import { until } from './helpers/app-server.mjs';

test('browser session authority commits through IndexedDB before releasing the session lock', { timeout: 120_000 }, async t => {
  const project = mkdtempSync(join(tmpdir(), 'sb4-session-authority-'));
  const sourceDir = join(project, 'snapback'); mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'schema.q'), `use identity password

table audit:
  total: int
  public 'Non-idempotent session admission audit.'
  update <- allow

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

  await t.test('a peer logout commits before the next lock holder and refuses a click captured from a stale mirror', async () => {
    const session = await fresh(), before = await total(session);
    await page.evaluate(options => boot(options), { url, session });
    await page.waitForFunction(() => window.pollHeld);
    const mirror = await page.evaluate(url => localStorage.getItem(sessionKey(url)), url);
    const peer = await page.context().newPage();
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
      t.diagnostic(JSON.stringify({ captured: true, outcome: result.state, code: result.why.code, audit: before, strictCommitsUnderLock: tx.length }));
    } finally {
      await peer.evaluate(async () => { window.releaseLock?.(); await app.close(); }); await peer.close();
      await page.evaluate(async () => { window.restoreMirror?.(); await app.close(); });
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
