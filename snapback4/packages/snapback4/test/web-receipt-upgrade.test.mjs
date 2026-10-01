import { hangBudget } from './helpers/wait.mjs';
// Upgrade custody on real Wasm + IndexedDB: original-store delivery and
// corrected receipts crossing more than one orphan adoption.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launch, devServer, root } from '../../../witness/lib.mjs';
import { until } from './helpers/app-server.mjs';

const headers = { 'x-snapback-persona': 'alice', 'content-type': 'application/json' };
const failed = (id, code) => ({ state: 'failed', id, why: { code, family: 'rule', message: code } });
const source = `use personas alice
table counters:
  admin: bool
  total: int
  public 'receipt upgrade audit'
  update <- allow
  sync
mutation removeMember():
  require counters['audit'].admin = true else NOT_ADMIN
  a = counters['audit'] ! else NOT_FOUND
  update counters[a] { total: a.total + 1 }
query total():
  return counters['audit'].total
`;

test('web receipt upgrades preserve original binding and corrected shared custody', { timeout: hangBudget(255) }, async t => {
  const project = mkdtempSync(join(tmpdir(), 'sb4-web-receipt-upgrade-'));
  const sourceDir = join(project, 'snapback'); mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'schema.q'), source);
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const sourceOverrides = {}, mutant = process.env.SNAPBACK4_UPGRADE_MUTANT;
  const replace = (file, before, after) => {
    const path = join(root, 'packages/snapback4/src', file);
    const text = sourceOverrides[path] ?? readFileSync(path, 'utf8');
    assert.ok(text.includes(before), `mutant ${mutant} must match ${file}`);
    sourceOverrides[path] = text.replace(before, after);
  };
  if (mutant === 'receipt-binding') {
    replace('local.ts', 'entry.receipt_store?.id ?? entry.store_id ?? storeIdentity', 'entry.store_id ?? storeIdentity');
    replace('web.ts', 'e.receipt_store?.id ?? journal.boundStore(e.id)', 'journal.boundStore(e.id)');
    replace('web.ts', 'entry.receipt_store?.id ?? journal.boundStore(entry.id)', 'journal.boundStore(entry.id)');
  }
  if (mutant === 'shared-correction') replace('web.ts', 'if (unknownOutcome(prior)) kept[index] = write;', '/* mutant: keep the first unknown outcome forever */');
  if (mutant === 'sent-correction') replace('web.ts', 'if (unknownOutcome(prior)) kept[index] = write;', 'if (unknownOutcome(prior) && write.state === "failed" && write.why.code === "NOT_ADMIN") kept[index] = write;');
  if (mutant === 'lookup-correction') replace('web.ts', 'if (prior && unknownOutcome(write) && !unknownOutcome(prior)) continue;', '/* mutant: local history always wins */');
  if (mutant === 'settlement-overlay' || mutant === 'settlement-shared-only') {
    replace('web.ts', ' && request.lookup === true && !reply.denied', ' && !reply.denied');
    if (mutant === 'settlement-shared-only') replace('web.ts', 'JSON.stringify(lookupReceipts(shared, local))',
      'JSON.stringify(request.lookup === true ? lookupReceipts(shared, local) : [...new Map([...shared, ...local].map(write => [write.id, write])).values()])');
  }
  if (mutant === 'custody-lookup') replace('local-receipts.ts', 'seq == null ? await history.read(id)', 'seq == null ? await history.lookup(id)');
  if (mutant === 'lookup-shared-only') replace('web.ts', 'JSON.stringify(lookupReceipts(shared, local))', 'JSON.stringify(shared)');
  if (mutant === 'lookup-no-recheck') replace('local-receipts.ts', 'entry = adopted;', '/* mutant: trust the initial absence of custody */');
  if (mutant === 'lookup-absent') replace('writes.ts', '(own && (own.state !== "failed" || own.why.code !== "E_STORE_REPLACED"))', '(own?.state !== "failed" || own.why.code !== "E_STORE_REPLACED")');
  if (mutant === 'remember-local-only') replace('local.ts', 'const keptWrites = (await call({ op: "meta", key: "write-history", lookup: true }))', 'const keptWrites = (await call({ op: "meta", key: "write-history" }))');
  const witness = await launch({ sourceDir, sourceOverrides,
    seed: [{ table: 'counters', row: { id: 'audit', admin: false, total: 0 } }], entrySource: `
import { mintId } from '${join(root, 'packages/snapback4/src/client.ts')}';
window.mintId = mintId;
window.boot = async ({ url, destination = url, holdSend = false, offline = false }) => {
  window.sent = []; window.sendHeld = false; window.releaseSend = undefined;
  window.historyReads = []; window.readGate = undefined; window.readHeld = false;
  window.persist = indexedDbPersistence();
  const claim = persist.claim;
  persist.claim = async (name, alternate) => {
    const held = await claim(name, alternate);
    if (alternate) { window.base = name; window.store = held.name; }
    return held;
  };
  const opener = webDevice({ persist });
  window.client = await createLocalClient({ url, persona: 'alice', waitSeconds: 25,
    device: { open: async (...args) => {
      window.core = await opener.open(...args);
      const call = core.call.bind(core);
      const holdRead = async () => {
        window.readGate = undefined; window.readHeld = true;
        await new Promise(resolve => window.releaseRead = resolve);
      };
      core.call = async (request, committed) => {
        if (request.op === 'meta' && request.key === 'write-history') {
          window.historyReads.push(request.lookup === true ? 'lookup' : 'local');
          if (request.lookup === true && window.readGate === 'lookup') await holdRead();
        }
        if (request.op === 'begin_send' && request.id && holdSend) {
          window.sendHeld = true;
          await new Promise(resolve => window.releaseSend = () => { holdSend = false; resolve(); });
        }
        const reply = await call(request, committed);
        if (request.op === 'queued' && window.readGate === 'queued') await holdRead();
        return reply;
      };
      return core;
    } },
    fetch: async (input, init) => {
      if (offline) throw new TypeError('offline receipt lookup');
      const route = new URL(input);
      if (route.pathname === '/changes') return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      const response = await fetch(destination + route.pathname + route.search, init);
      if (route.pathname.startsWith('/m/')) window.sent.push({ request: JSON.parse(init.body), keepalive: !!init.keepalive, reply: await response.clone().json() });
      return response;
    },
  });
};
window.hide = () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
};
` });
  t.after(() => witness.close());
  const { page, api: url } = witness;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const audit = async backend => (await fetch(backend + '/q/total', { method: 'POST', headers, body: '{}' }).then(r => r.json())).data;
  const focus = process.env.SNAPBACK4_UPGRADE_FOCUS;
  const check = (name, fn) => !focus || new RegExp(focus).test(name) ? t.test(name, fn) : Promise.resolve();
  // Build the upgrade fixture from an actual refused _ops record, retaining
  // exactly the legacy sequence and original store, with no admission journal.
  const legacy = async () => {
    await witness.reload(); await page.waitForFunction(() => !!window.boot);
    await page.evaluate(options => boot(options), { url });
    const captured = await page.evaluate(async () => ({ id: mintId(), store, base,
      binding: (await core.call({ op: 'sync_state', capture: false })).ok.store_id }));
    const refusal = await fetch(url + '/m/removeMember', { method: 'POST', headers,
      body: JSON.stringify({ id: captured.id, args: {}, newIds: [], store_id: captured.binding }) }).then(r => r.json());
    assert.equal(refusal.why.code, 'NOT_ADMIN');
    const db = new DatabaseSync(join(witness.app, '.snapback4/store.sqlite'));
    let seq;
    try { seq = db.prepare('SELECT seq FROM _ops WHERE principal = ? AND id = ?').get('dev:alice', captured.id).seq; }
    finally { db.close(); }
    await page.evaluate(async ({ id, binding, seq }) => {
      await client.close();
      await persist.save(store, [{ s: 'o', k: id, v: JSON.stringify({ id, seq: 1, op: 'removeMember', args: {}, viewer: 'dev:alice', now: Date.now(),
        new_ids: [], predicted: [], predictable: false, observed_seq: seq, receipt_store: { id: binding } }) },
        { s: 'm', k: 'client:write-history', v: null }]);
    }, { ...captured, seq });
    return { ...captured, seq };
  };

  for (const hidden of [false, true]) await check(`legacy binding survives adopted B on ${hidden ? 'keepalive' : 'ordinary'} transport`, async () => {
    const captured = await legacy();
    const replacement = await devServer({ sourceDir, seed: [{ table: 'counters', row: { id: 'audit', admin: true, total: 0 } }] });
    try {
      await page.evaluate(options => boot(options), { url, destination: replacement.api, holdSend: true });
      await page.waitForFunction(() => window.sendHeld);
      const adopted = await page.evaluate(async () => (await core.call({ op: 'sync_state', capture: false })).ok.store_id);
      assert.notEqual(adopted, captured.binding, 'B has been adopted before either transport sends');
      if (hidden) {
        await page.evaluate(() => hide());
        await page.waitForFunction(() => window.sent.some(send => send.keepalive));
      } else {
        await page.evaluate(() => releaseSend());
        await page.waitForFunction(() => window.sent.some(send => !send.keepalive));
      }
      assert.equal(await audit(replacement.api), 0, 'B cannot execute the retained A intent');
      const send = await page.evaluate(hidden => sent.find(send => send.keepalive === hidden), hidden);
      assert.equal(send.request.store_id, captured.binding);
      assert.equal(send.reply.why?.code, 'E_STORE_REPLACED');
      if (hidden) await page.evaluate(() => releaseSend());
      await until(() => page.evaluate(async id => (await client.write(id))?.state === 'failed', captured.id), 'replacement refusal persisted');
      assert.equal((await page.evaluate(id => client.write(id), captured.id)).why.code, 'E_STORE_REPLACED');
      await page.evaluate(() => client.close());
      await witness.reload(); await page.waitForFunction(() => !!window.boot);
      await page.evaluate(options => boot(options), { url, destination: replacement.api, offline: true });
      assert.equal((await page.evaluate(id => client.write(id), captured.id)).why.code, 'E_STORE_REPLACED');
      assert.deepEqual(await page.evaluate(() => sent), []);
      assert.equal(await audit(url), 0); assert.equal(await audit(replacement.api), 0);
      t.diagnostic(JSON.stringify({ transport: hidden ? 'keepalive' : 'ordinary', original: captured.binding, adopted, auditA: 0, auditB: 0 }));
    } finally {
      await page.evaluate(async () => { window.releaseSend?.(); await client.close(); });
      await replacement.close();
      // The next case starts on A, independently of the prior adopted backend.
      await page.evaluate(async () => { await indexedDbPersistence().remove(store); });
    }
  });

  await check('orphan replay correction survives adopter removal and the next recovery in its original position', async () => {
    const captured = await legacy();
    const history = [failed('before', 'NOT_FOUND'), failed(captured.id, 'E_STORE_REPLACED'), failed('after', 'NOT_ADMIN')];
    await page.evaluate(async ({ history }) => {
      // Hold the primary claim without a device. The first adopter must use
      // an alternate database, which the next recovery will actually remove.
      window.anchor = await persist.claim(base, false);
      window.orphan = base + ':tab-legacy';
      await persist.save(orphan, await persist.load(store));
      await persist.save(orphan, [{ s: 'm', k: 'client:write-history', v: JSON.stringify(history) }]);
      window.sourceClaim = await persist.claim(orphan, false);
      await persist.remove(store);
    }, { history });
    try {
      await page.evaluate(options => boot(options), { url });
      const adopter = await page.evaluate(() => store);
      assert.match(adopter, /:tab-/);
      await page.evaluate(async () => { await sourceClaim.release(); await client.sync(); });
      await until(() => page.evaluate(async id => (await client.write(id))?.why?.code === 'NOT_ADMIN', captured.id), 'original-store replay corrected the adopter receipt').catch(async error => {
        t.diagnostic(JSON.stringify(await page.evaluate(async () => ({ sent, store, base, orphan, queued: await core.call({ op: 'queued' }),
          state: await core.call({ op: 'sync_state', capture: false }), history: await persist.read(store, 'm', 'client:write-history'), source: (await persist.load(orphan)).filter(c => c.s === 'o') }))));
        throw error;
      });
      assert.deepEqual(await page.evaluate(() => sent.map(send => [send.request.store_id, send.reply.replayed, send.reply.why.code])), [[captured.binding, true, 'NOT_ADMIN']]);
      assert.equal(await page.evaluate(() => persist.has(orphan)), false, 'first orphan was removed');
      const shared = async () => page.evaluate(async () => JSON.parse(await persist.read(base + ':receipts', 'm', 'client:write-history')));
      assert.deepEqual((await shared()).map(write => [write.id, write.why.code]), history.map(write => [write.id, write.why.code]));
      await page.evaluate(async () => { await client.close(); await anchor.release(); });
      await page.evaluate(options => boot(options), { url });
      assert.equal(await page.evaluate(name => persist.has(name), adopter), false, 'corrected source was removed only after sharing');
      assert.equal((await page.evaluate(id => client.write(id), captured.id)).why.code, 'NOT_ADMIN');
      assert.deepEqual((await shared()).map(write => [write.id, write.why.code]), [['before', 'NOT_FOUND'], [captured.id, 'NOT_ADMIN'], ['after', 'NOT_ADMIN']]);
      // Repeated adoption must preserve the now-authored refusal, the adjacent
      // authored receipts, and retention order even against conflicting input.
      await page.evaluate(async ({ id }) => {
        await persist.save(base + ':tab-conflicting', [{ s: 'm', k: 'client:write-history', v: JSON.stringify([
          { state: 'sent', id, seq: 99 }, { state: 'sent', id: 'before', seq: 99 },
        ]) }]);
        await client.sync();
      }, captured);
      assert.deepEqual((await shared()).map(write => [write.id, write.why.code]), [['before', 'NOT_FOUND'], [captured.id, 'NOT_ADMIN'], ['after', 'NOT_ADMIN']]);
      await page.evaluate(() => client.close());
      await witness.reload(); await page.waitForFunction(() => !!window.boot);
      await page.evaluate(options => boot(options), { url, offline: true });
      assert.equal((await page.evaluate(id => client.write(id), captured.id)).why.code, 'NOT_ADMIN');
      assert.equal(await audit(url), 0);
      t.diagnostic('orphan -> adopter -> next recovery -> offline reopen: NOT_ADMIN; audit=0; retention order unchanged');
    } finally { await page.evaluate(async () => { await client.close(); await window.sourceClaim?.release(); await window.anchor?.release(); }); }
  });
  await check('adoption corrects a shared replacement refusal to an orphan sent receipt', async () => {
    // A verified correction can prove success, not only another refusal.
    await witness.reload(); await page.waitForFunction(() => !!window.boot);
    await page.evaluate(options => boot(options), { url });
    const id = await page.evaluate(() => mintId());
    const shared = async () => page.evaluate(async () => JSON.parse(await persist.read(base + ':receipts', 'm', 'client:write-history')));
    try {
      await page.evaluate(async ({ window: kept, orphan }) => {
        await persist.save(base + ':receipts', [{ s: 'm', k: 'client:write-history', v: JSON.stringify(kept) }]);
        await persist.save(base + ':tab-sent-correction', [{ s: 'm', k: 'client:write-history', v: JSON.stringify(orphan) }]);
      }, { window: [failed('kept', 'NOT_FOUND'), failed(id, 'E_STORE_REPLACED')], orphan: [{ state: 'sent', id, seq: 7 }] });
      await until(async () => {
        await page.evaluate(() => client.sync());
        return (await shared()).some(write => write.id === id && write.state === 'sent');
      }, 'adoption shared the sent correction');
      assert.deepEqual((await shared()).map(write => [write.id, write.state, write.seq ?? write.why.code]), [['kept', 'failed', 'NOT_FOUND'], [id, 'sent', 7]]);
      assert.equal(await page.evaluate(() => persist.has(base + ':tab-sent-correction')), false, 'the orphan was removed after sharing');
      const seen = await page.evaluate(id => client.write(id), id);
      assert.deepEqual([seen.state, seen.seq], ['sent', 7]);
      t.diagnostic('shared E_STORE_REPLACED + orphan sent seq 7 -> shared sent seq 7 in place; orphan removed');
    } finally { await page.evaluate(async () => { await client.close(); await persist.remove(base + ':receipts'); }); }
  });

  await check('lookup lets a shared correction supersede only this reader\'s replacement refusal', async () => {
    // A reader that kept its own E_STORE_REPLACED sees the outcome a sibling
    // later verified and shared. Every other local outcome still wins.
    await witness.reload(); await page.waitForFunction(() => !!window.boot);
    await page.evaluate(options => boot(options), { url });
    const own = await page.evaluate(() => store);
    const ids = await page.evaluate(() => ({ refused: mintId(), succeeded: mintId(), unknown: mintId(), authored: mintId() }));
    const local = [failed(ids.refused, 'E_STORE_REPLACED'), failed(ids.succeeded, 'E_STORE_REPLACED'), failed(ids.unknown, 'E_STORE_REPLACED'), failed(ids.authored, 'NOT_FOUND')];
    const shared = [failed(ids.refused, 'NOT_ADMIN'), { state: 'sent', id: ids.succeeded, seq: 11 }, failed(ids.unknown, 'E_STORE_REPLACED'), failed(ids.authored, 'NOT_ADMIN')];
    try {
      await page.evaluate(async ({ local, shared }) => {
        await client.close();
        await persist.save(store, [{ s: 'm', k: 'client:write-history', v: JSON.stringify(local) }]);
        await persist.save(base + ':receipts', [{ s: 'm', k: 'client:write-history', v: JSON.stringify(shared) }]);
      }, { local, shared });
      await page.evaluate(options => boot(options), { url, offline: true });
      assert.equal(await page.evaluate(() => store), own, 'the reader reopened its own store, whose history is local');
      const seen = await page.evaluate(async ids => Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([key, id]) => [key, await client.write(id)]))), ids);
      assert.equal(seen.refused.why.code, 'NOT_ADMIN');
      assert.deepEqual([seen.succeeded.state, seen.succeeded.seq], ['sent', 11]);
      assert.equal(seen.unknown.why.code, 'E_STORE_REPLACED');
      assert.equal(seen.authored.why.code, 'NOT_FOUND');
      t.diagnostic('local E_STORE_REPLACED x3 + NOT_FOUND over shared NOT_ADMIN, sent 11, E_STORE_REPLACED, NOT_ADMIN -> NOT_ADMIN, sent 11, E_STORE_REPLACED, NOT_FOUND');
    } finally { await page.evaluate(async () => { await client.close(); await persist.remove(base + ':receipts'); }); }
  });
  for (const missing of [false, true]) await check(`a shared correction never hides this device's qualified or pending custody (${missing ? 'absent' : 'replacement'} local history)`, async () => {
    // Settlement reads this device's receipts first. A qualified success
    // repairs the local replacement refusal to sent and keeps it; a legacy
    // sequence without a qualified outcome stays pending. Neither is answered
    // from the shared window.
    await witness.reload(); await page.waitForFunction(() => !!window.boot);
    await page.evaluate(options => boot(options), { url });
    const own = await page.evaluate(() => store);
    const binding = await page.evaluate(async () => (await core.call({ op: 'sync_state', capture: false })).ok.store_id);
    const ids = await page.evaluate(() => ({ qualified: mintId(), qualifiedOverSent: mintId(), legacy: mintId(), unsent: mintId() }));
    const outbox = (id, seq, fields) => ({ s: 'o', k: id, v: JSON.stringify({ id, seq, op: 'removeMember', args: {}, viewer: 'dev:alice', now: Date.now(),
      new_ids: [], predicted: [], predictable: false, ...fields }) });
    const local = missing ? [] : Object.values(ids).map(id => failed(id, 'E_STORE_REPLACED'));
    const shared = [failed(ids.qualified, 'NOT_ADMIN'), { state: 'sent', id: ids.qualifiedOverSent, seq: 99 }, failed(ids.legacy, 'NOT_ADMIN'), failed(ids.unsent, 'NOT_ADMIN')];
    try {
      await page.evaluate(async ({ changes, local, shared }) => {
        await client.close();
        await persist.save(store, [...changes, { s: 'm', k: 'client:write-history', v: JSON.stringify(local) }]);
        await persist.save(base + ':receipts', [{ s: 'm', k: 'client:write-history', v: JSON.stringify(shared) }]);
      }, { local, shared, changes: [
        outbox(ids.qualified, 1, { [missing ? 'observed_seq' : 'sent_seq']: 7, receipt_store: { id: binding, success_seq: 7 } }),
        outbox(ids.qualifiedOverSent, 2, { [missing ? 'observed_seq' : 'sent_seq']: 8, receipt_store: { id: binding, success_seq: 8 } }),
        outbox(ids.legacy, 3, { observed_seq: 9, receipt_store: { id: binding } }),
        // A guard, not a reachable state: custody here always outranks the window.
        outbox(ids.unsent, 4, { receipt_store: { id: binding } }),
      ] });
      await page.evaluate(options => boot(options), { url, offline: true });
      assert.equal(await page.evaluate(() => store), own, 'the device reopened its own store and outbox');
      const seen = await page.evaluate(async ids => Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([key, id]) => [key, await client.write(id)]))), ids);
      assert.deepEqual([seen.qualified.state, seen.qualified.seq], ['sent', 7], JSON.stringify(seen.qualified));
      assert.deepEqual([seen.qualifiedOverSent.state, seen.qualifiedOverSent.seq], ['sent', 8], JSON.stringify(seen.qualifiedOverSent));
      assert.equal(seen.legacy.state, 'pending', JSON.stringify(seen.legacy));
      assert.equal(missing ? seen.unsent.state : seen.unsent.why?.code, missing ? 'pending' : 'E_STORE_REPLACED', JSON.stringify(seen.unsent));
      const kept = await page.evaluate(async () => JSON.parse(await persist.read(store, 'm', 'client:write-history')));
      const byId = Object.fromEntries(kept.map(write => [write.id, write]));
      assert.deepEqual([byId[ids.qualified].state, byId[ids.qualified].seq], ['sent', 7], 'the qualified success replaced the local refusal on disk');
      assert.deepEqual([byId[ids.qualifiedOverSent].state, byId[ids.qualifiedOverSent].seq], ['sent', 8]);
      assert.equal(byId[ids.legacy]?.why.code, missing ? undefined : 'E_STORE_REPLACED', 'legacy custody waits for replay, not for a sibling');
      assert.ok((await page.evaluate(async () => (await core.call({ op: 'queued' })).ok.map(entry => entry.id))).includes(ids.legacy), 'the legacy intent keeps its custody');
      t.diagnostic('qualified 7 over shared NOT_ADMIN -> sent 7 kept; qualified 8 over shared sent 99 -> sent 8 kept; legacy 9 over shared NOT_ADMIN -> pending, custody kept');
    } finally { await page.evaluate(async () => { await client.close(); await persist.remove(base + ':receipts'); await persist.remove(store); }); }
  });
  await check('shared-only lookup recovers absent history and opener remembers those ids without settling them', async () => {
    await witness.reload(); await page.waitForFunction(() => !!window.boot);
    await page.evaluate(options => boot(options), { url });
    const ids = await page.evaluate(() => ({ sent: mintId(), refused: mintId(), evicted: mintId() }));
    const shared = [{ state: 'sent', id: ids.sent, seq: 7 }, failed(ids.refused, 'NOT_ADMIN'), { state: 'sent', id: ids.evicted, seq: 8 }];
    try {
      await page.evaluate(async shared => {
        await client.close();
        await persist.save(store, [{ s: 'm', k: 'client:write-history', v: null }]);
        await persist.save(base + ':receipts', [{ s: 'm', k: 'client:write-history', v: JSON.stringify(shared) }]);
      }, shared);
      await page.evaluate(options => boot(options), { url, offline: true });
      const seen = await page.evaluate(async ids => ({ sent: await client.write(ids.sent), refused: await client.write(ids.refused),
        retried: await client.mutate({ kind: 'mutation', name: 'removeMember' }, {}, { id: ids.sent }),
      }), ids);
      assert.ok(seen.sent, 'absent local history must recover a shared success');
      assert.ok(seen.refused, 'absent local history must recover a shared refusal');
      assert.deepEqual([seen.sent.state, seen.sent.seq], ['sent', 7]);
      assert.equal(seen.refused.why.code, 'NOT_ADMIN');
      assert.deepEqual([seen.retried.state, seen.retried.seq], ['sent', 7]);
      await page.evaluate(() => persist.remove(base + ':receipts'));
      const evicted = await page.evaluate(id => client.mutate({ kind: 'mutation', name: 'removeMember' }, {}, { id }), ids.evicted);
      assert.equal(evicted.why?.code, 'E_WRITE_RECEIPT_EXPIRED', 'opener remembers shared ids even after the receipt is evicted');
      assert.equal(await page.evaluate(() => persist.read(store, 'm', 'client:write-history')), null, 'lookup never copies shared outcomes into settlement history');
      assert.deepEqual(await page.evaluate(async () => (await core.call({ op: 'queued' })).ok), []);
      assert.deepEqual(await page.evaluate(() => sent), []);
    } finally { await page.evaluate(async () => { await client.close(); await persist.remove(store); await persist.remove(base + ':receipts'); }); }
  });

  await check('shared-only refusal cannot settle legacy custody before bound replay', async () => {
    const captured = await legacy();
    try {
      await page.evaluate(async id => persist.save(base + ':receipts', [{ s: 'm', k: 'client:write-history', v: JSON.stringify([
        { state: 'failed', id, why: { code: 'NOT_ADMIN', family: 'rule', message: 'shared refusal' } },
      ]) }]), captured.id);
      await page.evaluate(options => boot(options), { url, offline: true });
      assert.equal((await page.evaluate(id => client.write(id), captured.id)).state, 'pending');
      assert.equal(await page.evaluate(() => persist.read(store, 'm', 'client:write-history')), null);
      await page.evaluate(() => client.close());
      await page.evaluate(options => { window.opening = boot(options); }, { url, holdSend: true });
      await page.waitForFunction(() => window.sendHeld);
      assert.deepEqual(await page.evaluate(() => sent), []);
      assert.equal(await page.evaluate(async id => (await core.call({ op: 'queued' })).ok.find(entry => entry.id === id).id, captured.id), captured.id);
      await page.evaluate(() => releaseSend());
      await page.evaluate(() => opening);
      await until(() => page.evaluate(async id => (await client.write(id))?.why?.code === 'NOT_ADMIN', captured.id), 'same-id replay established the local refusal');
      assert.deepEqual(await page.evaluate(() => sent.map(send => [send.request.store_id, send.reply.replayed, send.reply.why.code])), [[captured.binding, true, 'NOT_ADMIN']]);
      assert.equal(await audit(url), 0);
      await page.evaluate(() => client.close());
      await witness.reload(); await page.waitForFunction(() => !!window.boot);
      await page.evaluate(options => boot(options), { url, offline: true });
      assert.equal((await page.evaluate(id => client.write(id), captured.id)).why.code, 'NOT_ADMIN');
    } finally { await page.evaluate(async () => { window.releaseSend?.(); await client.close(); await persist.remove(store); await persist.remove(base + ':receipts'); }); }
  });

  for (const initial of ['absent', 'replacement']) await check(`adoption during lookup recomputes legacy custody (${initial} local history)`, async () => {
    await witness.reload(); await page.waitForFunction(() => !!window.boot);
    await page.evaluate(options => boot(options), { url });
    const id = await page.evaluate(() => mintId());
    try {
      await page.evaluate(async ({ id, initial }) => {
        await client.close();
        await persist.save(store, [{ s: 'm', k: 'client:write-history', v: initial === 'absent' ? null : JSON.stringify([
          { state: 'failed', id, why: { code: 'E_STORE_REPLACED', family: 'store', message: 'unknown' } },
        ]) }]);
      }, { id, initial });
      await page.evaluate(options => boot(options), { url, offline: true });
      await page.evaluate(id => { window.readGate = 'queued'; window.lookupResult = client.write(id); }, id);
      await page.waitForFunction(() => window.readHeld);
      await page.evaluate(async id => {
        const state = (await core.call({ op: 'sync_state', capture: false })).ok;
        const generation = (await core.call({ op: 'state' })).ok.generation;
        window.orphan = base + ':tab-lookup-race';
        await persist.save(orphan, [...await persist.load(store),
          { s: 'o', k: id, v: JSON.stringify({ id, seq: 1, op: 'removeMember', args: {}, viewer: 'dev:alice', now: Date.now(),
            new_ids: [], predicted: [], predictable: false, observed_seq: state.watermark, receipt_store: { id: state.store_id } }) },
          { s: 'm', k: 'client:write-history', v: JSON.stringify([{ state: 'failed', id, why: { code: 'NOT_ADMIN', family: 'rule', message: 'verified correction' } }]) },
        ]);
        const adopted = await core.call({ op: 'observe_store', page: { snapshot: false, generation, events: [], more: false,
          watermark: state.watermark, store_id: state.store_id } });
        if (adopted.denied) throw Error(JSON.stringify(adopted));
      }, id);
      assert.equal(await page.evaluate(() => persist.has(orphan)), false, 'real adoption removed its source');
      assert.equal(await page.evaluate(async id => JSON.parse(await persist.read(store, 'o', id)).id, id), id, 'adoption committed destination custody');
      await page.evaluate(() => releaseRead());
      assert.equal((await page.evaluate(() => lookupResult)).state, 'pending', 'the first lookup must recompute after adoption');
      assert.equal((await page.evaluate(id => client.write(id), id)).state, 'pending');
      assert.equal(await page.evaluate(async id => JSON.parse(await persist.read(base + ':receipts', 'm', 'client:write-history')).find(write => write.id === id).why.code, id), 'NOT_ADMIN');
      assert.deepEqual(await page.evaluate(() => sent), []);
      const own = await page.evaluate(() => persist.read(store, 'm', 'client:write-history'));
      assert.equal(own ? JSON.parse(own)[0].why.code : undefined, initial === 'absent' ? undefined : 'E_STORE_REPLACED');
    } finally { await page.evaluate(async () => { window.releaseRead?.(); await client.close(); await persist.remove(store); await persist.remove(base + ':receipts'); }); }
  });

  for (const outcome of ['NOT_FOUND', 'sent']) await check(`lookup preserves local ${outcome} committed between history reads`, async () => {
    await witness.reload(); await page.waitForFunction(() => !!window.boot);
    await page.evaluate(options => boot(options), { url });
    const id = await page.evaluate(() => mintId());
    const local = outcome === 'sent' ? { state: 'sent', id, seq: 7 } : failed(id, outcome);
    try {
      await page.evaluate(async ({ id, shared }) => {
        await client.close();
        await persist.save(store, [{ s: 'm', k: 'client:write-history', v: JSON.stringify([{ state: 'failed', id, why: { code: 'E_STORE_REPLACED', family: 'store', message: 'unknown' } }]) }]);
        await persist.save(base + ':receipts', [{ s: 'm', k: 'client:write-history', v: JSON.stringify([shared]) }]);
      }, { id, shared: failed(id, 'NOT_ADMIN') });
      await page.evaluate(options => boot(options), { url, offline: true });
      await page.evaluate(id => { window.readGate = 'lookup'; window.lookupResult = client.write(id); }, id);
      await page.waitForFunction(() => window.readHeld);
      await page.evaluate(async ({ id, local }) => {
        const binding = (await core.call({ op: 'sync_state', capture: false })).ok.store_id;
        for (const request of [
          { op: 'enqueue', entry: { id, seq: 1, op: 'removeMember', args: {}, viewer: 'dev:alice', now: Date.now(), new_ids: [], predicted: [], predictable: false,
            observed_seq: 7, receipt_store: { id: binding } } },
          { op: 'keep_write', value: JSON.stringify({ ...local, revalidated_store: binding }) },
          { op: 'settle', id },
        ]) { const reply = await core.call(request); if (reply.denied) throw Error(JSON.stringify(reply)); }
      }, { id, local });
      assert.deepEqual(await page.evaluate(async () => (await core.call({ op: 'queued' })).ok), [], 'only the committed terminal remains before lookup resumes');
      await page.evaluate(() => releaseRead());
      const result = await page.evaluate(() => lookupResult);
      assert.deepEqual([result.state, result.seq ?? result.why.code], [local.state, local.seq ?? local.why.code]);
      assert.equal((await page.evaluate(id => client.write(id), id)).state, local.state);
      assert.deepEqual(await page.evaluate(() => sent), []);
    } finally { await page.evaluate(async () => { window.releaseRead?.(); await client.close(); await persist.remove(store); await persist.remove(base + ':receipts'); }); }
  });
  assert.deepEqual(errors, []);
});
