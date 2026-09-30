// @ref LLP 3000.023#10 — reported changes survive old replica reads; offline ephemeral recovery is plain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sdk, fixture, opener, q, parked, until } from './helpers/answers-stay.mjs';
import { ephemeralServer, api } from './helpers/ephemeral-server.mjs';
const { readyRead } = await import(new URL('read-existence.js', sdk));
const { createLocalClient } = await import(new URL('local.js', sdk));
const { answerIdentity, answerObservation, ReadObservation } = await import(new URL('read-observation.js', sdk));
const { LocalReads } = await import(new URL('local-reads.js', sdk));
const { episodeDeadline } = await import(new URL('read-episode.js', sdk));
const gate = () => ({ arrived: Promise.withResolvers(), release: Promise.withResolvers() });

test('pending change requires published sync or a whole server answer at its cut', () => {
  const answers = new LocalReads(), watch = Object.assign(new ReadObservation(), { op: q('item'), args: {} });
  const data = readyRead({ data: 'row', complete: true, fresh: true, cut: null });
  assert.equal(data.existence, 'present');
  answers.changed(watch, 10);
  answers.changed(watch, 9);
  for (const candidate of [{}, { serverOnly: true }, { serverOnly: true, seq: 9 }, { served: true, seq: 10 }]) {
    assert.equal(answers.current(watch, { read: data, ...candidate }), false);
  }
  assert.equal(answers.current(watch, { read: data, serverOnly: true, seq: 10 }), true);
  assert.equal(answers.current(watch, { read: data }), false, 'qualified server answer does not qualify old replica');
  assert.equal(answers.current(watch, { read: { denied: { code: 'APP_DENIED' } } }), true);
  answers.applied([watch], 9);
  assert.equal(answers.current(watch, { read: data }), false);
  answers.applied([watch], 10);
  assert.equal(answers.current(watch, { read: data }), true);
});

for (const host of ['process', 'wasm']) for (const name of ['item', 'mixed']) for (const failure of ['readable', 'throw']) for (const keep of [undefined, true, false]) {
  test(`${host}: ${name} notification survives ${failure} old replica and failed sync, keep=${keep}`, async t => {
    const f = await fixture(t), change = gate(), sync = gate(), device = opener(host, join(f.dir, host));
    let evidence, delivered = false, failing = false, replicaReads = 0, syncFailed = false;
    const client = await createLocalClient({ url: f.url, persona: 'bob', device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const result = await core.call(request, committed);
        if (failing && request.op === 'query' && request.name === name) {
          replicaReads++;
          assert.equal(result.ok.data.body, 'image-1', 'replica has not applied the change');
          if (failure === 'throw') throw Error('replica read failed');
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
      if (failing && path === '/probe') return parked(init.signal);
      if (failing && path === '/sync') {
        sync.arrived.resolve(); await Promise.race([sync.release.promise, parked(init.signal)]);
        syncFailed = true; throw Error('sync failed');
      }
      return fetch(input, init);
    } });
    t.after(async () => { failing = false; change.release.resolve(); sync.release.resolve(); await client.close(); });
    await client.sync();
    const watch = client.observe(q(name), name === 'mixed' ? { cutoff: Date.now() - 1000, deny: false } : {}, { keep });
    await until(() => watch.getSnapshot().data?.body === 'image-1');
    const receipt = await f.post('/m/remove', { id: 'remove', args: {} });
    evidence = { seq: receipt.seq, tables: ['members'] };
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot()));
    failing = true; change.release.resolve(); await sync.arrived.promise;
    await until(() => replicaReads > 0); await delay(20);
    if (failure === 'readable' && keep !== false) {
      const read = watch.getSnapshot();
      assert.equal(read.revalidating, true, 'old replica answer cannot settle the notification');
      assert.equal(typeof episodeDeadline(read), 'number');
      now = episodeDeadline(read); assert.equal(watch.getSnapshot().loading, true);
    } else assert.equal(watch.getSnapshot().loading, true);
    seen.length = 0; sync.release.resolve(); await until(() => syncFailed); await delay(30);
    assert.ok(seen.every(read => !read.data), 'old replica must not reappear after withdrawal');
    assert.equal(watch.getSnapshot().loading, true);
    failing = false; await client.sync();
    await until(() => watch.getSnapshot().data === null, 'applied sync qualifies the replacement');
  });
}

for (const host of ['process', 'wasm']) test(`${host}: only a server answer at the reported cut can replace before sync`, async t => {
  const f = await fixture(t), change = gate(), sync = gate(), device = opener(host, join(f.dir, host));
  const cutoff = Date.now() + 600000;
  let delivered = false, evidence, oldAnswer, mode = 'ready', responses = 0;
  const client = await createLocalClient({ url: f.url, persona: 'bob', device: { async open(...args) {
    const core = await device.open(...args);
    return { ...core, call: (request, committed) => core.call(mode === 'local' && request.op === 'query' ? { ...request, now: cutoff } : request, committed) };
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') {
      await Promise.race([change.release.promise, parked(init.signal)]);
      if (delivered) return parked(init.signal);
      delivered = true; return Response.json(evidence);
    }
    if (mode !== 'ready' && path === '/sync') { sync.arrived.resolve(); return parked(init.signal); }
    if (path === '/q/mixed') {
      responses++;
      if (mode === 'old') return Response.json(oldAnswer);
      const response = await fetch(input, init);
      if (mode === 'ready') oldAnswer = await response.clone().json();
      return response;
    }
    return fetch(input, init);
  } });
  t.after(async () => { change.release.resolve(); await client.close(); });
  await client.sync(); const watch = client.observe(q('mixed'), { cutoff, deny: false });
  await until(() => watch.getSnapshot().data?.body === 'image-1');
  const receipt = await f.post('/m/remove', { id: 'remove', args: {} });
  evidence = { seq: receipt.seq, tables: ['members'] };
  const before = responses; mode = 'old'; change.release.resolve(); await sync.arrived.promise;
  await until(() => responses > before); await delay(20);
  assert.equal(watch.getSnapshot().revalidating, true, 'older server cut does not settle evidence');
  assert.equal(typeof episodeDeadline(watch.getSnapshot()), 'number');
  mode = 'current'; watch.close(); watch.subscribe(() => {});
  await until(() => watch.getSnapshot().data === null, 'current server answer replaces before sync');
  assert.equal(watch.getSnapshot().revalidating, undefined);
  mode = 'local'; watch.close(); const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot()));
  await delay(50);
  assert.ok(seen.every(read => !read.data), 'a later old replica read cannot reinstall the row');
  assert.equal(watch.getSnapshot().data, null);
});

for (const host of ['process', 'wasm']) for (const outcome of ['offline', 'loading', 'denied']) {
  test(`${host}: ephemeral ${outcome} recovery preserves its classification and expiry`, async t => {
    const f = await ephemeralServer(t); let fail = false, requests = 0;
    await fetch(f.url + '/m/setTyping', { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify({ id: 'typing', args: { room: 'room' } }) });
    const client = await createLocalClient({ url: f.url, persona: 'bob', device: opener(host, join(f.dir, host)), fetch: (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes' || (fail && path === '/probe')) return parked(init.signal);
      if (fail && path === '/q/typingIn') {
        requests++;
        if (outcome === 'offline') throw Error('plain transport failure');
        return Response.json(outcome === 'loading' ? { loading: true } : { denied: { code: 'APP_DENIED', family: 'rule', message: 'unavailable' } });
      }
      return fetch(input, init);
    } });
    t.after(() => client.close()); await client.sync();
    const watch = client.observe(api.typingIn, { room: 'room' });
    await until(() => watch.getSnapshot().data?.length === 1);
    const before = watch.getSnapshot(), owner = answerObservation(before), confirmed = owner.since, deadline = owner.deadlines.server;
    const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot()));
    fail = true; await client.query(api.typingIn, { room: 'room' }); await delay(100);
    assert.ok(requests > 0);
    if (outcome === 'offline') {
      assert.ok(seen.every(read => !read.loading), 'offline rerun never publishes loading before expiry');
      const read = watch.getSnapshot();
      assert.equal(read.data.length, 1); assert.equal(read.revalidating, true); assert.equal(read.fresh, false);
      assert.equal(read.since, confirmed); assert.equal(answerIdentity(read), answerIdentity(before));
      assert.equal(owner.deadlines.server, deadline);
      await until(() => watch.getSnapshot().loading, 'original four-second row expiry still withdraws', 6000);
    } else {
      // Reacquire the same handle to request an explicit observation result.
      watch.close(); watch.subscribe(() => {});
      await until(() => outcome === 'loading' ? watch.getSnapshot().loading : watch.getSnapshot().denied?.code === 'APP_DENIED');
    }
  });
}
