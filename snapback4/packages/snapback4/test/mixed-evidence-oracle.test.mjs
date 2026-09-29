// @ref LLP 3000.023#10 — public-client port of LV's 11af2c7d5 seeded schedule.
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const sdk = process.env.RL_ORACLE_SDK ? pathToFileURL(resolve(process.env.RL_ORACLE_SDK) + '/') : new URL('../dist/', import.meta.url);
const { readyRead } = await import(new URL('read-existence.js', sdk));
const { createLocalClient } = await import(new URL('local.js', sdk));
const { answerObservation } = await import(new URL('read-observation.js', sdk));
import { fixture, opener, q, parked, until, source } from './helpers/answers-stay.mjs';
import { GenerationModel, MixedModel, random } from './helpers/mixed-evidence-oracle.mjs';
import { source as ephemeralSource } from './helpers/ephemeral-server.mjs';
import { notificationSchedule } from './helpers/notification-evidence-schedule.mjs';
import { generationSchedule } from './helpers/generation-evidence-schedule.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));
const seeds = Number(process.env.RL_SEEDS ?? 300);
test('reference rejects transient empty member answers and sign-out loading', () => {
  const model = new MixedModel(), empty = readyRead({ data: null, complete: true, fresh: true, cut: null });
  assert.equal(empty.existence, 'absent');
  assert.throws(() => model.observe(empty, 1000), /empty answer/);
  assert.throws(() => model.check(empty), /empty direct answer/);
  model.apply(2, 1000); model.observe(empty, 1000);
  model.apply(3, 1000); model.observe({ ...empty, revalidating: true }, 1000);
  assert.throws(() => model.observe(empty, 1000), /empty answer/);
  model.signOut();
  assert.throws(() => model.observe({ loading: true }, 1000), /sign-out must publish/);
  model.observe({ denied: { code: 'E_AUTH' } }, 1000);
  const generation = new GenerationModel();
  generation.observe(readyRead({ data: { body: 'image-5' }, complete: true, fresh: true, cut: null })); generation.notify();
  assert.throws(() => generation.observe(readyRead({ data: { body: 'image-5' }, revalidating: true, complete: true, fresh: true, cut: null })), /retired program/);
  generation.observe({ loading: true }); generation.observe({ denied: { code: 'APP_DENIED' } });
});
// 300 histories take about 200 s on both publication hosts; budget 2 s per history (600 s), still bounding a hang.
for (const host of ['process', 'wasm']) test(`mixed evidence schedule ${host}: ${seeds} independent histories`, { timeout: Math.max(240000, seeds * 2000) }, async t => {
  const typingSource = ephemeralSource.slice(ephemeralSource.indexOf('table typing:'), ephemeralSource.indexOf('table durableTyping:'));
  const f = await fixture(t, source + typingSource, { watch: true }), headers = { 'x-snapback-persona': 'bob' };
  const backend = await fetch(f.url + '/schema', { headers }).then(r => r.json());
  await f.post('/m/setTyping', { id: 'typing', args: { room: 'room' } });
  const typing = await f.post('/q/typingIn', { args: { room: 'room' } }, 'bob');
  assert.equal(typing.data.length, 1);
  const frames = [], replies = [], mixedReplies = [], empty = [], cutoff = Date.now() + 600000;
  let from = 0;
  for (let cut = 1; cut <= 5; cut++) {
    if (cut > 1) {
      if (cut % 2) await f.post('/m/edit', { id: `edit-${cut}`, args: { body: `image-${cut}` } });
      await f.post('/m/' + (cut % 2 ? 'restore' : 'remove'), { id: `member-${cut}`, args: {} });
    }
    const page = await f.post('/sync', { generation: backend.generation, from, limit: 1000 }, 'bob');
    from = page.watermark;
    frames[cut] = page;
    empty[cut] = await f.post('/sync', { generation: backend.generation, from, limit: 1000 }, 'bob');
    replies[cut] = await f.post('/q/item', { args: {} }, 'bob');
    mixedReplies[cut] = await f.post('/q/mixed', { args: { cutoff, deny: false } }, 'bob');
  }
  // Capture real program adoption once per host, then replay its envelopes in
  // independently scheduled clients. Sequence and table contents do not change.
  const generationFrames = { before: { snapshot: await f.post('/sync', { generation: backend.generation, from: 0, limit: 1000 }, 'bob'), empty: empty[5] } };
  writeFileSync(join(f.dir, 'snapback/schema.q'), (source + typingSource).replace('query item():', 'query item():\n  require false else APP_DENIED'));
  await until(async () => (await f.post('/q/item', { args: {} }, 'bob')).denied?.code === 'APP_DENIED');
  const nextBackend = await fetch(f.url + '/schema', { headers }).then(r => r.json());
  generationFrames.notification = await fetch(`${f.url}/changes?since=${from}&wait=0`, { headers }).then(r => r.json());
  assert.equal(generationFrames.notification.seq, from); assert.deepEqual(generationFrames.notification.tables, []);
  assert.notEqual(nextBackend.generation, backend.generation);
  generationFrames.discovery = await f.post('/sync', { generation: backend.generation, from, limit: 1000 }, 'bob');
  generationFrames.after = { snapshot: await f.post('/sync', { generation: nextBackend.generation, from: 0, limit: 1000 }, 'bob'), empty: await f.post('/sync', { generation: nextBackend.generation, from, limit: 1000 }, 'bob') };
  generationFrames.denied = await f.post('/q/item', { args: {} }, 'bob');
  const results = [], closing = [], directRead = new AsyncLocalStorage();
  t.after(() => Promise.all(closing));
  let wall = Date.now(); t.mock.method(Date, 'now', () => wall);
  for (let seed = 1; seed <= seeds; seed++) {
    const model = new MixedModel(), rand = random(seed), trace = [], failures = [], pending = [];
    let head = 1, hold, remoteHold, replacement, client, watch, signoutPending = false, localTime = cutoff - 1;
    const removalMode = rand(2);
    const device = opener(host, join(f.dir, `device-${seed}`));
    const gated = { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const beganAt = model.cut;
        let committedOnce = false;
        const onCommit = result => {
          if (committedOnce) return; committedOnce = true;
          if (request.op === 'apply' && !result.denied) {
            const fixtureCut = frames.findIndex(frame => frame?.watermark === request.page.watermark);
            if (fixtureCut > 0) { model.apply(fixtureCut, wall); trace.push(['fixture-commit', fixtureCut, wall]); }
          }
          committed?.(result);
        };
        const result = await core.call(request.op === 'query' && request.name === 'mixed' ? { ...request, now: localTime } : request, onCommit);
        onCommit(result);
        if (request.op === 'query' && request.name === 'item' && !directRead.getStore() && replacement && beganAt === replacement.cut) {
          const scheduled = replacement;
          scheduled.arrived.done = true; scheduled.arrived.resolve();
          if (scheduled.failure) { model.failed(); throw Error('injected replacement failure'); }
          await scheduled.release.promise;
        }
        if (request.op === 'query' && hold) {
          const gate = hold; hold = undefined; gate.arrived.resolve(); await gate.release.promise;
          if (gate.failure) throw Error('late replica failure');
        }
        return result;
      } };
    } };
    const capture = label => {
      const read = watch.getSnapshot(); trace.push([label, model.cut, read]);
      try { model.observe(read, wall); } catch (e) { failures.push(e.message); }
    };
    try {
      client = await createLocalClient({ url: f.url, persona: 'bob', device: gated, fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (path === '/schema') return Response.json(backend);
        if (path === '/changes') return parked(init.signal);
        if (path === '/q/item') return Response.json(replies[head]);
        if (path === '/q/mixed') {
          const response = structuredClone(mixedReplies[head]);
          if (remoteHold) { const gate = remoteHold; remoteHold = undefined; gate.arrived.resolve(); await gate.release.promise; }
          return Response.json(response);
        }
        if (path === '/probe') return Response.json({ ok: true, principal: 'dev:bob', store_id: backend.store_id, seq: frames[head].watermark });
        if (path === '/sync') {
          const { from } = JSON.parse(init.body);
          const next = frames.slice(1, head + 1).find(p => p.watermark > from);
          return Response.json(next ?? empty[head]);
        }
        return fetch(input, init);
      } });
      await client.sync();
      watch = client.observe(q('item'), {}); watch.subscribe(() => capture('notification'));
      await until(() => watch.getSnapshot().data?.body === 'image-1');
      for (let cut = 2; cut <= 5; cut++) {
        // Evaluate against the old replica, then independently release the reply
        // before or after a membership commit. The public SDK owns all fences.
        const gate = { arrived: Promise.withResolvers(), release: Promise.withResolvers() }; hold = gate;
        const read = directRead.run(true, () => client.query(q('item'), {}));
        void read.catch(() => {}); // Awaited below; direct retries are not the observation fault.
        pending.push({ gate, read }); await gate.arrived.promise;
        if (cut % 2 === 0) replacement = { cut, failure: (cut === 2 ? removalMode : 1 - removalMode) === 1, arrived: Promise.withResolvers(), release: Promise.withResolvers() };
        const early = rand(2);
        if (early) { gate.release.resolve(); await read; trace.push(['complete-before', cut]); }
        head = cut; await client.sync();
        gate.release.resolve();
        if (replacement) {
          await until(() => replacement.arrived.done, 'replacement entered');
          if (replacement.failure) await until(() => watch.getSnapshot().loading, 'failed removal replacement');
          else {
            wall = model.deadline - 1; capture('held-before-bound');
            wall++; capture('held-at-bound');
            assert.equal(watch.getSnapshot().loading, true, 'held removal replacement withdraws at fixture deadline');
          }
          capture('removal-withdrawn');
          const scheduled = replacement; replacement = undefined; scheduled.release.resolve();
          // Queue coalescing need not leave a redundant attempt after failure.
          // Recovery is an explicit public input after the injected fault ends.
          if (scheduled.failure) { watch.close(); watch.subscribe(() => capture('recovery-refetch')); }
        }
        const direct = await read;
        if (!early) model.check(direct);
        await until(() => !watch.getSnapshot().revalidating && (cut % 2 ? watch.getSnapshot().data?.body === model.answer() : watch.getSnapshot().data === null));
        capture('settled');
        for (let n = rand(5); n >= 0; n--) { await turn(); capture('later'); }
      }
      // Mixed remote/local branch: capture a real server image, then evaluate
      // the same operation on the replica with its clock on the later branch.
      // Random completion order is independent of the image/reference model.
      for (let step = 0; step < 12; step++) {
        localTime = cutoff - 1;
        const gate = { arrived: Promise.withResolvers(), release: Promise.withResolvers() };
        remoteHold = gate;
        const remote = client.query(q('mixed'), { cutoff, deny: false });
        pending.push({ gate, read: remote }); await gate.arrived.promise;
        localTime = cutoff;
        const local = client.query(q('mixed'), { cutoff, deny: false });
        if (rand(2)) { gate.release.resolve(); model.check(await remote); model.check(await local); }
        else { model.check(await local); gate.release.resolve(); model.check(await remote); }
        const denial = await client.query(q('mixed'), { cutoff, deny: true });
        assert.equal(denial.denied?.code, 'APP_DENIED');
        trace.push(['mixed', step, 'local-clock-denial']); capture('mixed-settled');
      }
      // LV's no-local-loading invariant also covers failed plain refetches.
      model.plain();
      const owner = answerObservation(watch.getSnapshot());
      // The clock was fixed while the fixture's final answer completed, so its
      // confirmation time is independently known, without reading owner.since.
      const confirmedAt = wall; wall += 50 + rand(500);
      await owner.fetch(async () => {
        model.offline(confirmedAt);
        return { read: { loading: true }, transportOffline: true };
      }, () => capture('offline'));
      capture('offline-finished');
      assert.equal(watch.getSnapshot().fresh, false);
      assert.equal(watch.getSnapshot().since, confirmedAt);
      // Start a real SDK replica re-read on the same local handle and hold its
      // completion across the public sign-out boundary, with randomized failure.
      const signoutGate = { arrived: Promise.withResolvers(), release: Promise.withResolvers(), failure: !!rand(2) };
      hold = signoutGate;
      watch.close(); watch.subscribe(() => capture('signout-read'));
      await signoutGate.arrived.promise;
      model.signOut(); const ending = client.signOut(); capture('signout-immediate');
      signoutGate.release.resolve();
      signoutPending = true; closing.push(ending.then(() => capture('signout-settled')));
    } catch (error) { failures.push(String(error)); }
    finally { replacement?.release.resolve(); replacement = undefined; for (const { gate, read } of pending) { gate.release.resolve(); await read.catch(() => {}); } watch?.close(); if (client && !signoutPending) closing.push(client.close()); }
    try {
      await generationSchedule({ createLocalClient, host, seed, f, oldBackend: backend, nextBackend, generationFrames, rand,
        clock: { get: () => wall, set: value => { wall = value; } }, trace, closing });
    } catch (error) { failures.push(String(error)); }
    try {
      await notificationSchedule({ createLocalClient, answerObservation, host, seed, f, backend, frames, empty, typing, rand,
        clock: { get: () => wall, set: value => { wall = value; } }, trace, closing });
    } catch (error) { failures.push(String(error)); }
    if (closing.length >= 8) await Promise.all(closing.splice(0));
    results.push({ host, seed, failures, ...(seed <= 2 ? { trace } : {}) });
  }
  await Promise.all(closing.splice(0));
  // Delayed sign-out notifications remain part of their seed until cleanup ends.
  for (const result of results) { result.failures = [...new Set(result.failures)]; if (!result.failures.length) delete result.trace; }
  if (process.env.RL_ORACLE_OUT) writeFileSync(`${process.env.RL_ORACLE_OUT}-${host}.json`, JSON.stringify(results, null, 2));
  const bad = results.filter(r => r.failures.length);
  console.log(JSON.stringify({ host, seeds: results.length, failedSeeds: bad.length, failures: [...new Set(bad.flatMap(r => r.failures))] }));
  assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 1)));
});
