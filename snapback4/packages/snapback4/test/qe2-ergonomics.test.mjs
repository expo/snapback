import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { server, root } from './helpers/read-through-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
const source = readFileSync(join(root, 'crates/snapback4-lang/tests/fixtures/qe2/rows.q'), 'utf8');
for (const tier of ['wasm', 'process']) test(`${tier}: total write images, point guards and authorized rule hops`, {timeout: hangBudget(15)}, async t => {
  const host = await server(t, tier, source);
  assert.equal((await host.post('/m/room', {id: 'room', args: {id: 'c'}})).state, 'sent');
  await host.open(); host.pauseSync();
  const call = async request => {
    const reply = await host.core.call(request);
    assert.equal(reply.denied, undefined, JSON.stringify(reply));
    assert.equal(reply.ok?.denied, undefined, JSON.stringify(reply));
    return reply.ok;
  };
  const predict = (name, args) => call({op: 'predict', name, viewer: 'dev:bob', args, now: 100, newIds: []});
  const sent = await predict('send', {id: 'm', conversation: 'c'});
  // The acquired server clock is a floor for the supplied prediction clock.
  assert.ok(sent.result.at >= 100);
  assert.deepEqual(sent.result, {id: 'm', photo: null, edited: false, at: sent.result.at, setting: 'off'});
  const patched = await predict('patch', {message: 'm'});
  assert.deepEqual(patched.result, {photo: null, edited: true, at: sent.result.at});
  assert.equal((await predict('react', {id: 'r', message: 'm'})).result.emoji, 'like');
  assert.equal((await predict('editReaction', {id: 'r'})).result.emoji, 'new');
  await predict('dropReaction', {id: 'r'});
  const absent = await host.core.call({op: 'predict', name: 'react', viewer: 'dev:bob', args: {id: 'no', message: 'absent'}, now: 100, newIds: []});
  assert.equal(absent.ok.denied.code, "E_PREDICT", JSON.stringify(absent));
});
