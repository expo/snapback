import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NativeAcquisitionClient } from '../dist/client.mjs';
import { NativeCustody, RowImage, encodeCursor } from '../dist/sqlite-test.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../../corpus/deliver-receipts-inbox.json', import.meta.url), 'utf8'));
const operation = { kind: 'query', ir: fixture.program, certificate: fixture.certificate, planHash: fixture.certificate.plan_hash, cursor: 'c', drain: { cursor: 'c' } };
const generation = 'a'.repeat(64), op = fixture.program.name;
const program = { generation, schemaHash: fixture.certificate.schema_hash, schema: fixture.schema, programs: { [op]: operation } };
const wire = (value: any): any => value === 'Null' ? null : value.Row || value.Map
  ? Object.fromEntries(Object.entries(value.Row ?? value.Map).map(([key, value]) => [key, wire(value)]))
  : value.Array ? value.Array.map(wire) : Object.values(value)[0];
const wireRows = fixture.receipt.rows.map((r: any) => ({ ...r, row: wire(r.row) }));
const event = wireRows.find((r: any) => r.table === 'deliveries').row;
const position = (id = event.id, seq = event.seq) => encodeCursor({ table: 'deliveries', index: 'byRecipient', order: 'Asc',
  suffix: [{ name: 'seq', kind: 'Int' }, { name: 'id', kind: 'Id' }], values: [{ Int: seq }, { Id: id }] });
const receipt = () => ({ ranges: [], absences: [], verdicts: [] });
function frame(after: string | null = null): any {
  return { protocol: 1, generation, schemaHash: program.schemaHash, authority: { principal: 'u1', authEpoch: 1 },
    log: 'deliveries', content: 'messages', seq: 2, readTime: 0, rows: after === null ? structuredClone(wireRows) : [],
    pages: [{ after, cursor: position(), next: null, exhausted: true,
      events: after === null ? [{ id: event.id, row: 'm', disposition: 'present' }] : [], receipt: receipt() }], receipts: [], more: false };
}
function memory() {
  const pages = new Map<number, string>(), proofs = new Map<string, any>();
  let state: any, program: any, writes = 0, fail = false;
  const disk = { async load() { return structuredClone({ program, state, pages: [...pages], proofs: [...proofs] }); },
    async commit(change: any) {
      if (fail) throw Error('injected carrier failure');
      const owned = structuredClone(change);
      for (const [id, value] of owned.pages) if (value === null) pages.delete(id); else pages.set(id, value);
      for (const [id, value] of Object.entries(owned.proofs)) if (value === null) proofs.delete(id); else proofs.set(id, value);
      program = owned.program ?? program; state = owned.state; writes++;
    }, close() {} };
  return { disk, saved: () => ({ state, program, pages, proofs, writes }), fail(value: boolean) { fail = value; } };
}
function client(store: ReturnType<typeof memory>, native: (body: any) => any | Promise<any>, options: any = {}) {
  return new NativeAcquisitionClient({ url: 'https://native.invalid', token: 'bound-secret', principal: 'u1',
    disk: async () => store.disk, fetch: async (url: string, init: any) => {
      const path = new URL(url).pathname;
      const value = path === '/api/auth/me' ? { viewer: 'u1', kind: 'user', authEpoch: 1 }
        : path === '/api/manifest' ? { generation, programGeneration: generation, channels: {}, auth: {}, ops: { [op]: { ...operation, args: fixture.program.args } } }
        : path === '/api/program' ? program : await native(JSON.parse(init.body));
      return value instanceof Response ? value : Response.json(value);
    }, ...options });
}

test('native body and cursor commit atomically before its first receipt request, and named offline query uses the same rows', async () => {
  const store = memory(), requests: any[] = [];
  const c = client(store, body => {
    requests.push(body);
    if (body.after === null) return frame();
    const held = store.saved();
    assert.equal(held.state.logs.deliveries.exhausted, true);
    assert.match([...held.pages.values()].join(''), /body/);
    assert.deepEqual(body.receipts, held.state.packets.map(({ id, events }: any) => ({ id, events })));
    return { ...frame(body.after), receipts: body.receipts.map((p: any) => ({ id: p.id, state: 'complete', seq: 3 })), seq: 3 };
  });
  try {
    const result = await c.acquire('deliveries');
    assert.equal(result.acquired, 1); assert.equal(result.pending, 0); assert.equal(requests.length, 2);
    c.setOffline();
    const local = await c.query(op, { c: null });
    assert.equal(local.connection, 'offline'); assert.match(JSON.stringify(local.data), /body/);
    assert.deepEqual(await c.settled(), { remaining: 0, rejected: 0 });
  } finally { await c.close(); }
});

test('carrier abort earns no receipt and leaves the previous physical state intact', async () => {
  const store = memory(); store.fail(true); let requests = 0;
  const c = client(store, () => { requests++; return frame(); });
  await assert.rejects(c.acquire('deliveries'), /injected carrier failure/);
  assert.equal(requests, 1); assert.equal(store.saved().writes, 0); assert.equal(store.saved().pages.size, 0);
  assert.throws(() => c.rows('messages'), /not readable/);
  await c.close();
});

test('an unfinished durable prefix restores its cursor and earned packet before continuing after restart', async () => {
  const store = memory();
  let c = client(store, body => {
    if (body.after !== null) throw Error('transport cut during paging');
    const value = frame(); value.pages[0].exhausted = false; value.pages[0].next = position(); value.more = true;
    return value;
  });
  await assert.rejects(c.acquire('deliveries'), /transport cut during paging/); await c.close();
  assert.equal(store.saved().state.logs.deliveries.exhausted, false);
  assert.equal(store.saved().state.packets.length, 1);
  c = client(store, body => {
    assert.equal(body.after, position()); assert.equal(body.receipts.length, 1);
    return { ...frame(body.after), seq: 3, receipts: [{ id: body.receipts[0].id, state: 'complete', seq: 3 }] };
  });
  const status = await c.acquire('deliveries');
  assert.equal(status.exhausted, true); assert.equal(status.acquired, 1); assert.equal(status.pending, 0); await c.close();
});

test('a receipt-only owner turn is followed by a receipt-free page turn', async () => {
  const store = memory(); let requests = 0;
  const c = client(store, body => {
    if (++requests === 1) {
      const value = frame(); value.pages[0].exhausted = false; value.pages[0].next = position(); return value;
    }
    if (requests === 2) return { ...frame(body.after), pages: [], seq: 3,
      receipts: [{ id: body.receipts[0].id, state: 'complete', seq: 3 }] };
    assert.deepEqual(body.receipts, []); return { ...frame(body.after), seq: 3 };
  });
  const status = await c.acquire('deliveries'); assert.equal(status.exhausted, true); assert.equal(requests, 3); await c.close();
});

test('authentication refusal during online reconstruction durably seals before a later offline open', async () => {
  const store = memory();
  let c = client(store, body => body.after === null ? frame() : { ...frame(body.after),
    receipts: [{ id: body.receipts[0].id, state: 'complete', seq: 2 }] });
  await c.acquire('deliveries'); await c.close();
  c = client(store, () => assert.fail(), { fetch: async () => Response.json({ code: 'E_SESSION', family: 'auth', message: 'revoked', guide: 'auth/session' }, { status: 401 }) });
  await assert.rejects(c.initialize(), /revoked/); await c.close(); assert.equal(store.saved().state.sealed, true);
  c = client(store, () => assert.fail(), { offline: true });
  await assert.rejects(c.initialize(), /sealed/); await c.close();
});

test('lost native success reply leaves the exact durable packet for retry after physical client reconstruction', async () => {
  const store = memory(), sent: any[] = []; let received = false, transitions = 0;
  let c = client(store, body => {
    if (body.after === null) return frame();
    sent.push(body.receipts);
    if (!received) { received = true; transitions++; }
    throw Error('lost successful reply');
  });
  await assert.rejects(c.acquire('deliveries'), /lost successful reply/); await c.close();
  assert.equal(store.saved().state.packets.length, 1);
  c = client(store, body => {
    sent.push(body.receipts);
    if (!received) { received = true; transitions++; }
    return { ...frame(body.after), seq: 3, receipts: body.receipts.map((p: any) => ({ id: p.id, state: 'complete', seq: 3 })) };
  });
  await c.acquire('deliveries'); assert.deepEqual(sent[0], sent[1]); assert.equal(transitions, 1); await c.close();
  c = client(store, () => assert.fail('offline reconstruction must not fetch'), { offline: true });
  await c.initialize(); assert.equal(c.rows('messages')[0].body, 'body'); assert.equal((await c.settled()).remaining, 0); await c.close();
});

for (const mutation of ['principal', 'cursor', 'missing-body', 'duplicate-event', 'foreign-receipt'] as const)
  test(`malformed native ${mutation} is rejected before any durable write or receipt admission`, async () => {
    const store = memory(), value = frame();
    if (mutation === 'principal') value.authority.principal = 'u2';
    if (mutation === 'cursor') value.pages[0].cursor = position(event.id, 3);
    if (mutation === 'missing-body') value.rows = value.rows.filter((r: any) => r.table !== 'messages');
    if (mutation === 'duplicate-event') value.pages[0].events.push(value.pages[0].events[0]);
    if (mutation === 'foreign-receipt') value.receipts = [{ id: 'not-submitted', state: 'complete', seq: 2 }];
    const c = client(store, () => value);
    await assert.rejects(c.acquire('deliveries')); assert.equal(store.saved().writes, 0); await c.close();
  });

test('token/generation binding mismatch and terminal session refusal seal rather than expose a retained partition', async () => {
  const store = memory();
  let c = client(store, body => body.after === null ? frame() : Response.json({ code: 'E_SESSION', family: 'auth', message: 'expired', guide: 'auth/session' }, { status: 401 }));
  await assert.rejects(c.acquire('deliveries'), /expired/); await c.close();
  assert.equal(store.saved().state.sealed, true); assert.equal(store.saved().state.packets.length, 1);
  c = client(store, () => assert.fail(), { offline: true });
  await assert.rejects(c.initialize(), /sealed/); await c.close();
  c = client(store, () => assert.fail(), { offline: true, token: 'different-secret' });
  await assert.rejects(c.initialize(), /tokenHash/); await c.close();
  assert.equal(store.saved().pages.size, 1, 'refused offline open retains durable data for explicit recovery');
});

test('removed body is physically erased; unavailable delivery does not erase retained history', async () => {
  const store = memory();
  let c = client(store, body => body.after === null ? frame() : { ...frame(body.after), seq: 3,
    receipts: body.receipts.map((p: any) => ({ id: p.id, state: 'complete', seq: 3 })) });
  await c.acquire('deliveries'); await c.close();
  const changed = { ...event, id: 'f'.repeat(64), seq: 4, kind: 'changed' };
  c = client(store, body => ({ ...frame(body.after), seq: 4, rows: [{ table: 'deliveries', id: changed.id, row: changed }],
    pages: [{ after: body.after, cursor: position(changed.id, 4), next: null, exhausted: true,
      events: [{ id: changed.id, row: 'm', disposition: 'unavailable' }], receipt: receipt() }] }));
  await c.acquire('deliveries'); assert.equal(c.rows('messages')[0].body, 'body'); await c.close();
  const removed = { ...event, id: 'e'.repeat(64), seq: 5, kind: 'removed' };
  c = client(store, body => ({ ...frame(body.after), seq: 5, rows: [{ table: 'deliveries', id: removed.id, row: removed }],
    pages: [{ after: body.after, cursor: position(removed.id, 5), next: null, exhausted: true,
      events: [{ id: removed.id, row: 'm', disposition: 'removed' }], receipt: receipt() }] }));
  await c.acquire('deliveries'); assert.deepEqual(c.rows('messages'), []); await c.close();
  assert.doesNotMatch([...store.saved().pages.values()].join(''), /"body":"body"/);
});

test('same-sequence contradiction fails before changing durable rows, packet queue, or evaluator ownership', async () => {
  const store = memory();
  const state = { principal: 'u1', authEpoch: 1, generation, schemaHash: program.schemaHash, tokenHash: 'test',
    seq: 2, readTime: 0, serial: 0, sealed: false, logs: {}, packets: [] };
  const custody = new NativeCustody(program, state, store.disk); await custody.open();
  const row = wireRows.find((r: any) => r.table === 'messages');
  const prepare = (body: string) => RowImage.fromWire(program.schema, 'messages', { ...row.row, body }, (message: string) => { throw Error(message); }, program.schemaHash);
  await custody.commit({ state, rows: [{ table: 'messages', id: 'm', row: prepare('first'), seq: 2 }] });
  await assert.rejects(custody.commit({ state, rows: [{ table: 'messages', id: 'm', row: prepare('conflict'), seq: 2 }] }), /same sequence/);
  assert.equal(store.saved().writes, 1); assert.equal(RowImage.wire(custody.rows.byId('messages', 'm')).body, 'first');
});
