import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockClient } from '../dist/mock.js';
import { until } from './helpers/app-server.mjs';
const set = { kind: 'mutation', name: 'setTyping', ephemeral: true, renews: true, renewMs: 250 };
const list = { kind: 'query', name: 'typing', ephemeralReads: ['typing'] };

test('mock renews unchanged rows, expires per table, rolls back refusals, and never emits durable writes', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_700_000_000_000 });
  t.mock.method(performance, 'now', () => Date.now());
  const table = new Map(), writes = [];
  const client = createMockClient({ viewer: 'alice', tables: { typing: table, viewing: new Map() }, ephemeral: { typing: 1000, viewing: 2000 },
    ops: { mutations: {}, queries: { typing: tables => [...tables.typing.values()] }, signals: {
      setTyping(tables) { tables.typing.set('alice', { id: 'alice' }); tables.viewing.set('alice', { id: 'alice' }); return null; },
      refuse(tables) { tables.typing.set('refused', { id: 'refused' }); return { code: 'NO', family: 'rule', message: 'no' }; },
    } } });
  t.after(() => client.close()); client.onWrite(write => writes.push(write));
  const signal = await client.mutate(set, {}); assert.equal(signal.state, 'sent');
  assert.equal(await client.write(signal.id), undefined); assert.equal(table.size, 0, 'caller fixture has no lasting ephemeral rows');
  const watch = client.observe(list, {}); t.after(() => watch.close());
  assert.equal(watch.getSnapshot().data.length, 1);
  t.mock.timers.tick(650); await client.mutate(set, {});
  t.mock.timers.tick(600); assert.equal(watch.getSnapshot().data.length, 1, 'empty patch renewed');
  const refusal = await client.mutate({ ...set, name: 'refuse', renews: undefined }, {});
  assert.equal(refusal.why.code, 'NO'); assert.equal(client.tables.typing.has('refused'), false);
  t.mock.timers.tick(399);
  assert.equal(watch.getSnapshot().data.length, 1, 'renewed row survives until its own deadline');
  t.mock.timers.tick(1);
  assert.equal(watch.getSnapshot().data.length, 0);
  assert.equal(client.tables.viewing.size, 1, 'longer table life remains');
  client.setLink('offline'); assert.equal((await client.mutate(set, {})).why.code, 'E_OFFLINE');
  assert.equal((await client.query(list, {})).denied?.code, 'E_OFFLINE');
  assert.deepEqual(writes, []);
});

for (const link of ['online', 'offline']) test(`mock supplied ids execute and emit once (${link})`, async t => {
  const { mintId } = await import('../dist/client.js');
  const id = mintId(), writes = []; let executions = 0;
  const increment = () => { executions++; return []; };
  const client = createMockClient({ viewer: 'alice', link, commitDelayMs: 20, tables: {},
    ops: { queries: {}, mutations: { increment, other: increment } } });
  t.after(() => client.close()); client.onWrite(write => writes.push(write));
  const op = { kind: 'mutation', name: 'increment' }, args = { delta: 1 };
  const outcomes = await Promise.all([client.mutate(op, args, { id, waitSeconds: 0 }), client.mutate(op, args, { id, waitSeconds: 0 })]);
  assert.ok(outcomes.every(write => write.state === 'pending')); assert.equal(executions, 1);
  assert.equal((await client.mutate(op, { delta: 2 }, { id, waitSeconds: 0 })).why.code, 'E_WRITE_ID_REUSE');
  assert.equal((await client.mutate({ kind: 'mutation', name: 'other' }, args, { id })).why.code, 'E_WRITE_ID_REUSE');
  if (link === 'offline') client.setLink('online');
  await until(() => writes.length === 1);
  assert.equal(writes[0].state, 'sent');
  const replay = await client.mutate(op, args, { id, waitSeconds: 0 });
  assert.deepEqual(replay, { state: 'sent', id, seq: 1, replayed: true });
  assert.equal(executions, 1); assert.equal(writes.length, 1);
});
