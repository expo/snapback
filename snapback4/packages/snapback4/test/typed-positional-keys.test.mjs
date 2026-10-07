// @ref LLP 3000.013#2.2 — one compiled positional point on server and both devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { binary, server, until } from './helpers/app-server.mjs';

const source = `use personas alice
table conversations:
  slug: text <=80
  owner: principal
  label: text <=80
  unique slug
  unique owner
  public
  update <- allow
  sync public
query byId(x: id):
  return conversations[x]
query byRef(x: conversations):
  return conversations[x]
query bySlug(x: text <=80):
  return conversations[x]
query byOwner(x: principal):
  return conversations[x]
mutation rename(x: conversations, label: text <=80):
  update conversations[x] { label }
`;
const query = name => ({ kind: 'query', name });
for (const tier of ['wasm', 'native']) test(`typed positional keys: server and offline ${tier} keep both unique columns`, async t => {
  const { url, dir } = await server(t, undefined, source);
  // Cross values distinguish a wrong id/slug/owner selection from a lucky match.
  const rows = [{ id: 'a', slug: 'b', owner: 'dev:alice', label: 'A' }, { id: 'b', slug: 'a', owner: 'dev:bob', label: 'B' }];
  assert.equal((await (await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(rows.map(row => ({ table: 'conversations', row }))) })).json()).seeded, 2);
  const online = createClient({ url, persona: 'alice' }); t.after(() => online.close());
  const renamed = await online.mutate({ kind: 'mutation', name: 'rename' }, { x: 'a', label: 'server update' });
  assert.equal(renamed.state, 'sent');
  let offline = false, requests = 0;
  const device = tier === 'native' ? processDevice({ binary, dir: join(dir, 'device') }) : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
  const local = await createLocalClient({ url, persona: 'alice', device, fetch: (input, init) => {
    if (offline) { requests++; throw new TypeError('offline'); }
    return fetch(input, init);
  } }); t.after(() => local.close());
  await until(async () => (await local.query(query('byId'), { x: 'a' })).data?.id === 'a', 'public rows acquired');
  offline = true;
  for (const [name, x, id] of [['byId', 'a', 'a'], ['byRef', 'b', 'b'], ['bySlug', 'a', 'b'], ['byOwner', 'dev:alice', 'a'], ['bySlug', 'missing', null]]) {
    const expected = await online.query(query(name), { x });
    const actual = await local.query(query(name), { x });
    assert.equal(expected.data?.id ?? null, id);
    assert.deepEqual(actual.data, expected.data);
    assert.equal(actual.complete, true);
  }
  assert.equal(requests, 0, 'held keys execute on the device, including unique-key absence');
  await local.mutate({ kind: 'mutation', name: 'rename' }, { x: 'a', label: 'device update' }, { waitSeconds: 0 });
  const predicted = await local.query(query('byId'), { x: 'a' });
  assert.equal(predicted.data.label, 'device update');
  assert.equal((await local.query(query('bySlug'), { x: 'a' })).data.label, 'B');
});

const ambiguous = `table conversations:
  slug: text <=80
  alias: text <=80
  unique slug
  unique alias
  cap 100
  public
  update <- allow
  delete <- allow
  online only
`;
for (const body of [
  'query q(x: text <=80):\n  return conversations[x]',
  'query q(x: text <=80):\n  return conversations[x] first 20',
  "query q(x: text <=80):\n  return conversations[x] where .slug != 'hidden'",
  'query q(x: text <=80):\n  return (conversations[x])',
  'mutation m(x: text <=80):\n  update conversations[x] { alias: x }',
  'mutation m(x: text <=80):\n  delete conversations[x]',
  'table links:\n  slug: text <=80\n  read <- exists conversations[.slug]\n  online only',
]) test(`check --fix applies a verified named key: ${body.split('\n').find(line => /return|update|delete|read <-/.test(line))?.trim()}`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-pk-fix-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'snapback'));
  const path = join(dir, 'snapback/schema.q');
  writeFileSync(path, ambiguous + body + '\n');
  const before = spawnSync(binary, ['check'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(before.status, 0);
  assert.match(before.stderr + before.stdout, /E_QUARRY_POSITIONAL_SCAN/);
  const fixed = spawnSync(binary, ['check', '--fix'], { cwd: dir, encoding: 'utf8' });
  assert.equal(fixed.status, 0, fixed.stderr + fixed.stdout);
  const edited = readFileSync(path, 'utf8');
  assert.match(edited, /conversations\[(slug|alias) = /);
  for (const modifier of ['first 20', 'where']) assert.equal(edited.split(modifier).length, (ambiguous + body).split(modifier).length);
  assert.equal(spawnSync(binary, ['check'], { cwd: dir }).status, 0);
});
