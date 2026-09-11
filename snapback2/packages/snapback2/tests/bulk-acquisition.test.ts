import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileRangeStore } from '../dist/test.mjs';
import { OfflineRuntime, commitQuery, DrainSubscription, itemInputs } from '../dist/sqlite-test.mjs';

const identity = { generation: 'a'.repeat(64), schemaHash: 'b'.repeat(64), planHash: 'c'.repeat(64) };
function batch(count: number) {
  return { more: false, pages: Array.from({ length: count }, (_, i) => ({ args: { c: i ? `p${i}` : null },
    envelope: { protocol: 1, ...identity, authority: { principal: 'dev:alice', authEpoch: 7 },
      state: 'complete', data: { $row: { table: 'messages', id: `m${i}` } },
      next: i + 1 < count ? `p${i + 1}` : null, seq: i + 1, validator: String(i).repeat(64),
      rows: [{ table: 'messages', id: `m${i}`, row: { id: `m${i}`, body: `body${i}` } }],
      receipt: { ranges: [], absences: [], verdicts: [] } } })) };
}
async function fixture(run: (runtime: any, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 's2-bulk-'));
  const runtime = new OfflineRuntime({ store: fileRangeStore(root) });
  try {
    await runtime.open('dev:alice');
    runtime.manifest({ generation: identity.generation, programGeneration: identity.generation, channels: {}, auth: {},
      ops: { read: { kind: 'query', planHash: identity.planHash, args: { c: { Optional: 'Cursor' } }, drain: { cursor: 'c' } } } });
    await run(runtime, root);
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
}
const commit = (runtime: any, raw: any, args: any = { c: null }) => commitQuery({ runtime, op: 'read', args, raw, batch: true,
  revision: runtime.coverageRevision, deliveryOrder: runtime.beginDelivery(), current: () => true,
  failure: (error: unknown) => error, revalidate: async () => { throw Error('unexpected conditional batch'); } });

test('bulk pages preserve arguments, independent sequences and durable rows', async () => fixture(async runtime => {
  const result = await commit(runtime, batch(9));
  assert.equal(result.pages.length, 9);
  assert.deepEqual((await runtime.store.coverage()).rows.map((row: any) => row.id).sort(), Array.from({ length: 9 }, (_, i) => `m${i}`));
  for (let i = 0; i < 9; i++) {
    const held = await runtime.answer('read', { c: i ? `p${i}` : null });
    assert.equal(held.seq, i + 1); assert.equal(held.data.body, `body${i}`);
    const evidence = itemInputs(result.pages[i]);
    assert.equal(evidence.values.get(result.pages[i].data), `messages\0m${i}`);
    assert.deepEqual(evidence.observations.get(`messages\0m${i}`), { through: i + 1 });
    assert.equal(evidence.entries, itemInputs(result.pages[0]).entries, 'pages share one captured ledger');
  }
  assert.deepEqual((await runtime.store.metadata()).watermarks, [], 'unfinished group acceptance cannot mint a caught-up watermark');
}));

test('malformed final transport frame rejects before any group, including forged chains', async () => {
  for (const mutate of [
    (value: any) => { value.pages[8].envelope.rows[0].id = 'wrong'; },
    (value: any) => { value.pages[8].args.c = 'skipped'; },
    (value: any) => { value.pages[8].envelope.next = 'p1'; value.more = true; },
  ]) await fixture(async runtime => {
    const value = batch(9); mutate(value);
    await assert.rejects(commit(runtime, value));
    assert.equal((await runtime.store.coverage()).rows.length, 0);
  });
});

test('owner refusal after a valid prefix publishes durable pages and advances before refusing', async () => fixture(async runtime => {
  const error = { code: 'E_OFFLINE_RESUME', family: 'offline', guide: 'offline',
    message: 'the acquisition page repeated its cursor', rewrite: 'reconnect to refresh the cursor' };
  await assert.rejects(commit(runtime, { ...batch(1), error }), /refusal follows a terminal page/);
  assert.equal((await runtime.store.coverage()).rows.length, 0, 'a malformed terminal plus refusal rejects before persistence');
  const prefix = { ...batch(6), pages: batch(6).pages.slice(0, 5), error };
  const requested: unknown[] = [], events: any[] = [];
  const sub = new DrainSubscription({ args: { c: null },
    query: async (args: any) => {
      requested.push(args.c);
      return (await commit(runtime, args.c === null ? prefix : { pages: [], more: false, error }, args)).pages;
    },
    mark: async () => { assert.fail('a refused suffix cannot certify exhaustion'); },
    subscribe: () => { throw Error('a refused suffix has no live tail'); },
    onEvent: (event: any) => events.push(event),
  });
  try {
    const refused = await sub.until((event: any) => event.state === 'refused');
    assert.equal(refused.code, error.code);
    assert.deepEqual(requested, [null, 'p5']);
    assert.deepEqual(events.slice(0, -1).map(event => [event.data.body, event.caughtUp]),
      Array.from({ length: 5 }, (_, i) => [`body${i}`, false]));
    assert.equal((await runtime.store.coverage()).rows.length, 5);
    assert.deepEqual((await runtime.store.metadata()).watermarks, []);
  } finally { sub.close(); }
}));

test('a later carrier failure preserves only earlier durable groups across reopen', async () => fixture(async (runtime, root) => {
  const original = runtime.store.commit.bind(runtime.store); let attempts = 0;
  runtime.store.commit = async (swap: any) => {
    if (swap.deliveries?.length && ++attempts === 2) throw Error('injected carrier failure');
    return original(swap);
  };
  await assert.rejects(commit(runtime, batch(9)), /injected carrier failure/);
  assert.equal((await runtime.store.coverage()).rows.length, 4);
  await runtime.close();
  const reopened = fileRangeStore(root)(); await reopened.open('dev:alice');
  try {
    assert.deepEqual((await reopened.coverage()).rows.map((row: any) => row.id).sort(), ['m0', 'm1', 'm2', 'm3']);
    assert.equal(await reopened.answer('read', { c: 'p4' }), undefined);
  } finally { await reopened.close(); }
}));

test('a batched drain watches the last page position, never the batch starting cursor', async () => {
  let tail: unknown; const marks: unknown[] = [], events: any[] = [];
  const sub = new DrainSubscription({ args: { c: null },
    query: async () => [{ state: 'complete', data: ['one'], seq: 1, next: 'second' },
      { state: 'complete', data: ['two'], seq: 2, next: null }],
    mark: async (watermark: unknown) => { marks.push(watermark); },
    subscribe: (args: unknown) => { tail = args; return { close() {}, until: async () => { throw Error('unused'); } }; },
    onEvent(event: any) { events.push(event); },
  });
  try {
    await sub.until((event: any) => event.caughtUp);
    assert.deepEqual(tail, { c: 'second' }); assert.deepEqual(marks, ['second']);
    assert.deepEqual(events.map(event => [event.data, event.caughtUp]), [[['one'], false], [['two'], true]]);
  }
  finally { sub.close(); }
});

test('a public page callback can close or reset before another batch page is exposed', async () => {
  for (const action of ['close', 'reset'] as const) {
    const events: any[] = []; let queries = 0;
    const done = Promise.withResolvers<void>();
    const sub = new DrainSubscription({ args: { c: null },
      query: async () => ++queries === 1
        ? [{ state: 'complete', data: ['first'], seq: 1, next: 'second' }, { state: 'complete', data: ['stale'], seq: 2, next: null }]
        : [{ state: 'complete', data: ['fresh'], seq: 3, next: null }],
      mark: async () => {},
      subscribe: () => ({ close() {}, until: async () => { throw Error('unused'); } }),
      onEvent(event: any) {
        events.push(event.data);
        if (events.length === 1) { sub[action](); if (action === 'close') done.resolve(); }
        else done.resolve();
      },
    });
    try {
      await done.promise; await new Promise(resolve => setTimeout(resolve, 0));
      assert.deepEqual(events, action === 'close' ? [['first']] : [['first'], ['fresh']]);
    } finally { sub.close(); }
  }
});
