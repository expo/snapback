import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '../dist/client.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { server } from './helpers/app-server.mjs';
import { source, api, until } from './helpers/ephemeral-server.mjs';

const headers = { 'x-snapback-persona': 'bob' };
const deferred = () => Promise.withResolvers();

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
  // A second query advertises capability while the watch's first answer is held.
  await client.query(api.list, {});
  await until(() => schemas === 1);
  current = true; schema.resolve();
  await until(() => polls.some(p => !p.signal.aborted && p.params.get('ephTables') === 'typing'));
  oldQuery.resolve();
  await until(() => watch.getSnapshot().data === 2);
  assert.ok(!published.includes(1), 'the answer from before installation must never publish');
});
