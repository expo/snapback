import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, latch, honest, answer, complete, causal } from './helpers.mjs';

test('wasm: a recovered edge refusal retires Updating without a sync publication', { timeout: 30000 }, async t => {
  const { bob, wire, watch, cores } = await setup(t, 'wasm');
  const core = cores.get('bob'), gates = wire.hold(), terminal = latch();
  const stop = bob.onWrite(write => { if (write.id === 'recovered-refusal') terminal.resolve(write); }); t.after(stop);
  const seq = (await core.call({ op: 'next_submission' })).ok;
  const admitted = await core.call({ op: 'admit', entry: { id: 'recovered-refusal', seq, op: 'follow', args: { actor: 'dev:bob' }, viewer: 'dev:bob', now: bob.now(), new_ids: [], predicted: [], predictable: false } });
  assert.equal(admitted.denied, undefined);
  await causal(t, async () => {
    await gates.request.promise; assert.ok(honest(watch.getSnapshot()));
    await answer(watch, r => 'data' in r && !r.complete && !r.revalidating);
    gates.send.resolve();
    const write = await terminal.promise;
    assert.equal(write.state, 'failed'); assert.equal(write.why.code, 'FEED_CANNOT_FOLLOW_SELF');
    assert.equal((await bob.pendingWrites()).length, 0);
    // No application query, sync or timer is used to discharge the observation.
    await answer(watch, r => complete(r, 0));
  });
});
