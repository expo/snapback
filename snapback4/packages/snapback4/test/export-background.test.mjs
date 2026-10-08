// @ref LLP 3000.030#15 — the real detached driver, with host tools replaced by owned fixtures.
import { test as nodeTest } from 'node:test';
import { fixtureWorkMs, fixtureTestMs } from '../../../scripts/test-work-bounds.mjs';
// Each case keeps its state and product-deadline assertions. The outer guard
// allows real wrapper/native process work under the ordinary file allowance.
const test = (name, options, body) => nodeTest(name, { ...(typeof options === 'function' ? {} : options), timeout: fixtureTestMs() }, body ?? options);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkedSpawnSync as spawnSync } from './helpers/fixture-command.mjs';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { maintenanceEvidence, watchMaintenance, observedMaintenance } from './helpers/maintenance-evidence.mjs';
import { signalChild, spawnTracked as spawn } from '../../../scripts/test-signals.mjs';
import { signalFixture } from './helpers/fixture-signals.mjs';
import { waitForPublisher, killPausedPublisher, releasePublisherBarrier } from './helpers/publication-barrier.mjs';

// Use one spelling for launch and exact identity checks, including Darwin's
// /private temporary roots and native workers spawned via current_exe().
const binary = fs.realpathSync(process.env.SNAPBACK4_EXPORT_TEST_BINARY || new URL('../../../target/debug/snapback4', import.meta.url));
const wrapper = new URL('../../snapback4-expo/export-ios.mjs', import.meta.url).pathname;
const shim = new URL('../bin/snapback4.js', import.meta.url).pathname;
const pause = () => new Promise(r => setTimeout(r, 50));
async function until(check, label, timeout = 30000, signal) {
  const end = performance.now() + timeout;
  for (;;) {
    signal?.throwIfAborted();
    if (check()) return;
    assert.ok(performance.now() < end, label); await pause();
  }
}
const read = p => { try { return JSON.parse(fs.readFileSync(p)); } catch { return null; } };
function fixture({ normalPriority = true } = {}) {
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
 process.on('exit',()=>event('exit'));
 process.on('SIGTERM',()=>process.exit(143));
 const timer=setInterval(()=>{if(fs.existsSync(root+'/continue')){clearInterval(timer);console.log(fs.existsSync(root+'/invalid')?'broken json':'{"runtimes":[]}');}},25);
 event('start'); // Readiness includes the handlers needed by supersession.
} else { console.error('unexpected fixture tool args'); process.exit(99); }
`, 0o755);
  // Node interprets an extensionless tool as CommonJS unless the containing
  // package is explicitly ESM; this is only our tool directory.
  put('bin/package.json', '{"type":"module"}');
  const env = { ...process.env, SNAPBACK4_BIN: binary, PATH: path.join(root, 'bin') + ':' + process.env.PATH,
    SNAPBACK4_SMOKE_DEVICE_PREFIX: 'sb4-nz-test-', XDG_STATE_HOME: path.join(root, 'state') };
  // Debug-only seam: queue/custody assertions must not depend on Darwin's
  // discretionary background I/O scheduling. The production-policy case below
  // explicitly removes it, including any value inherited from the test runner.
  if (normalPriority) env.SNAPBACK4_TEST_EXPORT_NORMAL_PRIORITY = '1';
  else delete env.SNAPBACK4_TEST_EXPORT_NORMAL_PRIORITY;
  delete env.SNAPBACK4_NATIVE_SMOKE;
  const maintainers = [];
  const invoke = (bytes = 'export one') => {
    const result = spawnSync(process.execPath, [wrapper], { cwd: root, env: { ...env, EXPORT_BYTES: bytes }, encoding: 'utf8', timeout: fixtureWorkMs, killSignal: 'SIGKILL' });
    const dir = read(path.join(root, 'artifacts/native-smoke/latest.json'))?.artifacts;
    const pid = dir && read(path.join(dir, 'maintenance-launch.json'))?.process?.pid;
    if (pid) maintainers.push(pid);
    return result;
  };
  const latest = () => read(path.join(root, 'artifacts/native-smoke/latest.json'));
  const status = (...args) => spawnSync(binary, ['witness', 'status', ...args], { cwd: root, env, encoding: 'utf8', timeout: fixtureWorkMs, killSignal: 'SIGKILL' });
  const events = () => { try { return fs.readFileSync(path.join(root, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch { return []; } };
  const f = { root, put, env, invoke, latest, status, events, maintainers };
  f.stopMaintenanceWatch = watchMaintenance(f);
  return f;
}
async function cleanup(f) {
  f.put('continue', '');
  f.put('stop-compression', '');
  // Never remove a live fixture's custody records. Its own driver has a short
  // mocked environment operation and completes under its normal guardian.
  const root = path.join(f.root, 'artifacts/native-smoke');
  await maintenanceIdle(f, true);
  await until(() => f.maintainers.every(pid => !alive(pid)), 'detached maintenance exited', 90000);
  if (fs.existsSync(root)) for (const dir of fs.readdirSync(root).filter(n => /^\d+-\d+$/.test(n))) {
    const run = path.join(root, dir);
    await until(() => !alive(read(path.join(run, 'maintenance-launch.json'))?.process?.pid), 'maintenance custodian exited', 90000);
    await until(() => read(path.join(run, 'result.json')) || fs.existsSync(path.join(run, 'retention.json')) || (['worker', 'driver', 'launch'].every(role => !alive(read(path.join(run, role + '.json'))?.process?.pid)) && !alive(read(path.join(run, 'live.json'))?.wrapper?.pid) && !alive(read(path.join(run, 'live.json'))?.owner?.pid)), 'fixture background result or dead custodians');
    await until(() => !alive(read(path.join(run, 'worker.json'))?.process?.pid), 'fixture guardian exited');
  }
  if (fs.existsSync(root)) for (const dir of fs.readdirSync(root).filter(n => n.startsWith('.retention-'))) {
    const custody = read(path.join(root, dir, 'retention-group.json'));
    if (custody) await until(() => !alive(custody.group) && !alive(custody.guardian?.pid), 'fixture retention keeper and guardian exited', 90000);
  }
  if (process.env.SNAPBACK4_MAINTENANCE_EVIDENCE) await maintenanceEvidence(f, 'cleanup');
  f.stopMaintenanceWatch();
  fs.rmSync(f.root, { recursive: true, force: true });
}

for (const normalPriority of [false,true]) test(`Darwin export launch policy: ${normalPriority?'normal fixture':'production background'}`, {skip:process.platform!=='darwin',timeout:120000}, async()=>{
  const f=fixture({normalPriority});
  try {
    f.env.SNAPBACK4_TEST_RETENTION_POINT='observer-wakeup';
    f.put('continue','');
    const run=f.invoke();assert.equal(run.status,0,run.stdout+run.stderr);
    const root=path.join(f.root,'artifacts/native-smoke'),dir=f.latest().artifacts;
    const point=path.join(root,'maintenance-test-point.json');
    // A small policy probe, with no history to compress. The background path
    // retains its discretionary scheduling; existing semantic waits below do
    // not receive this probe's startup allowance.
    await until(()=>read(point)?.point==='observer-wakeup' && read(path.join(dir,'worker.json')) && read(path.join(dir,'driver.json')),
      'observer, proof custodian and driver recorded their own policy',90000);
    const expected=normalPriority?0:1;
    assert.equal(read(point).darwinBackground,expected,'maintenance observer policy');
    assert.equal(read(path.join(dir,'worker.json')).darwinBackground,expected,'proof custodian policy');
    assert.equal(read(path.join(dir,'driver.json')).darwinBackground,expected,'proof driver inherited policy');
  } finally {f.put('artifacts/native-smoke/maintenance-test-resume','');await cleanup(f);}
});

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
    const doctor = spawnSync(binary, ['doctor'], { cwd: f.root, env: f.env, encoding: 'utf8', timeout: fixtureWorkMs, killSignal: 'SIGKILL' });
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
    const record = read(path.join(dir, victim + '.json')).process;
    const tool = f.events()[0].pid;
    await signalFixture(f, record, signal);
    const result = f.status('--wait'); assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /native smoke failed.*log:/);
    await until(() => !alive(tool), 'owned tool drained after peer death');
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
    await signalChild(observer, 'SIGINT');
    const [code, signal] = await exited;
    assert.ok(code === 130 || signal === 'SIGINT');
    assert.equal(f.status().status, 2);
    assert.equal(read(path.join(f.latest().artifacts, 'result.json')), null);
    assert.ok(alive(f.events()[0].pid), 'owned tool remains alive');
    f.put('continue', ''); assert.equal(f.status('--wait').status, 2);
  } finally {
    if (observer?.exitCode === null && observer?.signalCode === null) { const exited=once(observer,'exit'); await signalChild(observer, 'SIGTERM'); await exited; }
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
      // These three JS cases inject death through signalFixture. The shared
      // Rust fixture also has interrupt modes that signal their parent/group;
      // forbid those unused modes in this copy instead of installing another
      // unvalidated signal dispatcher in the background fixture.
      .replaceAll('os.kill(os.getppid(), signal.SIGINT)', "raise AssertionError('parent faults belong to signalFixture')")
      .replace('os.killpg(os.getpgid(os.getppid()), signal.SIGINT)', "raise AssertionError('group faults are not enabled in this fixture')")
      .replace('    print(udid, flush=True)', "    if mode == 'auto-create-race': (root / 'buffered-create-intent.json').write_text(json.dumps({'name': a[1], 'udid': udid}))\n    print(udid, flush=True)");
    assert.doesNotMatch(simctl, /\bos\.kill(?:pg)?\(/, 'copied simctl fixture must not dispatch signals');
    f.put('bin/xcrun', simctl, 0o755);
    Object.assign(f.env, { WITNESS_TEST_DIR: f.root, WITNESS_TEST_MODE: mode, WITNESS_TEST_UDID: udid });
    const exported = f.invoke(); assert.equal(exported.status, 0, exported.stdout + exported.stderr);
    const dir = f.latest().artifacts;
    const marker = path.join(f.root, ready);
    await until(() => ready.endsWith('.json') ? read(marker)?.udid === udid : fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === udid, 'fixture recorded its complete simulator identity');
    await signalFixture(f, read(path.join(dir, victim + '.json')).process, 'SIGKILL');
    const status = f.status('--wait'); assert.equal(status.status, 1, status.stdout + status.stderr);
    const owner = path.join(f.env.XDG_STATE_HOME, 'snapback4/witness/simulators', udid + '.json');
    // The mock writes its delete marker before simctl returns. Recovery then
    // unlinks ownership, finishes the journal and releases its process leases.
    // Observe the end of that sequence before reading the complete call log.
    await until(() => fs.existsSync(path.join(f.root, 'deleted-simulator')) && !fs.existsSync(owner), 'crash cleanup deleted its device and removed its ownership record', 90000);
    await until(() => ['worker', 'driver'].every(role => {
      const pid = read(path.join(dir, role + '.json'))?.process?.pid;
      return pid && !alive(pid);
    }), 'simulator cleanup custodians exited before final assertions', 90000);
    assert.equal(fs.readFileSync(path.join(f.root, 'deleted-simulator'), 'utf8'), udid);
    const calls = fs.readFileSync(path.join(f.root, 'simctl-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    for (const call of calls.filter(c => ['delete','shutdown','boot','bootstatus','getenv'].includes(c[0]))) assert.equal(call[1], udid);
    assert.equal(fs.existsSync(owner), false);
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
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
    }
    const status = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
    if (status.status === 1 && !status.stdout.trim()) return false;
    assert.equal(status.status, 0, status.error?.message ?? status.stderr);
    return !status.stdout.trim().startsWith('Z');
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return false;
    throw error;
  }
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
  const doctor = spawnSync(binary, ['doctor'], { cwd: f.root, env: f.env, encoding: 'utf8', timeout: fixtureWorkMs, killSignal: 'SIGKILL' });
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
    fs.mkdirSync(path.join(f.root, 'artifacts/native-smoke/latest.json.tmp')); // fail the in-transaction skip handoff
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

function blockedRetention(f, full = 0) {
  for (let i = 1; i <= (full || 6); i++) {
    if (full) f.put(`artifacts/native-smoke/${i}-1/export/bundle.hbc`, `real retained export ${i}`);
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
// Fixture-only escape hatch: each living member kills its own group. No
// recycled PID/group can be signalled by the test, and this is armed only
// by teardown, after the product's unaided drain assertions.
const stop=()=>{if(fs.existsSync(root+'/stop-compression'))require(${JSON.stringify(new URL('../../../scripts/test-owned-command.mjs', import.meta.url).pathname)}).signalSelf('SIGKILL',{group:true});};
const child=spawn(process.execPath,['-e',${JSON.stringify("const fs=require('fs');const {signalSelf}=require("+JSON.stringify(new URL('../../../scripts/test-owned-command.mjs', import.meta.url).pathname)+");process.on('SIGTERM',()=>{});setInterval(()=>{if(fs.existsSync('stop-compression'))signalSelf('SIGKILL',{group:true});},25)")}],{stdio:'ignore'});
setInterval(stop,25);
fs.writeFileSync(root+'/compression.json',JSON.stringify({pid:process.pid,child:child.pid}));
setInterval(()=>{},1000);
`, 0o755);
  // This tool is CommonJS despite the fixture bin directory's ESM default.
  const script = path.join(f.root, 'bin/gzip'); fs.renameSync(script, script + '.cjs');
  f.put('bin/gzip', `#!/bin/sh\nexec '${process.execPath}' '${script}.cjs' "$@"\n`, 0o755);
}
// LLP 3000.030 §15: 30 s retention work + at most 60 s native drain.
// Observation includes scheduling slack; completion still requires every
// recorded process to be gone. The outer guard includes setup and teardown.
const custodyObservationMs = 105000;
for (const [phase, mode] of [['before','SIGTERM'], ['before','SIGKILL'], ['before','supersede'], ['before','deadline'], ['after','SIGTERM'], ['after','SIGKILL'], ['after','supersede']]) test(`blocked retention has bounded custody: ${phase} ${mode}`, { skip: process.platform !== 'darwin' && phase === 'after', timeout: 300000 }, async t => {
  const f = fixture(); let pending;
  // The pre-driver custody is portable. Only the fixture wrapper selects its
  // background branch on Linux; the real binary still refuses iOS preparation.
  if (process.platform !== 'darwin') {
    f.put('background-platform.cjs', "Object.defineProperty(process,'platform',{value:'darwin'})");
    f.env.NODE_OPTIONS = `${f.env.NODE_OPTIONS || ''} --require=${path.join(f.root,'background-platform.cjs')}`;
  }
  const wait = (check, label) => until(check, label, custodyObservationMs, t.signal);
  const finished = async dir => {
    await wait(() => read(path.join(dir,'result.json')), 'proof outcome committed');
    const result = read(path.join(dir,'result.json'));
    assert.equal(result.state, process.platform === 'darwin' ? 'skipped' : 'failed');
    const status = f.status();
    assert.equal(status.status, process.platform === 'darwin' ? 2 : 1, status.stdout + status.stderr);
    if (process.platform !== 'darwin') {
      assert.match(fs.readFileSync(path.join(dir,'background.log'),'utf8'), /E_WITNESS_PLATFORM.*requires macOS/);
      assert.ok(read(path.join(dir,'driver.json')), 'real driver acquired the lease');
    }
  };
  const release = () => {
    f.put('stop-compression', ''); f.put('continue', '');
    pending?.child.stdin.end();
  };
  // Node cancels the test at its guard; it does not cancel an arbitrary async
  // body. Abort-aware waits stop that body, and after() awaits cleanup even on
  // timeout. The fixture escape hatch does not depend on working product custody.
  t.signal.addEventListener('abort', release, { once: true });
  t.after(async () => {
    t.signal.removeEventListener('abort', release);
    release();
    if (pending) await pending.exited;
    const compressor = read(path.join(f.root,'compression.json'));
    if (compressor) await until(() => !alive(compressor.pid) && !alive(compressor.child), 'fixture compression group reaped during teardown');
    await cleanup(f);
  });
  pending = await holdRetention(f, 'maintenance', t.signal);
  if (phase === 'before') blockedRetention(f);
  const invoked = f.invoke(); assert.equal(invoked.status, 0, invoked.stdout + invoked.stderr);
  const first = f.latest();
  if (phase === 'after') {
    await wait(() => f.events().length > 0, 'driver started before retention fixture');
    blockedRetention(f); f.put('continue', '');
    await finished(first.artifacts);
  }
  await wait(() => read(path.join(f.root, 'compression.json')), 'retention entered blocked compressor');
  const compressor = read(path.join(f.root, 'compression.json'));
  const worker = read(path.join(first.artifacts, 'worker.json')).process.pid;
  const retentionRoot = path.join(f.root, 'artifacts/native-smoke');
  const custodyDir = fs.readdirSync(retentionRoot).find(name => name.startsWith('.retention-') && read(path.join(retentionRoot, name, 'retention-group.json')));
  const custody = read(path.join(retentionRoot, custodyDir, 'retention-group.json'));
  assert.ok(custody?.guardian?.pid && custody?.group, 'retention journal exists before arbitrary compression');
  for (const pid of [compressor.pid, compressor.child]) assert.equal(Number(spawnSync('ps', ['-o','pgid=','-p',String(pid)], {encoding:'utf8'}).stdout.trim()), custody.group, 'compressor descendants share the recorded anchor group');
  // The second retention invocation must defer without waiting for the lock.
  const contender = spawnSync(binary, ['witness', 'export-cleanup', retentionRoot], { cwd: f.root, env: f.env, encoding: 'utf8', timeout: fixtureWorkMs, killSignal: 'SIGKILL' });
  assert.equal(contender.status, 1, contender.stdout + contender.stderr);
  assert.match(contender.stderr, /retention lock busy/);
  const started = performance.now();
  if (mode.startsWith('SIG')) await signalFixture(f, read(path.join(first.artifacts, 'worker.json')).process, mode);
  else if (mode === 'supersede') assert.equal(f.invoke('new publication').status, 0);
  await wait(() => !alive(compressor.pid) && !alive(compressor.child) && !alive(custody.guardian.pid) && !alive(custody.group), 'compressor, child, guardian and keeper drained without recovery');
  const elapsed = performance.now() - started;
  if (mode === 'deadline') {
    // Evidence of the actual product deadline, not an elapsed-time guess.
    await wait(() => fs.readFileSync(path.join(first.artifacts, 'background.log'), 'utf8').includes('30-second deadline'), 'retention deadline reported');
    assert.match(fs.readFileSync(path.join(first.artifacts, 'background.log'), 'utf8'), /cleanup deferred:.*30-second deadline/);
    // The directory timestamps the work's start. Time spent scheduling the
    // compressor or checking the contender already consumes that budget.
    const retentionStarted = Number(custodyDir.slice(custodyDir.lastIndexOf('-') + 1));
    assert.ok(Number.isSafeInteger(retentionStarted) && Date.now() - retentionStarted >= 25000, 'real 30-second deadline was exercised');
    if (process.platform === 'darwin') await wait(() => f.events().length > 0, 'proof continues after retention deadline');
    f.put('continue', ''); await finished(first.artifacts);
  }
  await wait(() => !alive(worker), 'guardian releases its background lease');
  if (mode !== 'supersede') assert.equal(f.invoke('new publication').status, 0);
  const next = f.latest(); assert.notEqual(next.generation, first.generation);
  if (process.platform === 'darwin') await wait(() => f.events().length > 0, 'new proof acquired the lease and reached its tool');
  f.put('continue', ''); await finished(next.artifacts);
  console.log(`retention ${phase} ${mode}: complete custody drained in ${Math.round(elapsed)} ms; newer proof started`);
});


for (const fault of ['marker', 'handoff']) test(`overlapping skipped export cannot inherit a concurrent publication's proof (${fault} failure)`, { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); let skipped;
  try {
    seedPass(f);
    const cli = path.join(f.root, 'node_modules/expo/bin/cli');
    fs.appendFileSync(cli, `if(process.env.PAUSE_SKIP){fs.writeFileSync('skip-ready','');while(!fs.existsSync('resume-skip'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);fs.writeFileSync(path.join(out,'assetmap.json'),'changed assets');}`);
    f.put('marker-fault.cjs', "const fs=require('fs'),write=fs.writeFileSync;fs.writeFileSync=function(p,...a){if(String(p).endsWith('.snapback4-publication.json'))throw Error('injected skipped marker write failure');return write.call(this,p,...a)}");
    const env = { ...f.env, SNAPBACK4_NATIVE_SMOKE:'off', PAUSE_SKIP:'1', ...(fault==='marker'?{NODE_OPTIONS:'--require='+path.join(f.root,'marker-fault.cjs')}:{}) };
    skipped = spawn(process.execPath, [wrapper], {cwd:f.root,env,stdio:['ignore','pipe','pipe']});
    let output=''; skipped.stdout.on('data',b=>output+=b); skipped.stderr.on('data',b=>output+=b);
    const ended=once(skipped,'close'); // Include delivery of the failure diagnostic.
    await until(()=>fs.existsSync(path.join(f.root,'skip-ready')),'skipped private export paused before marker');
    // Real wrapper + atomic publisher, equal Hermes bytes, a distinct generation.
    f.put('continue',''); assert.equal(f.invoke().status,0);
    assert.equal(f.status('--wait').status,2);
    const current=f.latest();
    await until(()=>!alive(read(path.join(current.artifacts,'worker.json'))?.process?.pid),'concurrent proof fixture finished');
    f.put(path.relative(f.root,path.join(current.artifacts,'result.json')),JSON.stringify({...current,state:'passed',finishedAt:Date.now()}));
    assert.equal(f.status('--wait').status,0,'seeded pass for concurrently published generation');
    if(fault==='handoff')fs.mkdirSync(path.join(f.root,'artifacts/native-smoke/latest.json.tmp'));
    f.put('resume-skip',''); const [code]=await ended;
    if(fault==='marker') {
      assert.equal(code,1,output); assert.match(output,/injected skipped marker write failure/);
      assert.equal(fs.readFileSync(path.join(f.root,'dist/assetmap.json'),'utf8'),'{}','failed private preparation cannot mutate visible assets');
      assert.equal(read(path.join(f.root,'dist/.snapback4-publication.json')).generation,current.generation);
    } else {
      assert.equal(code,0,output); assert.match(output,/native smoke status update failed/);
      assert.equal(fs.readFileSync(path.join(f.root,'dist/assetmap.json'),'utf8'),'changed assets');
      assert.notEqual(read(path.join(f.root,'dist/.snapback4-publication.json')).generation,current.generation);
      assert.deepEqual(f.latest(),current); noOldPass(f);
    }
  } finally {
    f.put('resume-skip','');
    if(skipped?.exitCode===null&&skipped?.signalCode===null)await once(skipped,'exit');
    await cleanup(f);
  }
});

test('first opt-out publishes a complete skipped handoff', async()=>{
  const f=fixture();
  try {
    f.env.SNAPBACK4_NATIVE_SMOKE='off';
    const result=f.invoke(); assert.equal(result.status,0,result.stdout+result.stderr);
    assert.ok(f.latest()?.generation);
    const status=f.status('--wait'); assert.equal(status.status,2); assert.match(status.stdout,/native smoke skipped/); assert.doesNotMatch(status.stdout,/handoff missing or stale/);
    assert.equal(read(path.join(f.latest().artifacts,'result.json')).state,'skipped');
  } finally {await cleanup(f);}
});

test('request timestamp begins at publication commit, not private marker creation', {skip:process.platform!=='darwin'},async()=>{
  const f=fixture();
  try {
    f.put('old-clock.cjs','Date.now=()=>1'); f.env.NODE_OPTIONS='--require='+path.join(f.root,'old-clock.cjs');
    const started=Date.now(); const result=f.invoke(); assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(read(path.join(f.root,'dist/.snapback4-publication.json')).publishedAt,1);
    assert.ok(f.latest().publishedAt>=started,'request uses verified commit time');
    assert.equal(f.latest().publishedAt,read(path.join(f.latest().artifacts,'publication.json')).verifiedAt);
    assert.equal(f.status().status,2); assert.match(f.status().stdout,/pending/);
  } finally {await cleanup(f);}
});

test('direct export-retain has bounded custody and the inner worker rejects manual use', {skip:process.platform!=='darwin'},async()=>{
  const f=fixture();let caller;
  try {
    const root=path.join(f.root,'artifacts/native-smoke');blockedRetention(f);
    const refused=spawnSync(binary,['witness','export-retain-worker',root,root],{cwd:f.root,env:f.env,encoding:'utf8'});
    assert.equal(refused.status,1);assert.match(refused.stderr,/requires native custody/);assert.equal(read(path.join(f.root,'compression.json')),null);
    caller=spawn(binary,['witness','export-retain',root],{cwd:f.root,env:f.env,stdio:'ignore'});const ended=once(caller,'exit');
    await until(()=>read(path.join(f.root,'compression.json')),'direct retention compressor entered');
    const compressor=read(path.join(f.root,'compression.json'));await signalChild(caller, 'SIGTERM');await ended;
    await until(()=>!alive(compressor.pid)&&!alive(compressor.child),'direct retention descendants drained');
  } finally {
    if(caller?.exitCode===null&&caller?.signalCode===null){const ended=once(caller,'exit');await signalChild(caller, 'SIGTERM');await ended;}
    await cleanup(f);
  }
});

test('SIGKILL overlap defers a still-held retention lock and starts the next proof', {skip:process.platform!=='darwin'},async()=>{
  const f=fixture();let custody,pending;
  try {
    pending=await holdRetention(f,'maintenance');
    const library=path.join(f.root,'r.dylib');
    const built=spawnSync('cc',['-dynamiclib',new URL('./retention-interposer.c',import.meta.url).pathname,'-o',library],{encoding:'utf8'});
    assert.equal(built.status,0,built.stderr);
    // taskpolicy strips DYLD_*; add the test interposer to a private copy's
    // Mach-O load commands instead. No product binary or system tool is edited.
    const injected=path.join(f.root,'snapback4-interposed');
    fs.copyFileSync(binary,injected,fs.constants.COPYFILE_FICLONE);fs.chmodSync(injected,0o755);
    const fd=fs.openSync(injected,'r+');
    try {
      const header=Buffer.alloc(32);fs.readSync(fd,header,0,32,0);assert.equal(header.readUInt32LE(0),0xfeedfacf);
      const size=header.readUInt32LE(20),commands=Buffer.alloc(size);fs.readSync(fd,commands,0,size,32);
      let firstSection=Infinity;
      for(let offset=0;offset<size;offset+=commands.readUInt32LE(offset+4))if(commands.readUInt32LE(offset)===0x19){
        for(let n=0;n<commands.readUInt32LE(offset+64);n++){
          const fileOffset=commands.readUInt32LE(offset+72+n*80+48);if(fileOffset)firstSection=Math.min(firstSection,fileOffset);
        }
      }
      const name=Buffer.from('@loader_path/r.dylib\0'),load=Buffer.alloc(Math.ceil((24+name.length)/8)*8);
      load.writeUInt32LE(0xc,0);load.writeUInt32LE(load.length,4);load.writeUInt32LE(24,8);name.copy(load,24);
      assert.ok(32+size+load.length<=firstSection,'load command fits existing header padding');
      const padding=Buffer.alloc(load.length);fs.readSync(fd,padding,0,padding.length,32+size);assert.deepEqual(padding,Buffer.alloc(load.length));
      fs.writeSync(fd,load,0,load.length,32+size);header.writeUInt32LE(header.readUInt32LE(16)+1,16);header.writeUInt32LE(size+load.length,20);fs.writeSync(fd,header,0,32,0);
    } finally {fs.closeSync(fd);}
    const signed=spawnSync('codesign',['--force','--sign','-',injected],{encoding:'utf8'});assert.equal(signed.status,0,signed.stderr);
    f.env.SNAPBACK4_BIN=injected;f.env.SB4_NZ_RETENTION_BARRIER=f.root;
    blockedRetention(f);assert.equal(f.invoke().status,0);
    const first=f.latest();await until(()=>read(path.join(f.root,'compression.json')),'blocked compression');
    const root=path.join(f.root,'artifacts/native-smoke');
    const journal=fs.readdirSync(root).find(n=>n.startsWith('.retention-')&&read(path.join(root,n,'retention-group.json')));
    custody=read(path.join(root,journal,'retention-group.json'));
    f.put('pause-owner-pid',String(custody.guardian.pid));
    await until(()=>fs.existsSync(path.join(f.root,'owner-exit-paused')),'native owner-exit watcher is paused before owner death');
    assert.equal(f.events().length,0,'first proof is still before its driver');
    const worker=read(path.join(first.artifacts,'worker.json')).process.pid;await signalFixture(f,read(path.join(first.artifacts,'worker.json')).process,'SIGKILL');
    await until(()=>!alive(worker),'old guardian released background.lock');
    const result=f.invoke('next generation');assert.equal(result.status,0,result.stdout+result.stderr);
    const next=f.latest();await until(()=>f.events().length>0,'next proof starts while old retention lock remains held');
    assert.match(fs.readFileSync(path.join(next.artifacts,'background.log'),'utf8'),/cleanup deferred:.*retention lock busy/);
    const compressor=read(path.join(f.root,'compression.json'));assert.ok(alive(compressor.pid));
    f.put('resume-owner-exit','');
    await until(()=>!alive(compressor.pid)&&!alive(compressor.child)&&!alive(custody.group)&&!alive(custody.guardian.pid),'old compression and keepers drained after watcher resumes');
    f.put('continue','');assert.equal(f.status('--wait').status,2);
  } finally {
    f.put('resume-owner-exit','');
    if(custody)await until(()=>!alive(custody.group)&&!alive(custody.guardian.pid),'paused custody drained before fixture removal');
    if(pending){pending.child.stdin.end();await pending.exited;}
    await cleanup(f);
  }
});


function skipMode(f, mode) {
  if (mode === 'off') f.env.SNAPBACK4_NATIVE_SMOKE = 'off';
  else {
    f.put('platform.cjs', "Object.defineProperty(process,'platform',{value:'linux'})");
    f.env.NODE_OPTIONS = '--require=' + path.join(f.root, 'platform.cjs');
  }
}
function retainedRuns(f) {
  const root = path.join(f.root, 'artifacts/native-smoke');
  const dirs = fs.readdirSync(root).filter(n => /^\d+-\d+$/.test(n)).map(n => path.join(root, n));
  return { full: dirs.filter(d => fs.existsSync(path.join(d, 'export'))), compressed: dirs.filter(d => read(path.join(d, 'retention.json'))), dirs };
}
for (const mode of ['off', 'non-macOS']) test(`repeated skipped exports retain five full plus twenty compressed runs (${mode})`, {timeout:120000}, async()=>{
  const f=fixture();
  try {
    skipMode(f,mode);
    const timings=[];
    for(let i=0;i<28;i++) {
      const started=Date.now(), result=f.invoke(`skipped export ${i}`); timings.push(Date.now()-started);
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.equal(f.latest().publishedAt,read(path.join(f.latest().artifacts,'publication.json')).verifiedAt,'skipped handoff copies exact verified commit time');
      assert.ok(read(path.join(f.latest().artifacts,'maintenance-launch.json')),'each committed skip schedules maintenance');
    }
    await maintenanceIdle(f);
    const runs=retainedRuns(f);
    assert.equal(runs.full.length,5); assert.equal(runs.compressed.length,20); assert.equal(runs.dirs.length,25);
    assert.ok(runs.full.includes(f.latest().artifacts),'latest result remains uncompressed');
    assert.equal(f.status('--wait').status,2); assert.match(f.status().stdout,/native smoke skipped/);
    assert.equal(f.events().length,0,'skipped exports never start simulator tools');
    for(const dir of runs.compressed) assert.ok(fs.existsSync(path.join(dir,'result.json.gz')),'compressed skipped receipt retained');
    console.log(JSON.stringify({mode,exports:28,full:runs.full.length,compressed:runs.compressed.length,returnMs:timings}));
  } finally {await cleanup(f);}
});

for(const [mode, fault] of [['off','SIGTERM'],['non-macOS','SIGKILL'],['off','deadline']]) test(`skipped maintenance never blocks publication and drains under ${fault} (${mode})`,{timeout:120000},async()=>{
  const f=fixture();
  try {
    skipMode(f,mode); blockedRetention(f,28);
    const first=f.invoke(); assert.equal(first.status,0,first.stdout+first.stderr);
    const firstDir=f.latest().artifacts;
    const maintainer=read(path.join(firstDir,'maintenance-launch.json')).process.pid;
    await until(()=>read(path.join(f.root,'compression.json')),'skipped compressor started after export returned');
    const compressor=read(path.join(f.root,'compression.json'));
    const root=path.join(f.root,'artifacts/native-smoke');
    const journal=fs.readdirSync(root).find(n=>n.startsWith('.retention-')&&read(path.join(root,n,'retention-group.json')));
    const custody=read(path.join(root,journal,'retention-group.json'));
    for(const pid of [compressor.pid,compressor.child]) assert.equal(Number(spawnSync('ps',['-o','pgid=','-p',String(pid)],{encoding:'utf8'}).stdout.trim()),custody.group);
    assert.ok(retainedRuns(f).full.length>5,'blocked sweep still has full export trees past the bound');
    const started=Date.now();
    const next=f.invoke('new skipped generation'); assert.equal(next.status,0,next.stdout+next.stderr);
    assert.ok(alive(compressor.pid),'the next export returns while previous compression is still paused');
    assert.equal(fs.readFileSync(path.join(f.root,'dist/bundle.hbc'),'utf8'),'new skipped generation');
    assert.equal(f.status('--wait').status,2);
    if(fault!=='deadline')await signalFixture(f,read(path.join(firstDir,'maintenance-launch.json')).process,fault);
    await until(()=>!alive(compressor.pid)&&!alive(compressor.child)&&!alive(custody.group)&&!alive(custody.guardian.pid),'owned skipped compression group drained',45000);
    const drainedAfter=Date.now()-started;
    await maintenanceIdle(f);
    await until(()=>f.maintainers.every(pid=>!alive(pid)),'all skipped custodians exited',45000);
    if(fault==='deadline') {
      assert.ok(drainedAfter>25000&&drainedAfter<40000,`real bounded retention deadline: ${drainedAfter}`);
      assert.match(fs.readFileSync(path.join(root,'maintenance.log'),'utf8'),/30-second deadline/);
    }
    assert.equal(read(path.join(f.latest().artifacts,'result.json')).state,'skipped');
    const retained=retainedRuns(f);
    assert.equal(retained.full.length,5); assert.equal(retained.compressed.length,20); assert.equal(retained.dirs.length,25);
    for(const dir of retained.compressed) assert.ok(fs.existsSync(path.join(dir,'result.json.gz')));
  } finally {await cleanup(f);}
});

// Queue records live outside retained run trees, so cleanup also sees a pending
// observer which was launched by the preceding custodian rather than a wrapper.
async function maintenanceIdle(f, allowParked = false) {
  const root=path.join(f.root,'artifacts/native-smoke');
  await observedMaintenance(f, allowParked, () => until(()=>(allowParked || ['maintenance-request.json','maintenance-claimed.json','maintenance-parked.json'].every(n=>!fs.existsSync(path.join(root,n)))) &&
    ['maintenance-next.json','maintenance-active.json'].every(n=>!alive(read(path.join(root,n))?.process?.pid)),
    'coalesced maintenance queue drained',90000));
}
function retentionProcesses(root, env = process.env) {
  // Full commands, unlike the runner's short metadata rows, can be kilobytes
  // each. 128 MiB fits 32,768 rows averaging 4 KiB (20,000 with headroom).
  // -ww prevents ps itself clipping commands to a display width. checkedSpawnSync
  // refuses ENOBUFS; a partial table must never prove custody.
  const result = spawnSync('ps', ['-axww', '-o', 'pid=,command='], {
    encoding: 'utf8', env, maxBuffer: 128 * 1024 * 1024,
    timeout: fixtureWorkMs, killSignal: 'SIGKILL',
  });
  assert.equal(result.status, 0, `complete process listing required: ${result.stderr}`);
  return result.stdout.split('\n').filter(line => line.includes(root) && /export-maintain|export-retain-worker|retention-group/.test(line));
}

test('retention process listing reads a large complete table and refuses partial output', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-process-listing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = [
    ` 10001 snapback4 witness export-maintain ${root}`,
    ` 10002 snapback4 witness export-retain-worker ${root}`,
    ` 10003 snapback4 witness retention-group ${root}`,
  ];
  const unrelated = ' 20000 another-command ' + 'x'.repeat(128) + '\n';
  // One match before the old limit, two after it. Silently truncating would
  // incorrectly claim there is only one observer; the exact rows must survive.
  const table = rows[0] + '\n' + unrelated.repeat(20000) + rows.slice(1).join('\n') + '\n';
  assert.ok(Buffer.byteLength(table) > 1024 * 1024);
  fs.writeFileSync(path.join(root, 'table'), table);
  fs.writeFileSync(path.join(root, 'ps'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
fs.writeFileSync(path.join(__dirname, 'args'), JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(1, fs.readFileSync(path.join(__dirname, 'table')));
if (process.env.PS_MODE === 'overflow') {
  const chunk = Buffer.alloc(1024 * 1024, 'x');
  for (let i = 0; i < 129; i++) fs.writeSync(1, chunk);
}
if (process.env.PS_MODE === 'failed') {
  fs.writeFileSync(2, 'fixture ps failed after partial output');
  process.exitCode = 1;
}
`, { mode: 0o755 });
  const env = { ...process.env, PATH: root + ':' + process.env.PATH, PS_MODE: 'complete' };
  assert.deepEqual(retentionProcesses(root, env), rows);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'args'))), ['-axww', '-o', 'pid=,command=']);
  assert.throws(() => retentionProcesses(root, { ...env, PS_MODE: 'failed' }), /complete process listing required: fixture ps failed/);
  assert.throws(() => retentionProcesses(root, { ...env, PS_MODE: 'overflow' }), error =>
    error.cause?.code === 'ENOBUFS' && /TEST_FIXTURE_COMMAND_FAILED: ps/.test(error.message));
});

for(const mode of ['off','non-macOS']) test(`held retention lock coalesces 28 skipped exports into one pending observer (${mode})`,{timeout:120000},async()=>{
  const f=fixture(); let holder, exited;
  try {
    skipMode(f,mode);
    const root=path.join(f.root,'artifacts/native-smoke');fs.mkdirSync(root,{recursive:true});
    holder=spawn('python3',['-c',"import fcntl,sys,pathlib; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX); pathlib.Path(sys.argv[2]).touch(); sys.stdin.read()",path.join(root,'retention.lock'),path.join(f.root,'lock-held')],{stdio:['pipe','ignore','inherit']});
    exited=once(holder,'exit');
    await until(()=>fs.existsSync(path.join(f.root,'lock-held')),'our retention lock held');
    let maximum=0; const observers=new Set(), timings=[];
    for(let i=0;i<28;i++) {
      const started=Date.now(), result=f.invoke(`queued skip ${i}`);timings.push(Date.now()-started);
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.equal(read(path.join(root,'maintenance-request.json')).state,'pending');
      const rows=retentionProcesses(root);
      maximum=Math.max(maximum,rows.length);
      assert.equal(rows.length,1,`only the pending observer exists while retention is locked: ${rows}`);
      observers.add(read(path.join(root,'maintenance-next.json')).process.pid);
      assert.equal(fs.readdirSync(root).filter(n=>n.startsWith('.retention-')).length,0,'busy requests do not launch native custodians');
    }
    assert.equal(observers.size,1,'all newer requests coalesce into the same pending observer');
    assert.equal(retainedRuns(f).full.length,28);
    assert.equal(f.status('--wait').status,2);
    holder.stdin.end(); await exited; holder=null;
    await maintenanceIdle(f);
    const runs=retainedRuns(f);
    assert.equal(runs.full.length,5);assert.equal(runs.compressed.length,20);assert.equal(runs.dirs.length,25);
    assert.ok(runs.full.includes(f.latest().artifacts));
    console.log(JSON.stringify({mode,exports:28,maximumMaintenanceProcesses:maximum,pendingObservers:observers.size,full:runs.full.length,compressed:runs.compressed.length,returnMs:timings}));
  } finally {if(holder){holder.stdin.end();await exited;}await cleanup(f);}
});
for(const mode of ['off','non-macOS','background']) test(`first-started last-published generation remains full evidence (${mode})`,{skip:process.platform!=='darwin',timeout:120000},async()=>{
  const f=fixture();let first, exited;
  try {
    if(mode!=='background')skipMode(f,mode);
    const cli=path.join(f.root,'node_modules/expo/bin/cli');
    fs.appendFileSync(cli, `if(process.env.PAUSE_EARLY_EXPORT){fs.writeFileSync('early-export.json',JSON.stringify({out}));while(!fs.existsSync('resume-early'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);}`);
    first=spawn(process.execPath,[wrapper],{cwd:f.root,env:{...f.env,PAUSE_EARLY_EXPORT:'1',EXPORT_BYTES:'first started, last published'},stdio:['ignore','pipe','pipe']});
    let output='';first.stdout.on('data',x=>output+=x);first.stderr.on('data',x=>output+=x);exited=once(first,'exit');
    await until(()=>read(path.join(f.root,'early-export.json')),'first export paused in its private tree');
    const early=path.dirname(path.resolve(f.root,read(path.join(f.root,'early-export.json')).out));
    f.env.SNAPBACK4_NATIVE_SMOKE='off';
    for(let i=0;i<8;i++){const later=f.invoke(`later started ${i}`);assert.equal(later.status,0,later.stdout+later.stderr);}
    assert.ok(fs.existsSync(path.join(f.root,'artifacts/native-smoke/maintenance-request.json')),'unfinished export keeps maintenance pending');
    assert.ok(Number(path.basename(early).split('-')[0])<Number(path.basename(f.latest().artifacts).split('-')[0]));
    assert.ok(fs.existsSync(path.join(early,'export/bundle.hbc')),'pending export retained despite its old start time');
    f.put('resume-early','');const [code]=await exited;assert.equal(code,0,output);first=null;
    assert.equal(f.latest().artifacts,early);
    const root=path.join(f.root,'artifacts/native-smoke');
    if(mode==='background') {
      await until(()=>f.events().length>0,'current native proof is pending');
      const sweep=spawnSync(binary,['witness','export-cleanup',root],{cwd:f.root,env:f.env,encoding:'utf8'});assert.equal(sweep.status,0,sweep.stderr);
      assert.ok(fs.existsSync(path.join(early,'request.json')),'current pending proof remains full');
      f.put('continue','');assert.equal(f.status('--wait').status,2);
      try {
        await until(()=>!alive(read(path.join(early,'worker.json'))?.process?.pid),'background proof and post-driver retention finished');
      } catch(error) {await maintenanceEvidence(f,'post-driver-timeout');throw error;}
    }
    await maintenanceIdle(f);
    const sweep=spawnSync(binary,['witness','export-cleanup',root],{cwd:f.root,env:f.env,encoding:'utf8'});assert.equal(sweep.status,0,sweep.stderr);
    const runs=retainedRuns(f);
    assert.equal(runs.full.length,5);assert.ok(runs.full.includes(early));
    assert.equal(fs.existsSync(path.join(early,'retention.json')),false);
    assert.equal(read(path.join(early,'result.json')).generation,f.latest().generation);
    const status=f.status('--wait');assert.equal(status.status,2,status.stdout+status.stderr);assert.match(status.stdout,/native smoke skipped/);assert.doesNotMatch(status.stdout,/no proof|unverified/);
    const doctor=spawnSync(binary,['doctor'],{cwd:f.root,env:f.env,encoding:'utf8'});assert.match(doctor.stdout,/native smoke skipped/);assert.doesNotMatch(doctor.stdout,/no proof for the current export/);
  } finally {f.put('resume-early','');if(first)await exited;await cleanup(f);}
});

for(const mode of ['off','non-macOS','background']) test(`failed handoffs with held wrapper leases retain deferred maintenance (${mode})`,{skip:process.platform!=='darwin',timeout:120000},async()=>{
  const f=fixture(), wrappers=[];
  try {
    f.env.SNAPBACK4_NATIVE_SMOKE='off';
    for(let i=0;i<5;i++){const r=f.invoke(`seed ${i}`);assert.equal(r.status,0,r.stdout+r.stderr);}
    await maintenanceIdle(f);
    delete f.env.SNAPBACK4_NATIVE_SMOKE;
    if(mode!=='background')skipMode(f,mode);
    const root=path.join(f.root,'artifacts/native-smoke');
    fs.mkdirSync(path.join(root,'latest.json.tmp')); // fail after verified commit
    f.put('hold-wrapper.cjs', `
const fs=require('fs'),path=require('path'),open=fs.openSync,close=fs.closeSync,held=new Map();
fs.openSync=function(p,...args){const fd=open.call(this,p,...args);if(String(p).endsWith('/export.lock'))held.set(fd,path.dirname(String(p)));return fd;};
fs.closeSync=function(fd){if(held.has(fd)){fs.mkdirSync('wrapper-held',{recursive:true});fs.writeFileSync('wrapper-held/'+process.pid+'.json',JSON.stringify({dir:held.get(fd)}));while(!fs.existsSync('release-wrapper-leases'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);held.delete(fd);}return close.call(this,fd);};
`);
    for(let i=0;i<10;i++) {
      const child=spawn(process.execPath,[wrapper],{cwd:f.root,env:{...f.env,EXPORT_BYTES:`deferred ${i}`,NODE_OPTIONS:[f.env.NODE_OPTIONS,'--require='+path.join(f.root,'hold-wrapper.cjs')].filter(Boolean).join(' ')},stdio:['ignore','pipe','pipe']});
      const run={child,exited:once(child,'exit'),output:''};wrappers.push(run);
      child.stdout.on('data',x=>run.output+=x);child.stderr.on('data',x=>run.output+=x);
      await until(()=>read(path.join(f.root,'wrapper-held',child.pid+'.json')),`wrapper ${i} paused after publication, before lease release`);
      // The marker and stderr travel independently; fs.closeSync's barrier
      // does not imply the parent's pipe reader has received the diagnostic.
      await until(()=>/native smoke (status update failed|failed to start)/.test(run.output),`wrapper ${i} reported its failed handoff`,90000);
      assert.match(run.output,/native smoke (status update failed|failed to start)/);
    }
    assert.equal(retainedRuns(f).full.length,15);assert.equal(retainedRuns(f).compressed.length,0);
    // Force discovery under the still-held export leases too: this models a
    // lease acquired after the observer's passive probe but before its worker.
    let scan;
    for(let i=0;i<20;i++) {
      scan=spawnSync(binary,['witness','export-cleanup',root],{cwd:f.root,env:f.env,encoding:'utf8',timeout:fixtureWorkMs,killSignal:'SIGKILL'});
      if(scan.status===0)break;
      assert.match(scan.stderr,/retention lock busy/);await pause();
    }
    assert.equal(scan.status,0,scan.stderr);
    await until(()=>fs.existsSync(path.join(root,'maintenance-request.json'))&&alive(read(path.join(root,'maintenance-next.json'))?.process?.pid),'unfinished discoveries have a pending request and observer');
    const observer=read(path.join(root,'maintenance-next.json')).process.pid;
    const attempts=read(path.join(root,'maintenance-active.json'))?.attempt??0;
    for(let i=0;i<10;i++) {
      await pause();
      assert.ok(fs.existsSync(path.join(root,'maintenance-request.json')),'deferred work remains pending');
      assert.ok(alive(observer),'the pending observer waits passively');
      assert.equal(read(path.join(root,'maintenance-active.json'))?.attempt??0,attempts,'held exports do not respawn retention workers');
    }
    f.put('release-wrapper-leases','');
    for(const run of wrappers){const [code]=await run.exited;assert.equal(code,0,run.output);}
    await maintenanceIdle(f);
    const runs=retainedRuns(f);assert.equal(runs.full.length,5);assert.equal(runs.compressed.length,10);assert.equal(runs.dirs.length,15);
    const current=read(path.join(f.root,'dist/.snapback4-publication.json'));
    assert.ok(runs.full.some(dir=>read(path.join(dir,'export/.snapback4-publication.json'))?.generation===current.generation));
    for(const dir of runs.compressed)assert.ok(fs.existsSync(path.join(dir,'publication.json.gz')));
    noOldPass(f);
    console.log(JSON.stringify({mode,failedHandoffs:10,pausedFull:15,full:runs.full.length,compressed:runs.compressed.length,pendingAfterRelease:false}));
  } finally {f.put('release-wrapper-leases','');for(const run of wrappers)await run.exited;await cleanup(f);}
});

for(const lease of ['exclusive','shared'])test(`a held ${lease} publication lock pauses one observer without starting retention workers`,{timeout:120000},async()=>{
  const f=fixture();let retention, publication;
  const hold=async(name)=>{
    const root=path.join(f.root,'artifacts/native-smoke');fs.mkdirSync(root,{recursive:true});
    const child=spawn('python3',['-c',"import fcntl,sys,pathlib; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_SH if sys.argv[3]=='shared' else fcntl.LOCK_EX); pathlib.Path(sys.argv[2]).touch(); sys.stdin.read()",path.join(root,name+'.lock'),path.join(f.root,name+'-held'),name==='publication'?lease:'exclusive'],{stdio:['pipe','ignore','inherit']});
    const held={child,exited:once(child,'exit')};await until(()=>fs.existsSync(path.join(f.root,name+'-held')),name+' lock held by our fixture');return held;
  };
  try {
    skipMode(f,'off');retention=await hold('retention');
    for(let i=0;i<15;i++){const r=f.invoke(`pending ${i}`);assert.equal(r.status,0,r.stdout+r.stderr);}
    const root=path.join(f.root,'artifacts/native-smoke');
    publication=await hold('publication');
    const observer=read(path.join(root,'maintenance-next.json')).process.pid;
    const before=read(path.join(root,'maintenance-active.json'))?.attempt??0;
    retention.child.stdin.end();await retention.exited;retention=null;
    const untilTime=Date.now()+2200;
    while(Date.now()<untilTime){
      await pause();assert.ok(alive(observer),'publication contention keeps the same passive observer');
      assert.equal(read(path.join(root,'maintenance-next.json')).process.pid,observer);
      assert.equal(read(path.join(root,'maintenance-active.json'))?.attempt??0,before,'no native worker attempt while publication is locked');
      assert.equal(fs.readdirSync(root).filter(n=>n.startsWith('.retention-')).length,0);
    }
    publication.child.stdin.end();await publication.exited;publication=null;
    await maintenanceIdle(f);
    const runs=retainedRuns(f);assert.equal(runs.full.length,5);assert.equal(runs.compressed.length,10);
    assert.equal(read(path.join(root,'maintenance-active.json')).attempt,before+1,'one scan covers all queued exports after release');
    console.log(JSON.stringify({heldPublicationMs:2200,retentionStartsWhileHeld:0,retentionStartsAfterRelease:1,full:5,compressed:10}));
  } finally {for(const held of [retention,publication])if(held){held.child.stdin.end();await held.exited;}await cleanup(f);}
});

test('failed maintenance retains a parked request and a later export retries it',{timeout:120000},async()=>{
  const f=fixture();let holder,exited;
  try {
    skipMode(f,'off');const root=path.join(f.root,'artifacts/native-smoke');fs.mkdirSync(root,{recursive:true});
    holder=spawn('python3',['-c',"import fcntl,sys,pathlib; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX); pathlib.Path(sys.argv[2]).touch(); sys.stdin.read()",path.join(root,'retention.lock'),path.join(f.root,'error-lock-held')],{stdio:['pipe','ignore','inherit']});
    exited=once(holder,'exit');await until(()=>fs.existsSync(path.join(f.root,'error-lock-held')),'retention lock held');
    f.put('bin/gzip','#!/bin/sh\nexit 99\n',0o755);
    for(let i=0;i<6;i++){const r=f.invoke(`before failure ${i}`);assert.equal(r.status,0,r.stdout+r.stderr);}
    holder.stdin.end();await exited;holder=null;
    await until(()=>read(path.join(root,'maintenance-result.json'))?.error,'failed maintenance is recorded');
    await maintenanceIdle(f,true);
    assert.ok(fs.existsSync(path.join(root,'maintenance-parked.json')),'failure preserves deferred work without a retry loop');
    const attempted=read(path.join(root,'maintenance-active.json')).attempt;assert.equal(attempted,1);
    for(let i=0;i<10;i++){await pause();assert.equal(read(path.join(root,'maintenance-active.json')).attempt,attempted,'persistent failure stays parked');}
    assert.equal(retainedRuns(f).full.length,6);
    fs.rmSync(path.join(f.root,'bin/gzip'));
    const later=f.invoke('retry after repair');assert.equal(later.status,0,later.stdout+later.stderr);
    await maintenanceIdle(f);
    assert.equal(retainedRuns(f).full.length,5);assert.equal(retainedRuns(f).compressed.length,2);
    assert.equal(read(path.join(root,'maintenance-result.json')).error,null);
  } finally {if(holder){holder.stdin.end();await exited;}await cleanup(f);}
});

async function holdRetention(f, name = 'retention', signal) {
  const root=path.join(f.root,'artifacts/native-smoke');fs.mkdirSync(root,{recursive:true});
  const marker=path.join(f.root,'held-'+randomUUID());
  const child=spawn('python3',['-c',"import fcntl,sys,pathlib; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX); pathlib.Path(sys.argv[2]).touch(); sys.stdin.read()",path.join(root,name+'.lock'),marker],{stdio:['pipe','ignore','inherit']});
  const exited=once(child,'exit');
  try { await until(()=>fs.existsSync(marker),'fixture retention lease held',30000,signal); }
  catch (error) { child.stdin.end(); await exited; throw error; }
  return {child,exited};
}
async function seedQueuedExports(f,count=28) {
  const saved=f.env.SNAPBACK4_NATIVE_SMOKE;f.env.SNAPBACK4_NATIVE_SMOKE='off';
  try {for(let i=0;i<count;i++){const r=f.invoke(`retention history ${i}`);assert.equal(r.status,0,r.stdout+r.stderr);}}
  finally {if(saved===undefined)delete f.env.SNAPBACK4_NATIVE_SMOKE;else f.env.SNAPBACK4_NATIVE_SMOKE=saved;}
}
function assertRetentionBound(f) {
  const runs=retainedRuns(f);
  assert.equal(runs.full.length,5);assert.equal(runs.compressed.length,20);assert.equal(runs.dirs.length,25);
  assert.ok(runs.full.includes(f.latest().artifacts),'current evidence remains full');
  for(const dir of runs.compressed)assert.ok(fs.existsSync(path.join(dir,'result.json.gz')),'actual compressed result evidence');
}
for(const point of ['before','after'])test(`retention repairs an ownerless publication ${point} exchange without worker respawn`,{timeout:120000},async()=>{
  const f=fixture();let held,wrapperChild,wrapperExit,publisher;
  const barrier=path.join(f.root,'publisher-paused');
  try {
    skipMode(f,'off');held=await holdRetention(f);await seedQueuedExports(f);
    const previous=f.latest(),root=path.join(f.root,'artifacts/native-smoke');
    const library=path.join(f.root,'publication.'+(process.platform==='darwin'?'dylib':'so'));
    const compiled=spawnSync('cc',[...(process.platform==='darwin'?['-dynamiclib']:['-shared','-fPIC']),new URL('./publication-interposer.c',import.meta.url).pathname,'-o',library],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr);
    f.put('dispatch.mjs',`#!${process.execPath}
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2),env={...process.env};
if(args[1]==='export-publish')env[process.platform==='darwin'?'DYLD_INSERT_LIBRARIES':'LD_PRELOAD']=${JSON.stringify(library)};
const r=spawnSync(${JSON.stringify(binary)},args,{env,stdio:args[1]==='export-publish'||args[1]==='export-lease'?['inherit','inherit','inherit',3]:'inherit'});
process.exit(r.status??1);
`,0o755);
    wrapperChild=spawn(process.execPath,[wrapper],{cwd:f.root,env:{...f.env,SNAPBACK4_BIN:path.join(f.root,'dispatch.mjs'),SB4_FAULT:'pause-'+point,SB4_FAULT_TARGET:path.join(f.root,'dist'),SB4_FAULT_BARRIER:barrier},stdio:['ignore','pipe','pipe']});
    let output='';wrapperChild.stdout.on('data',x=>output+=x);wrapperChild.stderr.on('data',x=>output+=x);wrapperExit=once(wrapperChild,'exit');
    await until(()=>read(path.join(root,'publication-pending.json')),'publisher recorded its pending transaction');
    const args=[binary,'witness','export-publish',read(path.join(root,'publication-pending.json')).source,path.join(f.root,'dist'),'--environment-skip'];
    publisher=await waitForPublisher(barrier,args);
    assert.ok(fs.existsSync(path.join(root,'publication-pending.json')));
    const observer=read(path.join(root,'maintenance-next.json')).process.pid;
    held.child.stdin.end();await held.exited;held=null;
    const end=Date.now()+2200;
    while(Date.now()<end){await pause();assert.ok(alive(observer));assert.equal(read(path.join(root,'maintenance-active.json'))?.attempt??0,0,'live publication waits passively');}
    await killPausedPublisher(barrier,publisher,args);publisher=null;
    const [code]=await wrapperExit;assert.notEqual(code,0,output);wrapperChild=null;
    const repairStarted=Date.now();await maintenanceIdle(f);
    assert.ok(Date.now()-repairStarted<30000,'ownerless transaction repaired without a later export');
    assert.equal(read(path.join(root,'maintenance-active.json')).attempt,1,'one worker repairs and prunes; no retry chain');
    assert.equal(fs.existsSync(path.join(root,'publication-pending.json')),false);
    assert.equal(f.latest().generation,previous.generation);assert.equal(f.status('--wait').status,2);
    assert.match(f.status().stdout,/native smoke skipped/);
    assertRetentionBound(f);
    for(let i=0;i<10;i++){await pause();assert.equal(read(path.join(root,'maintenance-active.json')).attempt,1);}
    console.log(JSON.stringify({interruptedPublication:point,workerStarts:1,repairMs:Date.now()-repairStarted,full:5,compressed:20}));
  } finally {
    releasePublisherBarrier(barrier);
    if(wrapperChild)await wrapperExit;
    if(held){held.child.stdin.end();await held.exited;}
    await cleanup(f);
  }
});

for(const mode of ['off','non-macOS','background'])test(`failed export lease removes its shell and retention repairs legacy ownerless runs (${mode})`,{skip:process.platform!=='darwin',timeout:120000},async()=>{
  const f=fixture();let held;
  try {
    if(mode!=='background')skipMode(f,mode);
    held=await holdRetention(f);await seedQueuedExports(f);
    const root=path.join(f.root,'artifacts/native-smoke');
    f.put('lease-fails','#!/bin/sh\nexit 1\n',0o755);
    const saved=f.env.SNAPBACK4_BIN;f.env.SNAPBACK4_BIN=path.join(f.root,'lease-fails');
    const failed=f.invoke();f.env.SNAPBACK4_BIN=saved;
    assert.notEqual(failed.status,0);assert.match(failed.stderr,/export lease failed/);
    assert.equal(retainedRuns(f).dirs.length,28,'failed initialization leaves no numeric run shell');
    f.put('lease-fails',`#!/bin/sh
if [ "$4" = "--initialize" ]; then exec '${binary}' "$@"; fi
exit 1
`,0o755);
    f.env.SNAPBACK4_BIN=path.join(f.root,'lease-fails');const afterCreate=f.invoke();f.env.SNAPBACK4_BIN=saved;
    assert.notEqual(afterCreate.status,0);assert.match(afterCreate.stderr,/export lease failed/);
    assert.equal(retainedRuns(f).dirs.length,28,'failed export lease removes the already-created shell');
    const shells=[];
    for(let i=0;i<10;i++) {
      const dir=path.join(root,`${9999999999999+i}-1`);shells.push(dir);fs.mkdirSync(dir);
      if(i%2) {fs.mkdirSync(path.join(dir,'export'));fs.writeFileSync(path.join(dir,'export/partial'),'unfinished bytes');}
    }
    // A missing legacy journal must not permit eviction of current evidence.
    const current=f.latest().artifacts;
    for(const name of ['live.json','finished.json','publication.json','request.json'])fs.rmSync(path.join(current,name),{force:true});
    held.child.stdin.end();await held.exited;held=null;
    const started=Date.now();await maintenanceIdle(f);
    assert.ok(Date.now()-started<30000,'ownerless states repaired within the worker bound');
    assert.equal(read(path.join(root,'maintenance-active.json')).attempt,1);
    for(const dir of shells)assert.equal(fs.existsSync(dir),false,'empty/partial shells are excluded from all keep slots');
    assert.equal(read(path.join(current,'finished.json')).missingOwner,true);
    assertRetentionBound(f);assert.match(f.status().stdout,/native smoke skipped/);
    console.log(JSON.stringify({ownerlessRepair:mode,removedShells:10,workerStarts:1,full:5,compressed:20}));
  } finally {if(held){held.child.stdin.end();await held.exited;}await cleanup(f);}
});

for(const gated of [true,false])test(`a live retention owner has a bounded passive observer and leaves a durable retry (launch gate ${gated})`,{timeout:120000},async()=>{
  const f=fixture();let held,observer,exited;
  try {
    skipMode(f,'off');held=await holdRetention(f);
    const root=path.join(f.root,'artifacts/native-smoke');
    f.put('artifacts/native-smoke/maintenance-request.json','{"state":"pending"}');
    // Use the real internal entry with its inherited OS lease and an earlier
    // deadline, not an environment override that can enlarge product limits.
    observer=spawn('python3',['-c',"import os,fcntl,sys; f=open(sys.argv[1]+'/maintenance-next.lock','a'); fcntl.flock(f,fcntl.LOCK_EX); os.dup2(f.fileno(),3); os.set_inheritable(3,True); os.execve(sys.argv[2],[sys.argv[2],'witness','export-maintain',sys.argv[1],sys.argv[3]],os.environ)",root,binary,String(Date.now()+1500)],{cwd:f.root,env:f.env,stdio:['pipe','ignore','pipe']});
    let output='';observer.stderr.on('data',x=>output+=x);exited=once(observer,'exit');const closed=once(observer,'close');observer.stdin.on('error',()=>{});if(gated)observer.stdin.end('s');
    const started=Date.now();
    const [code]=await exited;observer=null;assert.equal(code,1,output);
    assert.ok(Date.now()-started<4000,'live-owner observation terminates at its fixed deadline');
    await closed; // Process exit precedes complete delivery of its stderr.
    assert.match(output,/60-minute deadline.*parked/);
    assert.ok(fs.existsSync(path.join(root,'maintenance-request.json')));
    assert.equal(read(path.join(root,'maintenance-active.json')),null);
    await seedQueuedExports(f);
    held.child.stdin.end();await held.exited;held=null;
    const later=f.invoke('after bounded wait');assert.equal(later.status,0,later.stdout+later.stderr);
    await maintenanceIdle(f);assertRetentionBound(f);
  } finally {if(observer){observer.stdin.end('s');await exited;}if(held){held.child.stdin.end();await held.exited;}await cleanup(f);}
});

test('retention cannot remove a run between directory creation and export lease acquisition',{timeout:120000},async()=>{
  const f=fixture();let held,child,exited;
  try {
    skipMode(f,'off');held=await holdRetention(f);await seedQueuedExports(f);
    f.put('pause-initialization.cjs',`const fs=require('fs'),old=fs.mkdirSync;fs.mkdirSync=function(p,...args){const value=old.call(this,p,...args);if(/native-smoke\\/\\d+-\\d+$/.test(String(p))){fs.writeFileSync('initializing.json',JSON.stringify({dir:p}));while(!fs.existsSync('resume-initialization'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);}return value;};`);
    child=spawn(process.execPath,[wrapper],{cwd:f.root,env:{...f.env,NODE_OPTIONS:`--require=${path.join(f.root,'pause-initialization.cjs')}`},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);exited=once(child,'exit');
    await until(()=>read(path.join(f.root,'initializing.json')),'wrapper paused after mkdir but before export lease');
    const dir=read(path.join(f.root,'initializing.json')).dir,root=path.join(f.root,'artifacts/native-smoke');
    assert.equal(read(path.join(dir,'live.json')),null);
    held.child.stdin.end();await held.exited;held=null;
    const end=Date.now()+2200;
    while(Date.now()<end){await pause();assert.ok(fs.existsSync(dir));assert.equal(read(path.join(root,'maintenance-active.json')),null,'initialization lease keeps the observer passive');}
    f.put('resume-initialization','');const [code]=await exited;child=null;assert.equal(code,0,output);
    await maintenanceIdle(f);assertRetentionBound(f);
    assert.equal(read(path.join(root,'maintenance-active.json')).attempt,1);
  } finally {f.put('resume-initialization','');if(child)await exited;if(held){held.child.stdin.end();await held.exited;}await cleanup(f);}
});

test('export initialization refuses a live stuck initializer within five seconds',{timeout:30000},async()=>{
  const f=fixture();let holder,exited;
  try {
    skipMode(f,'off');const root=path.join(f.root,'artifacts/native-smoke');fs.mkdirSync(root,{recursive:true});
    holder=spawn('python3',['-c',"import fcntl,sys,pathlib; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX); pathlib.Path(sys.argv[2]).touch(); sys.stdin.read()",path.join(root,'initialization.lock'),path.join(f.root,'initialization-held')],{stdio:['pipe','ignore','inherit']});
    exited=once(holder,'exit');await until(()=>fs.existsSync(path.join(f.root,'initialization-held')),'our initialization lease held');
    const started=Date.now(),r=f.invoke();assert.notEqual(r.status,0);assert.match(r.stderr,/initialization lease unavailable within 5 seconds/);
    assert.ok(Date.now()-started>=4900&&Date.now()-started<8000);
    assert.equal(retainedRuns(f).dirs.length,0);
    holder.stdin.end();await exited;holder=null;
    assert.equal(f.invoke().status,0);await maintenanceIdle(f);
  } finally {if(holder){holder.stdin.end();await exited;}await cleanup(f);}
});

// Round 9: no later publication is allowed to rescue a lost maintenance claim.
for(const victim of ['custodian','observer'])test(`SIGKILL of the sole maintenance ${victim} restores retention without another export`,{timeout:120000},async()=>{
  const f=fixture();let held;
  try {
    held=await holdRetention(f);skipMode(f,'off');blockedRetention(f,28);
    const first=f.invoke();assert.equal(first.status,0,first.stdout+first.stderr);
    held.child.stdin.end();await held.exited;held=undefined;
    const root=path.join(f.root,'artifacts/native-smoke'), current=f.latest();
    await until(()=>read(path.join(f.root,'compression.json')),'sole maintainer is compressing');
    const compressor=read(path.join(f.root,'compression.json'));
    const custody=fs.readdirSync(root).filter(n=>n.startsWith('.retention-')).map(n=>read(path.join(root,n,'retention-group.json'))).find(Boolean);
    for(const pid of [compressor.pid,compressor.child])assert.equal(Number(spawnSync('ps',['-o','pgid=','-p',String(pid)],{encoding:'utf8'}).stdout.trim()),custody.group);
    assert.ok(fs.existsSync(path.join(root,'maintenance-claimed.json')),'work stays durably claimed during compression');
    assert.ok(!fs.existsSync(path.join(root,'maintenance-request.json')),'no later publication or queued request can rescue this claim');
    const record=victim==='custodian'?'maintenance-active.json':'maintenance-next.json';
    await signalFixture(f,read(path.join(root,record)).process,'SIGKILL');
    await until(()=>!alive(compressor.pid)&&!alive(compressor.child)&&!alive(custody.group)&&!alive(custody.guardian.pid),'sole maintainer native group drained',45000);
    await maintenanceIdle(f);assertRetentionBound(f);
    assert.equal(f.latest().generation,current.generation,'no later export was published');
    assert.equal(read(path.join(root,'maintenance-active.json')).attempt,2,'one bounded resumption covers the surviving claim');
  } finally {if(held){held.child.stdin.end();await held.exited;}await cleanup(f);}
});

for(const mode of ['off','non-macOS','background'])test(`failed Expo exports and dead wrapper journals never occupy keep slots (${mode})`,{timeout:120000},async()=>{
  const f=fixture();let held;
  try {
    held=await holdRetention(f);await seedQueuedExports(f);
    if(mode!=='background')skipMode(f,mode);
    const expo=fs.readFileSync(path.join(f.root,'node_modules/expo/bin/cli'),'utf8');
    f.put('node_modules/expo/bin/cli',expo+'process.exit(23);');
    const originalOptions=f.env.NODE_OPTIONS;
    for(let i=0;i<5;i++){const r=f.invoke('failed expo');assert.equal(r.status,23,r.stdout+r.stderr);}
    assert.equal(retainedRuns(f).dirs.length,28,'ordinary failed Expo wrappers remove their own attempt under the lease');
    // Model pre-round-9 wrappers: leave their actual birth-recorded journal
    // after Expo failure, and prove liveness rather than JSON presence decides.
    f.put('legacy-shell.cjs',`const fs=require('fs'),path=require('path'),remove=fs.rmSync;fs.rmSync=function(p,...args){if(/native-smoke\\/\\d+-\\d+$/.test(String(p))){return remove.call(this,path.join(p,'export'),{recursive:true,force:true});}return remove.call(this,p,...args);};`);
    f.env.NODE_OPTIONS=[originalOptions,'--require='+path.join(f.root,'legacy-shell.cjs')].filter(Boolean).join(' ');
    const before=new Set(retainedRuns(f).dirs);
    for(let i=0;i<5;i++){const r=f.invoke('legacy failed expo');assert.equal(r.status,23,r.stdout+r.stderr);}
    const shells=retainedRuns(f).dirs.filter(d=>!before.has(d));assert.equal(shells.length,5);
    for(const dir of shells){assert.ok(read(path.join(dir,'live.json'))?.wrapper?.pid);assert.ok(!alive(read(path.join(dir,'live.json')).wrapper.pid));assert.ok(!fs.existsSync(path.join(dir,'export')));}
    if(originalOptions===undefined)delete f.env.NODE_OPTIONS;else f.env.NODE_OPTIONS=originalOptions;
    f.put('node_modules/expo/bin/cli',expo);f.put('continue','');
    const success=f.invoke('after failed attempts');assert.equal(success.status,0,success.stdout+success.stderr);
    if(mode==='background')assert.equal(f.status('--wait').status,2);
    held.child.stdin.end();await held.exited;held=null;
    await maintenanceIdle(f);assertRetentionBound(f);
    for(const shell of shells)assert.ok(!fs.existsSync(shell),'dead journal-only shell repaired and excluded');
  } finally {if(held){held.child.stdin.end();await held.exited;}await cleanup(f);}
});

// Force the race *after* readiness: a real supervised worker sees the held
// retention lease. Handled deferrals must not consume the startup-crash budget.
test('repeated raced retention-lock deferrals stay pending and restore the bound after release',{timeout:120000},async()=>{
  const f=fixture();let held;const scans=[];
  try {
    skipMode(f,'off');held=await holdRetention(f);await seedQueuedExports(f);
    const root=path.join(f.root,'artifacts/native-smoke');
    const observer=read(path.join(root,'maintenance-next.json'));
    for(let i=0;i<4;i++) {
      const scan=spawn('python3',['-c',`import fcntl,os,sys
f=open(sys.argv[1]+'/maintenance.lock','a')
fcntl.flock(f,fcntl.LOCK_EX)
os.dup2(f.fileno(),3)
os.set_inheritable(3,True)
os.execve(sys.argv[2],[sys.argv[2],'witness','export-maintain-scan',sys.argv[1],sys.argv[3]],os.environ)
`,root,binary,String(observer.expiresAt)],{cwd:f.root,env:f.env,stdio:'ignore'});
      const exited=once(scan,'exit');
      scans.push({scan,exited});
      await until(()=>read(path.join(root,'maintenance-active.json'))?.process?.pid===scan.pid && read(path.join(root,'maintenance-active.json'))?.state==='handoff','handled deferral reaches durable handoff');
      assert.match(read(path.join(root,'maintenance-result.json')).error,/retention lock busy/);
      assert.ok(fs.existsSync(path.join(root,'maintenance-request.json')));
      assert.ok(!fs.existsSync(path.join(root,'maintenance-claimed.json')));
      assert.ok(alive(observer.process.pid),'same passive observer survives every handled race');
    }
    assert.equal(read(path.join(root,'maintenance-active.json')).attempt,4);
    held.child.stdin.end();await held.exited;held=null;
    await maintenanceIdle(f);for(const {exited} of scans)assert.equal((await exited)[0],0);assertRetentionBound(f);
    assert.equal(read(path.join(root,'maintenance-active.json')).attempt,5,'one successful scan after the four deferred workers');
  } finally {if(held){held.child.stdin.end();await held.exited;}await cleanup(f);}
});

// Round 10: one-shot debug barriers stop the actual process at a protocol
// boundary; signals target only identities this fixture created and recorded.
async function maintenanceFixture() {
  const f=fixture();skipMode(f,'off');
  const held=await holdRetention(f);blockedRetention(f,28);
  fs.rmSync(path.join(f.root,'bin/gzip')); // ordinary real compression
  const result=f.invoke();assert.equal(result.status,0,result.stdout+result.stderr);
  return {f,held,root:path.join(f.root,'artifacts/native-smoke')};
}
// The matrix starts before the first maintenance record, at verified commit.
// All later transition crashes below already have durable queue state.
for(const point of ['publication-committed','publication-handoff'])for(const mode of ['off','non-macOS','background'])for(const failNext of [false,true])for(const delayed of (point==='publication-committed'&&mode==='off'&&!failNext?[false,true]:[false]))test(delayed?'expired checkpoint refuses signal after 22-second dispatch delay':`maintenance crash matrix: ${point} (${mode}, next Expo ${failNext?'fails':'succeeds'})`,{timeout:120000},async()=>{
  const f=fixture();let held,wrapperChild,wrapperExit;
  try {
    held=await holdRetention(f);await seedQueuedExports(f);
    held.child.stdin.end();await held.exited;held=undefined;
    await maintenanceIdle(f);assertRetentionBound(f);
    const root=path.join(f.root,'artifacts/native-smoke');
    // The inventory alone must be enough: no historical maintenance records.
    for(const name of fs.readdirSync(root))if(name.startsWith('maintenance-')&&name.endsWith('.json'))fs.rmSync(path.join(root,name));
    delete f.env.SNAPBACK4_NATIVE_SMOKE;if(mode!=='background')skipMode(f,mode);
    f.env.SNAPBACK4_TEST_RETENTION_POINT=point;
    wrapperChild=spawn(process.execPath,[wrapper],{cwd:f.root,env:f.env,stdio:'ignore'});wrapperExit=once(wrapperChild,'exit');
    await until(()=>read(path.join(root,'maintenance-test-point.json')),'verified publication before request creation');
    const stopped=read(path.join(root,'maintenance-test-point.json'));
    assert.equal(stopped.point,point);
    const generation=read(path.join(f.root,'dist/.snapback4-publication.json')).generation;
    const current=retainedRuns(f).full.find(dir=>read(path.join(dir,'export/.snapback4-publication.json'))?.generation===generation);
    assert.ok(read(path.join(current,'publication.json')),'publication has committed');
    const queueFiles=()=>fs.readdirSync(root).filter(n=>n.startsWith('maintenance-')&&!n.endsWith('.lock')&&n!=='maintenance-test-point.json');
    assert.deepEqual(queueFiles(),[],'no first maintenance file or background handoff yet');
    assert.equal(read(path.join(current,'request.json')),null);
    assert.equal(fs.existsSync(path.join(root,'publication-pending.json')),point==='publication-committed','matrix covers both sides of namespace cleanup');
    if(delayed) {
      await new Promise(resolve=>setTimeout(resolve,22000));
      await wrapperExit;
      assert.equal(alive(stopped.process.pid),false,'checkpoint publisher exited after its 20-second bound');
      // Safe negative control: even a broken guard cannot kill a reused PID.
      const originalKill=process.kill, attempted=[];
      process.kill=(...args)=>{attempted.push(args);throw Error('UNSAFE_STALE_DISPATCH');};
      try { await assert.rejects(()=>signalFixture(f,stopped.process,'SIGKILL'),/TEST_SIGNAL_REFUSED/); }
      finally { process.kill=originalKill; }
      assert.deepEqual(attempted,[],'expired checkpoint must never reach signal dispatch');
      return;
    }
    await signalFixture(f,stopped.process,'SIGKILL');await wrapperExit;
    assert.equal(retainedRuns(f).full.length,6);assert.equal(retainedRuns(f).compressed.length,20);
    assert.deepEqual(queueFiles(),[],'publisher death has no surviving maintainer or queue record');
    if(failNext)f.put('node_modules/expo/bin/cli','process.exit(23)');
    f.put('continue','');delete f.env.SNAPBACK4_TEST_RETENTION_POINT;
    const start=Date.now(),next=f.invoke('next export inventory backstop');
    assert.equal(next.status,failNext?23:0,next.stdout+next.stderr);
    await maintenanceIdle(f);assertRetentionBound(f);
    assert.ok(fs.existsSync(path.join(current,'export')),'committed generation survives recovery');
    if(failNext)assert.equal(read(path.join(f.root,'dist/.snapback4-publication.json')).generation,generation);
    console.log(JSON.stringify({point,mode,nextExpo:failNext?'failed':'passed',recovery:'next export inventory',restoredMs:Date.now()-start,full:5,compressed:20}));
  } catch(error) {await maintenanceEvidence(f,'publication-crash-matrix');throw error;}
  finally {
    f.put('artifacts/native-smoke/maintenance-test-resume','');
    if(wrapperExit)await wrapperExit;
    if(held){held.child.stdin.end();await held.exited;}
    await cleanup(f);
  }
});
// A dead wrapper's export lease may now belong to maintenance. Pause each
// actual holder, then force the next publisher to contend before releasing it.
for(const holder of ['ready-pending-export','reconcile-pending-export'])for(const stalled of (holder==='ready-pending-export'?[false,true]:[false]))test(stalled?'interrupted publication preserves a persistently held export lease':`interrupted publication recovers through ${holder} custody`,{timeout:120000},async()=>{
  const f=fixture();let firstExit,nextExit;
  const root=path.join(f.root,'artifacts/native-smoke');
  const resume=point=>f.put(`artifacts/native-smoke/maintenance-test-${point}-resume`,'');
  try {
    skipMode(f,'off');f.put('continue','');
    f.env.SNAPBACK4_TEST_RETENTION_POINT='publication-committed';
    const first=spawn(process.execPath,[wrapper],{cwd:f.root,env:f.env,stdio:'ignore'});firstExit=once(first,'exit');
    await until(()=>read(path.join(root,'maintenance-test-point.json'))?.point==='publication-committed','first publication committed');
    const stopped=read(path.join(root,'maintenance-test-point.json'));
    const pending=read(path.join(root,'publication-pending.json'));
    const previous=path.dirname(pending.source);
    const generation=read(path.join(f.root,'dist/.snapback4-publication.json')).generation;
    await signalFixture(f,stopped.process,'SIGKILL');await firstExit;
    assert.equal(alive(first.pid),false,'the Node wrapper has exited before contention');
    f.env.SNAPBACK4_TEST_RETENTION_POINT=holder+',publication-recovery-busy';
    const producer=spawnSync(binary,['witness','export-maintenance',root],{cwd:f.root,env:f.env,encoding:'utf8',timeout:10000});
    assert.equal(producer.status,0,producer.stdout+producer.stderr);
    await until(()=>read(path.join(root,`maintenance-test-${holder}.json`))?.point===holder,'maintenance holds the interrupted export lease');
    const next=spawn(process.execPath,[wrapper],{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});nextExit=once(next,'exit');
    let output='';for(const stream of [next.stdout,next.stderr])stream.on('data',b=>{output=(output+b).slice(-16384);});
    await until(()=>read(path.join(root,'maintenance-test-publication-recovery-busy.json'))?.point==='publication-recovery-busy','next publisher encountered that custody');
    assert.equal(read(path.join(f.root,'dist/.snapback4-publication.json')).generation,generation,'visible committed generation stays intact during contention');
    console.log(JSON.stringify({holder,stalled,wrapperExited:first.pid,holderIdentity:read(path.join(root,`maintenance-test-${holder}.json`)).process,publisherIdentity:read(path.join(root,'maintenance-test-publication-recovery-busy.json')).process}));
    if(stalled) {
      resume('publication-recovery-busy');
      assert.equal((await nextExit)[0],1,output);
      assert.match(output,/interrupted publication still has export custody after 5 seconds; preserved/);
      assert.ok(alive(read(path.join(root,`maintenance-test-${holder}.json`)).process.pid),'the same paused holder outlives the refusal');
      assert.deepEqual(read(path.join(root,'publication-pending.json')),pending,'timeout preserves the exact recovery intent');
      assert.equal(read(path.join(f.root,'dist/.snapback4-publication.json')).generation,generation,'timeout leaves the committed namespace intact');
      resume(holder);await maintenanceIdle(f);
      const retry=f.invoke('retry after persistent custody');assert.equal(retry.status,0,retry.stdout+retry.stderr);
    } else {
      resume(holder);resume('publication-recovery-busy');
      assert.equal((await nextExit)[0],0,output);
    }
    assert.notEqual(read(path.join(f.root,'dist/.snapback4-publication.json')).generation,generation);
    assert.ok(read(path.join(f.latest().artifacts,'publication.json')),'next export verified its own publication');
    await maintenanceIdle(f);
    assert.ok(fs.existsSync(path.join(previous,'export')),'interrupted committed evidence survives recovery');
  } catch(error) {await maintenanceEvidence(f,'publication-recovery-failure');throw error;}
  finally {
    f.put('artifacts/native-smoke/maintenance-test-resume','');resume(holder);resume('publication-recovery-busy');
    if(firstExit)await firstExit;if(nextExit)await nextExit;
    await cleanup(f);
  }
});
const crashPoints=[
  ['request-created','next export'],['request-prepared','next export'],['request-committed','next export'],
  ['claim-renamed','peer'],['claim-recorded','peer'],['scan-starting','peer'],
  ['compress-before','next export'],['compress-committed','next export'],
  ['delete-before','next export'],['delete-after','next export'],
  ['scan-complete','peer'],['done-before','peer'],['done-after','already complete'],
];
for(const [point,recovery] of crashPoints)test(`maintenance crash matrix: ${point} (${recovery})`,{timeout:120000},async()=>{
  const {f,root,held}=await maintenanceFixture();let released=false,launcher,launcherExit;
  try {
    const observer=read(path.join(root,'maintenance-next.json')).process.pid;
    await signalFixture(f,read(path.join(root,'maintenance-next.json')).process,'SIGKILL');await until(()=>!alive(observer),'owned idle observer exited');
    f.env.SNAPBACK4_TEST_RETENTION_POINT=point;
    launcher=spawn(binary,['witness','export-maintenance',root],{cwd:f.root,env:f.env,stdio:'ignore'});launcherExit=once(launcher,'exit');
    if(!point.startsWith('request-')){assert.equal((await launcherExit)[0],0);held.child.stdin.end();await held.exited;released=true;}
    await until(()=>read(path.join(root,'maintenance-test-point.json')),'crash transition entered');
    const stopped=read(path.join(root,'maintenance-test-point.json'));assert.equal(stopped.point,point);
    if(['request-created','request-prepared'].includes(point))fs.rmSync(path.join(root,'maintenance-request.json')); // first publication of this request has no older dirty bit
    const before=Date.now();await signalFixture(f,stopped.process,'SIGKILL');
    if(!released){await launcherExit;held.child.stdin.end();await held.exited;released=true;}
    if(recovery==='next export') {
      await maintenanceIdle(f,true);
      // No helper repair: the next real wrapper is the documented backstop.
      if(['request-created','request-prepared'].includes(point))f.put('node_modules/expo/bin/cli','process.exit(23)');
      const resumed=f.invoke('next export repairs stranded or parked maintenance');assert.equal(resumed.status,['request-created','request-prepared'].includes(point)?23:0,resumed.stdout+resumed.stderr);
    }
    await maintenanceIdle(f);
    assertRetentionBound(f);
    assert.ok(!fs.existsSync(path.join(root,'maintenance-parked.json')));
    assert.ok(!fs.readdirSync(root).some(n=>n.startsWith('maintenance-request.')&&n.endsWith('.tmp')),'dead producer temporary state is repaired');
    console.log(JSON.stringify({point,recovery,restoredMs:Date.now()-before,full:5,compressed:20,attempt:read(path.join(root,'maintenance-active.json'))?.attempt}));
  } finally {
    f.put('artifacts/native-smoke/maintenance-test-resume','');
    if(!released){held.child.stdin.end();await held.exited;}
    if(launcherExit)await launcherExit;
    await cleanup(f);
  }
});

test('a custodian killed after claiming an empty legacy request resumes without a later export',{timeout:120000},async()=>{
  const {f,root,held}=await maintenanceFixture();let released=false;
  try {
    await signalFixture(f,read(path.join(root,'maintenance-next.json')).process,'SIGKILL');
    await until(()=>!alive(read(path.join(root,'maintenance-next.json')).process.pid),'old owned observer exited');
    f.env.SNAPBACK4_TEST_RETENTION_POINT='claim-renamed';
    const armed=spawnSync(binary,['witness','export-maintenance',root],{cwd:f.root,env:f.env,encoding:'utf8'});assert.equal(armed.status,0,armed.stderr);
    fs.writeFileSync(path.join(root,'maintenance-request.json'),'');
    held.child.stdin.end();await held.exited;released=true;
    await until(()=>read(path.join(root,'maintenance-test-point.json')),'empty claim renamed');
    assert.equal(fs.readFileSync(path.join(root,'maintenance-claimed.json'),'utf8'),'');
    await signalFixture(f,read(path.join(root,'maintenance-test-point.json')).process,'SIGKILL');
    await maintenanceIdle(f);assertRetentionBound(f);
    assert.doesNotMatch(fs.readFileSync(path.join(root,'maintenance.log'),'utf8'),/missing maintenance claim/);
  } finally {f.put('artifacts/native-smoke/maintenance-test-resume','');if(!released){held.child.stdin.end();await held.exited;}await cleanup(f);}
});

for(const point of ['handoff-pending','handoff-busy'])for(const victim of ['observer','custodian'])test(`maintenance handoff crash matrix: ${point} kills ${victim}`,{timeout:120000},async()=>{
  const {f,root,held}=await maintenanceFixture();let released=false,scan,ended;
  try {
    const observer=read(path.join(root,'maintenance-next.json'));
    scan=spawn('python3',['-c',`import fcntl,os,sys
f=open(sys.argv[1]+'/maintenance.lock','a');fcntl.flock(f,fcntl.LOCK_EX)
os.dup2(f.fileno(),3);os.set_inheritable(3,True)
os.execve(sys.argv[2],[sys.argv[2],'witness','export-maintain-scan',sys.argv[1],sys.argv[3]],os.environ)
`,root,binary,String(observer.expiresAt)],{cwd:f.root,env:{...f.env,SNAPBACK4_TEST_RETENTION_POINT:point},stdio:'ignore'});ended=once(scan,'exit');
    await until(()=>read(path.join(root,'maintenance-test-point.json')),'custodian saw busy observer lease');
    assert.equal(read(path.join(root,'maintenance-test-point.json')).process.pid,scan.pid);
    const pid=victim==='observer'?observer.process.pid:scan.pid;
    await signalFixture(f,victim==='observer'?observer.process:read(path.join(root,'maintenance-test-point.json')).process,'SIGKILL');await until(()=>!alive(pid),'owned victim exited in handoff gap');
    f.put('artifacts/native-smoke/maintenance-test-resume','');
    held.child.stdin.end();await held.exited;released=true;
    await maintenanceIdle(f);const [code,signal]=await ended;
    if(victim==='observer')assert.equal(code,0);else assert.equal(signal,'SIGKILL');
    assertRetentionBound(f);console.log(JSON.stringify({point,victim,recovery:'peer',full:5,compressed:20}));
  } finally {f.put('artifacts/native-smoke/maintenance-test-resume','');if(!released){held.child.stdin.end();await held.exited;}if(ended)await ended;await cleanup(f);}
});

for(const mode of ['off','non-macOS','background'])test(`next export repairs parked maintenance even when Expo fails (${mode})`,{timeout:120000},async()=>{
  const {f,root,held}=await maintenanceFixture();let released=false;
  try {
    const observer=read(path.join(root,'maintenance-next.json')).process.pid;
    await signalFixture(f,read(path.join(root,'maintenance-next.json')).process,'SIGKILL');await until(()=>!alive(observer),'owned observer exited');
    fs.renameSync(path.join(root,'maintenance-request.json'),path.join(root,'maintenance-parked.json'));
    assert.ok(!fs.existsSync(path.join(root,'maintenance-claimed.json')));
    held.child.stdin.end();await held.exited;released=true;
    delete f.env.SNAPBACK4_NATIVE_SMOKE;if(mode!=='background')skipMode(f,mode);
    f.put('node_modules/expo/bin/cli','process.exit(23)');
    const failure=f.invoke('no new publication can rescue maintenance');assert.equal(failure.status,23,failure.stdout+failure.stderr);
    await maintenanceIdle(f);assertRetentionBound(f);
    assert.equal(f.events().length,0,'maintenance backstop starts no simulator tools');
  } finally {if(!released){held.child.stdin.end();await held.exited;}await cleanup(f);}
});
