import { waitFor as awaitState } from './helpers/wait.mjs';
import { hangBudget } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { guest, logout } from '../dist/auth.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { server } from './helpers/app-server.mjs';
import { source, api, until } from './helpers/ephemeral-server.mjs';

const headers = { 'x-snapback-persona': 'bob' };
const deferred = () => Promise.withResolvers();

// Fix-round-2 differential probes, reproduced against the real server.
test('schema retries retire a known obsolete durable answer before adoption completes', { timeout: hangBudget(5) }, async t => {
  const text = source.replace('return notes first 100 by byId', 'return 1');
  const { url, dir } = await server(t, undefined, text, { watch: true });
  let fail = false, schemas = 0;
  const polls = [];
  const client = createClient({ url, persona: 'bob', waitSeconds: 1, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') {
      schemas++;
      if (fail) return Response.json({ denied: { code: 'E_BUSY', retryable: true } }, { status: 503 });
    }
    const response = await defaultFetch(input, init);
    if (path === '/changes') void response.clone().json().then(json => polls.push(json)).catch(() => {});
    return response;
  } });
  t.after(() => client.close());
  const watch = client.observe(api.list, {}); t.after(() => watch.close());
  await until(() => schemas === 1 && watch.getSnapshot().data === 1 && polls.some(poll => poll.generation === 1));
  const snapshots = [];
  watch.subscribe(() => snapshots.push(watch.getSnapshot()));
  fail = true;
  writeFileSync(join(dir, 'snapback/schema.q'), text.replace('return 1', 'return 2'));
  await until(() => polls.some(poll => poll.generation === 2) && schemas >= 2);
  const observed = watch.getSnapshot();
  assert.ok(!(observed.data === 1 && observed.fresh), 'known obsolete answer must be retired before schema recovery');
  assert.ok(snapshots.some(snapshot => snapshot.loading || snapshot.fresh === false), 'subscribers observe invalidation');
  await until(() => schemas >= 4 && watch.getSnapshot().data === 2, 'current durable answer during schema retries');
  assert.equal(watch.getSnapshot().fresh, false, 'polling is suspended until the new interests are known');
});

test('schema retries still deliver durable inserts during initial discovery', { timeout: hangBudget(5) }, async t => {
  const { url } = await server(t, undefined, source);
  let schemas = 0;
  const client = createClient({ url, persona: 'bob', waitSeconds: 1, fetch: async (input, init) => {
    if (new URL(input).pathname === '/schema') {
      schemas++;
      return Response.json({ denied: { code: 'E_BUSY', retryable: true } }, { status: 503 });
    }
    return defaultFetch(input, init);
  } });
  t.after(() => client.close());
  const watch = client.observe(api.list, {}); t.after(() => watch.close());
  await until(() => schemas >= 1 && watch.getSnapshot().data?.length === 0);
  const sent = await (await defaultFetch(`${url}/m/add`, {
    method: 'POST', headers: { 'x-snapback-persona': 'alice' },
    body: '{"id":"test-durable-update","args":{"body":"after-discovery"}}',
  })).json();
  assert.equal(sent.state, 'sent');
  await until(() => watch.getSnapshot().data?.[0]?.body === 'after-discovery', 'durable insert delivered while schema is unavailable');
  assert.ok(schemas >= 2, 'schema discovery is still retrying');
  assert.equal(watch.getSnapshot().fresh, false, 'suspended polling cannot claim freshness');
});

test('schema E_AUTH after revocation terminates discovery without retrying', { timeout: hangBudget(8) }, async t => {
  const { url } = await server(t, undefined, source);
  const signed = await guest(url, defaultFetch); assert.ok(signed.ok);
  const gate = deferred(); t.after(() => gate.resolve());
  let schemas = 0;
  const statuses = [];
  const client = createClient({ url, token: signed.session.token, waitSeconds: 1, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') { schemas++; await gate.promise; }
    // Keep other authenticated reads alive to prove /schema owns termination.
    if (path === '/q/list' && statuses.length) return Response.json({ data: [], complete: true, seq: 0, tables: ['notes'] });
    const response = await defaultFetch(input, init);
    if (path === '/schema') statuses.push(response.status);
    return response;
  } });
  t.after(() => client.close());
  const watch = client.observe(api.list, {}); t.after(() => watch.close());
  await until(() => schemas === 1 && watch.getSnapshot().data?.length === 0);
  await logout(url, signed.session.token, defaultFetch);
  gate.resolve();
  await until(() => statuses.length >= 1);
  await awaitState(() => client.link() === "signed-out" && watch.getSnapshot().denied, "schema refusal ends credentials");
  assert.equal(statuses[0], 401);
  assert.equal(client.link(), 'signed-out', 'schema refusal must end current credentials');
  assert.equal(watch.getSnapshot().denied?.code, 'E_AUTH');
  assert.equal(schemas, 1, 'a current-token E_AUTH is terminal');
});

test('schema E_AUTH from an obsolete bearer waits for rotation before retrying', async t => {
  const schema = deferred(), rotation = deferred(), entered = deferred(), polls = [];
  const bearers = [], snapshots = [];
  const session = token => ({ principal: 'user:bob', kind: 'user', token, expiresAt: Date.now() + 7 * 86400_000 });
  t.after(() => { schema.resolve(); rotation.resolve(); });
  const client = createClient({ url: 'http://capability.test', session: session('old'), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') {
      const bearer = new Headers(init.headers).get('authorization');
      bearers.push(bearer);
      if (bearer === 'Bearer old') {
        await schema.promise;
        return Response.json({ denied: { code: 'E_AUTH' } }, { status: 401 });
      }
      return Response.json(backend(1));
    }
    if (path === '/auth/refresh') {
      entered.resolve(); await rotation.promise;
      return Response.json({ session: session('next') });
    }
    if (path === '/changes') return holdPoll(polls, input, init);
    return Response.json({ data: 1, seq: 0, complete: true, tables: [] }, { headers: { 'X-Snapback-Ephemeral': '1' } });
  } });
  t.after(() => client.close());
  const watch = client.observe(api.list, {}); t.after(() => watch.close());
  watch.subscribe(() => snapshots.push(watch.getSnapshot()));
  await until(() => bearers.length === 1);
  const refreshing = client.refreshSession();
  await entered.promise;
  schema.resolve();
  await delay(650);
  assert.deepEqual(bearers, ['Bearer old'], 'an obsolete refusal waits for the successor bearer');
  rotation.resolve();
  assert.equal((await refreshing).ok, true);
  await until(() => watch.getSnapshot().fresh && polls.some(poll => !poll.signal.aborted && poll.params.get('ephTables') === 'typing'));
  assert.deepEqual(bearers, ['Bearer old', 'Bearer next']);
  assert.equal(client.link(), 'online');
  assert.equal(client.session().token, 'next');
  assert.ok(snapshots.every(snapshot => snapshot.denied?.code !== 'E_AUTH'), 'the successor never inherits the old refusal');
});

// Astra's differential: the query answers before the first schema request,
// adoption happens while discovery is held, and subsequent polls all report 2.
test('adoption during initial capability discovery invalidates a durable watch', async t => {
  const text = source.replace('return notes first 100 by byId', 'return 1');
  const { url, dir } = await server(t, undefined, text, { watch: true });
  const gate = deferred(), entered = deferred(), polls = [];
  t.after(() => gate.resolve());
  const client = createClient({ url, persona: 'bob', waitSeconds: 1, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') { entered.resolve(); await gate.promise; }
    const response = await defaultFetch(input, init);
    if (path === '/changes') void response.clone().json().then(json => polls.push(json)).catch(() => {});
    return response;
  } });
  t.after(() => client.close());
  const watch = client.observe(api.list, {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data === 1);
  await entered.promise;
  writeFileSync(join(dir, 'snapback/schema.q'), text.replace('return 1', 'return 2'));
  await until(async () => (await (await defaultFetch(`${url}/schema`, { headers })).json()).generation === 2);
  gate.resolve();
  await until(() => polls.filter(poll => poll.generation === 2).length >= 3, 'three generation-2 polls');
  const direct = await (await defaultFetch(`${url}/q/list`, { method: 'POST', headers, body: '{"args":{}}' })).json();
  assert.equal(direct.data, 2);
  assert.equal(watch.getSnapshot().data, direct.data, 'initial discovery must retire the generation-1 answer');
});

test('initial capability discovery retries one schema 503 and restores watch interests', async t => {
  const { url } = await server(t, undefined, source.replace('return notes first 100 by byId', 'return typing first 100 by byId'));
  let schemas = 0;
  const polls = [];
  const client = createClient({ url, persona: 'bob', fetch: async (input, init) => {
    const parsed = new URL(input);
    if (parsed.pathname === '/schema' && ++schemas === 1) return Response.json({ denied: { code: 'E_BUSY' } }, { status: 503 });
    if (parsed.pathname === '/changes') polls.push({ params: parsed.searchParams, signal: init.signal });
    return defaultFetch(input, init);
  } });
  t.after(() => client.close());
  const watch = client.observe(api.list, {}); t.after(() => watch.close());
  await until(() => schemas >= 2 && polls.some(p => !p.signal.aborted && p.params.get('ephi') && p.params.get('ephTables') === 'typing'), 'schema recovery before a long poll can delay discovery');
  await until(() => watch.getSnapshot().data?.length === 0);
  const result = await (await defaultFetch(`${url}/m/setTyping`, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: '{"args":{"room":"r"}}' })).json();
  assert.equal(result.state, 'sent');
  await until(() => watch.getSnapshot().data?.length === 1, 'healthy polls recover the missing schema facts');
  assert.equal(schemas, 2);
});

function backend(generation, table = 'typing') {
  return { generation, schema: { tables: { typing: { ephemeral: { life_ms: 4000 } }, viewing: { ephemeral: { life_ms: 4000 } } },
    operations: { list: { ephemeralReads: [table] } } }, programs: [] };
}

function holdPoll(polls, input, init) {
  return new Promise((resolve, reject) => {
    polls.push({ params: new URL(input).searchParams, signal: init.signal, resolve });
    if (init.signal.aborted) reject(Error('aborted'));
    else init.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  });
}

test('a poll generation fences stale schema facts until bounded retries catch up', async t => {
  let generation = 1, schemas = 0;
  const attempts = [], polls = [];
  const client = createClient({ url: 'http://capability.test', persona: 'bob', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') {
      attempts.push(performance.now());
      return Response.json(++schemas < 4 ? backend(1) : backend(2, 'viewing'));
    }
    if (path === '/changes') return holdPoll(polls, input, init);
    return Response.json({ data: generation, seq: 0, complete: true, tables: [] }, { headers: { 'X-Snapback-Ephemeral': '1' } });
  } });
  t.after(() => client.close());
  const watch = client.observe(api.list, {}); t.after(() => watch.close());
  await until(() => schemas === 1 && watch.getSnapshot().data === 1 && polls.some(p => !p.signal.aborted && p.params.get('ephTables') === 'typing'));
  const held = polls.findLast(p => !p.signal.aborted);
  generation = 2;
  held.resolve(Response.json({ generation: 2, seq: 0, tables: [] }));
  const before = polls.length;
  await until(() => polls.slice(before).some(p => !p.signal.aborted && p.params.get('ephTables') === 'viewing'), 'schema catches up without waiting for another poll');
  await until(() => watch.getSnapshot().data === 2);
  assert.equal(schemas, 4);
  assert.ok(polls.slice(before).every(p => p.params.get('ephTables') === 'viewing'), 'stale operation facts never start a new poll');
  assert.ok(attempts[2] - attempts[1] >= 15 && attempts[3] - attempts[2] >= 30, 'stale schema retries back off');
});

test('initial backend installation rejects a query already in flight', async t => {
  const schema = deferred(), oldQuery = deferred(), polls = [], published = [];
  let schemas = 0, queries = 0, current = false;
  t.after(() => { schema.resolve(); oldQuery.resolve(); });
  const client = createClient({ url: 'http://capability.test', persona: 'bob', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') { schemas++; await schema.promise; return Response.json(backend(2)); }
    if (path === '/changes') return holdPoll(polls, input, init);
    const value = current ? 2 : 1;
    if (++queries === 1) { await oldQuery.promise; }
    return Response.json({ data: value, seq: 0, complete: true, tables: [] }, { headers: { 'X-Snapback-Ephemeral': '1' } });
  } });
  t.after(() => client.close());
  const watch = client.observe(api.list, {}); t.after(() => watch.close());
  watch.subscribe(() => { if ('data' in watch.getSnapshot()) published.push(watch.getSnapshot().data); });
  await until(() => queries === 1, "the queued watch owns the held first request");
  // A second query advertises capability while the watch's first answer is held.
  await client.query(api.list, {});
  await until(() => schemas === 1);
  current = true; schema.resolve();
  await until(() => polls.some(p => !p.signal.aborted && p.params.get('ephTables') === 'typing'));
  oldQuery.resolve();
  await until(() => watch.getSnapshot().data === 2);
  assert.ok(!published.includes(1), 'the answer from before installation must never publish');
});
