// Browser review regressions: session custody, offline startup, and page exit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launch, devServer, root } from '../../../witness/lib.mjs';
import { until } from './helpers/app-server.mjs';

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
  const mutant = process.env.SNAPBACK4_WEB_ADMISSION_MUTANT ?? process.env.SNAPBACK4_WEB_STARTUP_MUTANT;
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
    assert.ok(source.includes('if (replayAllowed) listenForExit();'));
    sourceOverrides[path('local.ts')] = source.replace('if (replayAllowed) listenForExit();', '')
      .replace('    stopOutbox = core.onOutbox?', '    if (replayAllowed) listenForExit();\n    stopOutbox = core.onOutbox?');
  }
  if (mutant === 'probe-gate') replace('local.ts', 'const replayAllowed = core.onSuspend && await replayOnOpen();',
    'const replayAllowed = core.onSuspend && (listenForExit(), await replayOnOpen());');
  if (mutant === 'backend-required') replace('local.ts', '!capture || capture.backend_required || closed || sessionDead', '!capture || closed || sessionDead');
  if (mutant === 'probe-store') replace('local.ts', 'if (head.store_id !== capture.store_id) return false;', '/* mutant: accept a replacement probe */');
  if (mutant === 'probe-restore') replace('local.ts', 'if (await witnessRestore(head.store_id, head.seq, capture)) return false;', '/* mutant: skip restore validation */');
  if (mutant === 'hidden-registration') replace('web.ts', 'if (suspended) publishCommitted();', '/* mutant: lose the hide during the probe */');
  if (mutant === 'wrapped-owner') replace('app.ts', 'prepareAdmissionAuthority(prepared, {', 'if (sessionReader(backing)) prepareAdmissionAuthority(prepared, {');
  if (mutant === 'journal-fence') replace('web.ts', 'if (!reply.denied && observesStore) journal.fence(device!);', '/* mutant: retain recovered intents after replacement */');
  if (mutant === 'observed') replace('local.ts', '    if (!capture.store_id) return false;', '    if (!(await queued()).some(entry => entry.sent_seq == null && entry.observed_seq == null)) return true;\n    if (!capture.store_id) return false;');
  if (mutant === 'empty-queue') replace('local.ts', '    if (!capture.store_id) return false;', '    if (!(await queued()).some(entry => entry.sent_seq == null)) return true;\n    if (!capture.store_id) return false;');
  if (mutant === 'ordinary-gate') replace('local.ts', 'if (closed || !sendingAllowed) return;', 'if (closed) return;');
  if (mutant === 'replay-delivery') replace('local.ts', 'if (replayAllowed) listenForExit();', 'if (replayAllowed) { sendingAllowed = true; await flushOnce(false); listenForExit(); }');
  if (mutant === 'reconnect-exit') replace('local.ts', '      listenForExit();', '      /* mutant: reconnect never installs exit */');
  if (mutant === 'reconnect-delivery') replace('local.ts', '      if (resumeSending && sendingAllowed) void flush();', '      /* mutant: ordinary delivery never wakes */');
  const witness = await launch({ sourceDir, seed: [{ table: 'removals', row: { id: 'audit', total: 0 } }], sourceOverrides, entrySource: `
import { createApp } from '${path('app.ts')}';
import { keepSession, localStorageSessionStore, sessionKey } from '${path('auth.ts')}';
import { mintId } from '${path('client.ts')}';
Object.assign(window, { createApp, keepSession, localStorageSessionStore, sessionKey, mintId });
window.ops = { remove: { kind: 'mutation', name: 'removeMember' }, roster: { kind: 'query', name: 'roster' } };
window.boot = async ({ url, session, holdAdmission = false, holdSync = false, holdPoll = false, offline = false, blockMutations = false, wrappedStore = false, wrappedDevice = false, holdProbe = false, probeMode = 'accept', backendUrl = url, unavailable = false }) => {
  if (session) await keepSession(url, session, localStorageSessionStore());
  window.sessionLocks = 0; window.exitLocks = []; window.sent = []; window.syncHeld = false; window.openingDone = false; window.probeHeld = false; window.exitRegistrations = 0;
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
  window.unavailable = unavailable;
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
  const probeGate = new Promise(resolve => window.releaseProbe = resolve);
  const sessionStore = localStorageSessionStore();
  window.app = createApp({ url, sessionStore: wrappedStore === 'async'
    ? { get: key => sessionStore.get(key), set: (key, value) => sessionStore.set(key, value), delete: key => sessionStore.delete(key) }
    : wrappedStore ? { ...sessionStore } : sessionStore, waitSeconds: 25,
    device: { async open(name, backend) {
      const core = await opener.open(name, backend), subscribe = core.onSuspend.bind(core);
      window.core = core;
      core.onSuspend = flush => { window.exitRegistrations++; return subscribe((...args) => { window.exitLocks.push(window.sessionLocks); flush(...args); }); };
      return wrappedDevice ? { ...core, call: (...args) => core.call(...args) } : core;
    } },
    fetch: async (input, init) => {
      const parsed = new URL(String(input)), route = parsed.pathname;
      const destination = backendUrl + route + parsed.search;
      if (window.unavailable && (route === '/probe' || route === '/sync')) return Response.json({}, { status: 503 });
      if (route === '/probe' && holdProbe) {
        window.probeHeld = true; await probeGate;
        if (probeMode === 'refused') return Response.json({ denied: { code: 'E_AUTH', family: 'auth', message: 'probe refused' } }, { status: 401 });
        if (probeMode === 'restore') { const head = await fetch(destination, init).then(r => r.json()); return Response.json({ ...head, seq: 0 }); }
      }
      if (route === '/changes' && holdPoll) {
        window.pollHeld = true;
        await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      }
      if (route === '/sync' && holdSync) { window.syncHeld = true; await gate; }
      if (route.startsWith('/m/')) {
        window.sent.push({ id: JSON.parse(init.body).id, keepalive: !!init.keepalive });
        if (blockMutations && !init.keepalive) {
          if (blockMutations === 'hold') {
            window.mutationHeld = true;
            await new Promise(resolve => window.releaseMutation = resolve);
            return fetch(destination, init);
          }
          if (blockMutations === 'retry') return Response.json({ denied: { code: 'E_OFFLINE', family: 'link', message: 'ordinary send held', retryable: true } });
          throw new TypeError('ordinary transport held offline');
        }
      }
      if (offline) throw new TypeError('startup is offline');
      return fetch(destination, init);
    } });
  void app.ready.then(() => { window.openingDone = true; });
  if (!holdSync && !holdProbe && blockMutations !== 'hold') await app.ready;
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
  const total = async (session, backend = url) => (await fetch(backend + '/q/total', { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: '{}' }).then(r => r.json())).data;
  const navigate = async suffix => {
    await page.evaluate(suffix => location.assign('/?' + suffix), suffix);
    await page.waitForURL('**/?' + suffix); await page.waitForFunction(() => !!window.boot);
  };
  const hide = async () => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const replacementFor = async session => {
    const replacement = await devServer({ sourceDir, seed: [
      { table: 'removals', row: { id: 'audit', total: 0 } },
      { table: 'members', row: { id: 'admin', room: 'room', principal: session.principal, admin: true } },
      { table: 'members', row: { id: 'target', room: 'room', principal: 'user:other', admin: false } },
    ] });
    // A replacement retains real identity records but has new application storage.
    const db = new DatabaseSync(join(replacement.app, '.snapback4/store.sqlite'));
    try {
      db.prepare('ATTACH DATABASE ? AS source').run(join(witness.app, '.snapback4/store.sqlite'));
      for (const table of ['_principals', '_sessions', '_principal_generations']) db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM source.${table}`);
    } finally { db.close(); }
    const heads = await Promise.all([url, replacement.api].map(backend => fetch(backend + '/probe', {
      headers: { authorization: `Bearer ${session.token}` },
    }).then(r => r.json())));
    assert.ok(heads.every(head => head.ok === true)); assert.notEqual(heads[0].store_id, heads[1].store_id);
    return replacement;
  };

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
      await until(() => peer.evaluate(async url => (await navigator.locks.query()).pending.some(lock => lock.name === sessionKey(url)), url), 'peer logout queued on the session lock');
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

  await t.test('backend-required custody cannot exit offline and enables exit after validated adoption', async () => {
    const { session } = await fresh();
    const before = await total(session);
    await page.evaluate(options => boot(options), { url, session, blockMutations: true });
    const captured = await page.evaluate(() => captureClick());
    await until(() => page.evaluate(async ({ store, id }) => !!await indexedDbPersistence().read(store, 'o', id), captured), 'outbox admission committed');
    await page.evaluate(async ({ store, record }) => {
      await app.close();
      await indexedDbPersistence().save(store, [{ s: 'm', k: 'device:backend-required', v: record.storeId }]);
    }, captured);
    await navigate('backend-required=offline');
    await page.evaluate(options => boot(options), { url, offline: true });
    await hide();
    assert.equal(await page.evaluate(() => exitRegistrations), 0);
    assert.deepEqual(await page.evaluate(() => sent.filter(send => send.keepalive)), []);
    await page.evaluate(() => app.close());
    await navigate('backend-required=online');
    await page.evaluate(options => boot(options), { url, holdSync: true, blockMutations: 'retry' });
    await page.waitForFunction(() => window.syncHeld);
    await hide();
    assert.equal(await page.evaluate(() => exitRegistrations), 0);
    assert.deepEqual(await page.evaluate(() => sent), []);
    const delivered = page.waitForResponse(response => response.url().endsWith('/m/removeMember')
      && JSON.parse(response.request().postData()).id === captured.id, { timeout: 3000 });
    void delivered.catch(() => {});
    try {
      await page.evaluate(async () => { releaseSync(); await app.ready; });
      assert.equal((await delivered).status(), 200);
      assert.equal(await total(session), before + 1);
      assert.equal(await page.evaluate(() => exitRegistrations), 1);
    } finally { await page.evaluate(async () => { releaseSync(); await app.ready; await app.close(); }); }
  });

  for (const mode of ['accepted', 'refused', 'restore', 'replacement', 'observed-replacement']) await t.test(`a hide during the startup probe waits for its ${mode} decision`, async () => {
    const { session } = await fresh();
    const observer = await auth('signup', { email: `probe-observer-${mode}@example.com`, password: 'a-test-password-long-enough' });
    const before = await total(observer);
    await page.evaluate(options => boot(options), { url, session, holdAdmission: mode !== 'observed-replacement', blockMutations: true });
    await page.waitForFunction(() => app.client.acquired);
    const captured = await page.evaluate(() => captureClick());
    if (mode === 'observed-replacement') {
      await until(() => page.evaluate(async ({ store, id }) => !!await indexedDbPersistence().read(store, 'o', id), captured), 'observed fixture admission');
      await page.evaluate(async ({ store, id, record }) => {
        await app.close();
        const persist = indexedDbPersistence(), entry = JSON.parse(await persist.read(store, 'o', id));
        entry.sent_seq = null; entry.observed_seq = 1; entry.receipt_store = { id: record.storeId };
        await persist.save(store, [{ s: 'o', k: id, v: JSON.stringify(entry) }]);
      }, captured);
    }
    await navigate('probe=' + mode);
    let replacement;
    try {
      if (mode.endsWith('replacement')) {
        replacement = await replacementFor(session);
      }
      const backendUrl = replacement?.api ?? url;
      await page.evaluate(options => boot(options), { url, holdProbe: true, holdSync: true,
        probeMode: mode, backendUrl, blockMutations: 'retry' });
      await page.waitForFunction(() => window.probeHeld, null, { timeout: 5000 });
      const recovered = await page.evaluate(async ({ id, store }) => ({
        write: await app.client.write(id), outbox: await indexedDbPersistence().read(store, 'o', id),
        state: (await core.call({ op: 'sync_state', capture: false })).ok,
      }), captured);
      assert.equal(recovered.write?.state, mode === 'observed-replacement' ? 'sent' : 'pending');
      assert.equal(JSON.parse(recovered.outbox).id, captured.id);
      if (mode === 'observed-replacement') assert.equal(JSON.parse(recovered.outbox).observed_seq, 1);
      if (mode === 'restore') assert.ok(recovered.state.watermark > 0, 'the held probe must contradict a durably acquired head');
      await hide();
      // Drain local work and a browser task while the probe remains held. No
      // sender may be registered yet, so this is an ordering assertion, not a sleep.
      const held = await page.evaluate(async () => {
        await core.call({ op: 'state' }); await new Promise(resolve => setTimeout(resolve, 0));
        return { registrations: exitRegistrations, sends: sent };
      });
      assert.equal(held.registrations, 0, 'exit transport must wait for the probe decision');
      assert.deepEqual(held.sends, [], 'a held probe must not send its recovered head');
      const delivered = mode === 'accepted' ? page.waitForResponse(response => response.url().endsWith('/m/removeMember')
        && JSON.parse(response.request().postData()).id === captured.id, { timeout: 3000 }) : undefined;
      void delivered?.catch(() => {});
      await page.evaluate(() => releaseProbe());
      if (mode === 'accepted') {
        assert.equal((await delivered).status(), 200);
        await page.waitForFunction(() => window.syncHeld);
        assert.equal(await total(observer), before + 1, 'the hide during the probe is replayed before sync completes');
        assert.equal(await page.evaluate(() => sent.filter(send => send.keepalive).length), 1, 'hidden registration flushes once');
      } else {
        if (mode === 'restore') {
          // Readiness/another sync can settle before the probe's strict save.
          // Wait for the specific durable refusal that this response proves.
          await until(() => page.evaluate(async () => !!(await core.call({ op: 'sync_state', capture: false })).ok?.restore_refusal), 'probe restore refusal committed');
        } else await page.waitForFunction(() => window.syncHeld || window.openingDone);
        assert.equal(await page.evaluate(() => exitRegistrations), 0, 'a refused startup must not register exit transport');
        if (mode === 'restore') {
          const stopped = await page.evaluate(async () => ({ state: (await core.call({ op: 'sync_state', capture: false })).ok, auth: app.auth.getSnapshot(), sent }));
          assert.equal(stopped.state.restore_refusal?.code, 'E_STORE_RESTORE', JSON.stringify({ before: recovered.state, after: stopped }));
        }
        assert.deepEqual(await page.evaluate(() => sent.filter(send => send.keepalive)), []);
        assert.equal(await total(observer), before);
        if (replacement) assert.equal(await total(observer, replacement.api), 0, 'store B must never execute A’s recovered click');
      }
      await page.evaluate(async () => { releaseSync(); await app.ready; });
      if (mode.endsWith('replacement')) {
        // This must fail even when the startup guard works but journal.fence is
        // removed: sync adoption must durably retire A's recovered outbox entry.
        assert.equal(await page.evaluate(({ store, id }) => indexedDbPersistence().read(store, 'o', id), captured), null,
          'backend replacement must durably dequeue the recovered journal intent');
        assert.equal((await page.evaluate(id => app.client.write(id), captured.id))?.state, mode === 'observed-replacement' ? 'sent' : undefined);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
        await page.evaluate(() => core.call({ op: 'state' }));
        assert.equal(await total(observer, replacement.api), 0);
        assert.equal(await total(observer), before);
        await page.evaluate(() => app.close());
        await navigate('replacement-reopen=1');
        await page.evaluate(options => boot(options), { url, backendUrl: replacement.api });
        assert.equal((await page.evaluate(id => app.client.write(id), captured.id))?.state, mode === 'observed-replacement' ? 'sent' : undefined);
        assert.equal(await total(observer, replacement.api), 0, 'fresh load cannot resurrect A’s click');
      }
      t.diagnostic(JSON.stringify({ mode, originalId: captured.id, sendsWhileProbeHeld: held.sends.length,
        originalAudit: await total(observer), replacementAudit: replacement ? await total(observer, replacement.api) : undefined }));
    } finally {
      await page.evaluate(async () => { window.releaseProbe?.(); window.releaseSync?.(); await window.app?.ready; await window.app?.close(); });
      await replacement?.close();
    }
  });

  for (const [wrappedStore, wrappedDevice] of [[false, false], [true, false], [true, true], ['async', true]]) for (const committed of [false, true]) for (const legacy of wrappedStore && !committed ? [true, false] : [true]) await t.test(`${legacy ? 'legacy' : 'stamped'} journal after logout ${committed ? 'preserves committed outbox custody' : 'refuses an unestablished epoch'} (wrapped store: ${wrappedStore}, device: ${wrappedDevice})`, async () => {
    const { credentials, session } = await fresh();
    const before = await total(session);
    await page.evaluate(options => boot(options), { url, session, holdAdmission: !committed, blockMutations: true });
    const captured = await page.evaluate(() => captureClick());
    if (committed) await until(() => page.evaluate(async ({ store, id }) => !!await indexedDbPersistence().read(store, 'o', id), captured), 'outbox admission committed');
    await page.evaluate(({ record, legacy }) => {
      if (legacy) delete record.authority;
      localStorage.setItem(record.key, JSON.stringify(record));
    }, { ...captured, legacy });
    await navigate('legacy=' + committed + '-' + wrappedStore + '-' + legacy);
    await page.evaluate(({ url, epoch }) => navigator.locks.request(sessionKey(url), () => localStorageSessionStore().set(sessionKey(url), JSON.stringify({ snapback4Logout: epoch }))), { url, epoch: captured.record.authority.epoch });
    await auth('logout', {}, session.token);
    const next = await auth('login', credentials);
    assert.equal(next.principal, session.principal);
    await page.evaluate(({ url, session, epoch }) => navigator.locks.request(sessionKey(url), () => localStorageSessionStore().set(sessionKey(url), JSON.stringify({ ...session, snapback4Epoch: String(BigInt(epoch) + 1n) }))), { url, session: next, epoch: captured.record.authority.epoch });
    await page.evaluate(options => boot(options), { url, wrappedStore, wrappedDevice });
    if (committed) await until(() => page.evaluate(async id => (await app.client.write(id))?.state === 'sent', captured.id), 'committed write sent');
    else assert.equal(await page.evaluate(id => app.client.write(id), captured.id), undefined);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), captured.record.key), null);
    assert.equal(await total(next), before + (committed ? 1 : 0));
    assert.equal(await page.evaluate(id => sent.filter(send => send.id === id).length, captured.id) > 0, committed);
    await page.evaluate(() => app.close());
  });

  for (const reconnect of [false, true]) await t.test(reconnect ? 'a successful reconnect enables exit after startup 503s' : 'an accepted probe enables exit before ordinary replay resolves', async () => {
    const { session } = await fresh();
    const before = await total(session);
    await page.evaluate(options => boot(options), { url, session, holdAdmission: true });
    const captured = await page.evaluate(() => captureClick());
    await navigate('delivery=' + reconnect);
    await page.evaluate(options => boot(options), { url, unavailable: reconnect, blockMutations: reconnect ? 'retry' : 'hold' });
    try {
      if (reconnect) {
        assert.equal(await page.evaluate(() => exitRegistrations), 0);
        await page.evaluate(async () => { window.unavailable = false; await app.client.sync(); });
        await page.waitForFunction(() => app.client.acquired);
        await until(() => page.evaluate(() => sent.some(send => !send.keepalive)), 'successful reconnect wakes ordinary delivery before page hide');
      } else await page.waitForFunction(() => window.mutationHeld);
      assert.equal(await page.evaluate(() => exitRegistrations), 1);
      const delivered = page.waitForResponse(response => response.url().endsWith('/m/removeMember')
        && JSON.parse(response.request().postData()).id === captured.id, { timeout: 3000 });
      void delivered.catch(() => {});
      await hide();
      assert.equal((await delivered).status(), 200);
      assert.equal(await total(session), before + 1);
      assert.equal(await page.evaluate(id => sent.filter(send => send.id === id && send.keepalive).length, captured.id), 1);
    } finally { await page.evaluate(async () => { window.releaseMutation?.(); await app.ready; await app.close(); }); }
  });

  for (const mode of ['accepted', 'refused', 'restore', 'replacement']) await t.test(`an empty-outbox open gates new clicks on its ${mode} probe`, async () => {
    const { session } = await fresh();
    const observer = await auth('signup', { email: `empty-${mode}@example.com`, password: 'a-test-password-long-enough' });
    const before = await total(observer);
    await page.evaluate(options => boot(options), { url, session });
    await page.evaluate(() => app.close());
    await navigate('empty-open=' + mode);
    const replacement = mode === 'replacement' ? await replacementFor(session) : undefined;
    await page.evaluate(options => boot(options), { url, holdProbe: true, holdSync: true, probeMode: mode, backendUrl: replacement?.api ?? url });
    try {
      await page.waitForFunction(() => window.probeHeld, null, { timeout: 5000 });
      assert.deepEqual(await page.evaluate(async () => (await core.call({ op: 'queued' })).ok), []);
      const captured = await page.evaluate(() => captureClick());
      assert.ok(captured.record, 'the new click is synchronously journaled');
      // Await the caller's admission/send attempt, not just the durable commit.
      const pending = await page.evaluate(() => write);
      assert.equal(pending.state, 'pending');
      await hide();
      const held = await page.evaluate(async () => { await core.call({ op: 'state' }); return { sent, exitRegistrations }; });
      assert.deepEqual(held.sent, []); assert.equal(held.exitRegistrations, 0);
      assert.equal(await total(observer), before);
      const delivered = mode === 'accepted' ? page.waitForResponse(response => response.url().endsWith('/m/removeMember')
        && JSON.parse(response.request().postData()).id === captured.id, { timeout: 5000 }) : undefined;
      void delivered?.catch(() => {});
      await page.evaluate(() => releaseProbe());
      if (delivered) {
        assert.equal((await delivered).status(), 200);
        assert.equal(await total(observer), before + 1);
      } else {
        if (mode === 'restore') await until(() => page.evaluate(async () => !!(await core.call({ op: 'sync_state', capture: false })).ok?.restore_refusal), 'empty-open restore refusal');
        else await page.waitForFunction(() => window.syncHeld || window.openingDone);
        assert.deepEqual(await page.evaluate(() => sent), []);
        assert.equal(await total(observer), before);
        if (replacement) assert.equal(await total(observer, replacement.api), 0);
      }
    } finally {
      await page.evaluate(async () => { releaseProbe(); releaseSync(); await app.ready; await app.close(); });
      await replacement?.close();
    }
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
      await peer.evaluate(async ({ url, epoch, session, retainFields }) => {
        // The exact restoringStore.delete tombstone, plus the reader's accepted
        // logout shape with extra session metadata. Both must mean logged out.
        await localStorageSessionStore().set(sessionKey(url), JSON.stringify({ ...(retainFields ? session : {}), snapback4Logout: epoch }));
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
    const result = await page.evaluate(async url => {
      const key = sessionKey(url), kept = JSON.parse(localStorage.getItem(key));
      await navigator.locks.request(key, () => localStorageSessionStore().set(key, JSON.stringify({ snapback4Logout: String(BigInt(kept.snapback4Epoch ?? '0') + 1n) })));
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
