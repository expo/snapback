import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
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
query refusedOwner(owner: principal):
  require owner = viewer else NOT_OWNER
  return notes where .owner = owner last 20 by .id
`;

async function cli(args, cwd) {
  const child = spawn(binary, ['witness', ...(args[0] === '__family' ? args.slice(1) : ['acquire', ...args])], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
    assert.notEqual(reply.status, 0, JSON.stringify(args)); assert.match(reply.stderr, /E_WITNESS_INPUT/);
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
    assert.equal(run.coverage.rows, 2); assert.equal(run.coverage.groupsByTable[createHash('sha256').update(JSON.stringify(['witness-table', 'notes'])).digest('hex')], 1);
    assert.equal(run.coverage.residency.totalBytesKind, 'sqlite-pages');
    assert.ok(run.acquiredMs > 0 && run.firstLocalMs > 0 && run.restart.firstLocalMs > 0);
    assert.equal(run.restart.retained, true); assert.equal(run.restart.downloadedRows, 0);
    assert.deepEqual(run.restart.offline.residency.tables, run.coverage.residency.tables);
    assert.ok(run.requests.some(r => r.path === '/sync' && r.headerMs > 0 && !Object.hasOwn(r, 'serverTiming')));
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
    assert.notEqual(reply.status, 0); assert.match(reply.stderr, /E_AUTH|E_WITNESS_BACKEND|E_WITNESS_INPUT/);
  }
});

test('serve accepts a matching bearer, refuses a different principal, and omits server timings', async t => {
  const f = await fixture(t, true);
  const { session } = await fetch(`${f.url}/auth/guest`, { method: 'POST', body: '{}' }).then(r => r.json());
  assert.ok(session);
  const reply = await cli(['--url', f.url, '--as', session.principal, '--token', session.token, '--restart', '--json'], f.dir);
  assert.equal(reply.status, 0, reply.stderr);
  const receipt = JSON.parse(reply.stdout);
  assert.equal(receipt.runs[0].restart.retained, true);
  assert.equal(Object.hasOwn(receipt.runs[0], 'serverSyncMs'), false);
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
  } }), control === 'wipe' ? /E_WITNESS_BACKEND|E_WITNESS_RECEIPT/ : /E_WITNESS_RECEIPT.*coverage differs/);
});


// Astra's proxy reproduction: acquire normally, then tamper only with reconnect.
for (const fault of ['more-then-drop', 'denied', 'malformed-json', 'null', 'missing-fields', 'bad-more', 'behind-server', 'dropped-first', 'truncated-body', 'bad-ack', 'bad-acquisitions']) {
  test(`reconnect proof rejects ${fault} and records every attempted request`, async t => {
    const f = await fixture(t);
    let syncs = 0;
    const proxy = createServer(async (req, res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks), headers = { ...req.headers };
        delete headers.host; delete headers['content-length'];
        const reconnect = req.url === '/sync' && ++syncs >= 3;
        if (reconnect && (fault === 'dropped-first' || (fault === 'more-then-drop' && syncs > 3))) { res.destroy(); return; }
        const response = await fetch(f.url + req.url, { method: req.method, headers, ...(body.length ? { body } : {}) });
        let text = await response.text();
        if (reconnect) {
          const page = JSON.parse(text);
          if (fault === 'more-then-drop') { page.more = true; text = JSON.stringify(page); }
          if (fault === 'bad-ack') { page.acknowledged = { id: 'not-a-sequence' }; text = JSON.stringify(page); }
          if (fault === 'bad-acquisitions') { page.acquisitions = [{ at: 'invalid' }]; text = JSON.stringify(page); }
          if (fault === 'denied') text = JSON.stringify({ denied: { code: 'E_AUTH', message: 'refused' } });
          if (fault === 'malformed-json') text = '{';
          if (fault === 'null') text = 'null';
          if (fault === 'missing-fields') text = JSON.stringify({ events: [] });
          if (fault === 'bad-more') { page.more = 'false'; text = JSON.stringify(page); }
          if (fault === 'behind-server') { page.images_at += 1; text = JSON.stringify(page); }
          if (fault === 'truncated-body') { res.writeHead(200, { 'content-type': 'application/json', 'content-length': 9999 }); res.write('{'); res.flushHeaders(); setImmediate(() => res.destroy()); return; }
        }
        res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(text);
      } catch { res.destroy(); }
    });
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
    t.after(() => { proxy.closeAllConnections(); proxy.close(); });
    const artifacts = join(f.dir, fault);
    const reply = await cli(['--as', 'alice', '--url', `http://127.0.0.1:${proxy.address().port}`,
      '--restart', '--json', '--timeout', '15', '--artifacts', artifacts], f.dir);
    const receipt = JSON.parse(reply.stdout);
    assert.notEqual(reply.status, 0, 'failed reconnect must exit nonzero');
    assert.equal(receipt.passed, false);
    assert.equal(receipt.runs.length, 1, 'partial failed run must be retained');
    assert.equal(receipt.runs[0].passed, false);
    assert.equal(receipt.runs[0].restart.retained, false);
    const attempts = receipt.runs[0].requests.filter(r => r.path === '/sync');
    assert.equal(attempts.length, syncs, 'failed transports must not disappear');
    if (fault === 'more-then-drop') {
      assert.equal(attempts.at(-2).more, true);
      assert.equal(attempts.at(-1).http, 'unavailable');
      assert.equal(attempts.at(-1).outcome, 'failed');
    } else if (fault !== 'behind-server') assert.equal(attempts.at(-1).outcome, 'failed');
    assert.match(reply.stderr, /E_WITNESS_BACKEND|E_WITNESS_RECEIPT/);
    assert.deepEqual(JSON.parse(await readFile(join(artifacts, 'acquire.json'), 'utf8')), receipt);
  });
}

test('echoed bearer and derived refusal text never reach stderr, JSON, text or receipt files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sb4-witness-echo-'));
  const token = 'BN_TEST_REFLECTED_TOKEN+/%=not-real';
  const variants = [token, encodeURIComponent(token), Buffer.from(token).toString('base64'), createHash('sha256').update(token).digest('hex')];
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ denied: { code: 'E_AUTH', message: variants.join(' ') } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); });
  for (const json of [true, false]) {
    const artifacts = join(dir, `proof-${json}`);
    const reply = await cli(['--as', 'test-principal', '--token', token, '--url', `http://127.0.0.1:${server.address().port}`,
      '--artifacts', artifacts, ...(json ? ['--json'] : [])], dir);
    const file = await readFile(join(artifacts, 'acquire.json'), 'utf8');
    assert.notEqual(reply.status, 0);
    for (const value of variants) for (const [boundary, text] of Object.entries({ stdout: reply.stdout, stderr: reply.stderr, file })) {
      assert.ok(!text.includes(value), `${boundary} leaked a supplied or reflected credential`);
    }
    assert.equal(JSON.parse(file).passed, false);
    assert.match(reply.stderr, /E_AUTH/);
  }
  const invalid = await cli(['--wat', token, '--token', token], dir);
  assert.notEqual(invalid.status, 0); assert.ok(!invalid.stderr.includes(token));
  const reflectedFlag = await cli([token, '--token', token], dir);
  assert.notEqual(reflectedFlag.status, 0); assert.ok(!reflectedFlag.stderr.includes(token));
});

test('witness family usage advertises both commands and shares input diagnostics', async () => {
  for (const args of [['__family'], ['__family', 'ios', '--wat'], ['--wat']]) {
    const reply = await cli(args, tmpdir());
    assert.notEqual(reply.status, 0); assert.match(reply.stderr, /E_WITNESS_INPUT/);
    if (args.length === 1 && args[0] === '__family') { assert.match(reply.stderr, /witness acquire/); assert.match(reply.stderr, /witness ios/); }
  }
});

test('receipt identifies the JSON-line subprocess host', async t => {
  const f = await fixture(t), artifacts = join(f.dir, 'timings');
  const reply = await cli([...f.args, '--artifacts', artifacts], f.dir);
  assert.equal(reply.status, 0, reply.stderr);
  const receipt = JSON.parse(await readFile(join(artifacts, 'acquire.json'), 'utf8'));
  assert.match(receipt.note, /one JSON line per call.*snapback4 device subprocess/);
  assert.match(receipt.note, /Expo links the crate in-process/);
  assert.doesNotMatch(receipt.note, /same module as Expo/);
});

test('restart times coverage separately from first answer', async t => {
  const f = await fixture(t), artifacts = join(f.dir, 'timings');
  const reply = await cli([...f.args, '--artifacts', artifacts], f.dir);
  assert.equal(reply.status, 0, reply.stderr);
  const receipt = JSON.parse(await readFile(join(artifacts, 'acquire.json'), 'utf8'));
  const r = receipt.runs[0].restart;
  assert.ok(r.coverageVerifiedMs > 0);
  assert.equal(r.completed, true); assert.equal(receipt.runs[0].requests.filter(r => r.phase === 'reconnect' && r.path === '/sync').at(-1).applied, true); assert.equal(r.serverPositionSha256, r.reconnected.positionSha256);
  assert.ok(reply.stdout.includes(`cold restart first local answer ${(r.firstLocalMs / 1000).toFixed(3)} s; coverage verified (1 table/groups) in ${(r.coverageVerifiedMs / 1000).toFixed(3)} s`));
  // A delayed native coverage scan belongs entirely to its own timer.
  const measured = await measure(parse(f.args), { binary, beforeRestart({ opener }) {
    const open = opener.open.bind(opener);
    opener.open = async (...args) => {
      const core = await open(...args), call = core.call.bind(core);
      core.call = async request => {
        if (request.op === 'witness_coverage') await new Promise(resolve => setTimeout(resolve, 100));
        return call(request);
      };
      return core;
    };
  } });
  assert.ok(measured.restart.coverageVerifiedMs >= 100, 'coverage timer includes its scan');
});

test('bounds names the known process-device apply defect independently from retention', async () => {
  const guide = await readFile(join(root, 'crates/snapback4-lang/src/guide/bounds.rs'), 'utf8');
  assert.match(guide, /known performance defect/);
  assert.match(guide, /process-device apply/);
  assert.match(guide, /37\.9 s.*41\.7 s/s);
  assert.match(guide, /35\.5 s/);
  assert.match(guide, /coverageVerifiedMs/);
});

for (const valid of [true, false]) test(`binary native module ${valid ? 'installs and survives restart' : 'digest refusal fails proof'}`, async t => {
  const f = await fixture(t);
  // (memory 1), sb4_alloc(i32)->64, sb4_jobs()->packed(0,8), data ["noop"].
  // Real minimal native ABI module, no native read is invoked by heldNotes.
  const wasm = Buffer.from('0061736d01000000010a0260017f017f6000017e03030200010503010001072103066d656d6f72790200097362345f616c6c6f630000087362345f6a6f627300010a0c02050041c0000b040042080b0b0e010041000b085b226e6f6f70225d', 'hex');
  const digest = createHash('sha256').update(valid ? wasm : Buffer.from('wrong module')).digest('hex');
  const proxy = createServer(async (req, res) => {
    try {
      if (req.url === '/native.wasm') { res.writeHead(200, { 'content-type': 'application/wasm' }); res.end(wasm); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks), headers = { ...req.headers };
      delete headers.host; delete headers['content-length'];
      const response = await fetch(f.url + req.url, { method: req.method, headers, ...(body.length ? { body } : {}) });
      let text = await response.text();
      if (req.url === '/schema') { const backend = JSON.parse(text); backend.native = { digest }; text = JSON.stringify(backend); }
      res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(text);
    } catch { res.destroy(); }
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  const reply = await cli(['--as', 'alice', '--url', `http://127.0.0.1:${proxy.address().port}`, '--restart', '--json', '--timeout', '15'], f.dir);
  const receipt = JSON.parse(reply.stdout);
  if (valid) {
    assert.equal(reply.status, 0, reply.stderr); assert.equal(receipt.passed, true);
    assert.equal(receipt.runs[0].restart.retained, true);
    assert.equal(receipt.runs[0].requests.find(r => r.path === '/native.wasm').installed, true);
  } else { assert.notEqual(reply.status, 0); assert.equal(receipt.passed, false); }
});

const tokenForms = token => ({ raw: token, hex: Buffer.from(token).toString('hex'),
  HEX: Buffer.from(token).toString('hex').toUpperCase(), base64: Buffer.from(token).toString('base64'),
  base64url: Buffer.from(token).toString('base64url'), percent: [...Buffer.from(token)].map(b => `%${b.toString(16).padStart(2, '0').toUpperCase()}`).join(''),
  percentLower: [...Buffer.from(token)].map(b => `%${b.toString(16).padStart(2, '0')}`).join(''),
  sha256: createHash('sha256').update(token).digest('hex') });
function assertNoCredentials(variants, boundaries) {
  for (const [boundary, text] of Object.entries(boundaries)) for (const [form, secret] of Object.entries(variants)) {
    assert.equal(text.includes(secret), false, `${boundary} leaked ${form}`);
  }
}

// Each form reaches a successful receipt through schema names, sync identity,
// rows and headers; refusal cases exercise the distinct error boundaries too.
for (const form of Object.keys(tokenForms('synthetic'))) test(`server allowlist drops ${form} from every acquisition output surface`, async t => {
  const f = await fixture(t);
  const { session } = await fetch(`${f.url}/auth/guest`, { method: 'POST', body: '{}' }).then(r => r.json());
  assert.ok(session);
  const variants = tokenForms(session.token), echo = variants[form];
  const seeded = await fetch(`${f.url}/seed`, { method: 'POST', body: JSON.stringify([
    { table: 'notes', row: { id: 'echo-row', owner: session.principal, body: 'row body' } },
  ]) }).then(r => r.json());
  assert.equal(seeded.seeded, 1);
  let mode = 'success', firstPage;
  const echoed = [];
  const rename = value => {
    if (typeof value === 'string') return value === 'notes' || value === 'heldNotes' || value === 'row body' ? echo : value;
    if (Array.isArray(value)) return value.map(rename);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key === 'notes' ? echo : key, key === 'store_id' ? echo : rename(item)]));
    return value;
  };
  const proxy = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, `Bearer ${session.token}`);
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks), headers = { ...req.headers };
      delete headers.host; delete headers['content-length'];
      const response = await fetch(f.url + req.url, { method: req.method, headers, ...(body.length ? { body } : {}) });
      let page = await response.json();
      if (req.url === '/schema') firstPage = structuredClone(page);
      if (mode === 'success') page = rename(page);
      // Unknown fields, including server-provided numbers/hashes and refusal
      // vocabulary, must never be serialized by spreading a server object.
      Object.assign(page, { code: echo, message: echo, family: echo, site: echo, guide: echo,
        rewrite: echo, principal: echo, query: echo, args: { [echo]: echo }, hash: echo,
        rows: 987654321, bytes: 987654321, elapsed: 987654321, [echo]: echo });
      if (mode === 'missing-arg' && req.url === '/schema') {
        page.programs.find(p => p.name === 'byOwner').args = { [echo]: 'Principal' };
      }
      if (mode === 'viewer' && req.url === '/probe') page.viewer = echo;
      if (mode === 'schema-error' && req.url === '/schema') page.programs = echo;
      if (mode === 'sync-error' && req.url === '/sync') page.watermark = echo;
      if (mode === 'native-error' && req.url === '/sync') page.acknowledged = { [echo]: echo };
      if (mode === 'native-hash' && req.url === '/schema') page.native = { digest: echo };
      if (mode.startsWith('denied:') && req.url === mode.slice(7)) {
        page = { denied: Object.fromEntries(['code', 'message', 'family', 'site', 'guide', 'rewrite'].map(key => [key, echo])) };
      }
      echoed.push([mode, req.url]);
      res.writeHead(200, { 'content-type': 'application/json', 'server-timing': `total;dur=987654321, cpu;dur=987654321`,
        'x-reflection': echo });
      res.end(JSON.stringify(page));
    } catch { res.destroy(); }
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  for (const scenario of ['success', 'missing-arg', 'viewer', 'schema-error', 'sync-error', 'native-error', 'native-hash', 'denied:/probe', 'denied:/schema', 'denied:/sync']) {
    mode = scenario;
    for (const json of [true, false]) {
      const artifacts = join(f.dir, `${scenario.replaceAll('/', '-')}-${json}`);
      const reply = await cli(['--as', session.principal, '--token', session.token,
        '--url', `http://127.0.0.1:${proxy.address().port}`, '--timeout', '3', '--restart', '--artifacts', artifacts,
        ...(scenario === 'missing-arg' ? ['--query', 'byOwner'] : []), ...(json ? ['--json'] : [])], f.dir);
      const file = await readFile(join(artifacts, 'acquire.json'), 'utf8');
      assertNoCredentials(variants, { stdout: reply.stdout, stderr: reply.stderr, file });
      assert.ok(!file.includes('987654321'), 'server numeric metadata/timing must be dropped');
      const receipt = JSON.parse(file);
      assert.equal(receipt.principal, session.principal, 'principal comes from caller input');
      if (scenario === 'success') {
        assert.equal(reply.status, 0, reply.stderr);
        assert.equal(receipt.passed, true);
        assert.equal(receipt.runs[0].coverage.rows, 1);
        assert.equal(receipt.runs[0].query.name, 'automatic device query');
        assert.equal(receipt.runs[0].restart.completed, true);
        assert.equal(Object.keys(receipt.runs[0].coverage.groupsByTable).length, 1);
      } else {
        assert.notEqual(reply.status, 0, scenario);
        assert.equal(receipt.passed, false);
      }
      assert.deepEqual(await readdir(artifacts), ['acquire.json'], 'server free text is dropped, not saved elsewhere');
    }
  }
  assert.ok(firstPage?.programs.length);
  for (const scenario of ['sync-error', 'native-error', 'denied:/sync']) assert.ok(echoed.some(([mode, path]) => mode === scenario && path === '/sync'));
});

test('caller query and args are echoed from the request, never selected schema metadata', async t => {
  const f = await fixture(t), artifacts = join(f.dir, 'caller-input');
  const reply = await cli([...f.args, '--query', 'byOwner', '--args', '{"owner":"dev:alice"}', '--json', '--artifacts', artifacts], f.dir);
  assert.equal(reply.status, 0, reply.stderr);
  const receipt = JSON.parse(reply.stdout);
  assert.equal(receipt.principal, 'alice');
  assert.equal(receipt.runs[0].query.name, 'byOwner');
  assert.deepEqual(receipt.runs[0].query.args, { owner: 'dev:alice' });
});

test('failed query receipts distinguish argument rejection, query refusal and incomplete coverage', async t => {
  const f = await fixture(t);
  for (const [query, args, message] of [
    ['byOwner', { owner: 7 }, /query arguments rejected; check --args against the --query argument types/],
    ['refusedOwner', { owner: 'dev:bob' }, /query refused; check --query rules and requirements/],
    ['byOwner', { owner: 'dev:bob' }, /query coverage incomplete; choose --query and --args within held coverage/],
    ['byOwner', {}, /query needs an argument/],
    ['byOwner', { owner: 'dev:alice', extra: 7 }, /unknown query argument/],
    ['missingQuery', { owner: 7 }, /choose a device query/],
  ]) {
    const artifacts = join(f.dir, `failure-${query}-${Object.keys(args).join('-')}-${args.owner}`);
    const reply = await cli([...f.args, '--query', query, '--args', JSON.stringify(args), '--artifacts', artifacts, '--json'], f.dir);
    assert.notEqual(reply.status, 0);
    assert.match(reply.stderr, message);
    const file = await readFile(join(artifacts, 'acquire.json'), 'utf8');
    const receipt = JSON.parse(file);
    assert.deepEqual(JSON.parse(reply.stdout), receipt);
    assert.equal(receipt.passed, false);
    assert.equal(receipt.runs[0].query.name, query);
    assert.deepEqual(receipt.runs[0].query.args, args);
    assert.match(receipt.runs[0].error, message);
    assert.equal(reply.stderr.includes(query), false, 'refusal must not echo --query value');
    assert.equal(reply.stderr.includes(JSON.stringify(args)), false, 'refusal must not echo --args value');
  }
});

test('query diagnostics use validated codes and drop arbitrary refusal prose', async t => {
  const f = await fixture(t);
  const marker = 'BN_UNTRUSTED_REFUSAL_TEXT';
  for (const [code, expected] of [
    ['E_INPUT', /query arguments rejected/], ['E_TYPE', /query arguments rejected/],
    ['E_FIELD', /query arguments rejected/], ['E_RULE', /query refused/],
    ['E_OFFLINE', /query coverage incomplete/], ['E_PREDICT', /query coverage incomplete/],
    ['E_UNKNOWN', /query refused/], [`E_INPUT\n${marker}`, /query refused/],
    [marker, /query refused/], [7, /query refused/], [null, /query refused/],
  ]) {
    await assert.rejects(measure(parse([...f.args, '--query', 'byOwner', '--args', '{"owner":"dev:alice"}']), {
      binary, beforeRestart({ opener }) {
        const open = opener.open.bind(opener);
        opener.open = async (...args) => {
          const core = await open(...args), call = core.call.bind(core);
          core.call = request => request.op === 'query'
            ? Promise.resolve({ denied: { code, message: marker, family: marker, site: marker, guide: marker, rewrite: marker } })
            : call(request);
          return core;
        };
      },
    }), error => {
      assert.match(error.message, expected);
      assertNoCredentials({ marker }, { message: error.message, receipt: JSON.stringify(error.witnessRun) });
      assert.equal(error.witnessRun.passed, false);
      assert.equal(error.witnessRun.query.name, 'byOwner');
      assert.deepEqual(error.witnessRun.query.args, { owner: 'dev:alice' });
      return true;
    });
  }
});

test('equals token spelling authenticates without exposing the bearer', async t => {
  const f = await fixture(t, true);
  const { session } = await fetch(`${f.url}/auth/guest`, { method: 'POST', body: '{}' }).then(r => r.json());
  const reply = await cli([`--url=${f.url}`, `--as=${session.principal}`, `--token=${session.token}`, '--restart', '--json'], f.dir);
  assert.equal(reply.status, 0, 'equals bearer spelling must authenticate');
  assert.equal(JSON.parse(reply.stdout).passed, true);
  assertNoCredentials(tokenForms(session.token), { stdout: reply.stdout, stderr: reply.stderr });
});

test('acquire argument refusals omit values including equals bearers', async () => {
  const dir = tmpdir();
  const marker = 'BN_EQUALS_BEARER_TEST_NOT_REAL';
  const bad = [
    [`--token=${marker}`], [`--token=${marker}`, `--token=${marker}`], ['--token', marker, `--token=${marker}`],
    [`--token-file=${marker}`], ['--token-file', marker], [`--unknown=${marker}`], [marker],
    [`--${marker}`], [`--json=${marker}`], [`--as=${marker}`, '--runs', marker],
    ['--as', marker, '--token', marker], ['--as', 'alice', '--token', marker, '--query', marker],
    ['--as', 'alice', '--token', marker, '--artifacts', marker],
  ];
  for (const args of bad) {
    const result = await cli(args, dir);
    assertNoCredentials({ marker }, { stdout: result.stdout, stderr: result.stderr });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /E_WITNESS_INPUT/);
  }
});

test('iOS argument refusals omit values including equals bearers', async () => {
  const dir = tmpdir(), marker = 'BN_EQUALS_BEARER_TEST_NOT_REAL';
  for (const flag of ['token', 'token-file', 'bundle-id', 'udid', 'segment', 'artifacts', 'port', 'timeout', 'prime', 'relaunch', 'smoke', 'build', 'repack', 'app-project', 'unknown']) {
    const result = await cli(['__family', 'ios', `--${flag}=${marker}`], dir);
    assertNoCredentials({ marker }, { stdout: result.stdout, stderr: result.stderr });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /E_WITNESS_INPUT/);
  }
  for (const args of [[marker], ['--token', marker], ['--token-file', marker], ['--port', marker], ['--timeout', marker], ['--bundle-id', marker, '--segment', '!']]) {
    const result = await cli(['__family', 'ios', ...args], dir);
    assertNoCredentials({ marker }, { stdout: result.stdout, stderr: result.stderr });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /E_WITNESS_INPUT/);
  }
});


test('runtime refusals do not echo caller argument values in stderr', async t => {
  const f = await fixture(t), marker = 'BN_REFUSAL_ARGUMENT_VALUE';
  const reply = await cli(['--as', 'alice', '--url', f.url, '--query', marker,
    '--artifacts', join(f.dir, marker)], f.dir);
  assert.notEqual(reply.status, 0);
  assert.match(reply.stderr, /E_WITNESS_INPUT/);
  assertNoCredentials({ marker }, { stderr: reply.stderr });
});
