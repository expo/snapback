import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.019#3.3 — typing opts into stale presentation; expiry still withdraws it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { ServerClock } from '../dist/clock.js';
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

for (const tier of ['online', 'wasm', 'process']) test(`${tier}: kept typing survives member commits and expires during a held re-read`, { timeout: hangBudget(27) }, async t => {
  const { url, dir } = await server(t, undefined, source);
  const seeded = await defaultFetch(url + '/seed', { method: 'POST', body: JSON.stringify(
    ['alice', 'bob'].map(person => ({ table: 'members', row: { id: person, room: 'r', principal: `dev:${person}`, revision: 0 } }))) });
  assert.equal((await seeded.json()).seeded, 2);
  const replies = [];
  // The observer owns elapsed test time. HTTP and member commits may take
  // arbitrarily long without spending the typing answer's remaining life.
  // Keep the real server's nextExpiry; only clock samples are suppressed.
  let now = Date.now();
  const clock = new ServerClock(() => now);
  let holding = false, blocked = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const fetch = clock.wrap(async (input, init) => {
    const response = await defaultFetch(input, init);
    const headers = new Headers(response.headers);
    headers.delete('x-snapback-time'); headers.delete('x-snapback-clock');
    const path = new URL(input).pathname;
    if (path === '/changes') {
      // Preserve heartbeat bytes while removing the final clock sample.
      // Buffering the whole poll would itself trip the silence watchdog.
      const decoder = new TextDecoder(), encoder = new TextEncoder();
      let text = '';
      const body = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          text += decoder.decode(chunk, { stream: true });
          if (!text.trim()) { controller.enqueue(chunk); text = ''; }
        },
        flush(controller) {
          const json = JSON.parse(text + decoder.decode());
          delete json.serverNow; delete json.clockRevision;
          controller.enqueue(encoder.encode(JSON.stringify(json)));
        },
      }));
      return new Response(body, { status: response.status, headers });
    }
    if (path !== '/q/typingIn') return new Response(response.body, { status: response.status, headers });
    const json = await response.json();
    replies.push(json);
    if (holding) { blocked++; await held; }
    else await delay(30); // Make the loading window observable without changing the server answer.
    return Response.json(json, { status: response.status, headers });
  });
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
  assert.equal((await peer.mutate(api.setTyping, { room: 'r' })).state, 'sent');
  // No renewal or stopTyping call: silence must expire after the declared 4 s life.
  await until(() => hasPeer(plain.getSnapshot()) && hasPeer(kept.getSnapshot()) && hasPeer(bounded.getSnapshot()), 'peer typing');
  assert.ok(replies.some(reply => reply.tables.includes('members') && reply.tables.includes('typing')),
    'the server answer depends on the durable rule probe as well as typing');
  const deadline = replies.find(reply => reply.data?.length)?.nextExpiry;
  assert.equal(typeof deadline, 'number');
  now = deadline - 4000;
  // Retention episodes use elapsed wall time separately from ServerClock.
  // Own that clock too; HTTP workers and the peer keep their real clocks.
  const episodeWall = now;
  t.mock.method(Date, 'now', () => episodeWall); // Isolate row expiry from the online-change episode.
  const plainReads = [], keptReads = [], boundedReads = [];
  bounded.subscribe(() => boundedReads.push(bounded.getSnapshot()));
  plain.subscribe(() => plainReads.push(plain.getSnapshot()));
  kept.subscribe(() => keptReads.push({ at: now, read: kept.getSnapshot() }));
  for (let revision = 1; revision <= 20; revision++) {
    // First prove a completed re-read. Then hold all three replacement
    // bodies across the remaining commits, including a slow/paused host.
    // Twenty invalidations occupy 500 ms of the controlled four-second life,
    // inside the default watch's separate one-second retention episode.
    now += 25;
    if (revision === 2) holding = true;
    assert.equal((await peer.mutate({ kind: 'mutation', name: 'touchMember' }, { revision })).state, 'sent');
    await until(() => member.getSnapshot().data?.revision === revision && member.getSnapshot().fresh, 'member commit delivered');
    if (revision === 1) await until(() => hasPeer(plain.getSnapshot()) && plain.getSnapshot().fresh
      && kept.getSnapshot().fresh && !kept.getSnapshot().revalidating
      && bounded.getSnapshot().fresh && !bounded.getSnapshot().revalidating, 'first replacement delivered');
    if (revision === 2) await until(() => blocked === 3, 'all typing replies held before expiry');
  }
  assert.ok(keptReads.length > 0, 'commits actually re-read the kept watch');
  assert.ok(keptReads.every(({ read }) => hasPeer(read)), 'no publication hides typing during the burst');
  assert.ok(keptReads.some(({ read }) => read.revalidating === true), 'kept data marks revalidation');
  assert.ok(boundedReads.every(hasPeer), "ordinary ephemeral fallback honors default retention through the burst");
  assert.ok(boundedReads.some(read => read.revalidating === true));
  // Explicit false preserves immediate withdrawal.
  assert.ok(plainReads.some(read => 'loading' in read), 'keep:false invalidation publishes loading');
  assert.ok(plainReads.some(hasPeer), 'the default watch then publishes the peer again');
  t.diagnostic(`burst: ${plainReads.filter(read => 'loading' in read).length} default loading publications; ${keptReads.length} kept publications, all visible`);

  assert.equal((await peer.mutate({ kind: 'mutation', name: 'touchMember' }, { revision: 21 })).state, 'sent');
  await until(() => member.getSnapshot().data?.revision === 21 && member.getSnapshot().fresh, 'held re-read commit delivered');
  assert.ok(replies.filter(reply => reply.data?.length).every(reply => reply.nextExpiry === deadline),
    'member commits do not renew the server typing deadline');
  assert.ok(replies.slice(-3).every(reply => reply.nextExpiry === deadline && reply.data?.length === 1),
    'the held bodies contain the live peer and its original server deadline');
  now = deadline - 1;
  assert.ok(hasPeer(kept.getSnapshot()), 'keep spans the held replacement');
  now = deadline;
  assert.equal(hasPeer(kept.getSnapshot()), false, 'kept expiry withdraws at the server deadline without a replacement reply');
  const afterExpiry = keptReads.length;
  assert.ok(keptReads.every(({ at, read }) => hasPeer(read) || at >= deadline), 'no publication withdraws before the deadline');
  // Check the actual server at the ORIGINAL deadline too: member commits
  // must not extend the life. Advance only any remaining time, not a new
  // four seconds after the final member commit, which could mask a renewal.
  const status = await defaultFetch(url + '/dev/status');
  const serverNow = Number(status.headers.get('x-snapback-time'));
  await status.arrayBuffer();
  assert.ok(Number.isSafeInteger(serverNow) && serverNow > 0);
  if (serverNow < deadline) {
    const advanced = await defaultFetch(url + '/dev/clock/advance', { method: 'POST',
      body: JSON.stringify({ duration: `${deadline - serverNow}ms` }) });
    assert.equal(advanced.status, 200); await advanced.arrayBuffer();
  }
  const expired = await defaultFetch(url + '/q/typingIn', { method: 'POST',
    headers: { 'x-snapback-persona': 'bob' }, body: JSON.stringify({ args: { room: 'r' } }) });
  assert.deepEqual((await expired.json()).data, [], 'the server also expires typing at its original deadline');
  holding = false;
  release();
  await until(() => kept.getSnapshot().data?.length === 0 && kept.getSnapshot().fresh, 'empty answer after expiry');
  assert.ok(keptReads.slice(afterExpiry).every(({ read }) => !hasPeer(read)), 'late pre-expiry bodies never resurrect typing');
  t.diagnostic(`expiry: server deadline ${deadline}, visible at ${deadline - 1}, withdrawn at ${deadline}; 21 member commits, no renewal`);
});
