// @ref LLP 3000.023#10 — round 1: every change channel, offline metadata and recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sdk, fixture, opener, q, m, parked, until, source } from './helpers/answers-stay.mjs';
import { server } from './helpers/app-server.mjs';
import { source as ephemeralSource, api } from './helpers/ephemeral-server.mjs';
const { readyRead } = await import(new URL('read-existence.js', sdk));
const { createClient } = await import(new URL('client.js', sdk));
const { createLocalClient } = await import(new URL('local.js', sdk));
const { ReadObservation, answerIdentity, answerObservation } = await import(new URL('read-observation.js', sdk));
const { ReadApprovals } = await import(new URL('read-approval.js', sdk));
const { LocalReads } = await import(new URL('local-reads.js', sdk));
const { EphemeralReads } = await import(new URL('ephemeral-reads.js', sdk));
const { episodeDeadline } = await import(new URL('read-episode.js', sdk));
const { armReadExpiry, correctReadExpiries } = await import(new URL('read-expiry.js', sdk));
const ready = data => readyRead({ data, complete: true, fresh: true, cut: null });
test('ready fixtures carry existence', () => { assert.equal(ready(null).existence, 'absent'); assert.equal(ready('row').existence, 'present'); });
const gate = () => ({ arrived: Promise.withResolvers(), release: Promise.withResolvers() });

for (const keep of [undefined, true]) for (const operation of ['apply', 'admit', 'settle']) {
  for (const failure of ['held', 'throw']) test(`${operation} keeps its bound on ${failure}, keep=${keep}`, async t => {
    let now = 1000; t.mock.method(Date, 'now', () => now);
    const owner = Object.assign(new ReadObservation(keep), { presenceRefresh: null });
    t.after(() => owner.retire()); owner.publish(ready('A'));
    new LocalReads().committed([owner], operation);
    assert.equal(owner.snapshot.data, 'A', 'commit does not flash loading');
    assert.equal(episodeDeadline(owner.snapshot), undefined, 'commit queues the bound');
    owner.reload(); // The replacement attempt starts.
    assert.equal(episodeDeadline(owner.snapshot), 2000);
    if (failure === 'throw') await assert.rejects(owner.fetch(async () => { throw Error('device read failed'); }, () => {}));
    else now = 2000;
    assert.equal(owner.read(null).loading, true);
  });
}
for (const host of ['process', 'wasm']) for (const failure of ['held', 'throw']) test(`${host}: applied membership removal and ${failure} replica replacement`, async t => {
  const f = await fixture(t), device = opener(host, join(f.dir, host)), held = gate();
  let intercept = false;
  const client = await createLocalClient({ url: f.url, persona: 'bob', device: { async open(...args) {
    const core = await device.open(...args);
    return { ...core, async call(request, committed) {
      const result = await core.call(request, committed);
      if (intercept && request.op === 'query' && request.name === 'item') {
        assert.equal(result.ok.data, null, 'replica committed the membership removal');
        held.arrived.resolve();
        if (failure === 'throw') throw Error('device read failed');
        await held.release.promise;
      }
      return result;
    } };
  } }, fetch: (input, init) => new URL(input).pathname === '/changes' ? parked(init.signal) : fetch(input, init) });
  t.after(async () => { intercept = false; held.release.resolve(); await client.close(); });
  await client.sync(); const watch = client.observe(q('item'), {});
  await until(() => watch.getSnapshot().data?.body === 'image-1');
  intercept = true; await f.post('/m/remove', { id: 'remove', args: {} }); await client.sync();
  await held.arrived.promise;
  if (failure === 'held') assert.equal(watch.getSnapshot().data?.body, 'image-1');
  await until(() => watch.getSnapshot().loading, 'withdrawal after change evidence');
  intercept = false; held.release.resolve();
});

for (const keep of [undefined, true]) for (const failure of ['held', 'offline']) test(`online receipt bounds ${failure} replacement, keep=${keep}`, async t => {
  const f = await fixture(t), held = gate(); let afterReceipt = false;
  const client = createClient({ url: f.url, persona: 'bob', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes' || path === '/probe') return parked(init.signal);
    if (path === '/m/remove') { const response = await fetch(input, init); afterReceipt = true; return response; }
    if (path === '/q/item' && afterReceipt) {
      held.arrived.resolve();
      if (failure === 'offline') throw Error('offline after receipt');
      await Promise.race([held.release.promise, parked(init.signal)]);
    }
    return fetch(input, init);
  } });
  t.after(async () => { held.release.resolve(); await client.close(); });
  const watch = client.observe(q('item'), {}, { keep });
  await until(() => watch.getSnapshot().data?.body === 'image-1');
  assert.equal((await client.mutate(m('remove'), {})).state, 'sent');
  await held.arrived.promise;
  await until(() => watch.getSnapshot().loading, 'receipt withdrawal');
});

for (const host of ['online', 'process', 'wasm']) test(`${host}: ephemeral-only /changes bounds a held replacement`, async t => {
  const f = await server(t, undefined, ephemeralSource), change = gate(), held = gate();
  let holding = false, delivered = false, last;
  const post = (path, body) => fetch(f.url + path, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify(body) });
  await post('/m/setTyping', { id: 'typing', args: { room: 'room' } });
  const options = { url: f.url, persona: 'bob', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') {
      await Promise.race([change.release.promise, parked(init.signal)]);
      if (delivered) return parked(init.signal);
      delivered = true;
      return Response.json({ seq: last.seq, tables: [], ephemeral: { ...last.ephemeral, epoch: last.ephemeral.epoch + 1, tables: ['typing'] } });
    }
    if (path === '/q/typingIn') {
      if (holding) { held.arrived.resolve(); await Promise.race([held.release.promise, parked(init.signal)]); }
      const response = await fetch(input, init); last = await response.clone().json(); return response;
    }
    return fetch(input, init);
  } };
  const client = host === 'online' ? createClient(options) : await createLocalClient({ ...options, device: opener(host, join(f.dir, host)) });
  t.after(async () => { holding = false; held.release.resolve(); change.release.resolve(); await client.close(); });
  if (client.sync) await client.sync();
  const watch = client.observe(api.typingIn, { room: 'room' });
  await until(() => watch.getSnapshot().data?.length === 1);
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  holding = true; change.release.resolve(); await held.arrived.promise;
  assert.equal(watch.getSnapshot().data.length, 1);
  now += 1001;
  assert.equal(watch.getSnapshot().loading, true, 'ephemeral change has the one-second bound before row expiry');
});

test('ephemeral periodic sampling is distinct from change evidence', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const lifetime = new AbortController(), reads = new EphemeralReads(lifetime.signal), owner = {}, events = [];
  t.after(() => lifetime.abort());
  reads.add(owner, ['typing'], (reset, changed) => { events.push([reset, changed]); });
  reads.incomplete(owner, true); t.mock.timers.tick(1000);
  assert.deepEqual(events, [[false, false]]);
  const request = reads.request(); reads.accept(request, { incarnation: 'one', epoch: 1 }, owner); events.length = 0;
  reads.changed(request, { incarnation: 'one', epoch: 2, tables: ['typing'] });
  assert.deepEqual(events, [[false, true]]);
});

test('held approved A gets offline metadata from B with A identity, confirmation and deadlines', t => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const owner = new ReadObservation(), approvals = new ReadApprovals();
  t.after(() => { approvals.close(); owner.retire(); clearTimeout(owner.expiryTimer); });
  const clock = { issuedDeviceNow: () => now, estimatedServerNow: () => now,
    deviceDelay: d => Math.max(0, d - now), serverDelay: d => Math.max(0, d - now) };
  const arm = deadlines => armReadExpiry(owner, deadlines, clock, () => true, () => {
    correctReadExpiries([owner], clock, watch => watch.expire(), (_, d) => arm(d), () => {});
  });
  owner.publish(ready('A')); const a = owner.snapshot, identity = answerIdentity(a);
  arm({ device: null, server: 9000, localWakeup: false });
  const held = approvals.approve(a);
  now = 3000; owner.publish(ready('B'));
  arm({ device: null, server: 12000, localWakeup: false }); owner.failed(true);
  assert.equal(held.read().data, 'A'); assert.equal(held.read().fresh, false);
  assert.equal(held.read().since, 1000, 'A confirmation, not B confirmation or failure time');
  assert.equal(answerIdentity(held.read()), identity);
  assert.equal(owner.deadlines.server, 12000);
  now = 4000; owner.failed(true); assert.equal(held.read().since, 1000);
  now = 8999; assert.equal(held.read().data, 'A');
  now = 9000; assert.equal(held.read().loading, true, 'A keeps its own deadline across the offline copy');
  assert.equal(owner.read(null).data, 'B', 'B has its independent later deadline');
});

for (const host of ['process', 'wasm']) test(`${host}: plain offline server watch with failed recovery keeps honest metadata`, async t => {
  const f = await fixture(t), device = opener(host, join(f.dir, host)); let offline = false;
  const client = await createLocalClient({ url: f.url, persona: 'bob', device: { async open(...args) {
    const core = await device.open(...args);
    return { ...core, async call(request, committed) {
      if (offline && request.op === 'query') throw Error('recovery read failed');
      return core.call(request, committed);
    } };
  } }, fetch: (input, init) => {
    if (new URL(input).pathname === '/changes') return parked(init.signal);
    if (offline) throw Error('offline');
    return fetch(input, init);
  } });
  t.after(() => client.close()); await client.sync();
  const watch = client.observe(q('profile'), {}); await until(() => watch.getSnapshot().fresh);
  const before = watch.getSnapshot(), owner = answerObservation(before), confirmed = owner.since;
  offline = true; await client.sync(); await delay(20);
  const read = watch.getSnapshot();
  assert.equal(read.data.name, 'Bob'); assert.equal(read.revalidating, true);
  assert.equal(read.fresh, false); assert.equal(read.since, confirmed);
  assert.equal(answerIdentity(read), answerIdentity(before));
});

for (const host of ['process', 'wasm']) test(`${host}: change evidence retires remembered membership answer before failed sync`, async t => {
  const f = await fixture(t), change = gate(); let bad = false, delivered = false, evidence;
  const client = await createLocalClient({ url: f.url, persona: 'bob', device: opener(host, join(f.dir, host)), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') {
      await Promise.race([change.release.promise, parked(init.signal)]);
      if (delivered) return parked(init.signal); delivered = true; return Response.json(evidence);
    }
    if (bad && ['/sync', '/q/mixed', '/probe'].includes(path)) throw Error('offline after change');
    return fetch(input, init);
  } });
  t.after(async () => { change.release.resolve(); await client.close(); }); await client.sync();
  const watch = client.observe(q('mixed'), { cutoff: Date.now() + 600000, deny: false });
  await until(() => watch.getSnapshot().data?.body === 'image-1');
  const receipt = await f.post('/m/remove', { id: 'remove', args: {} });
  evidence = { seq: receipt.seq, tables: ['members', 'messages'] };
  const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot()));
  bad = true; change.release.resolve();
  await until(() => seen.some(read => read.loading)); await delay(100);
  assert.ok(seen.slice(seen.findIndex(read => read.loading)).every(read => !read.data), 'recovery never reinstalls the remembered pre-removal answer');
  assert.equal(watch.getSnapshot().loading, true);
});

for (const host of ['process', 'wasm']) for (const response of ['offline', 'loading', 'denied']) test(`${host}: ordinary search ${response} classification`, async t => {
  const program = source.replace('  body: text <=200', '  body: text <=200\n  search body').replace('  sync to members[.room]\ntable profiles:', '  sync to members[.room]\n  retain delivered-history\ntable profiles:') + `\nquery search(needle: text <=100, c: cursor?):\n  return messages matching needle last 20 by .at after c\n`;
  const f = await fixture(t, program); let fail = false, reads = 0;
  const client = await createLocalClient({ url: f.url, persona: 'bob', device: opener(host, join(f.dir, host)), fetch: (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') return parked(init.signal);
    if (path === '/q/search' && fail) {
      reads++;
      if (response === 'offline') throw Error('search transport failed');
      return Response.json(response === 'loading' ? { loading: true } : { denied: { code: 'APP_DENIED', family: 'rule', message: 'not available' } });
    }
    return fetch(input, init);
  } });
  t.after(() => client.close()); await client.sync();
  const watch = client.observe(q('search'), { needle: 'image', c: null });
  await until(() => watch.getSnapshot().data?.length === 1);
  // Reacquire the same local handle: its start callback performs a plain
  // re-read without injecting an apply commit or remote change evidence.
  watch.close(); fail = true;
  const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot()));
  await until(() => reads > 0); await delay(100);
  if (response === 'offline') {
    assert.ok(seen.length > 0); assert.ok(seen.every(read => !read.loading), 'plain search failure never publishes loading');
    assert.equal(watch.getSnapshot().fresh, false); assert.equal(typeof watch.getSnapshot().since, 'number');
  } else if (response === 'loading') assert.equal(watch.getSnapshot().loading, true);
  else assert.equal(watch.getSnapshot().denied?.code, 'APP_DENIED');
});

for (const host of ['process', 'wasm']) test(`${host}: pre-change replica completion cannot erase a pending change bound`, async t => {
  const f = await fixture(t), device = opener(host, join(f.dir, host));
  const old = gate(), change = gate(), next = gate(), sync = gate();
  let mode = 'ready', delivered = false, evidence, syncFailed = false;
  const client = await createLocalClient({ url: f.url, persona: 'bob', device: { async open(...args) {
    const core = await device.open(...args);
    return { ...core, async call(request, committed) {
      const result = await core.call(request, committed);
      if (request.op === 'query' && request.name === 'mixed') {
        if (mode === 'old') { mode = 'next'; old.arrived.resolve(); await old.release.promise; }
        else if (mode === 'next') { next.arrived.resolve(); await next.release.promise; throw Error('replacement failed'); }
      }
      return result;
    } };
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') {
      await Promise.race([change.release.promise, parked(init.signal)]);
      if (delivered) return parked(init.signal); delivered = true; return Response.json(evidence);
    }
    if (path === '/sync' && mode !== 'ready') { sync.arrived.resolve(); await sync.release.promise; syncFailed = true; throw Error('sync failed'); }
    if (syncFailed && path === '/probe') return parked(init.signal);
    return fetch(input, init);
  } });
  t.after(async () => { mode = 'ready'; old.release.resolve(); next.release.resolve(); sync.release.resolve(); change.release.resolve(); await client.close(); });
  await client.sync();
  const watch = client.observe(q('mixed'), { cutoff: Date.now() - 1000, deny: false });
  await until(() => watch.getSnapshot().data?.body === 'image-1');
  watch.close(); mode = 'old'; const seen = [];
  watch.subscribe(() => seen.push(watch.getSnapshot())); await old.arrived.promise;
  const receipt = await f.post('/m/remove', { id: 'remove', args: {} });
  evidence = { seq: receipt.seq, tables: ['members', 'messages'] }; change.release.resolve();
  await sync.arrived.promise; seen.length = 0; old.release.resolve();
  // The retired attempt cannot publish; its replacement starts the bound and
  // parks until sync rather than evaluating an already-known older replica.
  await until(() => typeof episodeDeadline(watch.getSnapshot()) === 'number');
  await delay(20);
  assert.ok(seen.every(read => !read.data || read.revalidating), 'pre-change completion cannot publish a settled answer');
  next.release.resolve(); sync.release.resolve();
  await until(() => watch.getSnapshot().loading, 'failed replacement keeps the change bound');
});
