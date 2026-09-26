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

test('web receipt upgrades preserve original binding and corrected shared custody', { timeout: 90_000 }, async t => {
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
  if (mutant === 'settlement-overlay') replace('web.ts', 'request.lookup === true ? lookupReceipts(shared, local) : localFirst(shared, local)', 'lookupReceipts(shared, local)');
  if (mutant === 'custody-lookup') replace('local.ts', '(entry ? history.read(id) : history.lookup(id))', 'history.lookup(id)');
  const witness = await launch({ sourceDir, sourceOverrides,
    seed: [{ table: 'counters', row: { id: 'audit', admin: false, total: 0 } }], entrySource: `
import { mintId } from '${join(root, 'packages/snapback4/src/client.ts')}';
window.mintId = mintId;
window.boot = async ({ url, destination = url, holdSend = false, offline = false }) => {
  window.sent = []; window.sendHeld = false; window.releaseSend = undefined;
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
      core.call = async (request, committed) => {
        if (request.op === 'begin_send' && request.id && holdSend) {
          window.sendHeld = true;
          await new Promise(resolve => window.releaseSend = () => { holdSend = false; resolve(); });
        }
        return call(request, committed);
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
  await check('a shared correction never hides this device\'s qualified or pending custody', async () => {
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
    const local = Object.values(ids).map(id => failed(id, 'E_STORE_REPLACED'));
    const shared = [failed(ids.qualified, 'NOT_ADMIN'), { state: 'sent', id: ids.qualifiedOverSent, seq: 99 }, failed(ids.legacy, 'NOT_ADMIN'), failed(ids.unsent, 'NOT_ADMIN')];
    try {
      await page.evaluate(async ({ changes, local, shared }) => {
        await client.close();
        await persist.save(store, [...changes, { s: 'm', k: 'client:write-history', v: JSON.stringify(local) }]);
        await persist.save(base + ':receipts', [{ s: 'm', k: 'client:write-history', v: JSON.stringify(shared) }]);
      }, { local, shared, changes: [
        outbox(ids.qualified, 1, { sent_seq: 7, receipt_store: { id: binding, success_seq: 7 } }),
        outbox(ids.qualifiedOverSent, 2, { sent_seq: 8, receipt_store: { id: binding, success_seq: 8 } }),
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
      assert.equal(seen.unsent.why?.code, 'E_STORE_REPLACED', JSON.stringify(seen.unsent));
      const kept = await page.evaluate(async () => JSON.parse(await persist.read(store, 'm', 'client:write-history')));
      const byId = Object.fromEntries(kept.map(write => [write.id, write]));
      assert.deepEqual([byId[ids.qualified].state, byId[ids.qualified].seq], ['sent', 7], 'the qualified success replaced the local refusal on disk');
      assert.deepEqual([byId[ids.qualifiedOverSent].state, byId[ids.qualifiedOverSent].seq], ['sent', 8]);
      assert.equal(byId[ids.legacy].why.code, 'E_STORE_REPLACED', 'the legacy refusal waits for replay, not for a sibling');
      assert.ok((await page.evaluate(async () => (await core.call({ op: 'queued' })).ok.map(entry => entry.id))).includes(ids.legacy), 'the legacy intent keeps its custody');
      t.diagnostic('qualified 7 over shared NOT_ADMIN -> sent 7 kept; qualified 8 over shared sent 99 -> sent 8 kept; legacy 9 over shared NOT_ADMIN -> pending, custody kept');
    } finally { await page.evaluate(async () => { await client.close(); await persist.remove(base + ':receipts'); await persist.remove(store); }); }
  });
  assert.deepEqual(errors, []);
});
