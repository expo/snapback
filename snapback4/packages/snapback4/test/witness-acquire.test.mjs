import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { measure, parse } from '../bin/witness-acquire.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const schema = `use personas alice, bob
use identity
table notes:
  owner: principal
  body: text <=100
  read <- .owner = viewer
  insert <- .owner = viewer
  retain delivered-history
  sync last 20 by .id
query heldNotes():
  return notes where .owner = viewer last 20 by .id
query byOwner(owner: principal):
  return notes where .owner = owner last 20 by .id
`;

async function cli(args, cwd) {
  const child = spawn(binary, ['witness', 'acquire', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [status] = await once(child, 'exit');
  return { status, stdout, stderr };
}
async function fixture(t, release = false) {
  const dir = await mkdtemp(join(tmpdir(), 'sb4-witness-test-'));
  await mkdir(join(dir, 'snapback'));
  await writeFile(join(dir, 'snapback/schema.q'), schema);
  if (release) {
    const deployed = spawnSync(binary, ['deploy', join(dir, 'release')], { cwd: dir, encoding: 'utf8' });
    assert.equal(deployed.status, 0, deployed.stderr);
  }
  const server = spawn(binary, release ? ['serve', join(dir, 'release'), '--port', '0'] : ['dev', '--port', '0', '--fresh', '--no-watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(server, 'exit');
  let log = '', url;
  server.stdout.on('data', bytes => { log += bytes; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  server.stderr.on('data', bytes => { log += bytes; });
  t.after(async () => { if (server.exitCode === null) server.kill(); await exit; await rm(dir, { recursive: true, force: true }); });
  const end = Date.now() + 30000;
  while (!url) { assert.equal(server.exitCode, null, log); assert.ok(Date.now() < end, log); await new Promise(r => setTimeout(r, 10)); }
  if (!release) {
  const response = await fetch(`${url}/seed`, { method: 'POST', body: JSON.stringify([
    { table: 'notes', row: { id: 'n1', owner: 'dev:alice', body: 'held one' } },
    { table: 'notes', row: { id: 'n2', owner: 'dev:alice', body: 'held two' } },
    { table: 'notes', row: { id: 'n3', owner: 'dev:bob', body: 'private' } },
  ]) });
  assert.equal((await response.json()).seeded, 3);
  }
  return { url, dir, args: ['--as', 'alice', '--url', url, '--restart', '--timeout', '15'] };
}

test('acquire CLI refuses invalid arguments before connecting', async () => {
  for (const args of [[], ['--as'], ['--as', 'alice', '--runs', '0'], ['--as', 'alice', '--runs', 'NaN'],
    ['--as', 'alice', '--restart', '--restart'], ['--as', 'alice', '--wat'], ['--as', 'alice', '--url', 'file:///tmp'],
    ['--as', 'alice', '--url', 'http://user:secret@localhost'], ['--as', 'member:1'], ['--as', 'alice', '--args', '[]'],
    ['--as', 'alice', '--query', 'heldNotes', '--args', '{'], ['--as', 'alice', '--timeout', '-1']]) {
    const reply = await cli(args, tmpdir());
    assert.notEqual(reply.status, 0, JSON.stringify(args)); assert.match(reply.stderr, /E_INPUT/);
  }
});

test('acquire CLI saves actual SDK acquisition and cold retained receipts across fresh runs', async t => {
  const f = await fixture(t), artifacts = join(f.dir, 'proof');
  const reply = await cli([...f.args, '--runs', '2', '--json', '--artifacts', artifacts], f.dir);
  assert.equal(reply.status, 0, reply.stderr);
  const receipt = JSON.parse(reply.stdout);
  assert.equal(receipt.passed, true); assert.equal(receipt.runs.length, 2);
  assert.match(receipt.note, /web wasm \+ IndexedDB figures differ/);
  assert.deepEqual(JSON.parse(await readFile(join(artifacts, 'acquire.json'), 'utf8')), receipt);
  for (const run of receipt.runs) {
    assert.equal(run.coverage.rows, 2); assert.equal(run.coverage.groupsByTable.notes, 1);
    assert.equal(run.coverage.residency.totalBytesKind, 'sqlite-pages');
    assert.ok(run.acquiredMs > 0 && run.firstLocalMs > 0 && run.restart.firstLocalMs > 0);
    assert.equal(run.restart.retained, true); assert.equal(run.restart.downloadedRows, 0);
    assert.deepEqual(run.restart.offline.residency.tables, run.coverage.residency.tables);
    assert.ok(run.requests.some(r => r.path === '/sync' && r.serverTiming?.includes('total;dur=')));
  }
  const overwrite = await cli([...f.args, '--artifacts', artifacts], f.dir);
  assert.notEqual(overwrite.status, 0); assert.match(overwrite.stderr, /EEXIST/);
});

test('acquire refuses unknown personas, mismatched bearer identity, unreachable servers and unknown queries', async t => {
  const f = await fixture(t);
  for (const args of [
    ['--as', 'unknown', '--url', f.url], ['--as', 'alice', '--url', f.url, '--token', 'not-a-session'],
    ['--as', 'alice', '--url', 'http://127.0.0.1:1'], ['--as', 'alice', '--url', f.url, '--query', 'notAQuery'],
    ['--as', 'alice', '--url', f.url, '--query', 'byOwner'],
    ['--as', 'alice', '--url', f.url, '--query', 'byOwner', '--args', '{"owner":7}'],
  ]) {
    const reply = await cli([...args, '--timeout', '2'], f.dir);
    assert.notEqual(reply.status, 0); assert.match(reply.stderr, /E_AUTH|E_WITNESS_BACKEND|E_INPUT/);
  }
});

test('serve accepts a matching bearer, refuses a different principal, and reports timing unavailable', async t => {
  const f = await fixture(t, true);
  const { session } = await fetch(`${f.url}/auth/guest`, { method: 'POST', body: '{}' }).then(r => r.json());
  assert.ok(session);
  const reply = await cli(['--url', f.url, '--as', session.principal, '--token', session.token, '--restart', '--json'], f.dir);
  assert.equal(reply.status, 0, reply.stderr);
  const receipt = JSON.parse(reply.stdout);
  assert.equal(receipt.runs[0].restart.retained, true);
  assert.equal(receipt.runs[0].serverSyncMs, null);
  assert.ok(!JSON.stringify(receipt).includes(session.token));
  const mismatch = await cli(['--url', f.url, '--as', 'unknown', '--token', session.token], f.dir);
  assert.notEqual(mismatch.status, 0); assert.match(mismatch.stderr, /principal does not match/);
});

test('bounds guide command and receipt excerpt execute against a small fixture', async t => {
  const f = await fixture(t);
  const guide = await readFile(join(root, 'crates/snapback4-lang/src/guide/bounds.rs'), 'utf8');
  const command = guide.match(/^snapback4 witness acquire .*$/m)?.[0];
  assert.ok(command);
  const args = command.replace('"$SB4_URL"', f.url).replace('"$SB4_PROOF"', join(f.dir, 'guide-proof')).split(' ').slice(3);
  const reply = await cli(args, f.dir);
  assert.equal(reply.status, 0, reply.stderr);
  const actual = JSON.parse(reply.stdout), example = JSON.parse(guide.match(/```json\n([^\n]+)\n```/)[1]);
  assert.equal(actual.passed, example.passed);
  assert.equal(actual.runs[0].coverage.groups, example.runs[0].coverage.groups);
  assert.equal(actual.runs[0].coverage.rows, example.runs[0].coverage.rows);
  assert.equal(actual.runs[0].restart.retained, example.runs[0].restart.retained);
  assert.equal(actual.runs[0].restart.downloadedRows, example.runs[0].restart.downloadedRows);
});

for (const control of ['wipe', 'delete-row', 'change-groups', 'change-boundaries']) test(`restart detects ${control} before reconnect can repair it`, async t => {
  const f = await fixture(t);
  await assert.rejects(measure(parse(f.args), { binary, async beforeRestart({ dir }) {
    const file = (await readdir(dir)).find(name => name.endsWith('.sqlite'));
    assert.ok(file);
    if (control === 'wipe') { await rm(dir, { recursive: true }); await mkdir(dir); return; }
    const db = new DatabaseSync(join(dir, file));
    try {
      if (control === 'delete-row') db.exec("DELETE FROM r WHERE t = (SELECT num FROM _catalog WHERE name = 'notes') AND id = 'n1'");
      else if (control === 'change-boundaries') db.prepare("UPDATE _meta SET value = 'unknown' WHERE key LIKE 'device:acquisition-boundaries:%'").run();
      else db.prepare("UPDATE _meta SET value = '{}' WHERE key = 'device:history:groups'").run();
    } finally { db.close(); }
  } }), control === 'wipe' ? /never synced|E_OFFLINE/ : /E_WITNESS_RECEIPT.*coverage differs/);
});
