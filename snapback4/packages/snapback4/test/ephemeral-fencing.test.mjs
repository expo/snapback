import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { EphemeralReads } from '../dist/ephemeral-reads.js';
import { ReadObservation } from '../dist/read-observation.js';
import { ephemeralServer, device, api, until } from './helpers/ephemeral-server.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('dependency epochs cover owners, direct replies, remounts and the final publication gap', t => {
  const stop = new AbortController(), reads = new EphemeralReads(stop.signal);
  const version = epoch => ({ incarnation: 'A', epoch });
  reads.accept(reads.request([]), version(0));
  const a = new ReadObservation(), b = new ReadObservation(false), other = new ReadObservation();
  let checking = false;
  t.after(() => { stop.abort(); [a, b, other].forEach(w => w.retire()); });
  for (const [owner, tables] of [[a, ['secrets']], [b, ['secrets']], [other, ['signals']]]) {
    reads.add(owner, tables, () => {
      const deliver = owner.reset({ loading: true }, true);
      return () => { deliver(); if (checking) { assert.equal(a.snapshot.loading, true); assert.equal(b.snapshot.loading, true); } };
    });
    reads.accept(reads.request(tables), version(0), owner);
  }
  // Install same-epoch observations before the callbacks begin checking a sweep.
  for (const owner of [a, b, other]) owner.publish({ data: 'old', complete: true, fresh: true });
  checking = true;
  const delayed = reads.request(['secrets']), independent = reads.request(['signals']);
  assert.equal(reads.accept(delayed, version(0)), true);
  assert.equal(reads.valid(delayed, version(0)), true, 'candidate accepted before its publication continuation');
  assert.equal(reads.accept(reads.request(['secrets']), version(2), a), true, 'the accepting owner also withdraws before peer callbacks');
  assert.equal(reads.valid(delayed, version(0)), false, 'new evidence fences the asynchronous publication gap');
  assert.equal(reads.accept(delayed, version(0)), false, 'ownerless alias is fenced');
  assert.equal(reads.accept(independent, version(0)), true, 'unrelated table remains independent');
  assert.equal(other.snapshot.data, 'old');
  reads.remove(a); reads.remove(b);
  assert.equal(reads.accept(reads.request(['secrets']), version(1)), false, 'floors outlive owners');
  assert.equal(reads.accept(reads.request(), version(1)), false, 'unknown dependencies fail closed');
  stop.abort(); [a, b, other].forEach(w => w.retire());
});

test('withheld epochs do not advance floors and changes fence ownerless replies', () => {
  const stop = new AbortController(), reads = new EphemeralReads(stop.signal), version = epoch => ({ incarnation: 'A', epoch });
  reads.accept(reads.request([]), version(0));
  assert.equal(reads.accept(reads.request(['secrets']), version(8), undefined, undefined, false), true);
  assert.equal(reads.accept(reads.request(['secrets']), version(1)), true, 'withheld body provides no replacement evidence');
  reads.changed(reads.pollRequest(), { ...version(3), tables: ['secrets'] });
  assert.equal(reads.accept(reads.request(['secrets']), version(2)), false, 'poll floor does not require a mounted owner');
  assert.equal(reads.accept(reads.request(['signals']), version(2)), true);
  stop.abort();
});
test('ephemeral replacement visits only advancing dependency buckets', () => {
  const stop = new AbortController(), reads = new EphemeralReads(stop.signal), version = epoch => ({ incarnation: 'A', epoch });
  reads.accept(reads.request([]), version(0));
  let withdrawals = 0, visits = 0;
  for (let i = 0; i < 400; i++) reads.add({}, ['table' + i], () => { withdrawals++; });
  reads.interests.values = () => assert.fail('per-result full owner scan');
  const get = reads.interests.get.bind(reads.interests);
  reads.interests.get = owner => { visits++; return get(owner); };
  for (let i = 0; i < 400; i++) {
    assert.ok(reads.accept(reads.request(['table' + i]), version(1)));
    assert.ok(reads.accept(reads.request(['table' + i]), version(1)), 'same epoch does not revisit its bucket');
  }
  assert.equal(visits, 400); assert.equal(withdrawals, 400);
  delete reads.interests.values; stop.abort();
});

test('poll coverage uses the smallest watch answer, and stale revisions precede incarnation checks', () => {
  const stop = new AbortController(), reads = new EphemeralReads(stop.signal), a = {}, b = {};
  reads.add(a, ['typing'], () => {}); reads.add(b, ['viewing'], () => {});
  assert.ok(reads.accept(reads.request(), { incarnation: 'A', epoch: 50 }, a));
  const oldQ = reads.request(), oldPoll = reads.pollRequest();
  assert.ok(reads.accept(reads.request(), { incarnation: 'A', epoch: 55 }, b));
  assert.equal(reads.parameters().epoch, 50);
  assert.ok(reads.changed(reads.pollRequest(), { incarnation: 'A', epoch: 51, tables: ['viewing'] }));
  assert.equal(reads.accept(reads.request(), { incarnation: 'A', epoch: 54 }, b), false, 'an older poll cannot lower the floor of a newer query answer');
  assert.equal(reads.accept(reads.request(), { incarnation: 'A', epoch: 49 }, a), false);
  assert.ok(reads.accept(reads.request(), { incarnation: 'B', epoch: 1 }, b));
  assert.equal(reads.accept(oldQ, { incarnation: 'A', epoch: 50 }, a), false);
  assert.equal(reads.changed(oldPoll, { incarnation: 'A', epoch: 50, tables: ['typing'] }), false);
  assert.equal(reads.parameters().incarnation, 'B'); stop.abort();
});

for (const tier of ['online', 'wasm']) test(`${tier}: stale epochs and delayed queries/polls cannot resurrect a retired incarnation`, async t => {
  const { url } = await ephemeralServer(t), polls = [], observed = [], packets = [];
  const head = await (await defaultFetch(`${url}/changes?since=0&wait=0`, { headers: { 'x-snapback-persona': 'bob' } })).json();
  let version = { incarnation: 'A', epoch: 50 }, staleOnce = false, holdQuery = false, heldQuery;
  const fetch = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') {
      const hold = deferred(); polls.push({ ...hold, signal: init.signal });
      // Deliberately ignore abort, as a buffered response can still arrive.
      return hold.promise;
    }
    const response = await defaultFetch(input, init);
    if (path !== '/q/typingIn') return response;
    const json = await response.json();
    const stale = staleOnce; staleOnce = false;
    const packet = { ...json, data: [{ principal: stale ? 'stale' : version.incarnation }], ephemeral: stale ? { incarnation: 'A', epoch: 49 } : { ...version } };
    packets.push(packet);
    if (holdQuery && JSON.parse(init.body).args.room === 'held') {
      holdQuery = false; heldQuery = { ...deferred(), packet }; return heldQuery.promise;
    }
    return Response.json(packet);
  };
  const b = tier === 'online' ? createClient({ url, persona: 'bob', fetch })
    : await createLocalClient({ url, persona: 'bob', fetch, device: device() });
  t.after(async () => { await b.close(); for (const poll of polls) poll.resolve(Response.json({ ...head, ephemeral: version })); heldQuery?.resolve(Response.json(heldQuery.packet)); });
  if (b.sync) await b.sync();
  const typing = b.observe(api.typingIn, { room: 'main' }); t.after(() => typing.close());
  typing.subscribe(() => { const data = typing.getSnapshot().data; if (data) observed.push(data[0]?.principal); });
  await until(() => typing.getSnapshot().data?.[0]?.principal === 'A');
  await until(() => polls.some(p => !p.signal.aborted));
  staleOnce = true; version = { incarnation: 'A', epoch: 51 };
  polls.findLast(p => !p.signal.aborted).resolve(Response.json({ ...head, ephemeral: { ...version, tables: ['typing'] } }));
  await until(() => !staleOnce); await delay(150);
  assert.equal(observed.includes('stale'), false, 'same-incarnation stale answer never publishes');
  await until(() => typing.getSnapshot().data?.[0]?.principal === 'A', JSON.stringify({ snapshot: typing.getSnapshot(), packets, link: b.link() }));
  await until(() => polls.some(p => !p.signal.aborted));
  const oldPoll = polls.findLast(p => !p.signal.aborted);
  holdQuery = true;
  const held = b.observe(api.typingIn, { room: 'held' }); t.after(() => held.close());
  held.subscribe(() => { const data = held.getSnapshot().data; if (data) observed.push(data[0]?.principal); });
  await until(() => heldQuery);
  version = { incarnation: 'B', epoch: 1 };
  const fresh = await b.query(api.typingIn, { room: 'new' });
  assert.equal(fresh.data?.[0]?.principal, 'B', JSON.stringify(fresh));
  await until(() => typing.getSnapshot().data?.[0]?.principal === 'B' && held.getSnapshot().data?.[0]?.principal === 'B', 'outstanding reads reissued');
  assert.equal(oldPoll.signal.aborted, true);
  const sinceB = observed.length;
  heldQuery.resolve(Response.json({ ...heldQuery.packet, store_id: 'retired-query-store' }));
  oldPoll.resolve(Response.json({ ...head, seq: 999, store_id: 'retired-poll-store', ephemeral: { incarnation: 'A', epoch: 50, tables: ['typing'] } }));
  await delay(100);
  assert.equal(b.link(), 'online');
  assert.equal(typing.getSnapshot().data?.[0]?.principal, 'B');
  assert.equal(held.getSnapshot().data?.[0]?.principal, 'B');
  assert.equal(observed.includes('stale'), false);
  assert.ok(observed.slice(sinceB).every(value => value === 'B'));
});
