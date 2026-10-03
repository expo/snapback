import { hangBudget } from './helpers/wait.mjs';
// Browser review regressions: session custody, offline startup, and page exit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launch, root } from '../../../witness/lib.mjs';
import { until } from './helpers/app-server.mjs';
import { replacementServer } from './helpers/replacement-server.mjs';

// One hang allowance per scenario, plus startup and cleanup, rather than a
// fixed file-throughput limit. Each of the 54 sequential scenarios is also bounded.
const scenarioTimeout = hangBudget();
test('web admission review: recovery and transport respect the session boundary', { timeout: (54 + 2) * scenarioTimeout }, async t => {
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
  const focus = process.env.SNAPBACK4_WEB_ADMISSION_FOCUS;
  // Bound each sequential browser scenario, so adding cases or sharing a CPU
  // cannot consume a later case's allowance. Launch/navigation have their own
  // bounded readiness waits; this file is not a 180-second throughput test.
  const check = (name, run) => !focus || new RegExp(focus).test(name)
    ? t.test(name, { timeout: scenarioTimeout }, run) : Promise.resolve();
  const path = name => join(root, 'packages/snapback4/src', name);
  const mutant = process.env.SNAPBACK4_WEB_ADMISSION_MUTANT ?? process.env.SNAPBACK4_WEB_STARTUP_MUTANT;
  const sourceOverrides = {};
  const replace = (file, before, after) => {
    const source = readFileSync(path(file), 'utf8');
    assert.ok(source.includes(before), `mutant ${mutant} must match its source`);
    sourceOverrides[path(file)] = source.replace(before, after);
  };
  if (mutant === 'transport') replace('web.ts', 'if (working) { publishPending = true; return; }', '/* mutant: publish while admission holds the session lock */');
  if (mutant === 'lock-notifications') replace('app-storage.ts', 'if (!pending) { work(); return; }', 'work(); return;');
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
  if (mutant === 'journal-fence') replace('web.ts', 'if (!reply.denied && (observesStore || request.op === "adopt")) journal.fence(device!);', '/* mutant: retain recovered intents after replacement */');
  if (mutant === 'fresh-fence') replace('web-journal.ts', 'journalStoreBinding(transfer.storeId, state?.store_id)', 'journalStoreBinding(transfer.recovered ? transfer.storeId : undefined, state?.store_id)');
  if (mutant === 'fresh-binding') replace('web-journal.ts', 'absent(transfer.key) && !queued.has(id)', 'absent(transfer.key) && (!transfer.recovered || !queued.has(id))');
  if (mutant === 'orphan-binding') replace('web.ts', '        if (binding === "defer") { unresolved = true; continue; }\n        if (binding === "retire") { removed.push({ s: "o", k: entry.id, v: null }); continue; }', '/* mutant: delete both orphan binding checks */');
  if (mutant === 'recovered-orphan-binding') replace('web.ts', 'journalStoreBinding(transfer?.storeId, destination)',
    'journalStoreBinding(transfer?.recovered === false ? transfer.storeId : undefined, destination)');
  if (mutant === 'transport-guards') {
    const source = readFileSync(path('web.ts'), 'utf8');
    const ordinary = 'if (request.op === "begin_send" && typeof request.id === "string") {';
    const exit = ' || journal.binding(device, id) !== "allow"';
    assert.ok(source.includes(ordinary) && source.includes(exit));
    sourceOverrides[path('web.ts')] = source.replace(ordinary, 'if (false) {').replace(exit, '');
  }
  if (mutant === 'ordinary-store-field') replace('local.ts', ', store_id: binding', '');
  if (mutant === 'exit-store-field') replace('local-exit.ts', ', store_id: entry.store_id', '');
  if (mutant === 'exit-retirement') replace('local-exit.ts', 'await refused?.(entry, why)', 'undefined');
  if (mutant === 'observed') replace('local.ts', '    if (!capture.store_id) return false;', '    if (!(await queued()).some(entry => entry.sent_seq == null && entry.observed_seq == null)) return true;\n    if (!capture.store_id) return false;');
  if (mutant === 'empty-queue') replace('local.ts', '    if (!capture.store_id) return false;', '    if (!(await queued()).some(entry => entry.sent_seq == null)) return true;\n    if (!capture.store_id) return false;');
  if (mutant === 'ordinary-gate') replace('local.ts', 'if (closed || !sendingAllowed) return;', 'if (closed) return;');
  if (mutant === 'replay-delivery') replace('local.ts', 'if (replayAllowed) listenForExit();', 'if (replayAllowed) { sendingAllowed = true; await flushOnce(false); listenForExit(); }');
  if (mutant === 'reconnect-exit') replace('local.ts', '      listenForExit();', '      /* mutant: reconnect never installs exit */');
  if (mutant === 'reconnect-delivery') replace('local.ts', '      if (resumeSending && sendingAllowed) void flush();', '      /* mutant: ordinary delivery never wakes */');
  if (mutant === 'exit-owner') replace('local-exit-settlement.ts', ' || options.owners.has(entry.id)', '');
  if (mutant === 'exit-custody') replace('web.ts', 'if (history.some(known => known.id === write.id) || !entry || entry.sent_seq != null || entry.observed_seq != null) return { ok: false };', '/* mutant: settle a late refusal without custody */');
  if (mutant === 'exit-persistence') replace('local-exit-settlement.ts', 'await options.commit(write)', 'await options.commit(write).catch(() => true)');
  if (mutant === 'exit-known') replace('local.ts', 'if (known && known.state !== "pending") return false;', '/* mutant: forget a known terminal */');
  if (mutant === 'custody-sequences') replace('web.ts', ' || entry.sent_seq != null || entry.observed_seq != null', '');
  if (mutant === 'receipt-fallthrough') replace('local.ts', 'retryFlush(); return { ...response, persistencePending: true };', 'retryFlush();');
  if (mutant === 'receipt-replay') replace('local-receipts.ts', 'if (!known || known.state === "pending") return;', 'return;');
  if (mutant === 'receipt-barrier') replace('local.ts', 'try { await history.persistPending(); } catch { retryFlush(); return false; }', '/* mutant: sync can retire volatile custody */');
  if (mutant === 'observe-store-barrier') replace('local.ts', '["observe_store", "apply", "adopt", "settle_exit"]', '["apply", "adopt", "settle_exit"]');
  if (mutant === 'acknowledged-refusal') replace('writes.ts', 'const known = await this.read(id, true);', 'const known = await this.read(id, true); if (known?.state === "failed") return known;');
  if (mutant === 'authored-refusal') replace('writes.ts', 'if (known?.state === "failed" && known.why.code !== "E_STORE_REPLACED") return known;', '/* mutant: turn a known refusal into success */');
  if (mutant === 'receipt-lookup-save') replace('writes.ts', 'if (known?.state === "failed" && known.why.code === "E_STORE_REPLACED") await this.keep(sent);', '/* mutant: leave the stored replacement refusal behind */');
  if (mutant === 'final-preflight') replace('local.ts', 'if (known) return { ok: true as const, json: { ...known }, obsoleteAuth: false }; }', 'if (known) return { ok: true as const, json: { ...receipt }, obsoleteAuth: false }; }');
  if (mutant === 'legacy-success') replace('writes.ts', 'if (!qualified) return known?.state === "sent" || (known?.state === "failed" && known.why.code !== "E_STORE_REPLACED") ? known : undefined;', '/* mutant: infer success from an unqualified sequence */');
  // Record the actual retry callback and entry into sync, without changing either.
  const localPath = path('local.ts');
  const syncEntry = 'function syncOnce(reserve = false): Promise<boolean> {';
  assert.ok((sourceOverrides[localPath] ?? readFileSync(localPath, 'utf8')).includes(syncEntry), 'sync instrumentation must match the production entry');
  sourceOverrides[localPath] = (sourceOverrides[localPath] ?? readFileSync(localPath, 'utf8'))
    .replace('const settling = new Set<string>();', 'const settling = (globalThis as any).settlementOwners = new Set<string>();')
    .replace('retry = undefined; void flush();', 'retry = undefined; (globalThis as any).retryTicks++; void flush();')
    .replace(syncEntry, syncEntry + ' (globalThis as any).syncAttempts?.push({ pending: history.hasUnpersisted((globalThis as any).capturedId), tick: (globalThis as any).retryTicks });');
  // Observe completion after the callback without timing sleeps or changing
  // production scheduling. Each real response body has its own gate below.
  const exitPath = path('local-exit.ts');
  sourceOverrides[exitPath] = (sourceOverrides[exitPath] ?? readFileSync(exitPath, 'utf8'))
    .replace('active = undefined; });', 'active = undefined; (globalThis as any).exitCompleted?.push(entry.id); });');
  const settlementPath = path('local-exit-settlement.ts');
  sourceOverrides[settlementPath] = (sourceOverrides[settlementPath] ?? readFileSync(settlementPath, 'utf8'))
    .replace('if (options.closed() || options.owners.has(entry.id)) return;', 'if (options.closed() || options.owners.has(entry.id)) { (globalThis as any).exitBlocked?.push(entry.id); return; }');
  const witness = await launch({ sourceDir, seed: [{ table: 'removals', row: { id: 'audit', total: 0 } }], sourceOverrides, entrySource: `
import { createApp } from '${path('app.ts')}';
import { keepSession, localStorageSessionStore, sessionKey } from '${path('auth.ts')}';
import { mintId } from '${path('client.ts')}';
import { storeLock } from '${path('app-storage.ts')}';
Object.assign(window, { createApp, keepSession, localStorageSessionStore, sessionKey, mintId, storeLock });
window.ops = { remove: { kind: 'mutation', name: 'removeMember' }, roster: { kind: 'query', name: 'roster' } };
window.boot = async ({ url, session, holdAdmission = false, holdSync = false, holdPoll = false, offline = false, blockMutations = false, wrappedStore = false, wrappedDevice = false, holdProbe = false, probeMode = 'accept', backendUrl = url, unavailable = false, holdOrdinaryResponse = false, holdExitResponse = false, holdSend = false }) => {
  if (session) await keepSession(url, session, localStorageSessionStore());
  window.sessionLocks = 0; window.exitLocks = []; window.sent = []; window.enqueued = []; window.syncHeld = false; window.openingDone = false; window.probeHeld = false; window.exitRegistrations = 0;
  window.backendUrl = backendUrl; window.exitCompleted = []; window.exitBlocked = []; window.outcomes = []; window.receiptBatches = []; window.keptReceipts = []; window.appliedAcks = []; window.pollCount = 0; window.retryTicks = 0; window.syncAttempts = []; window.syncRequests = 0;
  window.holdOrdinaryResponse = holdOrdinaryResponse; window.holdExitResponse = holdExitResponse;
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
    for (const change of changes) if (change.s === 'o' && change.v !== null) window.enqueued.push(change.k);
    if (changes.some(c => c.s === 'm' && c.k === 'client:write-history')) {
      window.receiptBatches.push(changes.map(c => ({ s: c.s, k: c.k, deleted: c.v === null })));
      if (window.holdReceipt) {
        window.receiptHeld = true;
        await new Promise(resolve => window.releaseReceipt = () => { window.holdReceipt = false; resolve(); });
      }
    }
    if (window.holdAdmission && changes.some(c => c.s === 'o' && c.v !== null)) {
      window.admissionHeld = true;
      await new Promise(resolve => window.releaseAdmission = () => { window.holdAdmission = false; resolve(); });
    }
    const result = await save(name, changes);
    for (const change of changes) {
      if (change.s === 'm' && change.k === 'client:write-history' && change.v) window.keptReceipts.push(...JSON.parse(change.v));
      if (change.s === 'o' && change.v && JSON.parse(change.v).observed_seq != null) window.appliedAcks.push(JSON.parse(change.v));
    }
    return result;
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
      const call = core.call.bind(core);
      core.call = async (request, committed) => {
        if (request.op === 'begin_send' && request.id && holdSend) {
          window.sendPreflightHeld = true;
          await new Promise(resolve => window.releaseSendPreflight = () => { holdSend = false; resolve(); });
        }
        return call(request, committed);
      };
      core.onSuspend = flush => { window.exitRegistrations++; return subscribe((...args) => { window.exitLocks.push(window.sessionLocks); flush(...args); }); };
      return wrappedDevice ? { ...core, call: (...args) => core.call(...args) } : core;
    } },
    fetch: async (input, init) => {
      const parsed = new URL(String(input)), route = parsed.pathname;
      const destination = window.backendUrl + route + parsed.search;
      if (route === '/sync') window.syncRequests++;
      if (window.unavailable && (route === '/probe' || route === '/sync')) return Response.json({}, { status: 503 });
      if (route === '/probe' && holdProbe) {
        window.probeHeld = true; await probeGate;
        if (probeMode === 'refused') return Response.json({ denied: { code: 'E_AUTH', family: 'auth', message: 'probe refused' } }, { status: 401 });
        if (probeMode === 'restore') { const head = await fetch(destination, init).then(r => r.json()); return Response.json({ ...head, seq: 0 }); }
      }
      if (route === '/changes' && holdPoll) {
        window.pollHeld = true; window.pollCount++;
        // Hold change evidence, not transport liveness. A silent fake poll
        // trips the real four-second watchdog and introduces an unplanned
        // probe during slow setup. Real long polls send whitespace heartbeats.
        let cancel = () => {};
        return new Response(new ReadableStream({
          start(controller) {
            const bytes = new TextEncoder();
            let done = false;
            const heartbeat = setInterval(() => { if (!done) controller.enqueue(bytes.encode(' ')); }, 1000);
            const clean = () => { clearInterval(heartbeat); init.signal.removeEventListener('abort', abort); };
            const abort = () => { if (done) return; done = true; clean(); controller.error(init.signal.reason); };
            cancel = () => { done = true; clean(); };
            window.releasePoll = reply => {
              if (done) return;
              done = true; clean(); window.pollReleased = true;
              controller.enqueue(bytes.encode(JSON.stringify(reply))); controller.close();
            };
            if (init.signal.aborted) abort();
            else init.signal.addEventListener('abort', abort, { once: true });
          },
          cancel() { cancel(); },
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (route === '/sync' && holdSync) { window.syncHeld = true; await gate; }
      if (route.startsWith('/m/')) {
        window.sent.push({ id: JSON.parse(init.body).id, store_id: JSON.parse(init.body).store_id, keepalive: !!init.keepalive });
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
      const response = await fetch(destination, init);
      if (route === '/sync' && window.traceSync) window.traceSync.push({ request: JSON.parse(init.body), reply: await response.clone().json() });
      if (route.startsWith('/m/')) {
        const kind = init.keepalive ? 'Exit' : 'Ordinary';
        if (window['hold' + kind + 'Response']) {
          window[kind + 'Body'] = await response.clone().json();
          await new Promise(resolve => window['release' + kind + 'Response'] = resolve);
        }
        if (!init.keepalive && window.dropOrdinaryResponse) { window.dropOrdinaryResponse = false; throw new TypeError('committed response lost'); }
      }
      return response;
    } });
  void app.ready.then(() => { window.openingDone = true; app.client.onWrite(write => window.outcomes.push(write)); });
  if (!holdSync && !holdProbe && blockMutations !== 'hold') await app.ready;
};
window.captureClick = () => {
  const id = mintId(); window.capturedId = id;
  window.write = app.mutate(ops.remove, { room: 'room', principal: 'user:other' }, { id });
  const key = Object.keys(localStorage).find(k => k.startsWith('snapback4-admission:') && k.endsWith(id));
  return { id, record: JSON.parse(localStorage.getItem(key)), store: decodeURIComponent(key.split(':')[1]) };
};
window.abortReceipts = (store, limit = Infinity) => {
  window.receiptAborts = 0; window.receiptAbortEnabled = true;
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value) {
    const request = put.call(this, value);
    if (window.receiptAbortEnabled && this.transaction.db.name === store && value.s === 'm' && value.k === 'client:write-history') {
      receiptAborts++; this.transaction.abort(); if (receiptAborts >= limit) window.receiptAbortEnabled = false;
      if (window.holdReceiptAfterAbort) { window.holdReceiptAfterAbort = false; window.holdReceipt = true; }
    }
    return request;
  };
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
  const total = async (session, backend = url) => {
    const result = await fetch(backend + '/q/total', { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: '{}' }).then(r => r.json());
    assert.equal(result.denied, undefined, JSON.stringify(result));
    return result.data;
  };
  const navigate = async suffix => {
    await page.evaluate(suffix => location.assign('/?' + suffix), suffix);
    await page.waitForURL('**/?' + suffix); await page.waitForFunction(() => !!window.boot);
  };
  const hide = async () => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const replacementFor = session => replacementServer({ original: witness, session, sourceDir, seed: [
      { table: 'removals', row: { id: 'audit', total: 0 } },
      { table: 'members', row: { id: 'admin', room: 'room', principal: session.principal, admin: true } },
      { table: 'members', row: { id: 'target', room: 'room', principal: 'user:other', admin: false } },
    ] });

  await check('hiding during strict admission releases the session lock before transport and peer logout', async () => {
    const { session } = await fresh();
    await page.evaluate(options => boot(options), { url, session, holdAdmission: true });
    const peer = await page.context().newPage();
  peer.setDefaultTimeout(hangBudget()); peer.setDefaultNavigationTimeout(hangBudget());
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
      await peer.waitForFunction(() => window.loggedOut, null, { timeout: hangBudget() });
      await page.waitForFunction(() => window.exitLocks.length > 0);
      assert.ok((await page.evaluate(() => exitLocks)).every(depth => depth === 0), 'transport entered under the session lock');
      assert.equal(await peer.evaluate(() => app.auth.state), 'signed-out');
      await page.evaluate(() => app.close()); await peer.evaluate(() => app.close());
    } finally { await peer.close(); }
  });

  await check('exit notification waits for a session turn queued after strict admission', async () => {
    const { session } = await fresh();
    await page.evaluate(options => boot(options), { url, session, holdAdmission: true });
    await page.evaluate(() => captureClick());
    await page.waitForFunction(() => window.admissionHeld && window.sessionLocks > 0);
    await page.evaluate(url => {
      window.followingTurn = storeLock(sessionKey(url), async () => {
        window.followingHeld = true;
        await new Promise(resolve => window.releaseFollowing = resolve);
      });
    }, url);
    try {
      await hide();
      await page.evaluate(() => releaseAdmission());
      await page.waitForFunction(() => window.followingHeld && window.sessionLocks > 0);
      assert.deepEqual(await page.evaluate(() => exitLocks), [], 'notification must wait for the following session turn');
      await page.evaluate(() => releaseFollowing());
      await page.waitForFunction(() => window.exitLocks.length > 0);
      assert.ok((await page.evaluate(() => exitLocks)).every(depth => depth === 0), 'transport entered under the session lock');
      assert.equal(await page.evaluate(() => app.auth.state), 'signed-in');
    } finally {
      await page.evaluate(() => { releaseFollowing?.(); });
      await page.evaluate(() => app.close());
    }
  });

  for (const mode of ['held-sync', 'offline']) await check(`navigation recovers its original outbox id before ${mode} startup completes`, async () => {
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
      && JSON.parse(response.request().postData()).id === captured.id, { timeout: hangBudget() }) : undefined;
    // Avoid a late unhandled rejection when a deliberately broken mutant never sends.
    void delivered?.catch(() => {});
    await hide();
    await page.waitForFunction(id => window.sent.some(send => send.id === id && send.keepalive), captured.id, { timeout: hangBudget() });
    if (delivered) {
      assert.equal((await delivered).status(), 200);
      assert.equal(await total(session), before + 1, 'the hide keepalive must reach the real server before /sync is released');
    }
    const sends = await page.evaluate(() => sent);
    assert.ok(sends.every(send => send.id === captured.id));
    t.diagnostic(JSON.stringify({ mode, id: captured.id, outboxBeforeSync: true, keepalive: true }));
    await page.evaluate(async () => { releaseSync(); await app.ready; await app.close(); });
  });

  await check('backend-required custody cannot exit offline and enables exit after validated adoption', async () => {
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
      && JSON.parse(response.request().postData()).id === captured.id, { timeout: hangBudget() });
    void delivered.catch(() => {});
    try {
      await page.evaluate(async () => { releaseSync(); await app.ready; });
      assert.equal((await delivered).status(), 200);
      assert.equal(await total(session), before + 1);
      assert.equal(await page.evaluate(() => exitRegistrations), 1);
    } finally { await page.evaluate(async () => { releaseSync(); await app.ready; await app.close(); }); }
  });

  for (const mode of ['accepted', 'refused', 'restore', 'replacement', 'observed-replacement']) await check(`a hide during the startup probe waits for its ${mode} decision`, async () => {
    const { session } = await fresh();
    const observer = await auth('signup', { email: `probe-observer-${mode}@example.com`, password: 'a-test-password-long-enough' });
    let before = await total(observer);
    await page.evaluate(options => boot(options), { url, session, holdAdmission: mode !== 'observed-replacement', blockMutations: true });
    await page.waitForFunction(() => app.client.acquired);
    const captured = await page.evaluate(() => captureClick());
    if (mode === 'observed-replacement') {
      await until(() => page.evaluate(async ({ store, id }) => !!await indexedDbPersistence().read(store, 'o', id), captured), 'observed fixture admission');
      const committed = await fetch(url + '/m/removeMember', { method: 'POST', headers: { authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ id: captured.id, args: captured.record.entry.args, newIds: captured.record.entry.new_ids, store_id: captured.record.storeId }) }).then(r => r.json());
      assert.equal(committed.state, 'sent'); captured.successSeq = committed.seq;
      before = await total(observer);
      await page.evaluate(async ({ store, id, record, successSeq }) => {
        await app.close();
        const persist = indexedDbPersistence(), entry = JSON.parse(await persist.read(store, 'o', id));
        entry.sent_seq = null; entry.observed_seq = successSeq; entry.receipt_store = { id: record.storeId, success_seq: successSeq };
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
      await page.waitForFunction(() => window.probeHeld, null, { timeout: hangBudget() });
      const recovered = await page.evaluate(async ({ id, store }) => ({
        write: await app.client.write(id), outbox: await indexedDbPersistence().read(store, 'o', id),
        state: (await core.call({ op: 'sync_state', capture: false })).ok,
      }), captured);
      assert.equal(recovered.write?.state, mode === 'observed-replacement' ? 'sent' : 'pending');
      assert.equal(JSON.parse(recovered.outbox).id, captured.id);
      if (mode === 'observed-replacement') assert.equal(JSON.parse(recovered.outbox).observed_seq, captured.successSeq);
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
        && JSON.parse(response.request().postData()).id === captured.id, { timeout: hangBudget() }) : undefined;
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

  for (const [wrappedStore, wrappedDevice] of [[false, false], [true, false], [true, true], ['async', true]]) for (const committed of [false, true]) for (const legacy of wrappedStore && !committed ? [true, false] : [true]) await check(`${legacy ? 'legacy' : 'stamped'} journal after logout ${committed ? 'preserves committed outbox custody' : 'refuses an unestablished epoch'} (wrapped store: ${wrappedStore}, device: ${wrappedDevice})`, async () => {
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

  for (const reconnect of [false, true]) await check(reconnect ? 'a successful reconnect enables exit after startup 503s' : 'an accepted probe enables exit before ordinary replay resolves', async () => {
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
        && JSON.parse(response.request().postData()).id === captured.id, { timeout: hangBudget() });
      void delivered.catch(() => {});
      await hide();
      assert.equal((await delivered).status(), 200);
      assert.equal(await total(session), before + 1);
      assert.equal(await page.evaluate(id => sent.filter(send => send.id === id && send.keepalive).length, captured.id), 1);
    } finally { await page.evaluate(async () => { window.releaseMutation?.(); await app.ready; await app.close(); }); }
  });

  for (const mode of ['accepted', 'refused', 'restore', 'replacement']) await check(`an empty-outbox open gates new clicks on its ${mode} probe`, async () => {
    const { session } = await fresh();
    const observer = await auth('signup', { email: `empty-${mode}@example.com`, password: 'a-test-password-long-enough' });
    let before = await total(observer);
    await page.evaluate(options => boot(options), { url, session });
    await page.evaluate(() => app.close());
    await navigate('empty-open=' + mode);
    const replacement = mode === 'replacement' ? await replacementFor(session) : undefined;
    await page.evaluate(options => boot(options), { url, holdProbe: true, holdSync: true, probeMode: mode, backendUrl: replacement?.api ?? url });
    try {
      await page.waitForFunction(() => window.probeHeld, null, { timeout: hangBudget() });
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
        && JSON.parse(response.request().postData()).id === captured.id, { timeout: hangBudget() }) : undefined;
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
      if (replacement) {
        // Adoption used to send this fresh click as soon as /sync completed.
        // Check both transports and durable custody after that barrier opens.
        await page.evaluate(async () => { releaseSync(); await app.ready; });
        const after = await page.evaluate(async ({ id, store }) => ({
          sent, queued: (await core.call({ op: 'queued' })).ok,
          outbox: await indexedDbPersistence().read(store, 'o', id),
          loaded: (await indexedDbPersistence().load(store)).filter(c => c.s === 'o' && c.k === id),
        }), captured);
        assert.deepEqual(after.sent, []); assert.deepEqual(after.queued, []);
        assert.equal(after.outbox, null); assert.deepEqual(after.loaded, []);
        assert.equal(await total(observer, replacement.api), 0, 'replacement audit after sync/adoption');
      }
    } finally {
      await page.evaluate(async () => { releaseProbe(); releaseSync(); await app.ready; await app.close(); });
      if (replacement) {
        try { assert.equal(await total(observer, replacement.api), 0, 'replacement audit after close'); }
        finally { await replacement.close(); }
      }
    }
  });

  for (const [first, abortReceipt] of [['keepalive', false], ['ordinary', false], ['ordinary', true]]) await check(`A's committed ordinary result owns settlement when ${first} answers first (receipt abort: ${abortReceipt})`, async () => {
    const { session } = await fresh(), before = await total(session);
    const replacement = await replacementFor(session);
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, holdOrdinaryResponse: true, holdExitResponse: true });
    try {
      const captured = await page.evaluate(() => captureClick());
      if (abortReceipt) await page.evaluate(store => { abortReceipts(store); window.unavailable = true; }, captured.store);
      await page.waitForFunction(() => window.OrdinaryBody);
      assert.equal(await total(session), before + 1, 'A committed before its response is released');
      await page.evaluate(destination => { window.backendUrl = destination; }, replacement.api);
      await hide();
      await page.waitForFunction(() => window.ExitBody);
      assert.equal(await page.evaluate(() => ExitBody.why.code), 'E_STORE_REPLACED');
      assert.equal(await total(session, replacement.api), 0);
      // Both requests reached their real backends. Future sync goes to A;
      // only the order of the two held responses now changes.
      await page.evaluate(destination => { window.backendUrl = destination; }, url);
      if (first === 'keepalive') {
        await page.evaluate(() => releaseExitResponse());
        await page.waitForFunction(id => exitCompleted.includes(id), captured.id);
        assert.deepEqual(await page.evaluate(() => outcomes), [], 'a refusal cannot publish while ordinary delivery owns this id');
        assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).state, 'pending');
        await page.evaluate(() => releaseOrdinaryResponse());
      } else {
        await page.evaluate(() => releaseOrdinaryResponse());
        assert.equal((await page.evaluate(() => write)).state, 'sent');
        if (abortReceipt) {
          assert.ok(await page.evaluate(() => receiptAborts > 0));
          assert.ok(await page.evaluate(async id => (await core.call({ op: 'queued' })).ok.some(entry => entry.id === id && entry.observed_seq == null), captured.id));
          await page.evaluate(() => { window.receiptAbortEnabled = false; });
        }
        if (!abortReceipt) assert.equal(await page.evaluate(async id => (await core.call({ op: 'settle_exit', write: {
          state: 'failed', id, why: { code: 'E_STORE_REPLACED', family: 'store', message: 'late replacement' },
        } })).ok, captured.id), false, 'the device transaction rechecks a settled id even without a transport guard');
        await page.evaluate(() => releaseExitResponse());
        await page.waitForFunction(id => exitCompleted.includes(id), captured.id);
      }
      assert.equal((await page.evaluate(() => write)).state, 'sent');
      assert.deepEqual(await page.evaluate(() => outcomes.map(write => write.state)), ['sent']);
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).state, 'sent');
      await page.evaluate(() => app.close());
      await navigate('settlement-order=' + first);
      await page.evaluate(options => boot(options), { url, holdPoll: true });
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).state, 'sent');
      assert.equal(await total(session), before + 1); assert.equal(await total(session, replacement.api), 0);
      const replayed = await page.evaluate(() => sent);
      assert.deepEqual(replayed, [], 'reopen settles known receipt custody without replay');
    } finally {
      await page.evaluate(async () => { window.releaseOrdinaryResponse?.(); window.releaseExitResponse?.(); await app.close(); });
      await replacement.close();
    }
  });

  for (const first of ['keepalive', 'ordinary']) await check(`a known NOT_ADMIN refusal survives two receipt aborts when ${first} answers first`, async () => {
    const { session } = await fresh(), before = await total(session);
    const replacement = await replacementFor(session);
    // A still authenticates the viewer, but its authored mutation refuses.
    assert.equal((await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([
      { table: 'members', row: { id: 'admin-' + account, room: 'room', principal: session.principal, admin: false } },
    ]) }).then(r => r.json())).seeded, 1);
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, holdOrdinaryResponse: true, holdExitResponse: true });
    try {
      const captured = await page.evaluate(() => captureClick());
      await page.waitForFunction(() => window.OrdinaryBody);
      assert.equal(await page.evaluate(() => OrdinaryBody.why.code), 'NOT_ADMIN');
      await page.evaluate(({ store, destination }) => { abortReceipts(store, 2); window.backendUrl = destination; }, { store: captured.store, destination: replacement.api });
      await hide(); await page.waitForFunction(() => window.ExitBody);
      assert.equal(await page.evaluate(() => ExitBody.why.code), 'E_STORE_REPLACED');
      if (first === 'keepalive') {
        await page.evaluate(() => releaseExitResponse());
        await page.waitForFunction(id => exitCompleted.includes(id), captured.id);
        await page.evaluate(() => releaseOrdinaryResponse());
      } else {
        await page.evaluate(() => releaseOrdinaryResponse());
        assert.equal((await page.evaluate(() => write)).why.code, 'NOT_ADMIN');
        await page.evaluate(() => releaseExitResponse());
        await page.waitForFunction(id => exitCompleted.includes(id), captured.id);
      }
      assert.equal((await page.evaluate(() => write)).why.code, 'NOT_ADMIN');
      await page.waitForFunction(() => receiptAborts === 2);
      // Await the actual retry's local receipt repair, without a lookup that
      // could itself repair it and conceal a failed retry implementation.
      await until(() => page.evaluate(async ({ id, store }) => JSON.parse(await indexedDbPersistence().read(store, 'm', 'client:write-history') ?? '[]').some(write => write.id === id && write.why?.code === 'NOT_ADMIN'), captured), 'NOT_ADMIN receipt repair');
      assert.deepEqual(await page.evaluate(() => outcomes.map(write => write.why?.code)), ['NOT_ADMIN']);
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why.code, 'NOT_ADMIN');
      await page.evaluate(() => app.close()); await navigate('refusal-receipt=' + first);
      await page.evaluate(options => boot(options), { url, backendUrl: replacement.api, holdPoll: true });
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why.code, 'NOT_ADMIN');
      assert.equal(await total(session), before); assert.equal(await total(session, replacement.api), 0);
    } finally { await page.evaluate(async () => { window.releaseOrdinaryResponse?.(); window.releaseExitResponse?.(); await app.close(); }); await replacement.close(); }
  });

  await check('receipt abort then retry persists sent before any replacement sync or POST', async () => {
    const { session } = await fresh(), before = await total(session);
    const replacement = await replacementFor(session);
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, holdOrdinaryResponse: true, holdExitResponse: true });
    try {
      const captured = await page.evaluate(() => captureClick());
      await page.waitForFunction(() => window.OrdinaryBody);
      await page.evaluate(({ store, destination }) => { abortReceipts(store); window.backendUrl = destination; }, { store: captured.store, destination: replacement.api });
      await hide(); await page.waitForFunction(() => window.ExitBody);
      await page.evaluate(() => releaseExitResponse());
      await page.waitForFunction(id => exitCompleted.includes(id), captured.id);
      const syncs = await page.evaluate(() => { window.syncAttempts = []; return syncRequests; });
      await page.evaluate(() => releaseOrdinaryResponse());
      assert.equal((await page.evaluate(() => write)).state, 'sent');
      assert.deepEqual(await page.evaluate(() => syncAttempts), [], 'a failed receipt save must return its known outcome without falling through to syncOnce');
      await page.waitForFunction(() => retryTicks >= 1 && receiptAborts >= 2);
      assert.equal(await page.evaluate(() => syncRequests), syncs, 'retry cannot sync an unpersisted success');
      assert.equal(await page.evaluate(() => sent.filter(send => !send.keepalive).length), 1, 'retry cannot POST an unpersisted success');
      // An explicit sync must also cross the persistence barrier.
      await page.evaluate(async () => { try { await app.client.sync(); } catch {} });
      assert.equal(await page.evaluate(() => syncRequests), syncs, 'explicit sync also waits for durable terminal custody');
      await page.evaluate(() => { window.receiptAbortEnabled = false; });
      await until(() => page.evaluate(async ({ id, store }) => JSON.parse(await indexedDbPersistence().read(store, 'm', 'client:write-history') ?? '[]').some(write => write.id === id && write.state === 'sent'), captured), 'retry persists original sent receipt');
      await until(() => page.evaluate(async id => !(await core.call({ op: 'queued' })).ok.some(entry => entry.id === id && entry.sent_seq == null), captured.id), 'retry settles before another POST');
      assert.equal(await page.evaluate(() => sent.filter(send => !send.keepalive).length), 1);
      assert.deepEqual(await page.evaluate(() => outcomes.map(write => write.state)), ['sent']);
      await page.evaluate(() => app.close()); await navigate('receipt-retry');
      await page.evaluate(options => boot(options), { url, backendUrl: replacement.api, holdPoll: true });
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).state, 'sent');
      assert.equal(await total(session), before + 1); assert.equal(await total(session, replacement.api), 0);
    } finally { await page.evaluate(async () => { window.receiptAbortEnabled = false; window.releaseOrdinaryResponse?.(); window.releaseExitResponse?.(); await app.close(); }); await replacement.close(); }
  });

  await check('sync acknowledgement replaces an aborted replacement refusal after A committed, including reopen', async () => {
    const { session } = await fresh(), before = await total(session);
    const replacement = await replacementFor(session);
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }));
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, holdOrdinaryResponse: true });
    try {
      const captured = await page.evaluate(() => captureClick());
      await page.waitForFunction(() => window.OrdinaryBody?.state === 'sent');
      const committed = await page.evaluate(() => OrdinaryBody);
      await page.evaluate(({ store, destination }) => {
        abortReceipts(store); window.backendUrl = destination; window.dropOrdinaryResponse = true;
        window.OrdinaryBody = undefined; releaseOrdinaryResponse();
      }, { store: captured.store, destination: replacement.api });
      await page.waitForFunction(() => window.OrdinaryBody?.why?.code === 'E_STORE_REPLACED');
      // Queue sync behind the held ordinary response, before retryFlush can
      // own the id again. Its receipt repair waits on the provider gate.
      await page.evaluate(() => {
        window.traceSync = []; window.syncAttempts = []; window.holdReceiptAfterAbort = true; window.syncRepair = app.client.sync();
      });
      await page.waitForFunction(() => syncAttempts.length > 0);
      await page.evaluate(() => releaseOrdinaryResponse());
      await page.waitForFunction(() => receiptAborts > 0 && window.receiptHeld);
      await page.evaluate(async destination => {
        window.receiptAbortEnabled = false; window.backendUrl = destination;
        window.holdOrdinaryResponse = false; releaseReceipt(); await syncRepair;
      }, url);
      // Inspect committed batches, independent of whether the timer already
      // settled the row: sync saved the refusal before A acknowledged the id.
      assert.ok(await page.evaluate(id => keptReceipts.some(write => write.id === id && write.why?.code === 'E_STORE_REPLACED'), captured.id));
      assert.equal(await page.evaluate(id => appliedAcks.find(entry => entry.id === id)?.observed_seq, captured.id), committed.seq,
        JSON.stringify(await page.evaluate(async () => ({ sent, keptReceipts, receiptAborts, syncRequests, traceSync, outcomes, state: (await core.call({ op: 'sync_state', capture: false })).ok, queued: (await core.call({ op: 'queued' })).ok }))));
      await until(() => page.evaluate(async ({ id, store }) => JSON.parse(await indexedDbPersistence().read(store, 'm', 'client:write-history') ?? '[]').some(write => write.id === id && write.state === 'sent'), captured), 'acknowledgement repairs stored replacement refusal');
      const write = await page.evaluate(id => app.client.write(id), captured.id);
      assert.equal(write.state, 'sent'); assert.equal(write.seq, committed.seq);
      await page.evaluate(() => app.close()); await navigate('acknowledgement-repairs-refusal');
      await page.evaluate(options => boot(options), { url, holdPoll: true });
      const reopened = await page.evaluate(id => app.client.write(id), captured.id);
      assert.equal(reopened.state, 'sent'); assert.equal(reopened.seq, committed.seq);
      assert.deepEqual(await page.evaluate(() => sent), []);
      assert.equal(await total(session), before + 1); assert.equal(await total(session, replacement.api), 0);
    } finally { await page.evaluate(async () => { window.receiptAbortEnabled = false; window.releaseReceipt?.(); window.releaseOrdinaryResponse?.(); await app.close(); }); await replacement.close(); }
  });

  await check('a refused _ops row never acknowledges success after its NOT_ADMIN response is lost', async () => {
    const { session } = await fresh(), before = await total(session);
    await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([
      { table: 'members', row: { id: 'admin-' + account, room: 'room', principal: session.principal, admin: false } },
    ]) });
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }));
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, holdOrdinaryResponse: true });
    try {
      const captured = await page.evaluate(() => captureClick());
      await page.waitForFunction(() => window.OrdinaryBody?.why?.code === 'NOT_ADMIN');
      const db = new DatabaseSync(join(witness.app, '.snapback4/store.sqlite'));
      try { assert.equal(JSON.parse(db.prepare('SELECT outcome FROM _ops WHERE principal = ? AND id = ?').get(session.principal, captured.id).outcome).why.code, 'NOT_ADMIN'); }
      finally { db.close(); }
      await page.evaluate(() => { window.traceSync = []; window.syncAttempts = []; window.syncRepair = app.client.sync(); });
      await page.waitForFunction(() => syncAttempts.length > 0);
      await page.evaluate(async () => { window.dropOrdinaryResponse = true; window.holdOrdinaryResponse = false; releaseOrdinaryResponse(); await syncRepair; });
      const sync = await page.evaluate(id => traceSync.find(page => page.request.pending.includes(id)), captured.id);
      assert.ok(sync, 'sync must inspect the refused id while it is still pending');
      assert.equal(sync.reply.acknowledged[captured.id], undefined);
      assert.equal(sync.reply.committed_above?.[captured.id], undefined);
      assert.equal((await page.evaluate(() => write)).why?.code, 'NOT_ADMIN');
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why?.code, 'NOT_ADMIN');
      assert.deepEqual(await page.evaluate(() => outcomes.map(write => write.why?.code)), ['NOT_ADMIN']);
      await page.evaluate(() => app.close()); await navigate('refused-ops');
      await page.evaluate(options => boot(options), { url, holdPoll: true });
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why?.code, 'NOT_ADMIN');
      assert.equal(await total(session), before);
    } finally { await page.evaluate(async () => { window.releaseOrdinaryResponse?.(); await app.close(); }); }
  });

  await check('a known NOT_ADMIN receipt wins over a legacy outbox acknowledgement in mutate and lookup', async () => {
    const { session } = await fresh(), before = await total(session);
    await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([
      { table: 'members', row: { id: 'admin-' + account, room: 'room', principal: session.principal, admin: false } },
    ]) });
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }));
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, holdOrdinaryResponse: true });
    const captured = await page.evaluate(() => captureClick());
    await page.waitForFunction(() => window.OrdinaryBody?.why?.code === 'NOT_ADMIN');
    const db = new DatabaseSync(join(witness.app, '.snapback4/store.sqlite'));
    let stored;
    try { stored = db.prepare('SELECT seq, outcome FROM _ops WHERE principal = ? AND id = ?').get(session.principal, captured.id); }
    finally { db.close(); }
    await page.evaluate(store => { abortReceipts(store); releaseOrdinaryResponse(); }, captured.store);
    assert.equal((await page.evaluate(() => write)).why.code, 'NOT_ADMIN');
    await page.evaluate(async ({ store, id, seq, outcome }) => {
      await app.close(); window.receiptAbortEnabled = false;
      const persist = indexedDbPersistence(), entry = JSON.parse(await persist.read(store, 'o', id));
      entry.observed_seq = seq;
      await persist.save(store, [{ s: 'o', k: id, v: JSON.stringify(entry) }, { s: 'm', k: 'client:write-history', v: JSON.stringify([JSON.parse(outcome)]) }]);
    }, { ...captured, ...stored });
    await navigate('legacy-refusal-ack');
    await page.evaluate(options => boot(options), { url, holdProbe: true, holdPoll: true });
    try {
      await page.waitForFunction(() => window.probeHeld);
      const retried = await page.evaluate(id => app.mutate(ops.remove, { room: 'room', principal: 'user:other' }, { id }), captured.id);
      assert.equal(retried.state, 'failed'); assert.equal(retried.why.code, 'NOT_ADMIN');
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why.code, 'NOT_ADMIN');
      await page.evaluate(async () => { releaseProbe(); await app.ready; await app.close(); });
      await navigate('legacy-refusal-kept');
      await page.evaluate(options => boot(options), { url, holdPoll: true });
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why.code, 'NOT_ADMIN');
      assert.equal(await total(session), before);
    } finally { await page.evaluate(async () => { window.releaseProbe?.(); await app.close(); }); }
  });

  await check('a legacy refused observation with no history remains pending until same-id replay', async () => {
    const { session } = await fresh(), before = await total(session);
    await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([
      { table: 'members', row: { id: 'admin-' + account, room: 'room', principal: session.principal, admin: false } },
    ]) });
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }));
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, holdOrdinaryResponse: true });
    const captured = await page.evaluate(() => captureClick());
    await page.waitForFunction(() => window.OrdinaryBody?.why?.code === 'NOT_ADMIN');
    const db = new DatabaseSync(join(witness.app, '.snapback4/store.sqlite'));
    let stored;
    try { stored = db.prepare('SELECT seq, outcome FROM _ops WHERE principal = ? AND id = ?').get(session.principal, captured.id); }
    finally { db.close(); }
    assert.equal(JSON.parse(stored.outcome).why.code, 'NOT_ADMIN');
    await page.evaluate(store => { abortReceipts(store); releaseOrdinaryResponse(); }, captured.store);
    assert.equal((await page.evaluate(() => write)).why.code, 'NOT_ADMIN');
    await page.evaluate(async ({ store, id, seq }) => {
      await app.close(); window.receiptAbortEnabled = false;
      const persist = indexedDbPersistence(), entry = JSON.parse(await persist.read(store, 'o', id));
      entry.observed_seq = seq; delete entry.receipt_store?.success_seq;
      await persist.save(store, [{ s: 'o', k: id, v: JSON.stringify(entry) }, { s: 'm', k: 'client:write-history', v: null }]);
    }, { ...captured, ...stored });
    await navigate('legacy-no-history');
    await page.evaluate(options => boot(options), { url, holdProbe: true, holdSync: true, holdPoll: true });
    try {
      await page.waitForFunction(() => window.probeHeld);
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).state, 'pending');
      assert.equal((await page.evaluate(id => app.mutate(ops.remove, { room: 'room', principal: 'user:other' }, { id }), captured.id)).state, 'pending');
      await page.evaluate(() => { app.client.onWrite(write => window.upgradeOutcome = write); releaseProbe(); });
      await page.waitForFunction(() => window.upgradeOutcome?.state === 'failed');
      assert.equal((await page.evaluate(() => upgradeOutcome)).why.code, 'NOT_ADMIN');
      assert.deepEqual(await page.evaluate(() => sent.map(write => [write.id, write.store_id])), [[captured.id, captured.record.storeId]]);
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why.code, 'NOT_ADMIN');
      await page.evaluate(async () => { releaseSync(); await app.ready; await app.close(); });
      await navigate('legacy-no-history-kept');
      await page.evaluate(options => boot(options), { url, offline: true, holdPoll: true });
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why.code, 'NOT_ADMIN');
      assert.equal(await total(session), before);
    } finally { await page.evaluate(async () => { window.releaseProbe?.(); window.releaseSync?.(); await app.close(); }); }
  });

  await check('final begin_send preflight preserves an intervening NOT_ADMIN receipt in mutation and notification', async () => {
    const { session } = await fresh(), before = await total(session);
    await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([
      { table: 'members', row: { id: 'admin-' + account, room: 'room', principal: session.principal, admin: false } },
    ]) });
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }));
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, holdSend: true });
    try {
      const captured = await page.evaluate(() => captureClick());
      await page.waitForFunction(() => window.sendPreflightHeld);
      assert.deepEqual(await page.evaluate(() => sent), [], 'initial receipt preflight completed before any send');
      const refused = await fetch(url + '/m/removeMember', { method: 'POST', headers: { authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ id: captured.id, args: { room: 'room', principal: 'user:other' }, newIds: captured.record.entry.new_ids, store_id: captured.record.storeId }),
      }).then(response => response.json());
      assert.equal(refused.why.code, 'NOT_ADMIN');
      const db = new DatabaseSync(join(witness.app, '.snapback4/store.sqlite'));
      let seq;
      try { seq = db.prepare('SELECT seq FROM _ops WHERE principal = ? AND id = ?').get(session.principal, captured.id).seq; }
      finally { db.close(); }
      await page.evaluate(async ({ id, seq, refused, storeId }) => {
        const state = (await core.call({ op: 'state' })).ok;
        const applied = await core.call({ op: 'apply', first: false, page: { snapshot: false, generation: state.generation,
          events: [], watermark: Math.max(seq, state.watermark), more: false, store_id: storeId, acknowledged: { [id]: seq } } });
        if (applied.denied) throw Error(JSON.stringify(applied));
        const kept = await core.call({ op: 'keep_write', value: JSON.stringify(refused) });
        if (kept.denied) throw Error(JSON.stringify(kept));
        releaseSendPreflight();
      }, { id: captured.id, seq, refused, storeId: captured.record.storeId });
      const outcome = await page.evaluate(() => write);
      assert.equal(outcome.state, 'failed'); assert.equal(outcome.why.code, 'NOT_ADMIN');
      assert.deepEqual(await page.evaluate(() => outcomes.map(write => write.why?.code)), ['NOT_ADMIN']);
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why.code, 'NOT_ADMIN');
      assert.deepEqual(await page.evaluate(() => sent), [], 'the intervening decision prevents another POST');
      assert.equal(await total(session), before);
    } finally { await page.evaluate(async () => { window.releaseSendPreflight?.(); await app.close(); }); }
  });

  await check('lookup repairs a stored replacement refusal from sent_seq alone before catch-up and reopen', async () => {
    const { session } = await fresh();
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, blockMutations: true });
    const captured = await page.evaluate(() => captureClick());
    assert.equal((await page.evaluate(() => write)).state, 'pending');
    await page.evaluate(async ({ id, store, record }) => {
      await app.close();
      const persist = indexedDbPersistence(), entry = JSON.parse(await persist.read(store, 'o', id));
      entry.sent_seq = 7; entry.observed_seq = null; entry.receipt_store = { id: record.storeId, success_seq: 7 };
      await persist.save(store, [{ s: 'o', k: id, v: JSON.stringify(entry) }, { s: 'm', k: 'client:write-history', v: JSON.stringify([
        { state: 'failed', id, why: { code: 'E_STORE_REPLACED', family: 'store', message: 'unknown outcome' } },
      ]) }]);
    }, captured);
    await navigate('sent-sequence-only');
    await page.evaluate(options => boot(options), { url, holdProbe: true, holdPoll: true });
    try {
      await page.waitForFunction(() => window.probeHeld);
      assert.deepEqual(await page.evaluate(id => app.client.write(id), captured.id), { state: 'sent', id: captured.id, seq: 7, replayed: true });
      const durable = await page.evaluate(async ({ id, store }) => JSON.parse(await indexedDbPersistence().read(store, 'm', 'client:write-history')).find(write => write.id === id), captured);
      assert.equal(durable.state, 'sent', 'lookup itself must persist the corrected receipt before any flush');
      assert.equal(durable.seq, 7); assert.deepEqual(await page.evaluate(() => sent), []);
      // Publish a covering page on the same device, then end the held startup.
      const reply = await page.evaluate(async storeId => {
        const state = (await core.call({ op: 'state' })).ok;
        return core.call({ op: 'apply', first: false, page: {
          snapshot: false, generation: state.generation,
          events: [], watermark: Math.max(7, state.watermark), more: false, store_id: storeId,
        } });
      }, captured.record.storeId);
      assert.equal(reply.denied, undefined);
      assert.ok(await page.evaluate(async id => !(await core.call({ op: 'queued' })).ok.some(entry => entry.id === id), captured.id));
      await page.evaluate(async () => { window.unavailable = true; releaseProbe(); await app.ready; await app.close(); });
      await navigate('sent-sequence-reopen');
      await page.evaluate(options => boot(options), { url, offline: true, holdPoll: true });
      assert.deepEqual(await page.evaluate(id => app.client.write(id), captured.id), { state: 'sent', id: captured.id, seq: 7, replayed: true });
    } finally { await page.evaluate(async () => { window.releaseProbe?.(); await app.close(); }); }
  });

  await check('a pending changes rewind waits for an aborted successful receipt to become durable', async () => {
    const { session } = await fresh(), before = await total(session);
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }));
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, holdOrdinaryResponse: true });
    await page.waitForFunction(() => window.pollHeld);
    const captured = await page.evaluate(() => captureClick());
    await page.waitForFunction(() => window.OrdinaryBody);
    const committed = await page.evaluate(() => OrdinaryBody);
    try {
      // The first poll preceded begin_send. Its capture is obsolete; let it
      // drain, then hold a poll whose send revision includes this request.
      await page.evaluate(storeId => releasePoll({ store_id: storeId, seq: 0, tables: [] }), captured.record.storeId);
      await page.waitForFunction(() => pollCount >= 2);
      await page.evaluate(() => { window.pollReleased = false; });
      await page.evaluate(store => { abortReceipts(store); releaseOrdinaryResponse(); }, captured.store);
      assert.equal((await page.evaluate(() => write)).state, 'sent');
      const aborts = await page.evaluate(() => receiptAborts);
      await page.evaluate(storeId => releasePoll({ store_id: storeId, seq: 0, tables: [] }), captured.record.storeId);
      await page.waitForFunction(() => window.pollReleased);
      await page.waitForFunction(prior => receiptAborts > prior || !app.client.acquired, aborts);
      const during = await page.evaluate(async () => (await core.call({ op: 'sync_state', capture: false })).ok);
      assert.ok(!during.restore_refusal, 'observe_store must not install a restore fence over volatile receipt custody');
      await page.evaluate(() => { window.receiptAbortEnabled = false; });
      await until(() => page.evaluate(async ({ id, store }) => JSON.parse(await indexedDbPersistence().read(store, 'm', 'client:write-history') ?? '[]').some(write => write.id === id && write.state === 'sent'), captured), 'original receipt repaired after the refused rewind');
      await page.evaluate(() => app.close()); await navigate('receipt-before-rewind');
      await page.evaluate(options => boot(options), { url, holdPoll: true });
      const recovered = await page.evaluate(id => app.client.write(id), captured.id);
      assert.equal(recovered.state, 'sent'); assert.equal(recovered.seq, committed.seq);
      assert.equal(await total(session), before + 1);
    } finally { await page.evaluate(async () => { window.receiptAbortEnabled = false; window.releaseOrdinaryResponse?.(); await app.close(); }); }
  });

  for (const marker of ['sent_seq', 'observed_seq']) await check(`outbox-only ${marker} evidence rejects a replacement refusal without terminal history`, async () => {
    const { session } = await fresh();
    await page.evaluate(options => boot(options), { url, session, blockMutations: true, holdPoll: true });
    const captured = await page.evaluate(() => captureClick());
    assert.equal((await page.evaluate(() => write)).state, 'pending');
    const result = await page.evaluate(async ({ id, store, record, marker }) => {
      await app.close();
      const persist = indexedDbPersistence(), entry = JSON.parse(await persist.read(store, 'o', id));
      entry[marker] = 1; entry.receipt_store = { id: record.storeId };
      await persist.save(store, [{ s: 'o', k: id, v: JSON.stringify(entry) }]);
      const device = await webDevice().open(store, null);
      try {
        const before = await device.call({ op: 'meta', key: 'write-history' });
        const reply = await device.call({ op: 'settle_exit', write: { state: 'failed', id, why: { code: 'E_STORE_REPLACED', family: 'store', message: 'replacement' } } });
        const queued = (await device.call({ op: 'queued' })).ok;
        return { before: before.ok, reply: reply.ok, entry: queued.find(entry => entry.id === id), history: (await device.call({ op: 'meta', key: 'write-history' })).ok, disk: JSON.parse(await persist.read(store, 'o', id)) };
      } finally { await device.close(); }
    }, { ...captured, marker });
    assert.ok(!JSON.parse(result.before ?? '[]').some(write => write.id === captured.id));
    assert.equal(result.reply, false);
    assert.equal(result.entry[marker], 1); assert.equal(result.disk[marker], 1);
    assert.ok(!JSON.parse(result.history ?? '[]').some(write => write.id === captured.id && write.state === 'failed'));
  });

  await check('a keepalive settlement held past the exit timeout excludes ordinary delivery until commit', async () => {
    const { session } = await fresh(), before = await total(session);
    const replacement = await replacementFor(session);
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, blockMutations: true });
    try {
      const captured = await page.evaluate(() => captureClick());
      assert.equal((await page.evaluate(() => write)).state, 'pending');
      await page.evaluate(destination => { window.backendUrl = destination; window.holdReceipt = true; }, replacement.api);
      await hide();
      await page.waitForFunction(() => window.receiptHeld);
      const ordinary = await page.evaluate(() => sent.filter(send => !send.keepalive).length);
      // The transport's one-second network wait expires while the local
      // settlement still owns the id and its atomic persistence is held.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1200)));
      assert.equal(await page.evaluate(() => sent.filter(send => !send.keepalive).length), ordinary);
      assert.deepEqual(await page.evaluate(() => outcomes), []);
      await page.evaluate(() => releaseReceipt());
      await page.waitForFunction(id => exitCompleted.includes(id), captured.id);
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why.code, 'E_STORE_REPLACED');
      assert.equal(await page.evaluate(() => sent.filter(send => !send.keepalive).length), ordinary);
      assert.ok(await page.evaluate(id => receiptBatches.some(batch => batch.some(c => c.s === 'o' && c.k === id && c.deleted)), captured.id), 'one persistence batch holds receipt and outbox retirement');
      assert.deepEqual(await page.evaluate(() => outcomes.map(write => write.state)), ['failed']);
      assert.equal(await total(session), before); assert.equal(await total(session, replacement.api), 0);
    } finally { await page.evaluate(async () => { window.releaseReceipt?.(); await app.close(); }); await replacement.close(); }
  });

  await check('an aborted keepalive receipt transaction retains custody until receipt and retirement commit together', async () => {
    const { session } = await fresh(), before = await total(session);
    const replacement = await replacementFor(session);
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }));
    const hideForSettlement = async id => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const prior = await page.evaluate(() => ({ done: exitCompleted.length, blocked: exitBlocked.length }));
        await hide();
        await page.waitForFunction(done => exitCompleted.length > done, prior.done);
        if (await page.evaluate(blocked => exitBlocked.length === blocked, prior.blocked)) return;
        // A declined callback did not attempt persistence. Wait for the
        // ordinary owner to finish before requesting this receipt attempt.
        await page.waitForFunction(id => !window.settlementOwners.has(id), id);
      }
      assert.fail('ordinary delivery kept owning all exit settlement attempts');
    };
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, blockMutations: true });
    try {
      const captured = await page.evaluate(() => captureClick());
      assert.equal((await page.evaluate(() => write)).state, 'pending');
      await page.evaluate(({ destination, store }) => {
        window.backendUrl = destination; abortReceipts(store);
      }, { destination: replacement.api, store: captured.store });
      await hideForSettlement(captured.id);
      assert.equal(await page.evaluate(() => receiptAborts), 1, 'the real strict IndexedDB transaction aborted');
      assert.deepEqual(await page.evaluate(() => outcomes), [], 'an uncommitted refusal is never published');
      await page.evaluate(() => app.close());
      await navigate('receipt-abort');
      await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }));
      // Keep ordinary replay offline while inspecting exactly what survived.
      await page.evaluate(options => boot(options), { url, blockMutations: true, holdPoll: true });
      const kept = await page.evaluate(async ({ id, store }) => ({
        write: await app.client.write(id), queue: (await core.call({ op: 'queued' })).ok,
        disk: await indexedDbPersistence().read(store, 'o', id),
        receipt: await indexedDbPersistence().read(store, 'm', 'client:write-history'),
      }), captured);
      assert.equal(kept.write.state, 'pending');
      assert.ok(kept.queue.some(entry => entry.id === captured.id)); assert.ok(kept.disk);
      assert.ok(!JSON.parse(kept.receipt ?? '[]').some(write => write.id === captured.id));
      await page.evaluate(destination => { window.backendUrl = destination; }, replacement.api);
      await hideForSettlement(captured.id);
      const failed = await page.evaluate(id => app.client.write(id), captured.id);
      assert.equal(failed.state, 'failed', JSON.stringify(await page.evaluate(() => ({ exitBlocked, sent, receiptBatches, outcomes })))); assert.equal(failed.why.code, 'E_STORE_REPLACED');
      assert.equal(await page.evaluate(async ({ id, store }) => indexedDbPersistence().read(store, 'o', id), captured), null);
      assert.deepEqual(await page.evaluate(() => outcomes.map(write => write.state)), ['failed']);
      await page.evaluate(() => app.close());
      await navigate('receipt-committed');
      await page.evaluate(options => boot(options), { url, blockMutations: true, holdPoll: true });
      assert.equal((await page.evaluate(id => app.client.write(id), captured.id)).why.code, 'E_STORE_REPLACED');
      assert.equal(await total(session), before); assert.equal(await total(session, replacement.api), 0);
    } finally { await page.evaluate(() => app.close()); await replacement.close(); }
  });

  for (const hidden of [false, true]) await check(`replacement after validation refuses the original orphan binding at the server (${hidden ? 'exit' : 'ordinary'} transport)`, async () => {
    const { session } = await fresh(), before = await total(session);
    await page.evaluate(options => boot(options), { url, session, holdPoll: true, blockMutations: hidden });
    const peer = await page.context().newPage();
  peer.setDefaultTimeout(hangBudget()); peer.setDefaultNavigationTimeout(hangBudget());
    let replacement;
    try {
      await peer.goto(page.url()); await peer.waitForFunction(() => !!window.boot);
      await peer.evaluate(options => boot(options), { url, holdPoll: true, blockMutations: true });
      const captured = await peer.evaluate(() => captureClick());
      assert.equal((await peer.evaluate(() => write)).state, 'pending');
      // Validate A and install orphan recovery while the source still holds its
      // provider claim. The endpoint changes later, without another sync/probe.
      await page.evaluate(() => app.client.sync());
      const validated = await page.evaluate(async () => (await core.call({ op: 'sync_state', capture: false })).ok.store_id);
      assert.equal(validated, captured.record.storeId);
      replacement = await replacementFor(session);
      await page.evaluate(destination => { window.backendUrl = destination; window.sent = []; }, replacement.api);
      if (hidden) await hide();
      const response = page.waitForResponse(response => response.url() === replacement.api + '/m/removeMember'
        && JSON.parse(response.request().postData()).id === captured.id, { timeout: hangBudget() });
      void response.catch(() => {});
      await peer.evaluate(() => app.close()); await peer.close();
      const rejected = await response;
      const body = await rejected.json();
      assert.equal(await total(session, replacement.api), 0, 'B must not execute even when local validation still says A');
      assert.equal(body.why?.code, 'E_STORE_REPLACED');
      assert.equal(JSON.parse(rejected.request().postData()).store_id, captured.record.storeId);
      await until(() => page.evaluate(async id => (await app.client.write(id))?.state === 'failed', captured.id), 'replacement refusal retired');
      const failed = await page.evaluate(id => app.client.write(id), captured.id);
      assert.equal(failed.why.code, 'E_STORE_REPLACED');
      assert.deepEqual(await page.evaluate(async id => (await core.call({ op: 'queued' })).ok.filter(entry => entry.id === id), captured.id), []);
      assert.ok((await page.evaluate(() => sent)).some(send => send.id === captured.id && send.keepalive === hidden));
      assert.equal(await total(session), before);
      await page.evaluate(() => app.close());
      await navigate('server-binding=' + hidden);
      await page.evaluate(options => boot(options), { url, backendUrl: replacement.api, holdPoll: true });
      const recovered = await page.evaluate(id => app.client.write(id), captured.id);
      assert.equal(recovered.state, 'failed'); assert.equal(recovered.why.code, 'E_STORE_REPLACED');
      assert.deepEqual(await page.evaluate(id => sent.filter(send => send.id === id), captured.id), []);
      assert.equal(await total(session, replacement.api), 0, 'reopening on B cannot retry the retired write');
      t.diagnostic(JSON.stringify({ afterValidation: true, transport: hidden ? 'keepalive' : 'ordinary', id: captured.id,
        originalStore: captured.record.storeId, refusal: failed.why.code, auditA: before, auditB: 0 }));
    } finally {
      if (!peer.isClosed()) { await peer.evaluate(() => app.close()); await peer.close(); }
      await page.evaluate(() => app.close());
      if (replacement) {
        try { assert.equal(await total(session, replacement.api), 0, 'replacement audit after close'); }
        finally { await replacement.close(); }
      }
    }
  });

  for (const recovered of [false, true]) for (const hidden of [false, true]) await check(`a ${recovered ? 'recovered' : 'fresh'} orphan bound to A is retired before enqueue on B (${hidden ? 'exit' : 'ordinary'} transport)`, async () => {
    const { session } = await fresh(), before = await total(session);
    await page.evaluate(options => boot(options), { url, session, holdPoll: true });
    const peer = await page.context().newPage();
  peer.setDefaultTimeout(hangBudget()); peer.setDefaultNavigationTimeout(hangBudget());
    let replacement;
    try {
      await peer.goto(page.url()); await peer.waitForFunction(() => !!window.boot);
      await peer.evaluate(options => boot(options), { url, holdPoll: true, blockMutations: true, holdAdmission: recovered });
      const captured = await peer.evaluate(() => captureClick());
      assert.match(captured.store, /:tab-/);
      if (recovered) {
        // Navigate before admission commits, then recover the journal in tab 2.
        // Its transfer must exercise the recovered:true orphan branch.
        await peer.evaluate(() => location.assign('/?recovered-orphan=1'));
        await peer.waitForURL('**/?recovered-orphan=1'); await peer.waitForFunction(() => !!window.boot);
        await peer.evaluate(options => boot(options), { url, holdPoll: true, blockMutations: true });
        assert.equal((await peer.evaluate(id => app.client.write(id), captured.id)).state, 'pending');
        // Reload may claim another alternate and adopt the old one. Locate the
        // actual durable owner instead of assuming the old database still owns it.
        const owners = await peer.evaluate(async ({ store, id }) => {
          const persist = indexedDbPersistence(), owners = [];
          for (const name of await persist.others(store.slice(0, store.indexOf(':tab-')) + ':tab-')) {
            if (await persist.read(name, 'o', id)) owners.push(name);
          }
          return owners;
        }, captured);
        assert.equal(owners.length, 1); captured.store = owners[0];
      } else assert.equal((await peer.evaluate(() => write)).state, 'pending');
      const transfer = await peer.evaluate(async ({ store, id }) => JSON.parse(await indexedDbPersistence().read(store, 'j', id)), captured);
      assert.equal(transfer.recovered, recovered); assert.equal(transfer.storeId, captured.record.storeId);
      replacement = await replacementFor(session);
      const head = await fetch(replacement.api + '/probe', { headers: { authorization: 'Bearer ' + session.token } }).then(r => r.json());
      await page.evaluate(async destination => { window.backendUrl = destination; await app.client.sync(); }, replacement.api);
      await until(() => page.evaluate(async storeId => (await core.call({ op: 'sync_state', capture: false })).ok?.store_id === storeId, head.store_id), 'primary adopts replacement B');
      await page.evaluate(() => { window.sent = []; window.enqueued = []; });
      if (hidden) await hide();
      await peer.evaluate(() => app.close());
      await peer.close();
      await until(() => page.evaluate(async store => !await indexedDbPersistence().has(store), captured.store), 'orphan retired');
      // Wait through the destination chain after the source's claim releases.
      const after = await page.evaluate(async id => {
        const queued = (await core.call({ op: 'queued' })).ok;
        return { queued: queued.filter(entry => entry.id === id), sent: sent.filter(entry => entry.id === id), enqueued: enqueued.filter(entry => entry === id) };
      }, captured.id);
      assert.deepEqual(after.enqueued, [], 'retire the mismatch before enqueueing it in B');
      assert.deepEqual(after.queued, []); assert.deepEqual(after.sent, []);
      assert.equal(await total(session), before); assert.equal(await total(session, replacement.api), 0);
      t.diagnostic(JSON.stringify({ orphan: captured.id, hidden, recovered, enqueuedInB: 0, auditA: before, auditB: 0 }));
    } finally {
      if (!peer.isClosed()) { await peer.evaluate(() => app.close()); await peer.close(); }
      await page.evaluate(() => app.close());
      if (replacement) {
        try { assert.equal(await total(session, replacement.api), 0, 'orphan replacement audit after close'); }
        finally { await replacement.close(); }
      }
    }
  });

  await check('a fresh orphan waits for an unidentified destination and delivers its original id after matching sync', async () => {
    const { session } = await fresh(), before = await total(session);
    await page.evaluate(options => boot(options), { url, session, holdPoll: true });
    const peer = await page.context().newPage();
  peer.setDefaultTimeout(hangBudget()); peer.setDefaultNavigationTimeout(hangBudget());
    try {
      await peer.goto(page.url()); await peer.waitForFunction(() => !!window.boot);
      await peer.evaluate(options => boot(options), { url, holdPoll: true, blockMutations: true });
      const captured = await peer.evaluate(() => captureClick());
      assert.equal((await peer.evaluate(() => write)).state, 'pending');
      const base = captured.store.slice(0, captured.store.indexOf(':tab-'));
      const state = await page.evaluate(async ({ base, orphan }) => {
        const backend = (await core.call({ op: 'backend' })).ok;
        await app.close();
        const persist = indexedDbPersistence(), load = persist.load;
        await persist.remove(base);
        window.orphanLoads = 0;
        persist.load = async name => { if (name === orphan) window.orphanLoads++; return load(name); };
        window.unidentified = await webDevice({ persist }).open(base, backend);
        return (await unidentified.call({ op: 'sync_state', capture: false })).ok;
      }, { base, orphan: captured.store });
      assert.equal(state.store_id, null);
      await peer.evaluate(() => app.close()); await peer.close();
      await page.waitForFunction(() => window.orphanLoads > 0);
      const deferred = await page.evaluate(async ({ store, id }) => ({
        queued: (await unidentified.call({ op: 'queued' })).ok,
        source: await indexedDbPersistence().read(store, 'o', id),
      }), captured);
      assert.deepEqual(deferred.queued, []); assert.equal(JSON.parse(deferred.source).id, captured.id);
      assert.equal(await total(session), before);
      await page.evaluate(() => unidentified.close());
      await page.evaluate(options => boot(options), { url, holdPoll: true });
      await until(() => page.evaluate(async id => (await app.client.write(id))?.state === 'sent', captured.id), 'same-store orphan delivered');
      assert.equal(await total(session), before + 1);
      assert.ok(await page.evaluate(id => sent.some(entry => entry.id === id), captured.id));
    } finally {
      if (!peer.isClosed()) { await peer.evaluate(() => app.close()); await peer.close(); }
      await page.evaluate(async () => { await window.unidentified?.close(); await app.close(); });
    }
  });

  for (const retainFields of [false, true]) await check(`same-epoch logout tombstone refuses live admission${retainFields ? ' even with retained session fields' : ''}`, async () => {
    const { session, credentials } = await fresh();
    // Observe the durable audit through an independent login family: the
    // tombstoned client's retired token may already be revoked on a slow host.
    const auditSession = await auth('login', credentials);
    const before = await total(auditSession);
    await page.evaluate(options => boot(options), { url, session });
    const peer = await page.context().newPage();
  peer.setDefaultTimeout(hangBudget()); peer.setDefaultNavigationTimeout(hangBudget());
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
      assert.equal(await total(auditSession), before);
      await page.evaluate(() => app.close());
    } finally { await peer.evaluate(() => window.releaseSession?.()); await peer.close(); }
  });

  await check('a confirmed epoch mismatch fences existing observations while the change poll is held', async () => {
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
    await page.waitForFunction(() => app.auth.state !== 'signed-in', null, { timeout: hangBudget() });
    const state = await page.evaluate(() => ({ viewer: old.viewer(), acquired: old.acquired, observed: observed.getSnapshot() }));
    assert.equal(state.viewer, null); assert.equal(state.acquired, false);
    assert.equal(state.observed.data, undefined); assert.ok(state.observed.denied);
    await page.evaluate(async () => { observed.close(); await app.close(); });
  });
  assert.deepEqual(errors, []);
});
