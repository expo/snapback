import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { existence } from '../dist/contract.js';
import { processDevice } from '../dist/native.js';
import { memoryPersistence, webDevice } from '../dist/web.js';
const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, '../../../target/debug/snapback4');
const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const until = async check => { for (let n = 0; n < 500; n++) { if (await check()) return; await delay(10); } assert.fail('existence integration did not settle'); };
const source = `use personas alice, bob
table rows:
  owner: principal
  label: text <=40
  unique owner, label
  immutable owner, label
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
query point(owner: principal, label: text <=40):
  return rows[owner, label]
mutation add(label: text <=40):
  return insert rows {owner: viewer, label}
`;
for (const tier of ['wasm', 'native']) test(`${tier}: real hidden/missing reads match and an admitted insert demotes retained absence`, { timeout: 60_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-proven-existence-'));
  mkdirSync(join(dir, 'snapback')); writeFileSync(join(dir, 'snapback/schema.q'), source);
  const host = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(host, 'exit'); let log = '', local, online, observed;
  const gate = Promise.withResolvers(), refusal = Promise.withResolvers(); let held = false, refuseAdmission = false;
  host.stdout.on('data', b => { log += b; }); host.stderr.on('data', b => { log += b; });
  t.after(async () => { gate.resolve(); refusal.resolve(); observed?.close(); await local?.close(); await online?.close(); host.kill('SIGTERM'); await exit; rmSync(dir, { recursive: true, force: true }); });
  await until(() => { assert.equal(host.exitCode, null, log); return /http:\/\/127\.0\.0\.1:\d+/.test(log); });
  const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const post = async (path, data) => fetch(url + path, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify(data) });
  assert.equal((await (await post('/seed', [{ table: 'rows', row: { id: 'hidden', owner: 'dev:bob', label: 'hidden' } }])).json()).seeded, 1);
  const op = { kind: 'query', name: 'point' };
  const hiddenArgs = { owner: 'dev:bob', label: 'hidden' }, missingArgs = { owner: 'dev:bob', label: 'absent' };
  const hidden = await (await post('/q/point', { args: hiddenArgs })).text();
  const missing = await (await post('/q/point', { args: missingArgs })).text();
  assert.equal(hidden, missing, 'byte-identical entire wire answers, including dev meter, at one watermark');
  assert.equal('existence' in JSON.parse(hidden), false);
  online = createClient({ url, persona: 'alice' });
  const onlineHidden = await online.query(op, hiddenArgs), onlineMissing = await online.query(op, missingArgs);
  assert.equal(existence(onlineHidden), 'absent'); assert.deepEqual(onlineHidden, onlineMissing);
  const opener = tier === 'wasm' ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir: join(dir, 'replica'), binary });
  const device = { async open(...args) {
    const core = await opener.open(...args);
    return { ...core, async call(request, notify) {
      if (refuseAdmission && request.op === 'admit') { await refusal.promise; return { denied: { code: 'E_TEST_REFUSED', family: 'test', message: 'admission refused' } }; }
      if (held && request.op === 'query') await gate.promise;
      return core.call(request, notify);
    } };
  } };
  local = await createLocalClient({ url, persona: 'alice', device, fetch: async (input, init) => {
    if (held && new URL(input).pathname === '/m/add') await gate.promise;
    return fetch(input, init);
  } });
  await local.sync();
  assert.deepEqual(await local.query(op, hiddenArgs), await local.query(op, missingArgs));
  const args = { owner: 'dev:alice', label: 'new' };
  const published = [];
  observed = local.observe(op, args, { keep: true }); const stop = observed.subscribe(() => { published.push(existence(observed.getSnapshot())); }); t.after(stop);
  await until(() => existence(observed.getSnapshot()) === 'absent');
  refuseAdmission = true;
  const rejected = local.mutate({ kind: 'mutation', name: 'add' }, { label: 'refused' }, { waitSeconds: 0 });
  await until(() => published.at(-1) === 'partial');
  refusal.resolve();
  assert.equal((await rejected).state, 'failed');
  await until(() => published.at(-1) === 'absent');
  refuseAdmission = false;
  held = true;
  const admitted = await local.mutate({ kind: 'mutation', name: 'add' }, { label: 'new' }, { waitSeconds: 0 });
  assert.equal(admitted.state, 'pending');
  await until(() => observed.getSnapshot().revalidating === true);
  const retained = observed.getSnapshot(); assert.equal(retained.data, null); assert.equal(retained.existence, 'partial');
  gate.resolve();
  await until(() => existence(observed.getSnapshot()) === 'present');
  assert.equal(observed.getSnapshot().data.label, 'new');
});

// @ref LLP 3000.023#10 — same-key completed replacements always replace data.
// @ref LLP 3000.031#1.1 — each replacement classifies its own disclosed value.
for (const host of ['online', 'process', 'wasm']) test(`${host}: same-key row arrival and delete replace absent/present existence`, { timeout: 60_000 }, async t => {
  const { fixture, open, q, until } = await import('./helpers/answers-stay.mjs');
  const f = await fixture(t);
  assert.equal((await f.post('/m/erase', {})).state, 'sent');
  const client = await open(t, f, host);
  const watch = client.observe(q('item'), {});
  const published = [];
  const stop = watch.subscribe(() => published.push(watch.getSnapshot()));
  t.after(() => { stop(); watch.close(); });
  await until(() => existence(watch.getSnapshot()) === 'absent');
  const absent = watch.getSnapshot();
  published.length = 0;
  assert.equal((await f.post('/seed', [{ table: 'messages', row: { id: 'item', room: 'room', body: 'arrived', at: 2 } }])).seeded, 1);
  if (client.sync) await client.sync();
  await until(() => existence(watch.getSnapshot()) === 'present' && watch.getSnapshot().data.body === 'arrived');
  const present = watch.getSnapshot();
  assert.notEqual(present, absent);
  assert.equal((await f.post('/m/erase', {})).state, 'sent');
  if (client.sync) await client.sync();
  await until(() => existence(watch.getSnapshot()) === 'absent');
  assert.equal(watch.getSnapshot().data, null);
  assert.notEqual(watch.getSnapshot(), present);
  assert.ok(published.some(read => existence(read) === 'present'));
  assert.ok(published.every(read => 'data' in read), 'immediate same-key replacements never flash loading');
  for (const read of published) {
    if (read.data === null) assert.notEqual(read.existence, 'present', 'an empty replacement never inherits present');
    else assert.equal(read.existence, 'present', 'an arriving row never inherits absent/partial');
  }
});
