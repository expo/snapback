// @ref LLP 3000.019#3.3 — typing opts into stale presentation; expiry still withdraws it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { server, binary, until } from './helpers/app-server.mjs';
import { device, api } from './helpers/ephemeral-server.mjs';

const source = `use identity
use personas alice, bob
table members:
  room: text <=40
  principal: principal
  revision: int
  unique room, principal
  immutable room, principal
  read <- exists members[.room, viewer]
  update <- .principal = viewer
  sync to members[.room]
mutation touchMember(revision: int):
  update members[room = 'r', principal = viewer] { revision }
query memberRevision():
  return members[room = 'r', principal = 'dev:alice'] { revision }
table typing:
  room: text <=40
  principal: principal
  unique room, principal
  cap 50 by room
  read <- exists members[.room, viewer]
  insert <- .principal = viewer and exists members[.room, viewer]
  update <- .principal = viewer and exists members[.room, viewer]
  ephemeral 4s
mutation setTyping(room: text <=40):
  upsert typing[room, viewer] {}
query typingIn(room: text <=40):
  return typing where .room = room and .principal != viewer by .principal { principal }
`;
const hasPeer = read => read.data?.some(row => row.principal === 'dev:alice') === true;

for (const tier of ['online', 'wasm', 'process']) test(`${tier}: kept typing survives member commits and expires during a held re-read`, { timeout: 20_000 }, async t => {
  const { url, dir } = await server(t, undefined, source);
  const seeded = await defaultFetch(url + '/seed', { method: 'POST', body: JSON.stringify(
    ['alice', 'bob'].map(person => ({ table: 'members', row: { id: person, room: 'r', principal: `dev:${person}`, revision: 0 } }))) });
  assert.equal((await seeded.json()).seeded, 2);
  const replies = [];
  let holding = false, blocked = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const fetch = async (input, init) => {
    const response = await defaultFetch(input, init);
    if (new URL(input).pathname !== '/q/typingIn') return response;
    const json = await response.clone().json();
    replies.push(json);
    if (holding) { blocked++; await held; }
    else await delay(30); // Make the loading window observable without changing the server answer.
    return response;
  };
  const observer = tier === 'online' ? createClient({ url, persona: 'bob', fetch })
    : await createLocalClient({ url, persona: 'bob', fetch,
      device: tier === 'wasm' ? device() : processDevice({ binary, dir: join(dir, 'device') }) });
  const peer = createClient({ url, persona: 'alice' });
  t.after(async () => { release(); await observer.close(); await peer.close(); });
  if (observer.sync) await observer.sync();
  const plain = observer.observe(api.typingIn, { room: 'r' }, { keep: false });
  const bounded = observer.observe(api.typingIn, { room: 'r' });
  const kept = observer.observe(api.typingIn, { room: 'r' }, { keep: true });
  const member = observer.observe({ kind: 'query', name: 'memberRevision' }, {}, { keep: true });
  await until(() => plain.getSnapshot().data?.length === 0 && kept.getSnapshot().data?.length === 0
    && member.getSnapshot().data?.revision === 0, 'initial reads');
  const stoppedAt = performance.now();
  assert.equal((await peer.mutate(api.setTyping, { room: 'r' })).state, 'sent');
  // No renewal or stopTyping call: silence must expire after the declared 4 s life.
  await until(() => hasPeer(plain.getSnapshot()) && hasPeer(kept.getSnapshot()) && hasPeer(bounded.getSnapshot()), 'peer typing');
  assert.ok(replies.some(reply => reply.tables.includes('members') && reply.tables.includes('typing')),
    'the server answer depends on the durable rule probe as well as typing');
  const plainReads = [], keptReads = [], boundedReads = [];
  bounded.subscribe(() => boundedReads.push(bounded.getSnapshot()));
  plain.subscribe(() => plainReads.push(plain.getSnapshot()));
  kept.subscribe(() => keptReads.push({ at: performance.now(), read: kept.getSnapshot() }));
  const burstAt = performance.now();
  for (let revision = 1; revision <= 20; revision++) {
    await delay(Math.max(0, burstAt + revision * 100 - performance.now()));
    assert.equal((await peer.mutate({ kind: 'mutation', name: 'touchMember' }, { revision })).state, 'sent');
  }
  await until(() => member.getSnapshot().data?.revision === 20 && member.getSnapshot().fresh
    && hasPeer(plain.getSnapshot()) && kept.getSnapshot().fresh, 'burst delivered');
  assert.ok(keptReads.length > 0, 'commits actually re-read the kept watch');
  assert.ok(keptReads.every(({ read }) => hasPeer(read)), 'no publication hides typing during the burst');
  assert.ok(keptReads.some(({ read }) => read.revalidating === true), 'kept data marks revalidation');
  assert.ok(boundedReads.every(hasPeer), "ordinary ephemeral fallback honors default retention through the burst");
  assert.ok(boundedReads.some(read => read.revalidating === true));
  // Explicit false preserves immediate withdrawal.
  assert.ok(plainReads.some(read => 'loading' in read), 'keep:false invalidation publishes loading');
  assert.ok(plainReads.some(hasPeer), 'the default watch then publishes the peer again');
  t.diagnostic(`burst: ${plainReads.filter(read => 'loading' in read).length} default loading publications; ${keptReads.length} kept publications, all visible`);

  holding = true;
  assert.equal((await peer.mutate({ kind: 'mutation', name: 'touchMember' }, { revision: 21 })).state, 'sent');
  await until(() => blocked >= 2, 'both typing replies held before expiry');
  assert.ok(hasPeer(kept.getSnapshot()), 'keep spans the held replacement');
  await until(() => !hasPeer(kept.getSnapshot()), 'kept expiry without a replacement reply');
  const expiredAt = performance.now(), afterExpiry = keptReads.length;
  assert.ok(expiredAt - stoppedAt <= 5000, `typing lasted ${expiredAt - stoppedAt} ms after the last call`);
  holding = false;
  release();
  await until(() => kept.getSnapshot().data?.length === 0 && kept.getSnapshot().fresh, 'empty answer after expiry');
  assert.ok(keptReads.slice(afterExpiry).every(({ read }) => !hasPeer(read)), 'late pre-expiry bodies never resurrect typing');
  t.diagnostic(`expiry: ${(expiredAt - stoppedAt).toFixed(1)} ms after the last call, while replies were held`);
});
