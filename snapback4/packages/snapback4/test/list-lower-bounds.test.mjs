import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { server, root } from './helpers/read-through-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
const source = readFileSync(join(root, 'crates/snapback4-lang/tests/fixtures/list-lower-bounds/schema.q'), 'utf8');
const mutation = name => ({ name, kind: 'mutation', predicts: 'eligible' });

for (const tier of ['process', 'wasm']) test(`${tier}: createGroup list minimum reaches the client and predicts identically`, { timeout: hangBudget(8) }, async t => {
  const host = await server(t, tier, source);
  const client = await host.open();
  const empty = await client.mutate(mutation('createGroup'), { peers: [] });
  assert.equal(empty.state, 'failed', JSON.stringify(empty));
  assert.equal(empty.why.code, 'E_INPUT');
  assert.equal(empty.why.message, 'E_INPUT: peers needs at least 1 item; got 0');
  for (const n of [1, 49, 50]) {
    const reply = await client.mutate(mutation('createGroup'), { peers: Array(n).fill('dev:alice') });
    assert.equal(reply.state, n <= 49 ? 'sent' : 'failed', JSON.stringify(reply));
    if (n === 50) assert.equal(reply.why.message, 'E_INPUT: peers has more than 49 items');
  }
  await client.sync(); host.pauseSync();
  for (const [op, args, message] of [
    ['createGroup', { peers: [] }, 'E_INPUT: peers needs at least 1 item; got 0'],
    ['createGroup', { peers: Array(50).fill('dev:alice') }, 'E_INPUT: peers has more than 49 items'],
    ['built', { n: 0 }, 'E_INPUT: groups.peers needs at least 1 item; got 0'],
  ]) {
    const reply = await host.core.call({ op: 'predict', name: op, viewer: 'dev:bob', args, now: 100, newIds: ['prediction'] });
    const denial = reply.denied ?? reply.ok?.denied;
    assert.equal(denial?.code, 'E_INPUT', JSON.stringify(reply));
    assert.equal(denial.message, message);
  }
  const predicted = await host.core.call({ op: 'predict', name: 'createGroup', viewer: 'dev:bob', args: { peers: ['dev:alice'] }, now: 100, newIds: ['prediction'] });
  assert.deepEqual(predicted.ok?.result?.peers, ['dev:alice'], JSON.stringify(predicted));
  const guarded = await host.post('/m/guarded', { id: 'guarded', args: { peers: [] } });
  assert.equal(guarded.why.code, 'MEMBERS_REQUIRED');
});
