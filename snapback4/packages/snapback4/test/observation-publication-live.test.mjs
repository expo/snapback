// @ref LLP 3000.023#10 — continuous same-cut sync cannot starve a whole server answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sdk, fixture, opener, source, q, parked, until } from './helpers/answers-stay.mjs';
import { hangBudget } from './helpers/wait.mjs';
const { createLocalClient } = await import(new URL('local.js', sdk));
const { evaluateLocal } = await import(new URL('local-query.js', sdk));
const { LocalReads, localWatch } = await import(new URL('local-reads.js', sdk));

for (const host of ['process', 'wasm']) test(`${host}: publish a matching reply despite sync before every response`, { timeout: hangBudget(12) }, async t => {
  const f = await fixture(t, source.replace('table profiles:\n', 'table profiles:\n  update <- allow\n') + `
mutation rename(name: text):
  update profiles['bob'] { name }
`);
  let active = false, responses = 0, client;
  const exhausted = Promise.withResolvers(), published = Promise.withResolvers();
  client = await createLocalClient({ url: f.url, persona: 'bob', device: opener(host, join(f.dir, host)),
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return parked(init.signal);
      const response = await fetch(input, init);
      if (path === '/q/profile' && active) {
        // The body is already authoritative. Every attempt now crosses an
        // actual published apply at that same cut before receiving the body.
        const json = await response.json();
        assert.equal(json.data.name, 'new');
        await client.sync();
        responses++;
        if (responses === 6) { active = false; exhausted.resolve(); }
        return Response.json(json);
      }
      return response;
    } });
  t.after(() => client.close()); await client.sync();
  const watch = client.observe(q('profile'), {});
  t.after(() => watch.close());
  watch.subscribe(() => { if (watch.getSnapshot().data?.name === 'new') { active = false; published.resolve(); } });
  await until(() => watch.getSnapshot().data?.name === 'Bob', 'initial server answer');
  assert.equal((await f.post('/m/rename', { id: 'rename', args: { name: 'new' } })).state, 'sent');
  active = true;
  await client.sync();
  await Promise.race([published.promise, exhausted.promise]);
  assert.equal(watch.getSnapshot().data?.name, 'new', 'same-cut evidence must not discard every matching reply');
  assert.equal(responses, 1, 'the first matching response covers its intervening sync');
});

// Astra's six overtaken-queue counterexamples, using each device's real local
// query and outbox. Opaque mode models a queue reply without footprint metadata.
for (const host of ['process', 'wasm']) for (const boundary of ['notification', 'commit', 'applied']) for (const opaque of [false, true]) {
  test(`${host}: ${opaque ? 'opaque' : 'known'} prediction discovered after disjoint ${boundary} fences local publication`, { timeout: hangBudget(4) }, async t => {
    const f = await fixture(t), inner = opener(host, join(f.dir, 'queue'));
    let core, backend;
    const owner = await createLocalClient({ url: f.url, persona: 'bob',
      fetch: (url, init) => new URL(url).pathname === '/changes' ? parked(init.signal) : fetch(url, init),
      device: { open: async (name, definition) => { backend = definition?.initial_backend ?? definition; return core = await inner.open(name, definition); } },
    });
    t.after(() => owner.close()); await owner.sync();
    const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
    const reads = new LocalReads(), op = q('history'), args = { c: null };
    const watch = localWatch(undefined, op, args, 'history', 0, () => false);
    watch.tables = new Set(['messages', 'members']); reads.queued([]);
    const queue = async () => ok(await core.call({ op: 'queued' })).map(entry => opaque ? { ...entry, predicted: undefined } : entry);
    let discover = true, original;
    const run = () => {
      const authority = reads.revision, version = watch.changeVersion;
      return evaluateLocal({
        backend, incarnation: 0, get authority() { return reads.revision; },
        current: () => watch.changeVersion === version, inputsCurrent: reads.inputsCurrent(watch),
        serverCurrent: reads.serverCurrent(watch), retainedCurrent: reads.retainedCurrent(),
        credentialRevision: 0, partitionCurrent: true, nativeReady: true,
        principal: 'dev:bob', link: 'online', caughtUp: true, identityChecked: true,
        signal: new AbortController().signal, unavailable: () => null,
        deviceNow: () => 10, serverNow: () => 10,
        queued: () => reads.readQueued(queue, [watch]), pending: (tables, entries) => reads.pending(tables, entries),
        call: async request => { const reply = await core.call(request); if (discover && request.op === 'query') original = ok(reply); return reply; },
        post: () => assert.fail('complete local data needs no server fallback'),
        serverAnswers: reads.serverAnswers.view(),
        followingPending: async () => {
          if (!discover) return false;
          discover = false;
          assert.deepEqual(original.data.map(row => row.id), ['item']);
          // Another store caller admits after evaluation, before this owner
          // learns of it; do not inject this owner's synchronous admission fence.
          ok(await core.call({ op: 'admit', entry: { id: 'pending', seq: 1, op: 'send',
            args: { body: 'prediction' }, viewer: 'dev:bob', now: 2, new_ids: ['predicted'], predictable: true } }));
          const entered = Promise.withResolvers(), release = Promise.withResolvers();
          const pending = reads.readQueued(async () => { const entries = await queue(); entered.resolve(); await release.promise; return entries; }, [watch]);
          await entered.promise;
          if (boundary === 'notification') reads.notified(['other'], 40);
          if (boundary === 'commit') reads.committed([], 'apply', [], [], 40);
          if (boundary === 'applied') reads.applied([], 40);
          release.resolve();
          const entries = await pending;
          assert.equal(entries.length, 1); assert.equal(entries[0].predictable, true);
          assert.equal(entries[0].observed_seq == null, true);
          if (!opaque) assert.ok(entries[0].predicted.includes('messages/predicted'));
          return false;
        },
      }, op, args, 0, authority);
    };
    const stale = await run();
    assert.ok(!('data' in stale.read), 'new queue evidence must retire the earlier non-empty local answer');
    const current = await run();
    assert.deepEqual(current.read.data.map(row => row.id), ['item', 'predicted'], 'reevaluation may publish the prediction');
    assert.equal(current.publicationCurrent(), true);
  });
}
