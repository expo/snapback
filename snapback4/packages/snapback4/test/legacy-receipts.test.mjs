// Upgrade evidence is read from actual old-format outbox rows. Both stores
// replay the original ID against a real server's refused idempotency record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { devServer, root } from '../../../witness/lib.mjs';
import { until } from './helpers/app-server.mjs';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { memoryPersistence, webDevice } from '../dist/web.js';
import { mintId } from '../dist/client.js';
const historyModule = new URL('../dist/writes.js', import.meta.url);
let historySource = readFileSync(historyModule, 'utf8');
if (process.env.SNAPBACK4_RECEIPT_MUTANT === 'only-admin') {
  const guard = 'known.why.code !== "E_STORE_REPLACED")';
  assert.ok(historySource.includes(guard));
  historySource = historySource.replace(guard, 'known.why.code === "NOT_ADMIN")')
    .replace('"./admission.js"', JSON.stringify(new URL('../dist/admission.js', import.meta.url).href));
}
const { WriteHistory } = await import(process.env.SNAPBACK4_RECEIPT_MUTANT
  ? 'data:text/javascript;base64,' + Buffer.from(historySource).toString('base64') : historyModule.href);

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
const operation = { kind: 'mutation', name: 'removeMember' };
const headers = { 'x-snapback-persona': 'alice', 'content-type': 'application/json' };
const ok = reply => { assert.equal(reply.denied, undefined, JSON.stringify(reply)); return reply.ok; };

test('sequence-only acknowledgement with no history stays unknown', async () => {
  const history = new WriteHistory({ read: async () => null, save: async () => assert.fail('unknown outcome cannot be saved') });
  assert.equal(await history.acknowledged('legacy', 3), undefined);
  assert.deepEqual(await history.acknowledged('qualified', 3, true), { state: 'sent', id: 'qualified', seq: 3, replayed: true });
});

for (const code of ['NOT_ADMIN', 'NOT_FOUND', 'CONFLICT']) test(`authored refusal ${code} wins over a success-qualified acknowledgement`, async () => {
  const refused = { state: 'failed', id: 'known', why: { code, family: 'rule', message: code } };
  const history = new WriteHistory({ read: async () => JSON.stringify([refused]), save: async () => assert.fail('authored refusal cannot be replaced') });
  assert.deepEqual(await history.acknowledged('known', 3, true), refused);
});

test('an aborted replay receipt retains its original-store proof for persistence retry', async () => {
  let saved = JSON.stringify([{ state: 'failed', id: 'legacy', why: { code: 'E_STORE_REPLACED' } }]);
  const attempts = [];
  const history = new WriteHistory({ read: async () => saved, save: async value => {
    const receipt = JSON.parse(value); attempts.push(receipt);
    if (attempts.length === 1) throw new Error('receipt transaction aborted');
    const { revalidated_store, ...terminal } = receipt; saved = JSON.stringify([terminal]);
  } });
  const refusal = { state: 'failed', id: 'legacy', why: { code: 'NOT_ADMIN', family: 'rule', message: 'write refused: NOT_ADMIN' } };
  await assert.rejects(history.keep(refusal, 'original-store'), /transaction aborted/);
  assert.equal(history.hasUnpersisted('legacy'), true);
  await history.persistPending();
  assert.deepEqual(attempts.map(receipt => receipt.revalidated_store), ['original-store', 'original-store']);
  assert.equal(history.hasUnpersisted('legacy'), false);
  assert.deepEqual(await history.read('legacy'), refusal);
});

for (const tier of ['memory', 'sqlite']) for (const field of ['observed_seq', 'sent_seq']) for (const prior of ['empty', 'replacement']) {
  test(`${tier}: legacy ${field} with ${prior} history replays NOT_ADMIN without executing`, { timeout: 30_000 }, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'sb4-legacy-receipt-'));
    const sourceDir = join(dir, 'snapback'); mkdirSync(sourceDir); writeFileSync(join(sourceDir, 'schema.q'), source);
    const host = await devServer({ sourceDir, seed: [{ table: 'counters', row: { id: 'audit', admin: false, total: 0 } }] });
    const clients = [];
    t.after(async () => { await Promise.all(clients.map(client => client.close())); await host.close(); rmSync(dir, { recursive: true, force: true }); });
    const persist = memoryPersistence();
    const opener = tier === 'memory' ? webDevice({ wasm: readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')), persist })
      : processDevice({ binary: join(root, 'target/debug/snapback4'), dir: join(dir, 'devices') });
    let online = true, core;
    const posts = [];
    const open = async () => {
      const client = await createLocalClient({ url: host.api, persona: 'alice', waitSeconds: 0,
        device: { open: async (...args) => core = await opener.open(...args) },
        fetch: async (input, init) => {
          if (!online) throw new TypeError('offline upgrade');
          const response = await fetch(input, init);
          if (new URL(input).pathname.startsWith('/m/')) posts.push({ request: JSON.parse(init.body), reply: await response.clone().json() });
          return response;
        },
      });
      clients.push(client); return client;
    };
    let client = await open();
    const store = ok(await core.call({ op: 'sync_state', capture: false })).store_id;
    const id = mintId();
    const refused = await fetch(host.api + '/m/removeMember', { method: 'POST', headers,
      body: JSON.stringify({ id, args: {}, newIds: [], store_id: store }) }).then(response => response.json());
    assert.equal(refused.why.code, 'NOT_ADMIN');
    const db = new DatabaseSync(join(host.app, '.snapback4/store.sqlite'));
    let stored;
    try { stored = db.prepare('SELECT seq, outcome FROM _ops WHERE principal = ? AND id = ?').get('dev:alice', id); }
    finally { db.close(); }
    assert.equal(JSON.parse(stored.outcome).why.code, 'NOT_ADMIN');

    online = false; await client.sync();
    ok(await core.call({ op: 'enqueue', entry: { id, seq: 1, op: operation.name, args: {}, viewer: 'dev:alice', now: Date.now(),
      new_ids: [], predicted: [], predictable: false, [field]: stored.seq, receipt_store: { id: store } } }));
    if (prior === 'replacement') ok(await core.call({ op: 'keep_write', value: JSON.stringify({ state: 'failed', id, why: { code: 'E_STORE_REPLACED', family: 'store', message: 'unknown outcome' } }) }));
    else assert.ok(!JSON.parse(ok(await core.call({ op: 'meta', key: 'write-history' })) ?? '[]').some(receipt => receipt.id === id));
    await client.close(); client = await open();
    const notifications = []; client.onWrite(write => notifications.push(write));
    assert.equal((await client.write(id)).state, 'pending');
    assert.equal((await client.mutate(operation, {}, { id })).state, 'pending');
    // Row reset used to promote legacy observed_seq into a durable success.
    ok(await core.call({ op: 'clear_rows' }));
    await client.close(); client = await open();
    client.onWrite(write => notifications.push(write));
    assert.equal((await client.write(id)).state, 'pending');
    assert.equal(ok(await core.call({ op: 'queued' })).length, 1);
    assert.deepEqual(notifications, []); assert.deepEqual(posts, []);

    online = true; await client.sync();
    await until(async () => (await client.write(id))?.state === 'failed', 'legacy refused outcome');
    assert.equal((await client.mutate(operation, {}, { id })).why.code, 'NOT_ADMIN');
    assert.equal((await client.write(id)).why.code, 'NOT_ADMIN');
    assert.deepEqual(notifications.map(write => write.why?.code), ['NOT_ADMIN']);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].request.id, id); assert.equal(posts[0].request.store_id, store);
    assert.equal(posts[0].reply.replayed, true); assert.equal(posts[0].reply.why.code, 'NOT_ADMIN');
    assert.equal(ok(await core.call({ op: 'queued' })).length, 0);
    await client.close(); online = false; client = await open();
    assert.equal((await client.write(id)).why.code, 'NOT_ADMIN');
    const audit = await fetch(host.api + '/q/total', { method: 'POST', headers, body: JSON.stringify({ args: {} }) }).then(response => response.json());
    assert.equal(audit.data, 0);
    t.diagnostic(JSON.stringify({ tier, field, prior, id, replayed: posts[0].reply.replayed, audit: audit.data }));
  });
}
