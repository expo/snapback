// @ref LLP 3000.029#9 — footprints are an input to the disclosure proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { operationTables } from '../dist/backend.js';
import { outstandingPredictions } from '../dist/read-nonrevoking.js';
import { profileSchema, profileRows } from './helpers/retention-profile.mjs';
import { server, until, binary } from './helpers/app-server.mjs';
const q = name => ({ name, kind: 'query' });
const gate = () => Promise.withResolvers();
const source = `use personas alice, bob
table roots:
  owner: principal
  immutable owner
  read <- .owner = viewer
  delete <- allow
  sync
table docs:
  root: roots
  immutable root
  read through .root
  delete <- allow
  sync
table children:
  doc: docs
  amount: int
  immutable doc
  read through .doc
  delete <- allow
  sync
table amounts:
  owner: principal
  amount: int
  read <- .owner = viewer
  delete <- allow
  sync
view totals: sum amounts of amount by .owner
table entries:
  total: sum likes of amount by entry
  read <- allow
  sync public
table likes:
  entry: entries
  owner: principal
  amount: int
  read <- .owner = viewer
  delete <- allow
  sync
query entry():
  return entries['E']
query newEntry():
  return entries['E']
query like():
  flag = remote['flag']
  return likes['L']
mutation eraseLike():
  delete likes['L']
table remote:
  read <- allow
  online only
query root():
  flag = remote['flag']
  return roots['R']
query amount():
  flag = remote['flag']
  return amounts['A']
query child():
  return children['C']
query newChild():
  return children['C']
query byIndex():
  return children where .doc = 'D' first 20 by .id
fn getChild(): children['C']
fn wrappedChild(): getChild()
query helper():
  return wrappedChild()
query joined():
  return children where .doc = 'D' first 20 by .id { id, parent: docs[.doc] }
query conditional(yes: bool):
  return getChild() if yes else null
query total():
  return totals[viewer]
query newTotal():
  return totals[viewer]
mutation eraseTree():
  delete children['C']
  delete docs['D']
  delete roots['R']
mutation eraseAmount():
  delete amounts['A']
`;
const rows = [
  { table: 'roots', row: { id: 'R', owner: 'dev:bob' } },
  { table: 'docs', row: { id: 'D', root: 'R' } },
  { table: 'children', row: { id: 'C', doc: 'D', amount: 42 } },
  { table: 'amounts', row: { id: 'A', owner: 'dev:bob', amount: 42 } },
  { table: 'entries', row: { id: 'E' } },
  { table: 'likes', row: { id: 'L', entry: 'E', owner: 'dev:bob', amount: 42 } },
  { table: 'remote', row: { id: 'flag' } },
];
async function fixture(t, text = source, seed = rows) {
  const f = await server(t, undefined, text);
  f.post = (path, body, persona = 'bob') => fetch(f.url + path, { method: 'POST', headers: { 'x-snapback-persona': persona }, body: JSON.stringify(body) }).then(r => r.json());
  assert.equal((await f.post('/seed', seed)).seeded, seed.length);
  return f;
}
function parked(input, init) {
  if (new URL(input).pathname !== '/changes') return fetch(input, init);
  return new Promise((_, reject) => {
    const abort = () => reject(Error('closed'));
    if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
  });
}
const deviceFor = (tier, dir) => tier === 'process' ? processDevice({ dir: join(dir, 'device'), binary })
  : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
for (const tier of ['online', 'process', 'wasm']) for (const kind of ['tree', 'sum', 'column']) {
  test(`round 3 ${tier}: ${kind} evidence withdraws dependent observations and fences new reads`, { timeout: 20000 }, async t => {
    const f = await fixture(t), release = gate(); let held = false;
    const names = kind === 'tree' ? ['child', 'helper', 'byIndex', 'joined'] : [kind === 'column' ? 'entry' : 'total'];
    const value = read => kind === 'tree' ? read.data?.id : kind === 'column' ? read.data?.total : read.data;
    const opts = { url: f.url, persona: 'bob', fetch: (input, init) => {
      const path = new URL(input).pathname;
      if (held && (path === '/sync' || names.some(n => path === '/q/' + n))) return release.promise.then(() => parked(input, init));
      return parked(input, init);
    } };
    const client = tier === 'online' ? createClient(opts) : await createLocalClient({ ...opts, device: deviceFor(tier, f.dir) });
    const watches = names.map(name => client.observe(q(name), {})); watches.forEach(w => w.subscribe(() => {}));
    t.after(async () => { held = false; release.resolve(); watches.forEach(w => w.close()); await client.close(); });
    if (tier !== 'online') await client.sync();
    await until(() => watches.every(w => 'data' in w.getSnapshot()), 'all initial reads');
    assert.equal(value(watches[0].getSnapshot()), kind === 'tree' ? 'C' : 42);
    held = true;
    assert.equal((await f.post('/m/' + (kind === 'tree' ? 'eraseTree' : kind === 'column' ? 'eraseLike' : 'eraseAmount'), { id: 'erase', args: {} })).state, 'sent');
    assert.equal((await client.query(q(kind === 'tree' ? 'root' : kind === 'column' ? 'like' : 'amount'), {})).data, null);
    for (const [i, watch] of watches.entries()) assert.equal(watch.getSnapshot().loading, true, names[i] + ' must withdraw before sync');
    if (tier !== 'online') {
      const fresh = await client.query(q(kind === 'tree' ? 'newChild' : kind === 'column' ? 'newEntry' : 'newTotal'), {});
      assert.notEqual(value(fresh), kind === 'tree' ? 'C' : 42, 'new read cannot use pre-evidence replica');
    }
    held = false; release.resolve(); if (tier !== 'online') await client.sync();
    await until(() => kind === 'tree' ? watches[0].getSnapshot().data === null : value(watches[0].getSnapshot()) === 0, 'recovers after apply');
  });
}

// Independent reference graph: build edges once from compiled declarations,
// then compute reachability for each compiled query. No production walkers,
// footprint functions, output metadata or executed branches feed the oracle.
function expectedFootprints(backend) {
  const tableFields = value => {
    const found = new Set(), visit = node => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.table === 'string') found.add(node.table);
      Object.values(node).forEach(visit);
    }; visit(value); return found;
  };
  const edges = new Map(Object.entries(backend.schema.tables).map(([name, table]) => {
    const next = tableFields(table.rules?.read);
    if (table.through) next.add(table.through.parent);
    return [name, next];
  }));
  for (const m of backend.schema.maintains ?? []) {
    const next = edges.get(m.target); next.add(m.source);
    if (m.row_key) next.add(m.row_key.table);
    if (m.parent_key) next.add(m.parent_key.parent);
  }
  return backend.programs.filter(p => p.kind === 'Query').map(program => {
    let reachable = tableFields(program.body), previous;
    do { previous = reachable.size; reachable = new Set([...reachable].flatMap(n => [n, ...edges.get(n) ?? []])); } while (previous !== reachable.size);
    return { program, expected: [...reachable].sort() };
  });
}
for (const tier of ['process', 'wasm']) test(`round 3 ${tier}: compiled-schema census bounds every server and device read footprint`, async t => {
  const f = await fixture(t), backend = await fetch(f.url + '/schema', { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
  let core;
  const opener = deviceFor(tier, f.dir);
  const client = await createLocalClient({ url: f.url, persona: 'bob', fetch: parked, device: { async open(...args) { core = await opener.open(...args); return core; } } });
  t.after(() => client.close()); await client.sync();
  for (const { program, expected } of expectedFootprints(backend)) {
    const args = program.name === 'conditional' ? { yes: false } : {};
    const remote = await f.post('/q/' + program.name, { args });
    const local = (await core.call({ op: 'query', name: program.name, viewer: 'dev:bob', args, now: Date.now() })).ok;
    for (const [host, actual] of [['server', remote?.tables], [tier, local?.tables], ['SDK', [...operationTables(program, backend.schema)]]]) {
      assert.ok(Array.isArray(actual), `${host}:${program.name} has metadata: ${JSON.stringify(local)}`);
      for (const table of expected) assert.ok(actual.includes(table), `${host}:${program.name} omitted ${table}; expected ${expected}, got ${actual}`);
    }
    assert.deepEqual([...remote.tables].sort(), [...local.tables].sort(), program.name + ': shared engine agrees, on acquired device');
    if (program.name === 'child' || program.name === 'helper' || program.name === 'conditional') assert.deepEqual(expected, ['children', 'docs', 'roots']);
    if (program.name === 'total') assert.deepEqual(expected, ['amounts', 'totals']);
  }
});

for (const tier of ['process', 'wasm']) test(`round 3 ${tier}: already-pending unrelated prediction preserves comparative myProfile`, async t => {
  const f = await fixture(t, profileSchema, profileRows);
  const client = await createLocalClient({ url: f.url, persona: 'alice', device: deviceFor(tier, f.dir), fetch: (input, init) => {
    if (new URL(input).pathname === '/m/unrelated') return Promise.resolve(new Response('', { status: 503 }));
    return parked(input, init);
  } });
  const watch = client.observe(q('myProfile'), {}); watch.subscribe(() => {});
  t.after(async () => { watch.close(); await client.close(); });
  await client.sync(); await until(() => watch.getSnapshot().data?.handle === 'alice');
  await client.mutate({ kind: 'mutation', name: 'unrelated' }, {}, { waitSeconds: 0 });
  await until(async () => (await client.pendingWrites()).some(w => w.predicted?.some(p => p.startsWith('notes/'))), 'prediction already outstanding');
  const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot()));
  assert.equal((await f.post('/m/saveProfile', { id: 'bob-edit', args: { displayName: 'Bob changed', handle: 'bob', bio: null, location: null, link: null } })).state, 'sent');
  await client.sync();
  await until(() => watch.getSnapshot().data?.handle === 'alice');
  assert.ok(seen.length > 0, 'publication observed');
  assert.equal(seen.some(r => r.loading), false, 'unrelated outstanding effects must not flash profile loading');
});
test('outstanding prediction capture rejects relevant, missing and unknown effects', () => {
  const entry = { id: 'a', predictable: true, predicted: ['profiles/alice'] };
  assert.deepEqual([...outstandingPredictions([entry], ['a'], true)], ['profiles']);
  assert.equal(outstandingPredictions([], ['a'], true), undefined);
  assert.equal(outstandingPredictions([{ ...entry, predicted: undefined }], ['a'], true), undefined);
  assert.equal(outstandingPredictions([entry], ['a'], false), undefined);
});
