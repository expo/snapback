import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createMockClient } from '../dist/mock.js';
import { until } from './helpers/app-server.mjs';
const set = { kind: 'mutation', name: 'setTyping', ephemeral: true, renews: true, renewMs: 250 };
const list = { kind: 'query', name: 'typing', ephemeralReads: ['typing'] };

test('mock renews unchanged rows, expires per table, rolls back refusals, and never emits durable writes', async t => {
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
  await delay(650); await client.mutate(set, {});
  await delay(600); assert.equal(watch.getSnapshot().data.length, 1, 'empty patch renewed');
  const refusal = await client.mutate({ ...set, name: 'refuse', renews: undefined }, {});
  assert.equal(refusal.why.code, 'NO'); assert.equal(client.tables.typing.has('refused'), false);
  await until(() => watch.getSnapshot().data.length === 0);
  assert.equal(client.tables.viewing.size, 1, 'longer table life remains');
  client.setLink('offline'); assert.equal((await client.mutate(set, {})).why.code, 'E_OFFLINE');
  assert.deepEqual(await client.query(list, {}), { loading: true });
  assert.deepEqual(writes, []);
});
