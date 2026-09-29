import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { EphemeralReads } from '../dist/ephemeral-reads.js';
import { ephemeralServer, device, api, until } from './helpers/ephemeral-server.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
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
