import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { runWorker } from '../dist/worker.js';
const { WorkerLedger } = await import(process.env.SNAPBACK4_TEST_WORKER_LEDGER ?? '../dist/worker-ledger.js');

const binary = process.env.SNAPBACK4_BIN ?? fileURLToPath(new URL('../../../target/debug/snapback4', import.meta.url));
const workerModule = new URL('../dist/worker.js', import.meta.url).href;
async function until(fn) {
  for (let i = 0; i < 240; i++) { if (await fn()) return; await sleep(50); }
  assert.fail('worker regression timed out');
}
function rows(path) { try { return readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse); } catch { return []; } }
function alive(pid) {
  try {
    process.kill(pid, 0);
    // Orphans can remain zombies until the container's init reaps them.
    if (process.platform === 'linux' && /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false;
    return true;
  } catch { return false; }
}
function fixture(t, source) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-worker-regression-'));
  mkdirSync(join(dir, 'snapback/workers'), { recursive: true });
  writeFileSync(join(dir, 'snapback/schema.q'), "use personas alice\neffect notify\nmutation send():\n  emit notify { message: 'hello' }\n  return true\n");
  if (source) writeFileSync(join(dir, 'snapback/workers/push.mjs'), source);
  const servers = [];
  t.after(async () => {
    for (const s of servers) { if (s.child.exitCode === null && s.child.signalCode === null) s.child.kill('SIGTERM'); await s.done; }
    for (const row of rows(join(dir, 'starts'))) for (const pid of [row.pid, row.helper]) if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, async start(extra = [], env = {}) {
    const child = spawn(binary, ['dev', '--port', '0', '--no-watch', ...extra], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const s = { child, done: once(child, 'exit'), log: '', url: '', events: [] };
    servers.push(s);
    child.stderr.on('data', b => { s.log += b; s.events.push({ at: performance.now(), text: String(b) }); });
    child.stdout.on('data', b => { s.url ||= String(b).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? ''; });
    await until(() => s.url); return s;
  } };
}
const idle = `import { appendFileSync } from 'node:fs';
appendFileSync('starts', JSON.stringify({pid:process.pid,token:process.env.SNAPBACK_SERVICE_TOKEN,ledger:process.env.SNAPBACK_WORKER_LEDGER})+'\\n');
setInterval(()=>{},1000);`;
async function claim(s, token) {
  return fetch(s.url + '/effects/claim', { method: 'POST', headers: { authorization: 'Bearer '+token, 'content-type': 'application/json' }, body: '{"wait":0}' });
}

test('failed revocation blocks restart until the retired bearer is refused', { timeout: 35_000 }, async t => {
  const f = fixture(t, idle), s = await f.start();
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  const first = rows(join(f.dir, 'starts'))[0];
  assert.equal((await claim(s, first.token)).status, 200);
  const db = new DatabaseSync(join(f.dir, '.snapback4/store.sqlite'));
  t.after(() => db.close());
  db.exec('BEGIN IMMEDIATE');
  try {
    process.kill(first.pid, 'SIGKILL');
    await until(() => s.log.includes("cannot close the child's session"));
    assert.equal(rows(join(f.dir, 'starts')).length, 1);
    assert.equal(alive(first.pid), false);
  } finally { db.exec('ROLLBACK'); }
  await until(() => rows(join(f.dir, 'starts')).length === 2);
  assert.equal((await claim(s, first.token)).status, 401, 'retired bearer must not authenticate');
  assert.equal((await claim(s, rows(join(f.dir, 'starts'))[1].token)).status, 200);
  assert.equal(s.log.includes(first.token), false);
});

test('rotation retires the old bearer even while its stored expiry still stands', { timeout: 15_000 }, async t => {
  const f = fixture(t, idle), s = await f.start();
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  const first = rows(join(f.dir, 'starts'))[0];
  const db = new DatabaseSync(join(f.dir, '.snapback4/store.sqlite'));
  // Separate revocation from ordinary expiry: the supervisor retains its
  // original one-day deadline, while this bearer remains valid in storage.
  db.exec("UPDATE _sessions SET expires_at = expires_at + 86400000 WHERE kind = 'service'"); db.close();
  assert.equal((await claim(s, first.token)).status, 200);
  const response = await fetch(s.url + '/dev/clock/advance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"duration":"1d"}' });
  assert.equal(response.status, 200);
  await until(() => rows(join(f.dir, 'starts')).length === 2);
  assert.equal((await claim(s, first.token)).status, 401);
  assert.equal(alive(first.pid), false);
});

for (const where of ['schema', 'root', 'entry', 'helper', 'fifo']) test(`worker snapshot refuses ${where} escapes or non-regular files`, t => {
  const f = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'sb4-external-workers-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'push.mjs'), idle);
  writeFileSync(join(outside, '.env.test'), 'not project source');
  const workers = join(f.dir, 'snapback/workers');
  if (where === 'schema') {
    mkdirSync(join(outside, 'workers'));
    writeFileSync(join(outside, 'schema.q'), 'query hello():\n  return true\n');
    writeFileSync(join(outside, 'workers/push.mjs'), idle);
    rmSync(join(f.dir, 'snapback'), { recursive: true }); symlinkSync(outside, join(f.dir, 'snapback'));
  } else if (where === 'root') { rmSync(workers, { recursive: true }); symlinkSync(outside, workers); }
  else if (where === 'entry') symlinkSync(join(outside, 'push.mjs'), join(workers, 'push.mjs'));
  else if (where === 'helper') symlinkSync(outside, join(workers, 'helpers'));
  else assert.equal(spawnSync('mkfifo', [join(workers, 'pipe')]).status, 0);
  const result = spawnSync(binary, ['deploy', join(f.dir, 'release')], { cwd: f.dir, encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(result.status, 0, 'unsafe source must not deploy');
  assert.match(result.stderr, /worker|symlink|regular/i);
  assert.equal(existsSync(join(f.dir, 'release/releases/1/snapback/workers/.env.test')), false);
});

test('worker snapshot retains regular nested helper bytes and permissions', t => {
  const f = fixture(t, idle);
  mkdirSync(join(f.dir, 'snapback/workers/helpers'));
  const helper = join(f.dir, 'snapback/workers/helpers/send.sh');
  const text = '#!/bin/sh\nprintf helper\n';
  writeFileSync(helper, text); chmodSync(helper, 0o750);
  const result = spawnSync(binary, ['deploy', join(f.dir, 'release')], { cwd: f.dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const copy = join(f.dir, 'release/releases/1/snapback/workers/helpers/send.sh');
  assert.equal(readFileSync(copy, 'utf8'), text);
  assert.equal(statSync(copy).mode & 0o777, 0o750);
});

test('fresh stores and replacement stores cannot replay another store completion', { timeout: 30_000 }, async t => {
  const source = `import { appendFileSync } from 'node:fs';
import { runWorker } from ${JSON.stringify(workerModule)};
appendFileSync('starts',JSON.stringify({pid:process.pid,ledger:process.env.SNAPBACK_WORKER_LEDGER})+'\\n');
await runWorker({url:process.env.SNAPBACK_URL,token:process.env.SNAPBACK_SERVICE_TOKEN,ledger:true,wait:0,
effects:{notify:(_payload,meta)=>{appendFileSync('actions',JSON.stringify({id:meta.id})+'\\n');return 'sent';}}}).done;`;
  const f = fixture(t, source);
  const paths = [], ids = [];
  for (const extra of [['--fresh'], ['--fresh'], [], []]) {
    const s = await f.start(extra);
    await until(() => rows(join(f.dir, 'starts')).length > paths.length);
    paths.push(rows(join(f.dir, 'starts')).at(-1).ledger);
    const response = await fetch(s.url + '/m/send', { method: 'POST', headers: { 'x-snapback-persona': 'alice', 'content-type': 'application/json' }, body: '{"args":{}}' });
    assert.equal((await response.json()).state, 'sent');
    await until(() => rows(join(f.dir, 'actions')).length === paths.length);
    ids.push(rows(join(f.dir, 'actions')).at(-1).id);
    s.child.kill('SIGTERM'); await s.done;
    if (paths.length === 3) for (const suffix of ['', '-wal', '-shm']) rmSync(join(f.dir, '.snapback4/store.sqlite'+suffix), { force: true });
  }
  assert.equal(new Set(ids).size, 1, 'control: distinct stores reused the same effect id');
  assert.equal(new Set(paths).size, 4, 'ledger namespace belongs to actual store identity');
  assert.ok(paths.slice(0, 2).every(p => !p.startsWith(join(f.dir, '.snapback4'))));
});

for (const death of ['worker', 'SIGTERM', 'SIGKILL']) test(`${death} stops worker descendants`, { timeout: 20_000 }, async t => {
  const source = `import { spawn } from 'node:child_process'; import { appendFileSync } from 'node:fs';
const helper=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
appendFileSync('starts',JSON.stringify({pid:process.pid,helper:helper.pid})+'\\n');setInterval(()=>{},1000);`;
  const f = fixture(t, source), s = await f.start();
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  const first = rows(join(f.dir, 'starts'))[0];
  await sleep(150);
  if (death === 'worker') process.kill(first.pid, 'SIGKILL');
  else { s.child.kill(death); await s.done; }
  await until(() => !alive(first.pid) && !alive(first.helper));
  if (death === 'worker') await until(() => rows(join(f.dir, 'starts')).length === 2);
});

for (const bad of ['corrupt', 'schema', 'receipt', 'parent-file']) test(`ledger ${bad} initialization reports once without claiming or settling`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-ledger-invalid-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let path = join(dir, 'ledger.sqlite');
  if (bad === 'corrupt') writeFileSync(path, 'not sqlite');
  else if (bad === 'schema') { const db = new DatabaseSync(path); db.exec('CREATE TABLE completions(wrong TEXT)'); db.close(); }
  else if (bad === 'receipt') { const db = new DatabaseSync(path); db.exec("CREATE TABLE completions(key TEXT PRIMARY KEY, result TEXT NOT NULL) WITHOUT ROWID; INSERT INTO completions VALUES ('one', 'not JSON')"); db.close(); }
  else { writeFileSync(path, 'file'); path += '/nested.sqlite'; }
  let claims = 0, settlements = 0, handlers = 0;
  const errors = [], stop = new AbortController();
  const w = runWorker({ url: 'http://test', token: 'seat', ledger: path, signal: stop.signal, wait: 0,
    effects: { notify: () => { handlers++; } }, onError: e => errors.push(String(e)),
    fetch: async url => { await sleep(1); if (url.endsWith('/claim')) { claims++; return Response.json({effects:[{id:'one',effect:'notify',payload:{},attempt:claims,seq:1,at:0}]}); } settlements++; return Response.json({ok:true}); },
  });
  // Always observe a rejected done as well, so the original broken finally is contained.
  const done = w.done.catch(e => errors.push(String(e)));
  await until(() => errors.length || settlements);
  await sleep(100); stop.abort(); await done;
  assert.equal(claims, 0); assert.equal(settlements, 0); assert.equal(handlers, 0);
  assert.equal(errors.length, 1);
});

test('named workers receive only entry-named declared secrets, defaulting to none', { timeout: 15_000 }, async t => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'snapback/schema.q'), 'effect notify secrets [WK_PUSH_KEY]\neffect digest secrets [WK_MAIL_KEY]\nquery hello():\n  return true\n');
  for (const name of ['push', 'plain']) writeFileSync(join(f.dir, `snapback/workers/${name}.mjs`), `${name === 'push' ? '// snapback4 secrets: WK_PUSH_KEY' : ''}
import { appendFileSync } from 'node:fs';
appendFileSync('starts',JSON.stringify({pid:process.pid,name:${JSON.stringify(name)},push:Object.hasOwn(process.env,'WK_PUSH_KEY'),mail:Object.hasOwn(process.env,'WK_MAIL_KEY')})+'\\n');
setInterval(()=>{},1000);`);
  await f.start([], { WK_PUSH_KEY: 'push-test-value', WK_MAIL_KEY: 'mail-test-value' });
  await until(() => rows(join(f.dir, 'starts')).length === 2);
  for (const row of rows(join(f.dir, 'starts'))) {
    assert.equal(row.push, row.name === 'push'); assert.equal(row.mail, false);
  }
});

test('shutdown starts every worker grace period together', { timeout: 15_000 }, async t => {
  const f = fixture(t);
  for (let i = 0; i < 4; i++) writeFileSync(join(f.dir, `snapback/workers/w${i}.mjs`), `import {appendFileSync} from 'node:fs';
process.on('SIGTERM',()=>appendFileSync('terms',JSON.stringify({pid:process.pid,at:Date.now()})+'\\n'));
appendFileSync('starts',JSON.stringify({pid:process.pid})+'\\n');setInterval(()=>{},1000);`);
  const s = await f.start();
  await until(() => rows(join(f.dir, 'starts')).length === 4);
  s.child.kill('SIGTERM'); await s.done;
  const terms = rows(join(f.dir, 'terms'));
  assert.equal(terms.length, 4);
  assert.ok(Math.max(...terms.map(r => r.at))-Math.min(...terms.map(r => r.at)) < 1500, 'later workers must not wait for an earlier grace period');
  for (const row of terms) assert.equal(alive(row.pid), false);
});

test('repeated secret admission failures increase restart backoff', { timeout: 15_000 }, async t => {
  const f = fixture(t, '// snapback4 secrets: UNDECLARED_KEY\n'+idle), s = await f.start();
  const failures = () => s.events.filter(e => e.text.includes('UNDECLARED_KEY is not a declared'));
  await until(() => failures().length >= 4);
  assert.ok(failures()[3].at-failures()[0].at >= 1400, 'four failures must not repeat at the initial 250ms interval');
  assert.equal(rows(join(f.dir, 'starts')).length, 0);
});

test('SQLite busy retries return the winning receipt to both waiters', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-ledger-busy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stop = new AbortController(), path = join(dir, 'ledger.sqlite');
  const first = await WorkerLedger.open(path, stop.signal), second = await WorkerLedger.open(path, stop.signal);
  t.after(() => { first.close(); second.close(); });
  let entered, release, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const a = first.run('shared', async () => { calls++; entered(); await gate; return 'original-receipt'; }, stop.signal);
  await started;
  const b = second.run('shared', async () => { calls++; return 'wrong-receipt'; }, stop.signal);
  void b.catch(() => {});
  await sleep(100); release();
  assert.deepEqual(await Promise.all([a, b]), ['original-receipt', 'original-receipt']);
  assert.equal(calls, 1);
});

for (const failure of ['disk-full', 'commit-and-rollback']) test(`ledger ${failure} closes storage and stops without failed settlement`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-ledger-runtime-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let initialized = false, claims = 0, settlements = 0;
  const original = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
    if (failure === 'commit-and-rollback' && initialized && (sql === 'COMMIT' || sql === 'ROLLBACK')) throw new Error('injected storage failure');
    const result = original.call(this, sql);
    if (sql === 'COMMIT' && !initialized) {
      initialized = true;
      if (failure === 'disk-full') original.call(this, 'PRAGMA max_page_count = 2');
    }
    return result;
  });
  const errors = [], stop = new AbortController(), path = join(dir, 'ledger.sqlite');
  const w = runWorker({url:'http://test',token:'seat',ledger:path,signal:stop.signal,wait:0,
    effects:{notify:()=> 'x'.repeat(100_000)},onError:e=>errors.push(String(e)),
    fetch:async url=>{ await sleep(1); if(url.endsWith('/claim')) { claims++; return Response.json({effects:[{id:'one',effect:'notify',payload:{},attempt:claims,seq:1,at:0}]}); } settlements++; return Response.json({ok:true}); },
  });
  const done = w.done.catch(e => errors.push(String(e)));
  await until(() => errors.length || settlements); stop.abort(); await done;
  assert.equal(claims, 1); assert.equal(settlements, 0); assert.equal(errors.length, 1);
  assert.match(errors[0], /ledger unavailable/);
  const db = new DatabaseSync(path); db.exec('BEGIN IMMEDIATE; ROLLBACK');
  assert.equal(db.prepare('SELECT count(*) AS n FROM completions').get().n, 0); db.close();
});
