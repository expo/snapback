// @ref LLP 3000.023#10 — generation discovery retires answers before adoption;
// quiet presence cannot settle a pending durable cut with an older answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sdk, fixture, source, opener, q, parked, until } from './helpers/answers-stay.mjs';
const { createLocalClient } = await import(new URL('local.js', sdk));
const { createClient } = await import(new URL('client.js', sdk));
const { answerObservation } = await import(new URL('read-observation.js', sdk));
const { episodeDeadline } = await import(new URL('read-episode.js', sdk));
const gate = () => ({ arrived: Promise.withResolvers(), release: Promise.withResolvers() });

for (const host of ['process', 'wasm']) for (const replica of ['readable', 'throw', 'held']) for (const keep of [undefined, true, false]) {
  test(`${host}: real generation-only adoption retires ${replica} replica answers, keep=${keep}`, async t => {
    const f = await fixture(t, source, { watch: true });
    const change = gate(), sync = gate(), old = gate(), device = opener(host, join(f.dir, host));
    let phase = 'ready', delivered = false, evidence, hold = false, blockedReads = 0;
    const client = await createLocalClient({ url: f.url, persona: 'bob', device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const result = await core.call(request, committed);
        if (request.op === 'query' && request.name === 'item') {
          if (hold) { hold = false; old.arrived.resolve(); await old.release.promise; }
          else if (phase === 'notified') {
            blockedReads++;
            assert.equal(result.ok.data.body, 'image-1', 'old replica still has the old program');
            if (replica === 'throw') throw Error('replica read failed after adoption');
          }
        }
        return result;
      } };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') {
        await Promise.race([change.release.promise, parked(init.signal)]);
        if (delivered) return parked(init.signal);
        delivered = true; return Response.json(evidence);
      }
      if (phase === 'notified' && path === '/sync') {
        sync.arrived.resolve(); await Promise.race([sync.release.promise, parked(init.signal)]);
        throw Error('sync failed after generation notification');
      }
      if (phase === 'notified' && path === '/probe') return parked(init.signal);
      if (phase === 'notified' && path.startsWith('/q/')) throw Error('query transport failed after notification');
      return fetch(input, init);
    } });
    t.after(async () => { change.release.resolve(); sync.release.resolve(); old.release.resolve(); await client.close(); });
    await client.sync();
    const watch = client.observe(q('item'), {}, { keep });
    await until(() => watch.getSnapshot().data?.body === 'image-1');
    const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot()));
    let pending;
    if (replica === 'held') {
      hold = true; pending = client.query(q('item'), {});
      await old.arrived.promise;
    }
    const before = await f.post('/q/item', { args: {} }, 'bob');
    writeFileSync(join(f.dir, 'snapback/schema.q'), source.replace('query item():', 'query item():\n  require false else APP_DENIED'));
    await until(async () => (await f.post('/q/item', { args: {} }, 'bob')).denied?.code === 'APP_DENIED', 'real dev adoption');
    evidence = await fetch(`${f.url}/changes?since=${before.seq}&wait=0`, { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
    assert.equal(evidence.generation, 2); assert.equal(evidence.seq, before.seq); assert.deepEqual(evidence.tables, []);
    seen.length = 0; phase = 'notified'; change.release.resolve(); await sync.arrived.promise;
    // Hard boundary is immediate, not the one-second change episode.
    assert.equal(watch.getSnapshot().loading, true, 'generation notification must retire the displayed answer immediately');
    old.release.resolve(); sync.release.resolve(); await until(() => client.link() === 'offline');
    if (pending) assert.ok(!('data' in await pending), 'pending replica completion was retired');
    await delay(1250);
    assert.ok(seen.every(read => !('data' in read)), 'no pre-adoption completion may restore data');
    assert.equal(watch.getSnapshot().loading, true);
    assert.equal(blockedReads, 0, 'the old replica must not answer before adoption');
    phase = 'recover'; await client.sync();
    await until(() => watch.getSnapshot().denied?.code === 'APP_DENIED', 'new program replaces loading after adoption');
  });
}

for (const host of ['process', 'wasm']) test(`${host}: generation boundary clears remembered answers and a held server completion`, async t => {
  const f = await fixture(t, source, { watch: true }), change = gate(), old = gate(), sync = gate();
  let phase = 'ready', evidence, delivered = false, hold = false;
  const client = await createLocalClient({ url: f.url, persona: 'bob', device: opener(host, join(f.dir, host)), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') {
      await Promise.race([change.release.promise, parked(init.signal)]);
      if (delivered) return parked(init.signal);
      delivered = true; return Response.json(evidence);
    }
    if (phase === 'notified' && path === '/sync') { sync.arrived.resolve(); throw Error('sync unavailable'); }
    if (phase === 'notified' && path === '/probe') return parked(init.signal);
    if (phase === 'notified' && path.startsWith('/q/')) throw Error('query unavailable');
    const response = await fetch(input, init);
    if (hold && path === '/q/mixed') { hold = false; const json = await response.json(); old.arrived.resolve(); await old.release.promise; return Response.json(json); }
    return response;
  } });
  t.after(async () => { old.release.resolve(); change.release.resolve(); await client.close(); });
  await client.sync();
  const args = { cutoff: Date.now() + 600000, deny: false }, watch = client.observe(q('mixed'), args);
  await until(() => watch.getSnapshot().data?.body === 'image-1');
  hold = true; const pending = client.query(q('mixed'), args); await old.arrived.promise;
  const before = await f.post('/q/item', { args: {} }, 'bob');
  writeFileSync(join(f.dir, 'snapback/schema.q'), source.replace('query mixed(cutoff: time, deny: bool):', 'query mixed(cutoff: time, deny: bool):\n  require false else APP_DENIED'));
  await until(async () => (await f.post('/q/mixed', { args }, 'bob')).denied?.code === 'APP_DENIED');
  evidence = await fetch(`${f.url}/changes?since=${before.seq}&wait=0`, { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
  assert.deepEqual(evidence.tables, []); assert.equal(evidence.seq, before.seq); assert.equal(evidence.generation, 2);
  const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot()));
  phase = 'notified'; change.release.resolve(); await sync.arrived.promise;
  old.release.resolve();
  assert.ok(!('data' in await pending), 'old server completion is retired');
  await until(() => client.link() === 'offline');
  assert.ok(!('data' in await client.query(q('mixed'), args)), 'offline recovery cannot restore remembered data');
  assert.ok(seen.every(read => !('data' in read)), 'displayed memory was reset before callbacks');
  phase = 'recover'; await client.sync();
  await until(() => watch.getSnapshot().denied?.code === 'APP_DENIED');
});

for (const host of ['process', 'wasm']) test(`${host}: quiet presence cannot publish below a pending durable cut`, async t => {
  const program = source + `query presenceItem():\n  return { item: messages['item'], online: exists connected['dev:alice'] }\n`;
  const f = await fixture(t, program), change = gate(), sync = gate();
  let sample = gate();
  let phase = 'ready', evidence, delivered = false, oldAnswer, replies = 0;
  const client = await createLocalClient({ url: f.url, persona: 'bob', device: opener(host, join(f.dir, host)), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') {
      await Promise.race([change.release.promise, parked(init.signal)]);
      if (delivered) return parked(init.signal);
      delivered = true; return Response.json(evidence);
    }
    if (phase !== 'ready' && path === '/sync') { sync.arrived.resolve(); return parked(init.signal); }
    if (path === '/q/presenceItem') {
      replies++;
      if (phase === 'sample') {
        const current = sample; current.arrived.done = true;
        await Promise.race([current.release.promise, parked(init.signal)]);
        return Response.json({ ...oldAnswer, refresh: 250 });
      }
      if (phase === 'notified') return Response.json({ ...oldAnswer, refresh: 250 });
      const response = await fetch(input, init); oldAnswer = await response.json();
      return Response.json({ ...oldAnswer, refresh: 250 });
    }
    return fetch(input, init);
  } });
  t.after(async () => { change.release.resolve(); sample.release.resolve(); await client.close(); });
  await client.sync(); const watch = client.observe(q('presenceItem'), {});
  await until(() => watch.getSnapshot().data?.item?.body === 'image-1');
  const owner = answerObservation(watch.getSnapshot());
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const receipt = await f.post('/m/remove', { id: 'remove', args: {} });
  evidence = { seq: receipt.seq, tables: ['members'] };
  const before = replies; phase = 'notified'; change.release.resolve(); await sync.arrived.promise;
  await until(() => replies > before && !owner.running, 'regular rerun rejected the older cut');
  const bound = episodeDeadline(watch.getSnapshot()); assert.equal(typeof bound, 'number');
  phase = 'sample'; await until(() => sample.arrived.done, 'quiet sample during retention');
  sample.release.resolve(); await until(() => owner.presenceRefresh !== null, 'quiet sample completed');
  assert.equal(watch.getSnapshot().revalidating, true, 'older sample cannot settle pending evidence');
  assert.equal(episodeDeadline(watch.getSnapshot()), bound);
  // Advance only after the first sample settles: an expiry that overtakes a
  // sample may legitimately end that sampling cycle without arming another.
  sample = gate(); now = bound;
  assert.equal(watch.getSnapshot().loading, true, 'pending durable episode withdrew');
  await until(() => sample.arrived.done, 'quiet sample after withdrawal');
  const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot()));
  // No intervening publication can reject this sample: it starts and ends
  // with the stable withdrawn snapshot while sync remains held.
  sample.release.resolve(); await until(() => owner.presenceRefresh !== null, 'withdrawn sample completed');
  assert.ok(seen.every(read => !read.data?.item), 'quiet replacement cannot restore a row below the pending cut');
  assert.equal(watch.getSnapshot().loading, true);
});

for (const tables of [undefined, []]) for (const keep of [undefined, true]) for (const failure of [false, true]) {
  test(`online: ${tables === undefined ? 'missing' : 'empty'} tables, keep=${keep}, failed=${failure}`, async t => {
    const change = gate(), reply = gate(), reads = new Map(); let sent = false;
    const client = createClient({ url: 'http://rl-unknown-tables.test', persona: 'bob', fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') {
        await Promise.race([change.release.promise, parked(init.signal)]);
        if (sent) return parked(init.signal);
        sent = true; return Response.json({ seq: 2, ...(tables === undefined ? {} : { tables }) });
      }
      if (path === '/probe') return parked(init.signal);
      const name = path.slice('/q/'.length), count = (reads.get(name) ?? 0) + 1; reads.set(name, count);
      if (count > 1) {
        await Promise.race([reply.release.promise, parked(init.signal)]);
        if (failure) throw Error('replacement transport failure');
      }
      return Response.json({ data: count === 1 ? 'A' : 'B', complete: true, seq: count === 1 ? 1 : 2, tables: [name] });
    } });
    t.after(async () => { change.release.resolve(); reply.release.resolve(); await client.close(); });
    const watches = ['item', 'profile'].map(name => client.observe(q(name), {}, { keep }));
    await until(() => watches.every(watch => watch.getSnapshot().data === 'A'));
    change.release.resolve(); await until(() => sent);
    if (tables === undefined) {
      await until(() => [...reads.values()].every(count => count > 1), 'missing tables refreshes every watch');
      for (const watch of watches) {
        assert.equal(watch.getSnapshot().revalidating, true);
        assert.equal(typeof episodeDeadline(watch.getSnapshot()), 'number');
      }
      if (failure) reply.release.resolve();
      await until(() => watches.every(watch => watch.getSnapshot().loading), 'failed or held replacement withdraws');
      if (!failure) { reply.release.resolve(); await until(() => watches.every(watch => watch.getSnapshot().data === 'B')); }
    } else {
      await delay(1100);
      assert.deepEqual([...reads.values()], [1, 1], 'explicit empty tables intersects neither known dependency');
      for (const watch of watches) {
        assert.equal(watch.getSnapshot().data, 'A');
        assert.equal(watch.getSnapshot().revalidating, undefined);
        assert.equal(episodeDeadline(watch.getSnapshot()), undefined);
      }
    }
  });
}
