// @ref LLP 3000.023#10 — public-client port of LV's 11af2c7d5 seeded schedule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const sdk = process.env.RL_ORACLE_SDK ? pathToFileURL(resolve(process.env.RL_ORACLE_SDK) + '/') : new URL('../dist/', import.meta.url);
const { createLocalClient } = await import(new URL('local.js', sdk));
const { answerObservation } = await import(new URL('read-observation.js', sdk));
import { fixture, opener, q, parked, until } from './helpers/answers-stay.mjs';
import { MixedModel, random } from './helpers/mixed-evidence-oracle.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));
for (const host of ['process', 'wasm']) test(`mixed evidence schedule ${host}: 300 independent histories`, { timeout: 240000 }, async t => {
  const f = await fixture(t), headers = { 'x-snapback-persona': 'bob' };
  const backend = await fetch(f.url + '/schema', { headers }).then(r => r.json());
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
  const results = [];
  for (let seed = 1; seed <= Number(process.env.RL_SEEDS ?? 300); seed++) {
    const model = new MixedModel(), rand = random(seed), trace = [], failures = [], pending = [];
    let head = 1, hold, remoteHold, client, watch, checking = false, sawData = false, localTime = cutoff - 1;
    const device = opener(host, join(f.dir, `device-${seed}`));
    const gated = { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const result = await core.call(request.op === 'query' && request.name === 'mixed' ? { ...request, now: localTime } : request, committed);
        if (request.op === 'query' && hold) {
          const gate = hold; hold = undefined; gate.arrived.resolve(); await gate.release.promise;
        }
        return result;
      } };
    } };
    const capture = label => {
      const read = watch.getSnapshot(); trace.push([label, model.cut, read]);
      try { model.observe(read); if (checking) model.check(read); } catch (e) { failures.push(e.message); }
      if (sawData && read.loading) failures.push('loading after data without remote evidence');
      if ('data' in read) sawData = true;
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
        const read = client.query(q('item'), {}); pending.push({ gate, read }); await gate.arrived.promise;
        checking = false;
        const early = rand(2);
        if (early) { gate.release.resolve(); await read; trace.push(['complete-before', cut]); }
        head = cut; model.head = cut; await client.sync();
        gate.release.resolve();
        const direct = await read; model.apply(cut);
        if (!early) model.check(direct);
        await until(() => !watch.getSnapshot().revalidating && (cut % 2 ? watch.getSnapshot().data?.body === model.answer() : watch.getSnapshot().data === null));
        checking = true; capture('settled');
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
      const owner = answerObservation(watch.getSnapshot());
      await owner.fetch(async () => ({ read: { loading: true }, transportOffline: true }), () => capture('offline'));
      capture('offline-finished');
    } catch (error) { failures.push(String(error)); }
    finally { for (const { gate, read } of pending) { gate.release.resolve(); await read.catch(() => {}); } watch?.close(); await client?.close(); }
    results.push({ host, seed, failures: [...new Set(failures)], ...(failures.length && seed <= 2 ? { trace } : {}) });
  }
  if (process.env.RL_ORACLE_OUT) writeFileSync(`${process.env.RL_ORACLE_OUT}-${host}.json`, JSON.stringify(results, null, 2));
  const bad = results.filter(r => r.failures.length);
  console.log(JSON.stringify({ host, seeds: results.length, failedSeeds: bad.length, failures: [...new Set(bad.flatMap(r => r.failures))] }));
  assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 1)));
});
