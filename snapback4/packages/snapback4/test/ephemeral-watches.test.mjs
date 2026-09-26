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
      if (poll) void response.clone().json().then(answer => { poll.answer = answer; poll.at = performance.now(); }).catch(() => {});
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
    const began = performance.now(); assert.equal((await a.mutate(api.setTyping, { room: 'r' })).state, 'sent');
    await until(() => typing.getSnapshot().data?.length === 1, 'peer typing');
    assert.ok(performance.now() - began <= 500, `${performance.now() - began} ms`);
    const delivery = polls.findLast(p => p.answer && p.at >= began);
    assert.ok(delivery?.answer.ephemeral.tables.includes('typing'), 'typing arrives through a poll notification');
    assert.equal(delivery.answer.seq, Number(delivery.params.get('since')));
    assert.equal(syncs, count, 'ephemeral wake does not sync');
    await until(() => typing.getSnapshot().data?.length === 0, 'nextExpiry fetch');
    assert.equal(syncs, count, 'silent expiry does not sync');
  });

  test(`${tier}: incomplete ephemeral answers refresh on a fixed 1 s cadence without a change`, async t => {
    const { url } = await ephemeralServer(t), queried = [];
    let reachable = false, syncs = 0;
    const fetch = async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/sync') syncs++;
      const response = await defaultFetch(input, init);
      if (path !== '/q/typingIn') return response;
      const json = await response.json();
      queried.push({ at: performance.now(), version: json.ephemeral, seq: json.seq });
      // Model an authorization-cut prefix whose hidden rows are silently
      // reclaimed; neither notification counter nor nextExpiry changes.
      return Response.json({ ...json, complete: reachable, data: reachable ? [{ principal: 'dev:alice' }] : [], nextExpiry: null });
    };
    const b = await open(t, tier, url, fetch), typing = watch(t, b, api.typingIn, { room: 'r' });
    await until(() => ready(typing)); const count = syncs;
    await until(() => queried.length >= 2, 'first incomplete refresh');
    const first = queried.at(-1).at;
    reachable = true;
    await until(() => typing.getSnapshot().data?.length === 1, 'reachable row after silent reclamation');
    const last = queried.at(-1);
    assert.ok(last.at - first >= 850 && last.at - first <= 1250, `cadence ${last.at - first}`);
    assert.ok(queried.every(q => q.seq === last.seq && q.version.epoch === last.version.epoch));
    const calls = queried.length; await delay(1100); assert.equal(queried.length, calls, 'complete stops the cadence');
    assert.equal(syncs, count);
  });
}
