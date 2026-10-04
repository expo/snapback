// @ref LLP 3000.030#15 — the real detached driver, with host tools replaced by owned fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';

const binary = new URL('../../../target/debug/snapback4', import.meta.url).pathname;
const wrapper = new URL('../../snapback4-expo/export-ios.mjs', import.meta.url).pathname;
const shim = new URL('../bin/snapback4.js', import.meta.url).pathname;
const pause = () => new Promise(r => setTimeout(r, 50));
async function until(check, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!check()) { assert.ok(Date.now() < end, label); await pause(); }
}
const read = p => { try { return JSON.parse(fs.readFileSync(p)); } catch { return null; } };
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-background-')));
  const put = (p, text, mode) => { p = path.join(root, p); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, mode ? { mode } : {}); };
  put('package.json', '{}'); put('snapback/schema.q', '');
  put('node_modules/expo/bin/cli', `const fs=require('fs'),path=require('path');const out=process.argv[process.argv.indexOf('--output-dir')+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'bundle.hbc'),process.env.EXPORT_BYTES||'export one');fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify({fileMetadata:{ios:{bundle:'bundle.hbc'}}}));fs.writeFileSync(path.join(out,'assetmap.json'),'{}');`);
  put('bin/snapback4', `#!/bin/sh\nexec '${process.execPath}' '${shim}' "$@"\n`, 0o755);
  put('bin/xcodebuild', '#!/bin/sh\nprintf "Xcode 27.0\\nBuild version 18A1\\n"\n', 0o755);
  put('bin/xcrun', `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2), root=process.cwd();
if(args[0]==='--sdk') { console.log('27.0'); process.exit(0); }
if(args.join(' ')==='simctl list runtimes --json') {
 const event=kind=>fs.appendFileSync(root+'/events.jsonl',JSON.stringify({kind,pid:process.pid,at:Date.now()})+'\\n');
 event('start'); process.on('exit',()=>event('exit'));
 process.on('SIGTERM',()=>process.exit(143));
 const timer=setInterval(()=>{if(fs.existsSync(root+'/continue')){clearInterval(timer);console.log(fs.existsSync(root+'/invalid')?'broken json':'{"runtimes":[]}');}},25);
} else { console.error('unexpected fixture tool args'); process.exit(99); }
`, 0o755);
  // Node interprets an extensionless tool as CommonJS unless the containing
  // package is explicitly ESM; this is only our tool directory.
  put('bin/package.json', '{"type":"module"}');
  const env = { ...process.env, SNAPBACK4_BIN: binary, PATH: path.join(root, 'bin') + ':' + process.env.PATH,
    SNAPBACK4_SMOKE_DEVICE_PREFIX: 'sb4-nz-test-', XDG_STATE_HOME: path.join(root, 'state') };
  delete env.SNAPBACK4_NATIVE_SMOKE;
  const invoke = (bytes = 'export one') => spawnSync(process.execPath, [wrapper], { cwd: root, env: { ...env, EXPORT_BYTES: bytes }, encoding: 'utf8', timeout: 20000 });
  const latest = () => read(path.join(root, 'artifacts/native-smoke/latest.json'));
  const status = (...args) => spawnSync(binary, ['witness', 'status', ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  const events = () => { try { return fs.readFileSync(path.join(root, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch { return []; } };
  return { root, put, env, invoke, latest, status, events };
}
async function cleanup(f) {
  f.put('continue', '');
  // Never remove a live fixture's custody records. Its own driver has a short
  // mocked environment operation and completes under its normal guardian.
  const root = path.join(f.root, 'artifacts/native-smoke');
  if (fs.existsSync(root)) for (const dir of fs.readdirSync(root).filter(n => /^\d+-\d+$/.test(n))) {
    const run = path.join(root, dir);
    await until(() => read(path.join(run, 'result.json')) || fs.existsSync(path.join(run, 'retention.json')) || (read(path.join(run, 'worker.json')) && ['worker', 'driver'].every(role => !alive(read(path.join(run, role + '.json'))?.process?.pid))), 'fixture background result or dead custodians');
    await until(() => {
      const p = read(path.join(run, 'worker.json'))?.process?.pid;
      if (!p) return true;
      try { process.kill(p, 0); return false; } catch { return true; }
    }, 'fixture guardian exited');
  }
  fs.rmSync(f.root, { recursive: true, force: true });
}

test('export publishes before smoke completes, reports pending, then surfaces skip in status/doctor/next export', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const run = f.invoke(); assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(fs.readFileSync(path.join(f.root, 'dist/bundle.hbc'), 'utf8'), 'export one');
    assert.match(run.stdout, /native smoke pending.*background/);
    const latest = f.latest(); assert.ok(latest?.exportHash);
    assert.equal(read(path.join(latest.artifacts, 'result.json')), null);
    await until(() => f.events().length > 0, 'detached driver reached blocked tool after export returned');
    const pending = f.status(); assert.equal(pending.status, 2); assert.match(pending.stdout, /native smoke pending/);
    f.put('continue', '');
    const done = f.status('--wait'); assert.equal(done.status, 2, done.stderr); assert.match(done.stdout, /native smoke skipped/);
    const doctor = spawnSync(binary, ['doctor'], { cwd: f.root, env: f.env, encoding: 'utf8', timeout: 10000 });
    assert.match(doctor.stdout, /native smoke skipped/);
    const next = f.invoke('export two'); assert.equal(next.status, 0, next.stderr);
    assert.match(next.stdout, /native smoke skipped/);
    assert.notEqual(f.latest().exportHash, latest.exportHash);
  } finally { await cleanup(f); }
});

test('new publication supersedes blocked smoke; only one driver enters the tool at a time', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    assert.equal(f.invoke().status, 0);
    const first = f.latest();
    await until(() => f.events().length > 0, 'first driver started');
    const second = f.invoke('new bundle'); assert.equal(second.status, 0, second.stderr);
    await until(() => read(path.join(first.artifacts, 'result.json')), 'first superseded and cleaned');
    assert.equal(read(path.join(first.artifacts, 'result.json')).state, 'superseded');
    await until(() => f.events().filter(x => x.kind === 'start').length === 2, 'second driver started');
    assert.deepEqual(f.events().map(x => x.kind), ['start', 'exit', 'start']);
    assert.equal(fs.readFileSync(path.join(f.root, 'dist/bundle.hbc'), 'utf8'), 'new bundle');
    f.put('continue', ''); assert.equal(f.status('--wait').status, 2);
  } finally { await cleanup(f); }
});

for (const [victim, signal] of [['driver','SIGKILL'], ['worker','SIGKILL'], ['worker','SIGTERM'], ['worker','SIGHUP']]) test(`${signal} of background ${victim} cleans its peer/tools without another export`, { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    assert.equal(f.invoke().status, 0);
    const dir = f.latest().artifacts;
    await until(() => f.events().length > 0, 'owned tool started');
    const pid = read(path.join(dir, victim + '.json')).process.pid;
    const tool = f.events()[0].pid;
    process.kill(pid, signal);
    const result = f.status('--wait'); assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /native smoke failed.*log:/);
    await until(() => { try { process.kill(tool, 0); return false; } catch { return true; } }, 'owned tool drained after peer death');
    assert.equal(fs.readFileSync(path.join(f.root, 'dist/bundle.hbc'), 'utf8'), 'export one');
    f.put('continue', ''); assert.equal(f.invoke('after crash').status, 0);
    assert.equal(f.status('--wait').status, 2);
  } finally { await cleanup(f); }
});

test('interrupting a status observer leaves the detached proof running', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); let observer;
  try {
    assert.equal(f.invoke().status, 0);
    await until(() => f.events().length > 0, 'detached proof started');
    observer = spawn(binary, ['witness','status','--wait'], { cwd: f.root, env: f.env, stdio: 'ignore' });
    const exited = once(observer, 'exit');
    await new Promise(r => setTimeout(r, 200));
    observer.kill('SIGINT');
    const [code, signal] = await exited;
    assert.ok(code === 130 || signal === 'SIGINT');
    assert.equal(f.status().status, 2);
    assert.equal(read(path.join(f.latest().artifacts, 'result.json')), null);
    assert.doesNotThrow(() => process.kill(f.events()[0].pid, 0));
    f.put('continue', ''); assert.equal(f.status('--wait').status, 2);
  } finally {
    if (observer?.exitCode === null && observer?.signalCode === null) { const exited=once(observer,'exit'); observer.kill('SIGTERM'); await exited; }
    await cleanup(f);
  }
});

test('background product failure stays loud without changing export success', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    f.put('invalid', ''); f.put('continue', '');
    const result = f.invoke(); assert.equal(result.status, 0, result.stdout + result.stderr);
    const status = f.status('--wait'); assert.equal(status.status, 1, status.stdout + status.stderr);
    assert.match(status.stdout, /native smoke failed.*invalid JSON.*log:/);
    assert.equal(fs.readFileSync(path.join(f.root, 'dist/bundle.hbc'), 'utf8'), 'export one');
  } finally { await cleanup(f); }
});

test('failed evidence pruning does not rewrite a completed native outcome', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    assert.equal(f.invoke().status, 0);
    await until(() => f.events().length > 0, 'initial recovery finished; proof is running');
    f.put('bin/gzip', '#!/bin/sh\nexit 99\n', 0o755);
    for (let i=1;i<=6;i++) {
      f.put(`artifacts/native-smoke/${i}-1/finished.json`, '{}');
      f.put(`artifacts/native-smoke/${i}-1/result.json`, '{"state":"skipped"}');
      f.put(`artifacts/native-smoke/${i}-1/smoke-ios-run.json`, '{"exitStatus":0,"finishedAt":1}');
    }
    f.put('continue', ''); assert.equal(f.status('--wait').status, 2);
    const dir=f.latest().artifacts;
    await until(() => fs.readFileSync(path.join(dir,'background.log'),'utf8').includes('evidence cleanup deferred'), 'pruning failure is loud');
    assert.equal(read(path.join(dir,'result.json')).state,'skipped');
  } finally { await cleanup(f); }
});

for (const [mode, victim, ready] of [
  ['auto-create-buffered-timeout', 'driver', 'buffered-create-intent.json'],
  ['auto-create-race', 'driver', 'bootstatus-waiting'],
  ['auto-create-race', 'worker', 'bootstatus-waiting'],
]) test(`${victim} death during ${mode} deletes only its recorded simulator`, { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const udid = randomUUID().toUpperCase();
    // The older fixture's race mode only tests live rollback. Crash recovery
    // also lists the created device, whose name must match its creation intent.
    const simctl = fs.readFileSync(new URL('../../../crates/snapback4/tests/fixtures/witness-simctl.py', import.meta.url), 'utf8')
      .replace('    print(udid, flush=True)', "    if mode == 'auto-create-race': (root / 'buffered-create-intent.json').write_text(json.dumps({'name': a[1], 'udid': udid}))\n    print(udid, flush=True)");
    f.put('bin/xcrun', simctl, 0o755);
    Object.assign(f.env, { WITNESS_TEST_DIR: f.root, WITNESS_TEST_MODE: mode, WITNESS_TEST_UDID: udid });
    const exported = f.invoke(); assert.equal(exported.status, 0, exported.stdout + exported.stderr);
    const dir = f.latest().artifacts;
    await until(() => fs.existsSync(path.join(f.root, ready)), 'fixture created its own simulator');
    process.kill(read(path.join(dir, victim + '.json')).process.pid, 'SIGKILL');
    const status = f.status('--wait'); assert.equal(status.status, 1, status.stdout + status.stderr);
    await until(() => fs.existsSync(path.join(f.root, 'deleted-simulator')), 'crash cleanup deleted its exact device');
    assert.equal(fs.readFileSync(path.join(f.root, 'deleted-simulator'), 'utf8'), udid);
    const calls = fs.readFileSync(path.join(f.root, 'simctl-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    for (const call of calls.filter(c => ['delete','shutdown','boot','bootstatus','getenv'].includes(c[0]))) assert.equal(call[1], udid);
    assert.equal(fs.existsSync(path.join(f.env.XDG_STATE_HOME, 'snapback4/witness/simulators', udid + '.json')), false);
    assert.equal(fs.readFileSync(path.join(f.root, 'dist/bundle.hbc'), 'utf8'), 'export one');
  } finally { await cleanup(f); }
});

test('an explicit opt-out supersedes an in-flight proof and reports the new export as skipped', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    assert.equal(f.invoke().status, 0);
    const first = f.latest(); await until(() => f.events().length > 0, 'first driver started');
    // Expo's ordinary output directory is dist when the wrapper opts out.
    const cli = path.join(f.root, 'node_modules/expo/bin/cli');
    fs.writeFileSync(cli, fs.readFileSync(cli, 'utf8').replace("process.argv[process.argv.indexOf('--output-dir')+1]", "(process.argv.includes('--output-dir')?process.argv[process.argv.indexOf('--output-dir')+1]:'dist')"));
    f.env.SNAPBACK4_NATIVE_SMOKE = 'off';
    const skipped = f.invoke('opted out export'); assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
    assert.equal(f.status('--wait').status, 2);
    assert.match(f.status().stdout, /skipped.*SNAPBACK4_NATIVE_SMOKE=off/);
    assert.notEqual(f.latest().exportHash, first.exportHash);
    await until(() => read(path.join(first.artifacts, 'result.json'))?.state === 'superseded', 'old driver cancelled');
  } finally { await cleanup(f); }
});

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function seedPass(f) {
  const exportHash = createHash('sha256').update('export one').digest('hex');
  const generation = randomUUID(), artifacts = path.join(f.root, 'artifacts/native-smoke/1-1');
  const marker = { generation, exportHash, mode: 'background', publishedAt: Date.now() };
  const request = { ...marker, artifacts, target: path.join(f.root, 'dist'), project: f.root };
  f.put('dist/bundle.hbc', 'export one');
  f.put('dist/metadata.json', JSON.stringify({ fileMetadata: { ios: { bundle: 'bundle.hbc' } } }));
  f.put('dist/.snapback4-publication.json', JSON.stringify(marker));
  f.put('artifacts/native-smoke/latest.json', JSON.stringify(request));
  f.put('artifacts/native-smoke/1-1/request.json', JSON.stringify(request));
  f.put('artifacts/native-smoke/1-1/finished.json', '{}');
  f.put('artifacts/native-smoke/1-1/result.json', JSON.stringify({ ...request, state: 'passed', finishedAt: Date.now() }));
  assert.equal(f.status('--wait').status, 0, 'fixture establishes an earlier matching pass');
  return request;
}
function noOldPass(f) {
  const status = f.status('--wait');
  assert.equal(status.status, 2, status.stdout + status.stderr);
  assert.match(status.stdout, /no proof for the current export/);
  assert.doesNotMatch(status.stdout, /native smoke passed/);
  const doctor = spawnSync(binary, ['doctor'], { cwd: f.root, env: f.env, encoding: 'utf8', timeout: 10000 });
  assert.match(doctor.stdout, /no proof for the current export/);
  assert.doesNotMatch(doctor.stdout, /native smoke passed/);
}
for (const bytes of ['export one', 'changed export']) test(`failed latest handoff cannot report an older pass (${bytes})`, { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const previous = seedPass(f);
    // write() creates this exact temporary file. A directory fails before
    // rename, leaving the old latest pointer byte-for-byte intact.
    fs.mkdirSync(path.join(f.root, 'artifacts/native-smoke/latest.json.tmp'));
    const result = f.invoke(bytes);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /native smoke failed to start/);
    assert.equal(fs.readFileSync(path.join(f.root, 'dist/bundle.hbc'), 'utf8'), bytes);
    assert.deepEqual(f.latest(), previous);
    assert.notEqual(read(path.join(f.root, 'dist/.snapback4-publication.json')).generation, previous.generation);
    noOldPass(f);
  } finally { await cleanup(f); }
});
for (const reason of ['off', 'non-macOS']) test(`failed export-skipped handoff cannot report an older pass (${reason}, equal bytes)`, async () => {
  const f = fixture();
  try {
    const previous = seedPass(f);
    const cli = path.join(f.root, 'node_modules/expo/bin/cli');
    fs.writeFileSync(cli, fs.readFileSync(cli, 'utf8').replace("process.argv[process.argv.indexOf('--output-dir')+1]", "(process.argv.includes('--output-dir')?process.argv[process.argv.indexOf('--output-dir')+1]:'dist')"));
    f.put('bin/snapback4', `#!/bin/sh\nif [ "$2" = export-skipped ]; then echo 'injected skip handoff failure' >&2; exit 77; fi\nexec '${process.execPath}' '${shim}' "$@"\n`, 0o755);
    if (reason === 'off') f.env.SNAPBACK4_NATIVE_SMOKE = 'off';
    else {
      f.put('platform.cjs', "Object.defineProperty(process,'platform',{value:'linux'})");
      f.env.NODE_OPTIONS = '--require=' + path.join(f.root, 'platform.cjs');
    }
    const result = f.invoke(); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /native smoke status update failed/);
    assert.deepEqual(f.latest(), previous);
    noOldPass(f);
    // A missing marker is also unverified, even with identical bundle bytes.
    fs.unlinkSync(path.join(f.root, 'dist/.snapback4-publication.json'));
    noOldPass(f);
  } finally { await cleanup(f); }
});

function blockedRetention(f) {
  for (let i = 1; i <= 6; i++) {
    f.put(`artifacts/native-smoke/${i}-1/finished.json`, '{}');
    f.put(`artifacts/native-smoke/${i}-1/result.json`, '{"state":"skipped"}');
  }
  // Only the first compressor blocks. Its child ignores TERM too; the native
  // keeper must drain the complete group, including after guardian SIGKILL.
  f.put('bin/gzip', `#!${process.execPath}
const fs=require('fs'),{spawn,spawnSync}=require('child_process');
const root=process.cwd();
if(fs.existsSync(root+'/compression.json')) {
 const result=spawnSync('/usr/bin/gzip',process.argv.slice(2),{stdio:'inherit'});process.exit(result.status??1);
}
process.on('SIGTERM',()=>{});
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
fs.writeFileSync(root+'/compression.json',JSON.stringify({pid:process.pid,child:child.pid}));
setInterval(()=>{},1000);
`, 0o755);
  // This tool is CommonJS despite the fixture bin directory's ESM default.
  const script = path.join(f.root, 'bin/gzip'); fs.renameSync(script, script + '.cjs');
  f.put('bin/gzip', `#!/bin/sh\nexec '${process.execPath}' '${script}.cjs' "$@"\n`, 0o755);
}
for (const [phase, mode] of [['before','SIGTERM'], ['before','SIGKILL'], ['before','supersede'], ['before','deadline'], ['after','SIGTERM'], ['after','SIGKILL'], ['after','supersede']]) test(`blocked retention has bounded custody: ${phase} ${mode}`, { skip: process.platform !== 'darwin', timeout: 90000 }, async () => {
  const f = fixture();
  try {
    if (phase === 'before') blockedRetention(f);
    assert.equal(f.invoke().status, 0);
    const first = f.latest();
    if (phase === 'after') {
      await until(() => f.events().length > 0, 'driver started before retention fixture');
      blockedRetention(f); f.put('continue', '');
      assert.equal(f.status('--wait').status, 2);
    }
    await until(() => read(path.join(f.root, 'compression.json')), 'retention entered blocked compressor');
    const compressor = read(path.join(f.root, 'compression.json'));
    const worker = read(path.join(first.artifacts, 'worker.json')).process.pid;
    const retentionRoot = path.join(f.root, 'artifacts/native-smoke');
    const custodyDir = fs.readdirSync(retentionRoot).find(name => name.startsWith('.retention-') && read(path.join(retentionRoot, name, 'retention-group.json')));
    const custody = read(path.join(retentionRoot, custodyDir, 'retention-group.json'));
    assert.ok(custody?.guardian?.pid && custody?.group, 'retention journal exists before arbitrary compression');
    const started = Date.now();
    // The second retention invocation must defer without waiting for the lock.
    const contender = spawnSync(binary, ['witness', 'export-cleanup', path.join(f.root, 'artifacts/native-smoke')], { cwd: f.root, env: f.env, encoding: 'utf8', timeout: 10000 });
    assert.equal(contender.status, 1, contender.stdout + contender.stderr);
    assert.match(contender.stderr, /retention lock busy/);
    if (mode.startsWith('SIG')) process.kill(worker, mode);
    else if (mode === 'supersede') assert.equal(f.invoke('new publication').status, 0);
    await until(() => !alive(compressor.pid) && !alive(compressor.child), 'compressor and child drained without recovery', 45000);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < (mode === 'deadline' ? 40000 : 10000), `retention cancellation took ${elapsed} ms`);
    await until(() => !alive(worker) && !alive(custody.guardian.pid) && !alive(custody.group), 'guardian and native keeper release custody');
    if (mode === 'deadline') {
      assert.ok(elapsed > 25000, `real 30-second deadline was exercised: ${elapsed}`);
      assert.match(read(path.join(first.artifacts, 'result.json')).reason, /30-second deadline/);
    }
    await until(() => !alive(worker), 'guardian releases its background lease');
    if (mode !== 'supersede') assert.equal(f.invoke('new publication').status, 0);
    await until(() => f.events().length > 0, 'new proof acquired the lease and reached its tool');
    f.put('continue', ''); assert.equal(f.status('--wait').status, 2);
    console.log(`retention ${phase} ${mode}: compressor group drained in ${elapsed} ms; newer proof started`);
  } finally { await cleanup(f); }
});
