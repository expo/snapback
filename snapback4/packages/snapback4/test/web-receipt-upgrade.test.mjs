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
  if (mutant === 'shared-correction') replace('web.ts', 'if (prior.state === "failed" && prior.why.code === "E_STORE_REPLACED") kept[index] = write;', '/* mutant: keep the first unknown outcome forever */');
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
  assert.deepEqual(errors, []);
});
