import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { server } from './helpers/app-server.mjs';
import { source, device, api, until } from './helpers/ephemeral-server.mjs';

const durable = source.split('table typing:')[0];
const viewing = source.slice(source.indexOf('table typing:'), source.indexOf('table durableTyping:'))
  .replaceAll('typing', 'viewing').replaceAll('Typing', 'Viewing');
const headers = { 'x-snapback-persona': 'bob' };
const edit = (dir, text) => writeFileSync(join(dir, 'snapback/schema.q'), text);

test('durable-only dev adoption answers a held legacy poll with the new generation within 500 ms', async t => {
  const { url, dir } = await server(t, undefined, durable, { watch: true });
  const controller = new AbortController(); t.after(() => controller.abort());
  // The first whitespace heartbeat proves that this request is held at the server.
  const response = await defaultFetch(`${url}/changes?since=0&wait=8&heartbeat=1`, { headers, signal: controller.signal });
  const began = performance.now();
  edit(dir, `${durable}\nquery added():\n  return 1\n`);
  const answer = await response.json();
  const elapsed = performance.now() - began;
  assert.equal(answer.generation, 2, JSON.stringify(answer));
  assert.ok(elapsed < 500, `${elapsed} ms`);
  assert.equal(answer.ephemeral, undefined);
});

for (const tier of ['online', 'wasm']) {
  test(`${tier}: durable-only changes retain base wire bytes plus change evidence`, async t => {
    const { url } = await server(t, undefined, durable), requests = [], replies = [];
    let schemas = 0;
    const fetch = async (input, init) => {
      const parsed = new URL(input);
      if (parsed.pathname === '/schema') schemas++;
      if (parsed.pathname !== '/changes') return defaultFetch(input, init);
      requests.push(parsed);
      const response = await defaultFetch(input, init);
      const copy = response.clone();
      void copy.text().then(text => replies.push(text.trim())).catch(() => {});
      return response;
    };
    const client = tier === 'online' ? createClient({ url, persona: 'bob', fetch, waitSeconds: 1 })
      : await createLocalClient({ url, persona: 'bob', fetch, waitSeconds: 1, device: device() });
    t.after(() => client.close());
    if (client.sync) await client.sync();
    const list = client.observe(api.list, {}); t.after(() => list.close());
    await until(() => replies.length >= 2, 'two ordinary poll completions');
    if (tier === 'online') assert.equal(schemas, 0, 'durable online clients need no additional schema request');
    // Frozen from 0badac987 changes.ts / serve_changes.rs. Runtime identity and
    // clock values are substituted, while parameter order and JSON bytes bind.
    for (const request of requests) {
      const id = request.searchParams.get('store_id');
      assert.equal(request.pathname + request.search, `/changes?since=0&wait=1&heartbeat=1${id === null ? '' : `&store_id=${encodeURIComponent(id)}`}`);
    }
    for (const reply of replies) {
      const json = JSON.parse(reply);
      // RV preservation and SN complete-interval evidence add no ephemeral wire.
      assert.deepEqual(json.preserved, ['notes']);
      assert.equal(reply, JSON.stringify({ changes: { after: 0, through: 0, writes: {} }, clockRevision: json.clockRevision, generation: 1, preserved: ['notes'], seq: 0,
        serverNow: json.serverNow, store_id: json.store_id, tables: [] }));
    }
  });

  test(`${tier}: adoption replaces mounted ephemeral interests, including removal`, async t => {
    const original = source + viewing;
    const { url, dir } = await server(t, undefined, original, { watch: true });
    const polls = [];
    const fetch = (input, init) => {
      const parsed = new URL(input);
      if (parsed.pathname === '/changes') polls.push({ params: parsed.searchParams, signal: init.signal });
      return defaultFetch(input, init);
    };
    const client = tier === 'online' ? createClient({ url, persona: 'bob', fetch })
      : await createLocalClient({ url, persona: 'bob', fetch, device: device() });
    t.after(() => client.close());
    if (client.sync) await client.sync();
    const watch = client.observe(api.typingIn, { room: 'r' }); t.after(() => watch.close());
    await until(() => watch.getSnapshot().data?.length === 0);
    await until(() => polls.some(p => p.params.get('ephi') && p.params.get('ephTables') === 'typing' && !p.signal.aborted));
    const old = polls.findLast(p => !p.signal.aborted);
    edit(dir, original.replace('return typing where', 'return viewing where'));
    await until(() => polls.some(p => p.params.get('ephi') && p.params.get('ephTables') === 'viewing' && !p.signal.aborted), 'adopted viewing interest');
    assert.equal(old.signal.aborted, true);
    await until(() => watch.getSnapshot().data?.length === 0);
    await delay(150);
    const began = performance.now();
    const sent = await (await defaultFetch(`${url}/m/setViewing`, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify({ args: { room: 'r' } }) })).json();
    assert.equal(sent.state, 'sent', JSON.stringify(sent));
    await until(() => watch.getSnapshot().data?.length === 1, 'viewing write without remount');
    assert.ok(performance.now() - began <= 500);
    edit(dir, `${durable}\nquery typingIn(room: text <=40):\n  return notes first 100 by byId\n`);
    await until(() => polls.some(p => !p.signal.aborted && !p.params.has('ephTables')), 'removal returns to durable wire');
    await until(() => watch.getSnapshot().data?.length === 0, 'same watch after removal');
  });
}

test('a self-invalidating guard is sent twice and returns its second refusal', async t => {
  const text = `use personas alice
table signals:
  owner: principal
  n: int
  unique owner
  read <- allow
  insert <- .owner = viewer
  update <- .owner = viewer
  ephemeral 4s
mutation reset():
  upsert signals[owner = viewer] { n: 0 }
mutation change(n: int):
  old = signals[owner = viewer] ! else MISSING
  require old.n = 0 else ALREADY_CHANGED
  update signals[owner = viewer] { n }
`;
  const { url } = await server(t, undefined, text);
  const backend = await (await defaultFetch(`${url}/schema`, { headers: { 'x-snapback-persona': 'alice' } })).json();
  const op = { kind: 'mutation', name: 'change', ...backend.schema.operations.change };
  assert.equal(op.renews, undefined, 'generated facts refuse renewal certification');
  let calls = 0;
  const client = createClient({ url, persona: 'alice', fetch: (input, init) => {
    if (new URL(input).pathname === '/m/change') calls++;
    return defaultFetch(input, init);
  } });
  t.after(() => client.close());
  await client.mutate({ kind: 'mutation', name: 'reset', ...backend.schema.operations.reset }, {});
  assert.equal((await client.mutate(op, { n: 1 })).state, 'sent');
  const second = await client.mutate(op, { n: 1 });
  assert.equal(second.state, 'failed');
  assert.equal(second.why.code, 'ALREADY_CHANGED');
  assert.equal(calls, 2);
});

for (const tier of ['online', 'wasm']) test(`${tier}: a durable mounted watch discovers ephemeral capability on adoption`, async t => {
  const { url, dir } = await server(t, undefined, durable, { watch: true });
  const polls = [];
  const fetch = (input, init) => {
    const parsed = new URL(input);
    if (parsed.pathname === '/changes') polls.push({ params: parsed.searchParams, signal: init.signal });
    return defaultFetch(input, init);
  };
  const client = tier === 'online' ? createClient({ url, persona: 'bob', fetch })
    : await createLocalClient({ url, persona: 'bob', fetch, device: device() });
  t.after(() => client.close());
  if (client.sync) await client.sync();
  const watch = client.observe(api.list, {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data?.length === 0);
  await until(() => polls.some(p => !p.params.has('ephTables')));
  edit(dir, source.replace('return notes first 100 by byId', 'return typing first 100 by byId'));
  await until(() => polls.some(p => !p.signal.aborted && p.params.get('ephi') && p.params.get('ephTables') === 'typing'), 'new capability and interest');
  await until(() => watch.getSnapshot().data?.length === 0);
  await delay(150);
  await defaultFetch(`${url}/m/setTyping`, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify({ args: { room: 'r' } }) });
  await until(() => watch.getSnapshot().data?.length === 1, 'newly ephemeral watch');
});

test('online capability discovery cannot swallow a generation invalidation for durable watches', async t => {
  let generation = 1, changes = 0, release;
  const changed = new Promise(resolve => { release = resolve; });
  const client = createClient({ url: 'http://capability.test', persona: 'bob', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') return Response.json({ generation: 2, schema: {
      tables: { typing: { ephemeral: { life_ms: 4000 } }, notes: {} }, operations: { list: {} },
    }, programs: [] });
    if (path === '/changes') {
      const n = ++changes;
      if (n === 2) await changed;
      if (n > 3) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true }));
      return Response.json({ seq: 0, generation, tables: [] }, n === 2 ? { headers: { 'X-Snapback-Ephemeral': '1' } } : undefined);
    }
    return Response.json({ data: [generation], seq: 0, complete: true, tables: ['notes'] });
  } });
  t.after(async () => { release(); await client.close(); });
  const watch = client.observe(api.list, {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data?.[0] === 1 && changes === 2);
  generation = 2; release();
  await until(() => watch.getSnapshot().data?.[0] === 2, 'generation invalidates the durable watch after capability discovery');
});
