// Run from snapback4/. Exercises real recovery with private fake simctl on
// Linux, then executes the Darwin test's unchanged final observation block.
// This is recovery/observation evidence, not a Darwin background-driver run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

const source = fs.readFileSync('packages/snapback4/test/export-background.test.mjs', 'utf8');
const helpers = source.slice(source.indexOf('const pause ='), source.indexOf('function fixture()'));
const liveness = source.slice(source.indexOf('function alive(pid)'), source.indexOf('function seedPass('));
const { until, read, alive } = new Function('fs', 'assert', `${helpers}\n${liveness}\nreturn {until,read,alive};`)(fs, assert);
const first = source.indexOf('    const owner = path.join(f.env.XDG_STATE_HOME');
assert.ok(first > 0);
const block = source.slice(first, source.indexOf('  } finally { await cleanup(f); }', first));
assert.match(block, /simulator cleanup custodians exited/);
const observe = new (async function () {}.constructor)('fs', 'path', 'assert', 'until', 'read', 'alive', 'f', 'dir', 'udid', block);
const binary = path.resolve('target/debug/snapback4');
const cases = ['delayed-delete', 'already-deleted', 'retained-record', 'wrong-deletion-marker', 'late-unrelated-call', 'changed-export'];
const results = [];
for (const mode of cases) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-fl-r2-recovery-'));
  const udid = randomUUID().toUpperCase(), other = randomUUID().toUpperCase();
  const put = (name, value) => {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const state = path.join(root, 'state'), owners = path.join(state, 'snapback4/witness/simulators');
  const dir = path.join(root, 'artifacts/native-smoke/1-1');
  const simulator = { udid, name: 'sb4-fl-r2-owned', prefix: 'sb4-fl-r2-', runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', selection: 'created', ready: false };
  const otherRecord = JSON.stringify({ ...simulator, udid: other, name: 'unrelated' });
  put('artifacts/native-smoke/1-1/live.json', { owner: null, wrapper: null, children: {}, background: true, simulator });
  put('artifacts/native-smoke/1-1/result.json', { state: 'failed' });
  put('dist/bundle.hbc', mode === 'changed-export' ? 'corrupted bytes' : 'export one');
  put(`state/snapback4/witness/simulators/${udid}.json`, mode === 'retained-record' ? { ...simulator, name: 'different-owner' } : simulator);
  put(`state/snapback4/witness/simulators/${other}.json`, otherRecord);
  fs.chmodSync(owners, 0o700);
  for (const id of [udid, other]) fs.chmodSync(path.join(owners, id + '.json'), 0o600);
  put('bin/xcrun', `#!/usr/bin/python3
import json, os, pathlib, sys, time
root=pathlib.Path(os.environ['FIXTURE_ROOT']); a=sys.argv[1:]; record=json.loads(os.environ['FIXTURE_SIMULATOR'])
with (root/'simctl-calls.jsonl').open('a') as log: log.write(json.dumps(a[1:])+'\\n')
if a==['simctl','list','devices','--json']:
    devices=[] if (root/'physically-deleted').exists() else [record]
    print(json.dumps({'devices':{record['runtime']:devices}}))
elif a==['simctl','delete',record['udid']]:
    (root/'physically-deleted').touch()
    (root/'deleted-simulator').write_text(os.environ['FIXTURE_OTHER'] if os.environ['FIXTURE_MODE']=='wrong-deletion-marker' else record['udid'])
    end=time.monotonic()+8
    while not (root/'release-delete').exists() and time.monotonic()<end: time.sleep(.01)
    assert (root/'release-delete').exists(), 'fixture delete never released'
    if os.environ['FIXTURE_MODE']=='late-unrelated-call':
        with (root/'simctl-calls.jsonl').open('a') as log: log.write(json.dumps(['delete',os.environ['FIXTURE_OTHER']])+'\\n')
else: raise AssertionError(a)
`);
  fs.chmodSync(path.join(root, 'bin/xcrun'), 0o755);
  if (['already-deleted', 'retained-record'].includes(mode)) {
    put('physically-deleted', ''); put('deleted-simulator', udid);
  }
  const env = { ...process.env, XDG_STATE_HOME: state, PATH: path.join(root, 'bin') + ':' + process.env.PATH,
    FIXTURE_ROOT: root, FIXTURE_SIMULATOR: JSON.stringify(simulator), FIXTURE_MODE: mode, FIXTURE_OTHER: other };
  const child = spawn(binary, ['witness', 'export-cleanup', path.dirname(dir), dir], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', x => output += x); child.stderr.on('data', x => output += x);
  const ended = once(child, 'close');
  // The observation block requires both recorded actors to have exited. For
  // this Linux replay they both identify the real, directly owned recovery
  // command; no fake Darwin platform or background custody claim is involved.
  for (const role of ['worker', 'driver']) put(`artifacts/native-smoke/1-1/${role}.json`, { process: { pid: child.pid } });
  try {
    let settled = false;
    // Only the expected retained-record refusal uses a shorter observation
    // bound. The predicate and all final assertions are unmodified source.
    const wait = mode === 'retained-record' ? (check, label) => until(check, label, 500) : until;
    const observed = observe(fs, path, assert, wait, read, alive, { root, env }, dir, udid)
      .then(() => { settled = true; return null; }, error => { settled = true; return error; });
    await until(() => fs.existsSync(path.join(root, 'deleted-simulator')), 'owned mock delete reached', 10000);
    if (!['already-deleted', 'retained-record'].includes(mode)) {
      assert.ok(fs.existsSync(path.join(owners, udid + '.json')), 'old immediate ownership assertion deterministically fails in this gap');
      assert.equal(settled, false, 'new observation waits for the later unlink');
    }
    put('release-delete', '');
    const [code] = await ended; assert.equal(code, 0, output);
    const failure = await observed;
    if (['delayed-delete', 'already-deleted'].includes(mode)) {
      assert.equal(failure, null, failure?.stack);
      assert.equal(read(path.join(dir, 'finished.json')).recovered, true);
    } else {
      assert.ok(failure instanceof assert.AssertionError, mode + ' must fail');
      if (mode === 'retained-record') assert.match(failure.message, /removed its ownership record/);
    }
    assert.equal(fs.readFileSync(path.join(owners, other + '.json'), 'utf8'), otherRecord, 'unrelated ownership remains byte-identical');
    const calls = fs.readFileSync(path.join(root, 'simctl-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    if (mode === 'already-deleted') assert.ok(calls.every(c => c[0] === 'list'), 'recovery removes the tombstone without deleting again');
    results.push({ mode, recoveryExit: code, observation: failure ? 'rejected as expected' : 'passed', calls, refusal: failure?.message });
  } finally {
    put('release-delete', '');
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await ended;
    await until(() => fs.readdirSync(path.dirname(dir)).filter(n => n.startsWith('.retention-')).every(n => {
      const record = read(path.join(path.dirname(dir), n, 'retention-group.json'));
      return !record || (!alive(record.group) && !alive(record.guardian?.pid));
    }), 'owned recovery keeper and guardian exited', 90000);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ platform: process.platform, assertionsFrom: 'export-background.test.mjs', results }, null, 2));
