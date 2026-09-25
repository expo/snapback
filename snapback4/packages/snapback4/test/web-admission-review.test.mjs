// Round-2 browser regressions: session custody, offline startup, and page exit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, root } from '../../../witness/lib.mjs';

test('web admission review: recovery and transport respect the session boundary', { timeout: 180_000 }, async t => {
  const project = mkdtempSync(join(tmpdir(), 'sb4-admission-review-'));
  const sourceDir = join(project, 'snapback'); mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'schema.q'), `use identity password

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
  public 'Non-idempotent audit for admission regressions.'
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
`);
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const path = name => join(root, 'packages/snapback4/src', name);
  const mutant = process.env.SNAPBACK4_WEB_ADMISSION_MUTANT;
  const sourceOverrides = {};
  const replace = (file, before, after) => {
    const source = readFileSync(path(file), 'utf8');
    assert.ok(source.includes(before), `mutant ${mutant} must match its source`);
    sourceOverrides[path(file)] = source.replace(before, after);
  };
  if (mutant === 'transport') replace('web.ts', 'if (working) { publishPending = true; return; }', '/* mutant: publish while admission holds the session lock */');
  if (mutant === 'legacy') replace('web-journal.ts', 'if (!stamp) return this.authority ? refused() : admitted();', 'if (!stamp) return admitted();');
  if (mutant === 'attach') replace('web.ts', 'chain = chain.then(() => run(recoverOpening)).catch(error => { discard(); throw error; });', 'needsRecovery = false;');
  if (mutant === 'fence') replace('app.ts', 'void authorized().catch(() => {});', '/* mutant: never confirm the mismatch */');
  if (mutant === 'tombstone') replace('admission-authority.ts', '!raw || logoutEpoch(raw) !== null', '!raw');
  if (mutant === 'early-exit') {
    const source = readFileSync(path('local.ts'), 'utf8');
    const start = source.indexOf('  if (core.onSuspend) {\n    const sendOnExit');
    assert.ok(start >= 0);
    const end = source.indexOf('  const start = async () => {', start);
    const block = source.slice(start, end);
    sourceOverrides[path('local.ts')] = source.slice(0, start) + source.slice(end).replace('    stopOutbox = core.onOutbox?', block + '    stopOutbox = core.onOutbox?');
  }
  const witness = await launch({ sourceDir, seed: [{ table: 'removals', row: { id: 'audit', total: 0 } }], sourceOverrides, entrySource: `
import { createApp } from '${path('app.ts')}';
import { keepSession, localStorageSessionStore, sessionKey } from '${path('auth.ts')}';
import { mintId } from '${path('client.ts')}';
Object.assign(window, { createApp, keepSession, localStorageSessionStore, sessionKey, mintId });
window.ops = { remove: { kind: 'mutation', name: 'removeMember' }, roster: { kind: 'query', name: 'roster' } };
window.boot = async ({ url, session, holdAdmission = false, holdSync = false, holdPoll = false, offline = false, blockMutations = false }) => {
  if (session) await keepSession(url, session, localStorageSessionStore());
  window.sessionLocks = 0; window.exitLocks = []; window.sent = []; window.syncHeld = false;
  const request = navigator.locks.request.bind(navigator.locks);
  navigator.locks.request = (name, ...args) => {
    const callback = args.pop();
    return request(name, ...args, async lock => {
      if (name === sessionKey(url)) window.sessionLocks++;
      try { return await callback(lock); }
      finally { if (name === sessionKey(url)) window.sessionLocks--; }
    });
  };
  window.holdAdmission = holdAdmission;
  const persist = indexedDbPersistence(), save = persist.save;
  persist.save = async (name, changes) => {
    if (window.holdAdmission && changes.some(c => c.s === 'o' && c.v !== null)) {
      window.admissionHeld = true;
      await new Promise(resolve => window.releaseAdmission = () => { window.holdAdmission = false; resolve(); });
    }
    return save(name, changes);
  };
  const opener = webDevice({ persist });
  const gate = new Promise(resolve => window.releaseSync = resolve);
  window.app = createApp({ url, sessionStore: localStorageSessionStore(), waitSeconds: 25,
    device: { async open(name, backend) {
      const core = await opener.open(name, backend), subscribe = core.onSuspend.bind(core);
      core.onSuspend = flush => subscribe((...args) => { window.exitLocks.push(window.sessionLocks); flush(...args); });
      return core;
    } },
    fetch: async (input, init) => {
      const route = new URL(String(input)).pathname;
      if (route === '/changes' && holdPoll) {
        window.pollHeld = true;
        await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      }
      if (route === '/sync' && holdSync) { window.syncHeld = true; await gate; }
      if (route.startsWith('/m/')) {
        window.sent.push({ id: JSON.parse(init.body).id, keepalive: !!init.keepalive });
        if (blockMutations && !init.keepalive) throw new TypeError('ordinary transport held offline');
      }
      if (offline) throw new TypeError('startup is offline');
      return fetch(input, init);
    } });
  if (!holdSync) await app.ready;
};
window.captureClick = () => {
  const id = mintId();
  window.write = app.mutate(ops.remove, { room: 'room', principal: 'user:other' }, { id });
  const key = Object.keys(localStorage).find(k => k.startsWith('snapback4-admission:') && k.endsWith(id));
  return { id, record: JSON.parse(localStorage.getItem(key)), store: decodeURIComponent(key.split(':')[1]) };
};
` });
  t.after(() => witness.close());
  const { page, api: url } = witness;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let account = 0;
  const credentials = () => ({ email: `round2-${++account}@example.com`, password: 'a-test-password-long-enough' });
  const auth = async (verb, body, token) => {
    const response = await fetch(url + '/auth/' + verb, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
    const value = await response.json(); assert.equal(value.denied, undefined, JSON.stringify(value)); return value.session;
  };
  const fresh = async () => {
    await witness.reload();
    const credentials_ = credentials(), session = await auth('signup', credentials_);
    const rows = [
      { table: 'members', row: { id: 'admin-' + account, room: 'room', principal: session.principal, admin: true } },
      { table: 'members', row: { id: 'target', room: 'room', principal: 'user:other', admin: false } }];
    assert.equal((await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json())).seeded, 2);
    return { credentials: credentials_, session };
  };
  const total = async session => (await fetch(url + '/q/total', { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: '{}' }).then(r => r.json())).data;
  const navigate = async suffix => {
    await page.evaluate(suffix => location.assign('/?' + suffix), suffix);
    await page.waitForURL('**/?' + suffix); await page.waitForFunction(() => !!window.boot);
  };
  const hide = async () => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await t.test('hiding during strict admission releases the session lock before transport and peer logout', async () => {
    const { session } = await fresh();
    await page.evaluate(options => boot(options), { url, session, holdAdmission: true });
    const peer = await page.context().newPage();
    try {
      await peer.goto(page.url()); await peer.waitForFunction(() => !!window.boot);
      await peer.evaluate(options => boot(options), { url });
      await page.evaluate(() => captureClick());
      await page.waitForFunction(() => window.admissionHeld && window.sessionLocks > 0);
      await hide();
      await peer.evaluate(() => { window.loggingOut = app.auth.logout().then(() => window.loggedOut = true); });
      await peer.waitForFunction(async url => (await navigator.locks.query()).pending.some(lock => lock.name === sessionKey(url)), url);
      assert.deepEqual(await page.evaluate(() => exitLocks), [], 'the hide must wait for the pending commit');
      await page.evaluate(() => releaseAdmission());
      await peer.waitForFunction(() => window.loggedOut, null, { timeout: 5000 });
      await page.waitForFunction(() => window.exitLocks.length > 0);
      assert.ok((await page.evaluate(() => exitLocks)).every(depth => depth === 0), 'transport entered under the session lock');
      assert.equal(await peer.evaluate(() => app.auth.state), 'signed-out');
      await page.evaluate(() => app.close()); await peer.evaluate(() => app.close());
    } finally { await peer.close(); }
  });

  for (const mode of ['held-sync', 'offline']) await t.test(`navigation recovers its original outbox id before ${mode} startup completes`, async () => {
    const { session } = await fresh();
    const before = await total(session);
    await page.evaluate(options => boot(options), { url, session, holdAdmission: true });
    const captured = await page.evaluate(() => captureClick());
    await navigate('recover=' + mode);
    await page.evaluate(options => boot(options), { url, holdSync: mode === 'held-sync', offline: mode === 'offline', blockMutations: true });
    await page.waitForFunction(() => app.auth.state === 'signed-in');
    const recovered = await page.evaluate(async ({ id, store }) => ({ write: await app.client.write(id), outbox: await indexedDbPersistence().read(store, 'o', id) }), captured);
    assert.equal(recovered.write?.state, 'pending', 'recovery must not depend on /sync');
    assert.equal(JSON.parse(recovered.outbox).id, captured.id);
    const delivered = mode === 'held-sync' ? page.waitForResponse(response => response.url().endsWith('/m/removeMember')
      && JSON.parse(response.request().postData()).id === captured.id, { timeout: 5000 }) : undefined;
    // Avoid a late unhandled rejection when a deliberately broken mutant never sends.
    void delivered?.catch(() => {});
    await hide();
    await page.waitForFunction(id => window.sent.some(send => send.id === id && send.keepalive), captured.id, { timeout: 3000 });
    if (delivered) {
      assert.equal((await delivered).status(), 200);
      assert.equal(await total(session), before + 1, 'the hide keepalive must reach the real server before /sync is released');
    }
    const sends = await page.evaluate(() => sent);
    assert.ok(sends.every(send => send.id === captured.id));
    t.diagnostic(JSON.stringify({ mode, id: captured.id, outboxBeforeSync: true, keepalive: true }));
    await page.evaluate(async () => { releaseSync(); await app.ready; await app.close(); });
  });

  for (const committed of [false, true]) await t.test(`legacy journal after logout ${committed ? 'preserves committed outbox custody' : 'refuses an unestablished epoch'}`, async () => {
    const { credentials, session } = await fresh();
    const before = await total(session);
    await page.evaluate(options => boot(options), { url, session, holdAdmission: !committed, blockMutations: true });
    const captured = await page.evaluate(() => captureClick());
    if (committed) await page.waitForFunction(async ({ store, id }) => !!await indexedDbPersistence().read(store, 'o', id), captured);
    await page.evaluate(({ record }) => {
      delete record.authority;
      localStorage.setItem(record.key, JSON.stringify(record));
    }, captured);
    await navigate('legacy=' + committed);
    await page.evaluate(({ url, epoch }) => localStorage.setItem(sessionKey(url), JSON.stringify({ snapback4Logout: epoch })), { url, epoch: captured.record.authority.epoch });
    await auth('logout', {}, session.token);
    const next = await auth('login', credentials);
    assert.equal(next.principal, session.principal);
    await page.evaluate(({ url, session, epoch }) => localStorage.setItem(sessionKey(url), JSON.stringify({ ...session, snapback4Epoch: String(BigInt(epoch) + 1n) })), { url, session: next, epoch: captured.record.authority.epoch });
    await page.evaluate(options => boot(options), { url });
    if (committed) await page.waitForFunction(async id => (await app.client.write(id))?.state === 'sent', captured.id);
    else assert.equal(await page.evaluate(id => app.client.write(id), captured.id), undefined);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), captured.record.key), null);
    assert.equal(await total(next), before + (committed ? 1 : 0));
    assert.equal(await page.evaluate(id => sent.filter(send => send.id === id).length, captured.id) > 0, committed);
    await page.evaluate(() => app.close());
  });

  for (const retainFields of [false, true]) await t.test(`same-epoch logout tombstone refuses live admission${retainFields ? ' even with retained session fields' : ''}`, async () => {
    const { session } = await fresh();
    const before = await total(session);
    await page.evaluate(options => boot(options), { url, session });
    const peer = await page.context().newPage();
    try {
      await peer.goto(page.url()); await peer.waitForFunction(() => !!window.sessionKey);
      await peer.evaluate(url => new Promise(resolve => {
        void navigator.locks.request(sessionKey(url), async () => { resolve(); await new Promise(release => window.releaseSession = release); });
      }), url);
      const captured = await page.evaluate(() => captureClick());
      await peer.evaluate(({ url, epoch, session, retainFields }) => {
        // The exact restoringStore.delete tombstone, plus the reader's accepted
        // logout shape with extra session metadata. Both must mean logged out.
        localStorage.setItem(sessionKey(url), JSON.stringify({ ...(retainFields ? session : {}), snapback4Logout: epoch }));
        releaseSession();
      }, { url, epoch: captured.record.authority.epoch, session, retainFields });
      const write = await page.evaluate(() => window.write);
      assert.equal(write.state, 'failed'); assert.equal(write.why.code, 'E_AUTH');
      assert.equal(await page.evaluate(({ store, id }) => indexedDbPersistence().read(store, 'o', id), captured), null);
      assert.equal(await total(session), before);
      await page.evaluate(() => app.close());
    } finally { await peer.evaluate(() => window.releaseSession?.()); await peer.close(); }
  });

  await t.test('a confirmed epoch mismatch fences existing observations while the change poll is held', async () => {
    const { session } = await fresh();
    await page.evaluate(options => boot(options), { url, session, holdPoll: true });
    await page.evaluate(() => { window.old = app.client; window.observed = old.observe(ops.roster, { room: 'room' }); });
    await page.waitForFunction(() => window.pollHeld && window.observed.getSnapshot()?.data?.length > 0);
    // A peer's durable logout marker; no storage event is needed to discover it.
    const result = await page.evaluate(url => {
      const key = sessionKey(url), kept = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ snapback4Logout: String(BigInt(kept.snapback4Epoch ?? '0') + 1n) }));
      const write = old.mutate(ops.remove, { room: 'room', principal: 'user:other' });
      return { state: write.state, code: write.why?.code };
    }, url);
    assert.deepEqual(result, { state: 'failed', code: 'E_AUTH' });
    await page.waitForFunction(() => app.auth.state !== 'signed-in', null, { timeout: 3000 });
    const state = await page.evaluate(() => ({ viewer: old.viewer(), acquired: old.acquired, observed: observed.getSnapshot() }));
    assert.equal(state.viewer, null); assert.equal(state.acquired, false);
    assert.equal(state.observed.data, undefined); assert.ok(state.observed.denied);
    await page.evaluate(async () => { observed.close(); await app.close(); });
  });
  assert.deepEqual(errors, []);
});
