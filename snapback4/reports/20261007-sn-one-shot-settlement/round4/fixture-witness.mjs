import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { server, binary } from '../../../packages/snapback4/test/helpers/app-server.mjs';
import { ordinary } from '../../../packages/snapback4/test/helpers/schema-capability-fixtures.mjs';
import { loadWasm } from '../../../packages/snapback4/test/helpers/published-capabilities.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const pinPath = join(root, 'packages/snapback4/test/fixtures/capability-free-0.4.backend.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const ok = reply => { assert.equal(reply.denied, undefined, JSON.stringify(reply)); assert.ok(Object.hasOwn(reply, 'ok')); return reply.ok; };

test('real compiler pin and unchanged stored schema/device IR on Linux', async t => {
  const source = readFileSync(join(root, 'crates/snapback4-core/tests/fixtures/capability-free.q'), 'utf8');
  assert.equal(source, 'use identity guests\n' + ordinary);
  const f = await server(t, undefined, source);
  const response = await fetch(f.url + '/schema', { headers: { 'x-snapback-persona': 'alice' } });
  assert.equal(response.status, 200);
  const text = await response.text(), identity = /,"store_id":"[0-9a-f]{32}"}$/.exec(text);
  assert.ok(identity, 'remove only the trailing serving-store identity');
  const bytes = Buffer.from(text.slice(0, identity.index) + '}'), backend = JSON.parse(bytes);
  const prior = spawnSync('git', ['show', '2baacccde1:snapback4/packages/snapback4/test/fixtures/capability-free-0.4.backend.json'], { cwd: root });
  assert.equal(prior.status, 0, prior.stderr.toString());
  const withoutFacts = structuredClone(backend);
  for (const program of withoutFacts.programs) { assert.ok(program.settlement); delete program.settlement; }
  assert.deepEqual(Buffer.from(JSON.stringify(withoutFacts)), prior.stdout, 'the only backend byte change is the additive settlement envelope');
  assert.equal(bytes.length, 3100);
  if (process.env.SN_UPDATE_BACKEND_PIN === '1') writeFileSync(pinPath, bytes);
  assert.deepEqual(readFileSync(pinPath), bytes, 'the pin is the real /schema output');
  const db = new DatabaseSync(join(f.dir, '.snapback4/store.sqlite'), { readOnly: true });
  let stored;
  try { stored = db.prepare('SELECT schema FROM _generations ORDER BY generation DESC LIMIT 1').get().schema; }
  finally { db.close(); }
  const oldSchema = readFileSync(join(root, 'crates/snapback4-core/tests/fixtures/capability-free.schema.json'), 'utf8');
  assert.equal(stored, oldSchema, 'exact pre-SN stored schema bytes');
  assert.deepEqual(JSON.parse(stored), JSON.parse(prior.stdout).schema);
  assert.deepEqual(backend.schema, JSON.parse(stored));

  const backendFile = join(f.dir, 'backend.json'); writeFileSync(backendFile, bytes);
  const requests = [{ op: 'backend' }, { op: 'adopt', backend }, { op: 'backend' }];
  const native = spawnSync(binary, ['device', join(f.dir, 'device.sqlite'), backendFile], {
    input: requests.map(r => JSON.stringify(r) + '\n').join(''), encoding: 'utf8', timeout: 30000,
  });
  assert.equal(native.status, 0, native.stdout + native.stderr);
  const replies = native.stdout.trim().split('\n').map(line => JSON.parse(line)); replies.forEach(ok);
  assert.equal(replies.length, 4);
  const deviceDb = new DatabaseSync(join(f.dir, 'device.sqlite'), { readOnly: true });
  let persisted;
  try { persisted = deviceDb.prepare("SELECT value FROM _meta WHERE key = 'device:backend'").get().value; }
  finally { deviceDb.close(); }
  assert.deepEqual(ok(replies[1]), ok(replies[3]));
  assert.ok(!persisted.includes('"settlement"'), 'native stored backend omits summaries');
  // The runtime exposes its BTreeMap in name order; persisted bytes keep source order.
  const runtime = JSON.parse(persisted); runtime.programs.sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(ok(replies[3]), runtime);
  const Web = await loadWasm(join(root, 'packages/snapback4/src/wasm'));
  const device = new Web(bytes.toString(), '[]');
  const call = request => ok(JSON.parse(device.call(JSON.stringify(request))));
  assert.deepEqual(call({ op: 'backend' }), runtime);
  call({ op: 'adopt', backend }); assert.deepEqual(call({ op: 'backend' }), runtime);
  const changes = device.drain(); device.free();
  const saved = JSON.parse(changes).find(change => change.s === 'm' && change.k === 'device:backend');
  assert.equal(saved.v, persisted, 'WASM persistence stores the same summary-free typed backend');
  const reopened = new Web(undefined, changes);
  assert.deepEqual(ok(JSON.parse(reopened.call('{"op":"backend"}'))), runtime); reopened.free();
  const result = { priorBytes: prior.stdout.length, bytes: bytes.length, delta: bytes.length - prior.stdout.length,
    sha256: sha256(bytes), storedSchemaBytes: Buffer.byteLength(stored), storedSchemaSha256: sha256(stored),
    nativeAndWasmStoredBackendBytes: Buffer.byteLength(persisted), nativeAndWasmStoredBackendSha256: sha256(persisted),
    onlySettlementChanged: true, storedSchemaUnchanged: true, summariesPersisted: false };
  writeFileSync(new URL('./fixture.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  t.diagnostic(JSON.stringify(result));
});
