// @ref LLP 3000.023#11 — independent custody and commits must not starve a one-shot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, q, m, until, program } from './helpers/one-shot.mjs';

const source = program.replace("  name: text\n  read <- allow", "  name: text\n  update <- allow\n  read <- allow") + `
table likes:
  owner: principal
  public
  sync public
mutation like(): server
  insert likes { owner: viewer }
mutation rename(name: text): server
  update profiles['bob'] { name }
`;
const tiers = ['online', 'wasm', 'process', 'app-online', 'app-wasm', 'app-process'];
for (const tier of tiers) {
  test(`${tier}: server aggregate settles while unrelated like remains unobserved`, async t => {
    const gate = Promise.withResolvers(); let held = false;
    t.after(() => gate.resolve());
    const f = await setup(t, tier, { program: source, fetch: async (path, init, send) => {
      if (held && path === '/m/like') await gate.promise;
      return send();
    } });
    held = true;
    const write = await f.client.mutate(m('like'), {}, { waitSeconds: 0 });
    assert.equal(write.state, 'pending');
    const read = await f.client.query(q('insights'), {});
    assert.equal(read.data, 1, JSON.stringify(read));
    assert.ok((await f.client.pendingWrites()).some(w => w.id === write.id));
  });
  test(`${tier}: unrelated commits at every publication do not spend the round budget`, async t => {
    const f = await setup(t, tier, { program: source }); let rounds = 0;
    f.controls.boundary = async () => {
      rounds++;
      assert.equal((await f.client.mutate(m('rename'), { name: `revision-${rounds}` })).state, 'sent');
      if (f.client.sync) await f.client.sync();
    };
    const read = await f.client.query(q('item'), {});
    assert.equal(read.data?.body, 'image-1', JSON.stringify(read));
    assert.equal(rounds, 1);
  });
}

const { readFileSync } = await import('node:fs');
const receiptSource = readFileSync(new URL('../../../crates/snapback4-lang/tests/fixtures/rp-predecessor/schema.q', import.meta.url), 'utf8')
  .replace(/^use .*$/gm, '')
  .replace(/\b(conversations|members|messages)\b/g, name => `receipt_${name}`)
  .replace('query history(', 'query receiptHistory(').replace(/\bsend\b/g, 'receiptSend');
for (const tier of tiers) test(`${tier}: history settles while receipt watermark writes stay unobserved`, async t => {
  const gate = Promise.withResolvers(); let held = false;
  t.after(() => gate.resolve());
  const f = await setup(t, tier, { program: source + receiptSource, fetch: async (path, init, send) => {
    if (held && ['/m/seen', '/m/delivered', '/m/compactReceipts'].includes(path)) await gate.promise;
    return send();
  } });
  const room = await f.post('/m/createConversation', { id: 'create-room', args: { title: 'Receipts' } });
  assert.equal(room.state, 'sent', JSON.stringify(room));
  const conversation = room.result;
  assert.equal((await f.post('/m/add', { id: 'add-bob', args: { conversation, principal: 'dev:bob' } })).state, 'sent');
  assert.equal((await f.post('/m/receiptSend', { id: 'seed-message', args: { conversation, text: 'hello', photo: null } })).state, 'sent');
  if (f.client.sync) await f.client.sync();
  held = true;
  const write = await f.client.mutate(m('seen'), { conversation, through: 1 }, { waitSeconds: 0 });
  assert.equal(write.state, 'pending');
  const read = await f.client.query(q('receiptHistory'), { conversation, c: null });
  assert.equal(read.data?.[0]?.text, 'hello', JSON.stringify(read));
  assert.ok((await f.client.pendingWrites()).some(w => w.id === write.id));
});

const { setTimeout: delay } = await import('node:timers/promises');
for (const tier of tiers) for (const kind of ['row', 'count', 'rule', 'unknown', 'failure']) {
  test(`${tier}: dependent ${kind} custody waits for observation or failure without spending rounds`, async t => {
    const gate = Promise.withResolvers(); let held = false, evaluated = 0, finished = false;
    const operation = { row: 'edit', count: 'send', rule: 'remove', unknown: 'rename', failure: 'refuse' }[kind];
    t.after(() => gate.resolve());
    const f = await setup(t, tier, { program: source + '\nmutation refuse(): server\n  require false else TEST_REFUSAL\n', fetch: async (path, init, send) => {
      if (held && path === `/m/${operation}`) await gate.promise;
      const response = await send();
      if ((kind === 'unknown' || kind === 'failure') && path === '/schema') {
        const json = await response.json();
        json.programs.find(p => p.name === operation).settlement = null;
        return Response.json(json);
      }
      return response;
    } });
    held = true;
    const args = kind === 'row' || kind === 'count' ? { body: 'after-observation' } : kind === 'unknown' ? { name: 'new-name' } : {};
    const write = await f.client.mutate(m(operation), args, { waitSeconds: 0 });
    assert.equal(write.state, 'pending');
    f.controls.boundary = () => { evaluated++; };
    const query = f.client.query(q(kind === 'count' ? 'insights' : 'item'), {}).then(read => { finished = true; return read; });
    await until(() => evaluated > 0);
    await delay(300);
    assert.equal(finished, false, 'does not exhaust the old 25/50/100 ms pauses');
    assert.equal(evaluated, 1, 'custody wait is event-driven, not repeated evaluation');
    gate.resolve();
    const read = await query;
    if (kind === 'rule') assert.ok(read.data === null || read.denied, JSON.stringify(read));
    else if (kind === 'count') assert.equal(read.data, 2, JSON.stringify(read));
    else assert.equal(read.data?.body, kind === 'row' ? 'after-observation' : 'image-1', JSON.stringify(read));
    assert.equal((await f.client.write(write.id)).state, kind === 'failure' ? 'failed' : 'sent');
  });
}

for (const tier of tiers) test(`${tier}: receipt-owned returned field waits for seen observation`, async t => {
  const gate = Promise.withResolvers(); let held = false, evaluated = 0, finished = false;
  t.after(() => gate.resolve());
  const f = await setup(t, tier, { program: source + receiptSource, fetch: async (path, init, send) => {
    if (held && path === '/m/seen') await gate.promise;
    return send();
  } });
  const room = await f.post('/m/createConversation', { id: 'create-room', args: { title: 'Receipts' } });
  const conversation = room.result;
  assert.equal((await f.post('/m/add', { id: 'add-bob', args: { conversation, principal: 'dev:bob' } })).state, 'sent');
  assert.equal((await f.post('/m/receiptSend', { id: 'seed-message', args: { conversation, text: 'hello', photo: null } })).state, 'sent');
  if (f.client.sync) await f.client.sync();
  held = true;
  assert.equal((await f.client.mutate(m('seen'), { conversation, through: 1 }, { waitSeconds: 0 })).state, 'pending');
  f.controls.boundary = () => { evaluated++; };
  const query = f.client.query(q('receiptMember'), { conversation }).then(read => { finished = true; return read; });
  await until(() => evaluated > 0); await delay(300);
  assert.equal(finished, false); assert.equal(evaluated, 1);
  gate.resolve();
  const read = await query;
  assert.equal(read.data?.seenOrdinal, 1, JSON.stringify(read));
});

for (const tier of tiers) test(`${tier}: held dependent custody expires on the single 30-second timer`, async t => {
  const gate = Promise.withResolvers(); let held = false, evaluated = 0;
  t.after(() => gate.resolve());
  const f = await setup(t, tier, { program: source, fetch: async (path, init, send) => {
    if (held && path === '/m/rename') await gate.promise;
    return send();
  } });
  held = true;
  await f.client.mutate(m('rename'), { name: 'held-name' }, { waitSeconds: 0 });
  const original = globalThis.setTimeout, deadlines = [];
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    if (ms === 30_000) { deadlines.push(() => fn(...args)); return original(() => {}, ms); }
    return original(fn, ms, ...args);
  });
  f.controls.boundary = () => { evaluated++; };
  const query = f.client.query(q('profile'), {});
  await until(() => evaluated > 0);
  assert.equal(deadlines.length, 1); deadlines[0]();
  const read = await query;
  assert.equal(read.denied?.code, 'E_QUERY_RETRY'); assert.equal(read.denied.retryable, true);
});

for (const tier of ['wasm','process','app-wasm','app-process']) test(`${tier}: dependent observation does not wait for later unrelated custody`, async t => {
  const first = Promise.withResolvers(), unrelated = Promise.withResolvers();
  let held = false, evaluated = false;
  t.after(() => { first.resolve(); unrelated.resolve(); });
  const f = await setup(t, tier, { program: source, fetch: async (path, init, send) => {
    if (held && path === '/m/edit') await first.promise;
    if (held && path === '/m/like') await unrelated.promise;
    return send();
  } });
  held = true;
  await f.client.mutate(m('edit'), { body: 'observed-first' }, { waitSeconds: 0 });
  const other = await f.client.mutate(m('like'), {}, { waitSeconds: 0 });
  f.controls.boundary = () => { evaluated = true; };
  const query = f.client.query(q('item'), {});
  await until(() => evaluated); first.resolve();
  const read = await query;
  assert.equal(read.data?.body, 'observed-first', JSON.stringify(read));
  assert.ok((await f.client.pendingWrites()).some(w => w.id === other.id));
});

const { createMockClient } = await import('../dist/mock.js');
for (const known of [true, false]) test(`mock: ${known ? 'known disjoint' : 'unknown'} effects use the same custody rule`, async t => {
  const client = createMockClient({ viewer: 'dev:bob', tables: {}, commitDelayMs: 500,
    dependencies: known ? { item: { reads: {messages: null}, writes: {} }, like: {reads: {}, writes: {likes: null}} } : undefined,
    ops: { queries: { item: () => 'answer' }, mutations: { like: () => [] } } });
  t.after(() => client.close());
  await client.mutate(m('like'), {}, { waitSeconds: 0 });
  let done = false;
  const result = client.query(q('item'), {}).then(r => { done = true; return r; });
  await delay(100);
  assert.equal(done, known);
  assert.equal((await result).data, 'answer');
});

for (const tier of ['wasm','process','app-wasm','app-process']) test(`${tier}: a newly started read observes an acknowledged write behind an unrelated held send`, async t => {
  const first = Promise.withResolvers(), unrelated = Promise.withResolvers();
  let held = false, tailSending = false;
  t.after(() => { first.resolve(); unrelated.resolve(); });
  const f = await setup(t, tier, { program: source, fetch: async (path, init, send) => {
    if (held && path === '/m/edit') await first.promise;
    if (held && path === '/m/like') { tailSending = true; await unrelated.promise; }
    return send();
  } });
  held = true;
  await f.client.mutate(m('edit'), { body: 'observed-first' }, { waitSeconds: 0 });
  const other = await f.client.mutate(m('like'), {}, { waitSeconds: 0 });
  first.resolve(); await until(() => tailSending);
  const read = await f.client.query(q('item'), {});
  assert.equal(read.data?.body, 'observed-first', JSON.stringify(read));
  assert.ok((await f.client.pendingWrites()).some(w => w.id === other.id));
});

const columns = readFileSync(new URL('../../../crates/snapback4-lang/tests/fixtures/maintained-columns.q', import.meta.url), 'utf8')
  .replace(/\blikes\b/g, 'countedLikes').replace(/\blike\(/g, 'countedLike(');
for (const tier of tiers) test(`${tier}: maintained likeCount waits for its source write`, async t => {
  const gate = Promise.withResolvers(); let held = false, evaluated = false, finished = false;
  t.after(() => gate.resolve());
  const f = await setup(t, tier, { program: source + columns, fetch: async (path, init, send) => {
    if (held && path === '/m/countedLike') await gate.promise;
    return send();
  } });
  assert.equal((await f.post('/m/post', { id: 'post', args: { id: 'p', at: 1 } })).state, 'sent');
  if (f.client.sync) await f.client.sync();
  held = true;
  await f.client.mutate(m('countedLike'), { id: 'l', postId: 'p', active: true, amount: 3 }, { waitSeconds: 0 });
  f.controls.boundary = () => { evaluated = true; };
  const query = f.client.query(q('postRow'), { id: 'p' }).then(read => { finished = true; return read; });
  await until(() => evaluated); await delay(300);
  assert.equal(finished, false);
  gate.resolve();
  assert.equal((await query).data?.likeCount, 1);
});

for (const tier of ['online', 'app-online']) test(`${tier}: dependency discovery cannot cross store identity`, async t => {
  const f = await setup(t, tier, { program: source, fetch: async (path, init, send) => {
    const response = await send();
    if (path !== '/schema') return response;
    const json = await response.json(); json.store_id = 'replacement-store';
    return Response.json(json);
  } });
  assert.equal((await f.client.query(q('item'), {})).denied?.code, 'E_STORE_REPLACED');
});
