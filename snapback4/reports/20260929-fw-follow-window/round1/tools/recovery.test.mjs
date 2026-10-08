import test from 'node:test';
import assert from 'node:assert/strict';
import { FollowingIntents } from '../../../../packages/snapback4/dist/local-following.js';
import { createLocalClient, q, honest, complete, answer, setup, causal } from './helpers.mjs';

for (const tier of ['wasm', 'process']) {
  test(`${tier}: post, like and remove do not gate mounted Following`, { timeout: 30000 }, async t => {
    const { bob, wire, watch } = await setup(t, tier);
    await causal(t, async () => {
      for (const [name, args, count] of [['post', { postId: 'own', parentId: null }, 1], ['like', { postId: 'first' }, 1], ['remove', { postId: 'own' }, 0]]) {
        if (process.env.FW_TRACE) console.error('non-edge', tier, name);
        const gates = wire.hold();
        const write = bob.mutate({ kind: 'mutation', name }, args);
        if (process.env.FW_TRACE) void write.then(r => console.error('write', r));
        // Ordinary prediction/apply invalidation may revalidate a shaped feed.
        // The edge-intent gate must add no call-turn mark and no incompleteness.
        assert.equal(watch.getSnapshot().revalidating, undefined, `${name}: no edge call-turn mark`);
        await gates.request.promise;
        if (process.env.FW_TRACE) console.error('requested', watch.getSnapshot());
        const direct = await bob.query(q, { c: null });
        if (process.env.FW_TRACE) console.error('direct', direct);
        assert.equal(direct.complete, true, `${name}: the complete prediction or like-disjoint answer settles`);
        assert.equal(direct.data.length, count);
        await answer(watch, r => complete(r, count));
        assert.equal(watch.getSnapshot().revalidating, undefined, `${name}: settled local read is unmarked while transport is held`);
        let state;
        const stateRead = bob.query({ kind: 'query', name: 'postState' }, { postId: 'first' }).then(read => { state = read; return read; });
        if (name !== 'like') assert.equal((await stateRead).complete, true);
        else {
          await bob.pendingWrites();
          assert.equal(state, undefined, 'the like-dependent read waits for observation');
        }
        wire.release(); assert.equal((await write).state, 'sent'); await bob.sync();
        assert.equal((await stateRead).data.liked, name !== 'post');
        await answer(watch, r => complete(r, count));
      }
    });
  });

  test(`${tier}: an empty author's follow ends complete, fresh and empty`, { timeout: 30000 }, async t => {
    const { bob, wire, watch } = await setup(t, tier, false);
    await causal(t, async () => {
      const gates = wire.hold();
      const write = bob.mutate({ kind: 'mutation', name: 'follow' }, { actor: 'dev:alice' });
      await gates.request.promise;
      assert.ok(honest(watch.getSnapshot()));
      let direct;
      const reading = bob.query(q, { c: null }).then(read => { direct = read; return read; });
      gates.send.resolve(); await gates.sync.promise;
      assert.equal(direct, undefined, 'even an empty answer waits for dependent custody');
      assert.ok(honest(watch.getSnapshot())); gates.apply.resolve();
      assert.equal((await write).state, 'sent');
      assert.deepEqual((await reading).data, []); assert.equal(direct.complete, true);
      await answer(watch, r => complete(r, 0));
    });
  });

  test(`${tier}: overlapping follow then unfollow before apply ends empty`, { timeout: 30000 }, async t => {
    const { bob, wire, watch, publications } = await setup(t, tier);
    await causal(t, async () => {
      const gates = wire.hold(); publications.length = 0;
      const follow = bob.mutate({ kind: 'mutation', name: 'follow' }, { actor: 'dev:alice' }, { waitSeconds: 0 });
      await gates.request.promise;
      const unfollow = await bob.mutate({ kind: 'mutation', name: 'unfollow' }, { actor: 'dev:alice' }, { waitSeconds: 0 });
      assert.equal(unfollow.state, 'pending'); assert.equal((await follow).state, 'pending');
      assert.equal((await bob.pendingWrites()).length, 2);
      assert.ok(honest(watch.getSnapshot()));
      gates.send.resolve(); await gates.sync.promise;
      assert.ok(honest(watch.getSnapshot()));
      const reading = bob.query(q, { c: null });
      gates.apply.resolve();
      assert.deepEqual((await reading).data, []);
      await answer(watch, r => complete(r, 0));
      assert.equal((await bob.write(unfollow.id)).state, 'sent');
      for (const r of publications) assert.ok(honest(r) || r.data?.length === 0, JSON.stringify(r));
    });
  });

  test(`${tier}: an offline follow survives reconnect and publishes Alice`, { timeout: 30000 }, async t => {
    const { bob, wire, watch } = await setup(t, tier);
    wire.offline = true; await bob.sync();
    const write = await bob.mutate({ kind: 'mutation', name: 'follow' }, { actor: 'dev:alice' }, { waitSeconds: 0 });
    assert.equal(write.state, 'pending'); assert.ok(honest(await bob.query(q, { c: null })));
    await causal(t, async () => {
      const gates = wire.hold(); wire.offline = false;
      const sync = bob.sync(); gates.apply.resolve();
      await gates.request.promise; assert.ok(honest(watch.getSnapshot()));
      gates.send.resolve(); await sync;
      await answer(watch, r => complete(r, 1));
      assert.equal((await bob.write(write.id)).state, 'sent');
    });
  });

  test(`${tier}: sign-out store reuse does not gate another viewer`, { timeout: 30000 }, async t => {
    const { url, bob, wire, device, cores } = await setup(t, tier);
    wire.offline = true; await bob.sync();
    const write = await bob.mutate({ kind: 'mutation', name: 'follow' }, { actor: 'dev:alice' }, { waitSeconds: 0 });
    assert.equal(write.state, 'pending'); await bob.signOut();
    const carol = await createLocalClient({ url, persona: 'carol', device: device('bob'), fetch: wire.fetch });
    t.after(() => carol.close());
    const entries = (await cores.get('bob').call({ op: 'queued' })).ok;
    const backend = (await cores.get('bob').call({ op: 'backend' })).ok;
    assert.ok(entries.some(entry => entry.id === write.id && entry.viewer === 'dev:bob' && entry.observed_seq == null));
    const changed = [];
    const gate = new FollowingIntents(() => backend, async () => entries, tables => changed.push(tables), 'dev:carol');
    assert.equal(await gate.pending(new Set(['followingFeed'])), false, 'the retained Bob entry cannot make Carol incomplete');
    gate.recovered(entries); assert.deepEqual(changed, [], 'another viewer must not invalidate mounted Following');
    const own = new FollowingIntents(() => backend, async () => entries, () => {}, 'dev:bob');
    assert.equal(await own.pending(new Set(['followingFeed'])), true, 'the same durable entry still gates its own viewer');
    // The replica itself also fences a mismatched principal's held partition.
    const read = await carol.query(q, { c: null });
    assert.ok(read.loading || read.denied || read.complete, JSON.stringify(read));
  });
}

test('process: a queued follow survives closing and restarting the device process', { timeout: 30000 }, async t => {
  const { url, bob, wire, device } = await setup(t, 'process');
  wire.offline = true; await bob.sync();
  const write = await bob.mutate({ kind: 'mutation', name: 'follow' }, { actor: 'dev:alice' }, { waitSeconds: 0 });
  assert.equal(write.state, 'pending'); await bob.close();
  const restarted = await createLocalClient({ url, persona: 'bob', device: device('bob'), fetch: wire.fetch });
  t.after(() => { wire.release(); return restarted.close(); });
  const watch = restarted.observe(q, { c: null }); t.after(() => watch.close());
  assert.ok(honest(await restarted.query(q, { c: null })));
  assert.equal((await restarted.pendingWrites())[0].id, write.id);
  await causal(t, async () => {
    const gates = wire.hold(); wire.offline = false;
    const sync = restarted.sync(); gates.apply.resolve();
    await gates.request.promise; assert.ok(honest(watch.getSnapshot()));
    gates.send.resolve(); await sync;
    await answer(watch, r => complete(r, 1));
    assert.equal((await restarted.write(write.id)).state, 'sent');
  });
});

// A committed host image can outlive a lost save reply. No public mutate call
// owns this injected recovery, so only restored custody can wake the watch.
test('wasm: restoring a committed edge after a lost save reply invalidates Following', { timeout: 30000 }, async t => {
  const { bob, wire, watch, cores, loseOutboxReply } = await setup(t, 'wasm');
  const core = cores.get('bob'), gates = wire.hold();
  const seq = (await core.call({ op: 'next_submission' })).ok;
  loseOutboxReply();
  await assert.rejects(core.call({ op: 'admit', entry: { id: 'restored-edge', seq, op: 'follow', args: { actor: 'dev:alice' }, viewer: 'dev:bob', now: bob.now(), new_ids: [], predicted: [], predictable: false } }), /lost outbox commit reply/);
  await core.call({ op: 'state' }); // Reload the durable image; no new outbox write is needed.
  assert.ok(honest(watch.getSnapshot()), 'restored custody invalidates the mounted answer');
  await causal(t, async () => {
    const sync = bob.sync(); gates.apply.resolve();
    await gates.request.promise;
    const reading = bob.query(q, { c: null });
    gates.send.resolve(); await sync;
    const read = await reading;
    assert.equal(read.data?.length, 1); assert.equal(read.complete, true);
    await answer(watch, r => complete(r, 1));
    assert.equal((await bob.write('restored-edge')).state, 'sent');
  });
});
