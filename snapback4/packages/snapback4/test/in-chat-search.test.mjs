// @ref LLP 3000.007#18.1 — named unique order uses the existing words page on every host.
// @ref LLP 3000.028#3.3.1 — decorations never change the selected page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { binary, server } from './helpers/app-server.mjs';
import { parkedChanges } from './helpers/sync-control.mjs';
const op = name => ({ kind: 'query', name });
const source = `use personas alice, bob
 table conversations:
  title: text <=80
  read <- exists members[.id, viewer]
  sync to members[.id]
table members:
  conversation: conversations
  principal: principal
  unique conversation, principal
  read <- exists members[.conversation, viewer]
  sync to members[.conversation]
table profiles:
  principal: principal
  name: text <=80
  unique principal
  public
  sync public
table messages:
  conversation: conversations
  ordinal: int
  at: time
  sender: principal
  body: text <=100
  search body
  unique byConversationOrdinal: conversation, ordinal
  read <- exists members[.conversation, viewer]
  sync to members[.conversation]
query named(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 20 by byConversationOrdinal after c
query columns(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 20 by .ordinal after c
query decorated(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 20 by byConversationOrdinal after c { *, title: conversations[.conversation].title, name: profiles[principal = .sender].name }
query ascending(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q first 20 by byConversationOrdinal after c
`.replace(' table conversations:', 'table conversations:');

for (const tier of ['process', 'wasm']) test(`in-chat unique order: 10,000 messages, online and offline ${tier}`, { timeout: 240000 }, async t => {
  const { url, dir } = await server(t, '', source);
  const rows = [
    { table: 'conversations', row: { id: 'chat', title: 'Busy chat' } },
    { table: 'conversations', row: { id: 'hidden', title: 'Hidden' } },
    { table: 'members', row: { id: 'member', conversation: 'chat', principal: 'dev:alice' } },
    { table: 'members', row: { id: 'hidden-member', conversation: 'hidden', principal: 'dev:bob' } },
    { table: 'profiles', row: { id: 'profile', principal: 'dev:alice', name: 'Alice' } },
  ];
  const expected = [];
  for (let ordinal = 1; ordinal <= 10000; ordinal++) {
    const hit = ordinal % 37 === 0;
    const id = `m${String(10001 - ordinal).padStart(5, '0')}`;
    rows.push({ table: 'messages', row: { id, conversation: 'chat', ordinal, at: 10001 - ordinal,
      sender: ordinal % 2 ? 'dev:alice' : 'dev:missing', body: hit ? 'coffee coffers car' : 'ordinary' } });
    if (hit) expected.unshift(id);
  }
  rows.push({ table: 'messages', row: { id: 'secret', conversation: 'hidden', ordinal: 99999, at: 99999, sender: 'dev:bob', body: 'coffee car' } });
  for (let start = 0; start < rows.length; start += 200) {
    const batch = rows.slice(start, start + 200);
    const reply = await fetch(`${url}/seed`, { method: 'POST', body: JSON.stringify(batch) }).then(r => r.json());
    assert.equal(reply.seeded, batch.length, JSON.stringify(reply));
  }
  const online = createClient({ url, persona: 'alice' });
  let offline = false, core;
  const device = tier === 'process' ? processDevice({ binary, dir: join(dir, 'device') })
    : webDevice({ persist: memoryPersistence(), wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)) });
  const local = await createLocalClient({ url, persona: 'alice', device: { async open(...args) { core = await device.open(...args); return core; } }, fetch: async (input, init) => {
    if (offline) throw new TypeError('offline');
    if (new URL(input).pathname === '/changes') return parkedChanges(init.signal);
    return fetch(input, init);
  } });
  t.after(async () => { await local.close(); await online.close(); });
  await local.sync();
  const traverse = async (client, name, q, ascending = false) => {
    let c = null; const seen = [];
    for (let page = 0; page < 20; page++) {
      const read = await client.query(op(name), { conversation: 'chat', q, c });
      assert.ok(Array.isArray(read.data), JSON.stringify(read));
      assert.equal(read.complete, true, JSON.stringify(read));
      assert.equal(read.cut ?? null, null);
      seen.push(...read.data.map(row => row.id));
      if (name === 'decorated') {
        const bare = await client.query(op('named'), { conversation: 'chat', q, c });
        assert.deepEqual(read.data.map(row => row.id), bare.data.map(row => row.id));
        for (const key of ['complete', 'cut', 'next', 'fresh', 'since']) assert.deepEqual(read[key], bare[key], `decoration ${key}`);
      }
      if (name === 'decorated') for (const row of read.data) {
        assert.equal(row.title, 'Busy chat');
        assert.equal(row.name, row.sender === 'dev:alice' ? 'Alice' : null);
      }
      c = read.next;
      if (!c) break;
    }
    assert.ok(!c, 'traversal exhausted within 20 pages');
    assert.deepEqual(seen, ascending ? [...expected].reverse() : expected);
    assert.equal(new Set(seen).size, seen.length, 'no repeated source ID');
  };
  for (const client of [online, local]) {
    await traverse(client, 'named', 'cof car');
    await traverse(client, 'decorated', 'cof car');
  }
  offline = true; await local.sync();
  assert.equal(local.link(), 'offline');
  await traverse(local, 'named', 'cof car');
  await traverse(local, 'decorated', 'cof car');
  await traverse(local, 'ascending', 'cof car', true);
  // Same words-index cursor, including empty-needle browse and no-match pages.
  for (const q of ['cof car', '', 'absent', 'ordinary unicorn']) {
    const args = { conversation: 'chat', q };
    const named = await core.call({ op: 'query', name: 'named', viewer: 'dev:alice', args, now: Date.now(), search: true });
    const columns = await core.call({ op: 'query', name: 'columns', viewer: 'dev:alice', args, now: Date.now(), search: true });
    for (const key of ['data', 'next', 'complete', 'cut']) assert.deepEqual(named.ok[key], columns.ok[key], `${q}: ${key}`);
    // Operation/site strings have different heap prices; scan work is identical.
    for (const key of ['examined', 'index_entries', 'steps', 'output_bytes']) assert.equal(named.ok.metered[key], columns.ok.metered[key], `${q}: ${key}`);
    if (q === 'ordinary unicorn') {
      assert.equal(named.ok.complete, false); assert.equal(named.ok.cut, 'meter'); assert.equal(named.ok.next ?? null, null);
      const used = named.ok.metered;
      assert.ok(used.examined > 8192 || used.heap_bytes > 16 * 1024 * 1024, JSON.stringify(used));
      t.diagnostic(`${tier}: cut at examined=${used.examined}, heap=${used.heap_bytes}`);
      const raw = await fetch(`${url}/q/named`, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify({ args }) }).then(r => r.json());
      t.diagnostic(`server meter cut: ${JSON.stringify(raw.meter)}`);
      assert.equal(raw.complete, false); assert.equal(raw.meter.cut, 'meter'); assert.equal(raw.loading, true); assert.equal(raw.next ?? null, null);
      const remote = await online.query(op('named'), args);
      assert.equal(remote.denied?.code, 'E_QUERY_RETRY', JSON.stringify(remote));
      const equivalent = await online.query(op('columns'), args);
      assert.equal(equivalent.denied?.code, remote.denied.code);
    }
    if (named.ok.next) {
      const page = await core.call({ op: 'query', name: 'named', viewer: 'dev:alice', args: { ...args, c: columns.ok.next }, now: Date.now() });
      assert.ok(!page.denied, JSON.stringify(page));
      assert.ok(!page.ok.data.some(row => named.ok.data.some(old => old.id === row.id)), 'cursor has no repeated row');
    }
  }
  for (const client of [online, local]) {
    const read = await client.query(op('named'), { conversation: 'hidden', q: 'cof' });
    assert.deepEqual(read.data, []);
  }
  t.diagnostic(`${tier}: 10000 chat rows, ${expected.length} hits; descending/ascending, decorations, empty browse, hidden scope, default meter cut`);
});

const compositeRoot = new URL('../../../crates/snapback4-device/tests/matching_order/', import.meta.url);
const compositeSource = readFileSync(new URL('composite.q', compositeRoot), 'utf8');
const compositeFixture = JSON.parse(readFileSync(new URL('composite.json', compositeRoot), 'utf8'));

for (const tier of ['process', 'wasm']) test(`in-chat composite order: tied buckets and suffix pin ${tier}`, { timeout: 60000 }, async t => {
  const { url, dir } = await server(t, '', compositeSource);
  const rows = [
    { table: 'conversations', row: { id: 'chat' } },
    { table: 'conversations', row: { id: 'hidden' } },
    { table: 'members', row: { id: 'member', conversation: 'chat', principal: 'dev:alice' } },
    { table: 'members', row: { id: 'hidden-member', conversation: 'hidden', principal: 'dev:bob' } },
    ...compositeFixture.messages.map(row => ({ table: 'messages', row })),
  ];
  const seeded = await fetch(`${url}/seed`, { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json());
  assert.equal(seeded.seeded, rows.length, JSON.stringify(seeded));
  const online = createClient({ url, persona: 'alice' });
  let offline = false;
  const device = tier === 'process' ? processDevice({ binary, dir: join(dir, 'device') })
    : webDevice({ persist: memoryPersistence(), wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)) });
  const local = await createLocalClient({ url, persona: 'alice', device, fetch: async (input, init) => {
    if (offline) throw new TypeError('offline');
    if (new URL(input).pathname === '/changes') return parkedChanges(init.signal);
    return fetch(input, init);
  } });
  t.after(async () => { await local.close(); await online.close(); });
  await local.sync();
  offline = true; await local.sync();
  assert.equal(local.link(), 'offline');
  for (const { query, control, needle: q, pages } of compositeFixture.cases) {
    let c = null; const seen = [];
    for (const expected of pages) {
      const args = { conversation: 'chat', q, c };
      const remote = await online.query(op(query), args);
      const held = await local.query(op(query), args);
      for (const [host, page] of [[tier, held], ['server', remote]]) {
        assert.deepEqual(page.data?.map(row => row.id), expected, `${host} ${query} ${q}`);
        assert.equal(page.complete, true, JSON.stringify(page));
        assert.equal(page.cut ?? null, null);
      }
      assert.equal(held.next, remote.next, 'server and device cursors interchange');
      if (control) for (const [client, page] of [[online, remote], [local, held]]) {
        const equivalent = await client.query(op(control), args);
        for (const key of ['data', 'next', 'complete', 'cut']) assert.deepEqual(equivalent[key], page[key], `${query}/${control}: ${key}`);
      }
      seen.push(...held.data.map(row => row.id));
      c = held.next;
      if (seen.length < pages.flat().length) assert.ok(c, 'continuation across tied buckets');
    }
    assert.equal(new Set(seen).size, seen.length, 'no repeated hit');
    if (c) for (const client of [online, local]) {
      const end = await client.query(op(query), { conversation: 'chat', q, c });
      assert.deepEqual(end.data, []);
      assert.equal(end.complete, true);
      assert.equal(end.cut ?? null, null);
      assert.equal(end.next ?? null, null);
    }
  }
  for (const client of [online, local]) {
    const hidden = await client.query(op('named'), { conversation: 'hidden', q: 'cof car' });
    assert.deepEqual(hidden.data, []);
  }
});
