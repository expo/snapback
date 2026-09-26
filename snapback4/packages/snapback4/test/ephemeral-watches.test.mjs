import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { ephemeralServer, device, api, until } from './helpers/ephemeral-server.mjs';

async function open(t, tier, url, fetch) {
  const client = tier === 'online' ? createClient({ url, persona: 'bob', fetch })
    : await createLocalClient({ url, persona: 'bob', fetch, device: device() });
  t.after(() => client.close());
  if (client.sync) await client.sync();
  return client;
}
const watch = (t, client, op, args = {}) => { const value = client.observe(op, args); t.after(() => value.close()); return value; };
const ready = value => 'data' in value.getSnapshot();
for (const lingering of [false, true]) test(`online keep: 1.15 s replies publish on the incomplete 1 s cadence (${lingering ? 'lingering' : 'active'})`, async t => {
  const { url } = await ephemeralServer(t);
  let slow = false, replies = 0, discovered = false;
  const queried = [];
  const fetch = async (input, init) => {
    const parsed = new URL(input), path = parsed.pathname;
    if (path === '/changes' && parsed.searchParams.get('ephi')) discovered = true;
    const response = await defaultFetch(input, init);
    if (path !== '/q/typingIn') return response;
    const json = await response.json();
    if (!slow) return Response.json({ ...json, data: [], complete: false, nextExpiry: null });
    const began = performance.now();
    queried.push(began);
    await delay(1150);
    replies++;
    return Response.json({ ...json, data: [{ principal: 'dev:alice' }], complete: true, nextExpiry: null });
  };
  const client = await open(t, 'online', url, fetch);
  // Finish capability discovery before starting the cadence being measured.
  const warm = watch(t, client, api.list);
  await until(() => discovered && warm.getSnapshot().fresh === true);
  const typing = client.observe(api.typingIn, { room: 'r' }, { keep: true });
  await until(() => ready(typing) && typing.getSnapshot().fresh === true);
  assert.equal(typing.getSnapshot().complete, false);
  const notifications = [];
  if (lingering) typing.close();
  else typing.subscribe(() => notifications.push(typing.getSnapshot()));
  slow = true;
  await until(() => typing.getSnapshot().complete === true || replies >= 3, 'slow replacement replies');
  assert.deepEqual(typing.getSnapshot().data, [{ principal: 'dev:alice' }], 'periodic refresh must not discard successful slow replies');
  assert.equal(typing.getSnapshot().complete, true);
  assert.ok(queried.length > 0);
  assert.ok(notifications.every(read => !('loading' in read)), 'the kept answer stays during refresh');
  if (lingering) {
    const calls = queried.length;
    const joined = client.observe(api.typingIn, { room: 'r' }, { keep: true });
    assert.equal(joined.getSnapshot().complete, true, 'remount joins the complete replacement');
    assert.equal(queried.length, calls, 'joining does not add a read');
  }
});

for (const tier of ['online', 'wasm']) {
  test(`${tier}: mounting interest reissues a held poll, invalidates without sync, and refetches at expiry`, async t => {
    const { url } = await ephemeralServer(t), polls = [];
    let syncs = 0;
    const fetch = async (input, init) => {
      const parsed = new URL(input);
      const poll = parsed.pathname === '/changes' ? { params: parsed.searchParams, signal: init.signal } : null;
      if (poll) polls.push(poll);
      if (parsed.pathname === '/sync') syncs++;
      const response = await defaultFetch(input, init);
      if (poll) { poll.answer = await response.clone().json(); poll.at = performance.now(); }
      return response;
    };
    const b = await open(t, tier, url, fetch);
    const list = watch(t, b, api.list); await until(() => ready(list));
    await until(() => polls.some(p => p.params.get('ephi') && p.params.get('ephTables') === '' && !p.signal.aborted));
    const held = polls.findLast(p => !p.signal.aborted);
    const typing = watch(t, b, api.typingIn, { room: 'r' });
    await until(() => ready(typing));
    await until(() => polls.some(p => p.params.get('ephTables') === 'typing'));
    assert.equal(held.signal.aborted, true);
    await until(() => polls.some(p => !p.answer && !p.signal.aborted && p.params.get('ephi') && p.params.get('ephTables') === 'typing'));
    await delay(150); // No startup query or incarnation-reset response can deliver the following write.
    const count = syncs;
    const a = createClient({ url, persona: 'alice' }); t.after(() => a.close());
    let published;
    t.after(typing.subscribe(() => {
      if (published === undefined && typing.getSnapshot().data?.length === 1) published = performance.now();
    }));
    const began = performance.now();
    const result = await a.mutate(api.setTyping, { room: 'r' });
    const replied = performance.now();
    assert.equal(result.state, 'sent');
    await until(() => published !== undefined, 'peer typing');
    // The old clock included the mutation round trip and until()'s polling
    // delay. Time the publication itself after the write's reply instead;
    // the held poll may deliver it even before that reply reaches the writer.
    const deliveryMs = Math.max(0, published - replied);
    t.diagnostic(`mutation reply ${(replied - began).toFixed(1)} ms; publication after reply ${(published - replied).toFixed(1)} ms; old elapsed ${(performance.now() - began).toFixed(1)} ms`);
    assert.ok(deliveryMs <= 500, `notification delivery ${deliveryMs} ms (must precede the 1 s refresh)`);
    const delivery = polls.findLast(p => p.answer && p.at >= began && p.at <= published);
    assert.ok(delivery?.answer.ephemeral.tables.includes('typing'), 'typing arrives through a poll notification');
    assert.equal(delivery.answer.seq, Number(delivery.params.get('since')));
    assert.equal(syncs, count, 'ephemeral wake does not sync');
    await until(() => typing.getSnapshot().data?.length === 0, 'nextExpiry fetch');
    assert.equal(syncs, count, 'silent expiry does not sync');
  });

  test(`${tier}: incomplete ephemeral answers refresh on a fixed 1 s cadence without a change`, async t => {
    const { url } = await ephemeralServer(t), queried = [];
    let syncs = 0, discovered = false;
    const fetch = async (input, init) => {
      const parsed = new URL(input), path = parsed.pathname;
      if (path === '/changes' && parsed.searchParams.get('ephi')) discovered = true;
      if (path === '/sync') syncs++;
      // Cadence schedules requests, not response-body delivery. A slow body
      // followed by a prompt one can arrive only milliseconds apart.
      const query = path === '/q/typingIn' ? { at: performance.now(), reachable: queried.length >= 3 } : null;
      if (query) queried.push(query);
      const response = await defaultFetch(input, init);
      if (!query) return response;
      const json = await response.json();
      if (query === queried[1]) await delay(900);
      Object.assign(query, { arrived: performance.now(), version: json.ephemeral, seq: json.seq });
      // Model an authorization-cut prefix whose hidden rows are silently
      // reclaimed before the fourth request; neither notification counter nor
      // nextExpiry changes. Capture this at dispatch so the test runner need
      // not toggle it in the short window between the delayed reply and a tick.
      return Response.json({ ...json, complete: query.reachable, data: query.reachable ? [{ principal: 'dev:alice' }] : [], nextExpiry: null });
    };
    const b = await open(t, tier, url, fetch);
    // Incarnation/schema discovery can also reissue a query; finish it before
    // measuring the periodic refresh in the absence of changes.
    const warm = watch(t, b, api.list);
    await until(() => discovered && warm.getSnapshot().fresh === true, 'capability discovery');
    const typing = watch(t, b, api.typingIn, { room: 'r' });
    await until(() => ready(typing)); const count = syncs;
    await until(() => queried[1]?.arrived !== undefined, 'first incomplete refresh');
    await until(() => typing.getSnapshot().data?.length === 1, 'reachable row after silent reclamation');
    const last = queried[3];
    // The delayed call serializes its successor even with a broken fast timer.
    // Measure the following pair of prompt requests to retain both bounds.
    const cadence = last.at - queried[2].at;
    assert.ok(cadence >= 850 && cadence <= 1250, `cadence ${cadence}`);
    t.diagnostic(`request cadence ${cadence.toFixed(1)} ms; delayed response gap ${(queried[2].arrived - queried[1].arrived).toFixed(1)} ms`);
    assert.ok(queried.every(q => q.seq === last.seq && q.version.epoch === last.version.epoch));
    const calls = queried.length; await delay(1100); assert.equal(queried.length, calls, 'complete stops the cadence');
    assert.equal(syncs, count);
  });
}
