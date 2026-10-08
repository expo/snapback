import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { inspectSignalTarget, signalChild, spawnTracked, childCaptureReady } from '../../../scripts/test-signals.mjs';
import { fixtureCommand } from './helpers/fixture-command.mjs';
import { fixtureTestMs } from '../../../scripts/test-work-bounds.mjs';
import { signalFixture } from './helpers/fixture-signals.mjs';
import { killOwned, runOwnedCommand, runInspection } from '../../../scripts/test-owned-command.mjs';
import { runProcess, processExists } from '../../../scripts/test-processes.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-signal-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function waitFor(predicate) {
  const end = performance.now() + 10000;
  while (!predicate()) { assert.ok(performance.now() < end, 'fixture state deadline'); await sleep(20); }
}

test('fixture signals bind every native command to the selected binary and exact root', { timeout: fixtureTestMs() }, async t => {
  const dir = fs.realpathSync(fixture(t)), root = path.join(dir, 'project.[fixture]');
  fs.mkdirSync(root);
  const alias = path.join(dir, 'project-alias'); fs.symlinkSync(root, alias);
  const original = path.join(root, 'original'), selected = path.join(root, 'snapback4-interposed');
  // A native stand-in preserves argv[0] and all witness arguments. It remains
  // under our child handle and exits on stdin EOF even if an assertion fails.
  fs.writeFileSync(original + '.c', '#include <stdio.h>\nint main(void) { puts("ready"); fflush(stdout); while (getchar() != EOF) {} return 0; }\n');
  const built = await fixtureCommand('cc', [original + '.c', '-o', original], { label: 'native copied-binary identity fixture' });
  assert.equal(built.error, undefined); assert.equal(built.status, 0, built.stderr.toString());
  fs.copyFileSync(original, selected);
  const artifacts = path.join(root, 'artifacts/native-smoke'), run = path.join(artifacts, '123-456');
  for (const args of [
    ['witness', 'background-worker', run],
    ['witness', 'background-run', run],
    ['witness', 'export-maintenance', artifacts],
    ['witness', 'export-maintain', artifacts, '12345'],
    ['witness', 'export-maintain-scan', artifacts, '12345'],
    ['witness', 'export-retain-worker', path.join(artifacts, '.retention-123'), artifacts],
    ...['--environment-skip', '--background'].map(mode => ['witness', 'export-publish', path.join(run, 'publication-export'), path.join(root, 'dist'), mode]),
  ]) {
    const child = spawnTracked(selected, args), exited = once(child, 'exit');
    try {
      await once(child.stdout, 'data');
      const record = await inspectSignalTarget(child.pid, [selected, ...args]);
      const originalKill = process.kill, attempted = [];
      // Exercise the complete recorded fault dispatcher without killing any
      // recorded PID. Cleanup uses the retained child's private EOF protocol.
      process.kill = (...values) => { attempted.push(values); return true; };
      try {
        const f = { root, env: { SNAPBACK4_BIN: selected } };
        await signalFixture(f, record, 'SIGKILL');
        assert.deepEqual(attempted, [[child.pid, 'SIGKILL']], args[1]);
        attempted.length = 0;
        for (const wrong of [
          { root, env: { SNAPBACK4_BIN: original } },
          { root, env: { SNAPBACK4_BIN: path.join(alias, 'snapback4-interposed') } },
          { root: alias, env: f.env },
          { root: root.replace('[fixture]', 'xfixturex'), env: f.env },
        ]) await assert.rejects(() => signalFixture(wrong, record, 'SIGKILL'), /expected fixture command/, args[1]);
        assert.deepEqual(attempted, [], 'different binary/root spellings must refuse before dispatch');
      } finally { process.kill = originalKill; }
    } finally { child.stdin.end(); await exited; }
  }
});

for (const mode of ['shebang', 'env shebang', 'node file'])
test(`tracked identity accepts ${mode} with its exact interpreter argv`, { timeout: fixtureTestMs() }, async t => {
  const dir = fixture(t), file = path.join(dir, 'child.cjs');
  const prefix = mode === 'env shebang' ? '#!/usr/bin/env node' : `#!${process.execPath}`;
  fs.writeFileSync(file, `${prefix}\nprocess.stdin.resume();process.stdin.on('end',()=>process.exit(0));console.log('ready');\n`, { mode: 0o755 });
  const child = mode === 'node file' ? spawnTracked(process.execPath, [file]) : spawnTracked(file, []);
  const exited = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    const original = process.kill, originalChildKill = child.kill, attempted = [];
    process.kill = () => { assert.fail('owned-child signal must use its retained handle'); };
    child.kill = signal => { attempted.push([child.pid, signal]); return true; };
    try {
      await signalChild(child, 'SIGTERM');
      assert.deepEqual(attempted, [[child.pid, 'SIGTERM']]);
    } finally { process.kill = original; child.kill = originalChildKill; }
  } finally { child.stdin.end(); await exited; }
});

for (const changedCommand of [false, true])
test(`owned shebang timeout reaps before resolving (identity refusal=${changedCommand})`, { timeout: 20000 }, async t => {
  const dir = fixture(t), file = path.join(dir, 'child.cjs'), ready = path.join(dir, 'ready'), stop = path.join(dir, 'stop'), go = path.join(dir, 'go');
  fs.writeFileSync(file, `#!${process.execPath}
const fs=require('node:fs');
setInterval(()=>{
 if(fs.existsSync(${JSON.stringify(stop)}))process.exit(0);
 if(fs.existsSync(${JSON.stringify(go)})&&!fs.existsSync(${JSON.stringify(ready)})){
  ${changedCommand ? "process.title='sb4-deliberately-changed-command';" : ''}
  fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));
 }
},10);
`, { mode: 0o755 });
  try {
    let completed = false;
    const pending = runProcess(file, [], { timeout: 3000, maxBuffer: 1024, env: process.env }).finally(() => { completed = true; });
    fs.writeFileSync(go, 'capture completed');
    await waitFor(() => fs.existsSync(ready) || completed);
    assert.ok(fs.existsSync(ready), 'child reached readiness before timeout');
    const pid = Number(fs.readFileSync(ready, 'utf8'));
    // Fault identity remains strict even though timeout cleanup deliberately
    // uses owned handle custody without waiting for the inspector.
    if (changedCommand) await assert.rejects(inspectSignalTarget(pid, [process.execPath, file]), /TEST_SIGNAL_REFUSED/);
    else assert.equal((await inspectSignalTarget(pid, [process.execPath, file])).pid, pid, 'the interpreter command must validate');
    const result = await pending;
    assert.ok(fs.existsSync(ready), 'child reached readiness before timeout');
    assert.equal(result.error?.code, 'ETIMEDOUT');
    assert.equal(result.signal, 'SIGKILL');
    assert.equal(processExists(Number(fs.readFileSync(ready, 'utf8'))), false, 'timeout resolves only after reaping');
  } finally {
    // A broken timeout implementation still has an independent, private exit
    // protocol. Never leave the deliberately live regression child behind.
    fs.writeFileSync(stop, '');
    if (fs.existsSync(ready)) await waitFor(() => !processExists(Number(fs.readFileSync(ready, 'utf8'))));
  }
});

test('owned cleanup refuses a borrowed numeric PID or imitation child object', () => {
  assert.throws(() => killOwned(process.pid, 'SIGKILL'), /no owned ChildProcess handle/);
  assert.throws(() => killOwned({ pid: process.pid, kill() { assert.fail('borrowed dispatch'); } }, 'SIGKILL'), /no owned ChildProcess handle/);
});

test('self-directed cleanup loads synchronously without the Darwin inspector', { timeout: fixtureTestMs() }, async t => {
  const dir = fixture(t), compiled = path.join(dir, 'compiled');
  fs.writeFileSync(path.join(dir, 'cc'), `#!/bin/sh\ntouch '${compiled}'\nexit 1\n`, { mode: 0o755 });
  const helper = new URL('../../../scripts/test-owned-command.mjs', import.meta.url).pathname;
  const script = `Object.defineProperty(process,'platform',{value:'darwin'});
process.kill=(...args)=>console.log(JSON.stringify(args));
require(${JSON.stringify(helper)}).signalSelf('SIGKILL',{group:true});`;
  const result = await fixtureCommand(process.execPath, ['-e', script], { label: 'synchronous self-cleanup import', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(JSON.parse(result.stdout), [0, 'SIGKILL']);
  assert.equal(fs.existsSync(compiled), false, 'self cleanup must never depend on compiler availability');
});

test('Darwin inspector compiler escalates when its child handles SIGTERM', { timeout: 90000 }, async t => {
  const dir = fixture(t), term = path.join(dir, 'term'), ready = path.join(dir, 'ready'), stop = path.join(dir, 'stop'), escaped = path.join(dir, 'escaped');
  fs.writeFileSync(path.join(dir, 'cc'), `#!${process.execPath}
const fs=require('node:fs');
process.on('SIGTERM',()=>{
 fs.writeFileSync(${JSON.stringify(term)},'handled');
 // A regressed implementation must fail without leaving an orphan compiler.
 // This self-release is ten times the helper's grace and records its use.
 setTimeout(()=>{fs.writeFileSync(${JSON.stringify(escaped)},'unreaped');process.exit(1)},10000);
});
fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));
setInterval(()=>{if(fs.existsSync(${JSON.stringify(stop)}))process.exit(1)},10);
`, { mode: 0o755 });
  const module = new URL('../../../scripts/test-signals.mjs', import.meta.url).href;
  const script = `Object.defineProperty(process,'platform',{value:'darwin'});
try { await import(${JSON.stringify(module)}); throw Error('unexpected compiler success'); }
catch(error) { console.log(error.message); }`;
  try {
    const result = await runOwnedCommand(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, timeout: 60000,
    });
    assert.equal(result.error, undefined, 'compiler must reap and return before the outer guard');
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(fs.readFileSync(term, 'utf8'), 'handled', 'TERM must precede KILL');
    assert.equal(fs.existsSync(escaped), false, 'compiler must be killed before its emergency self-release');
    assert.match(result.stdout.toString(), /TEST_SIGNAL_REFUSED: cannot build Darwin identity inspector: cc ETIMEDOUT/);
    assert.equal(processExists(Number(fs.readFileSync(ready, 'utf8'))), false, 'compiler reaped');
  } finally {
    fs.writeFileSync(stop, '');
    if (fs.existsSync(ready)) await waitFor(() => !processExists(Number(fs.readFileSync(ready, 'utf8'))));
  }
});


// /proc can publish an empty command while env execs its interpreter. Only
// initial capture may wait for a complete command, within the same live birth.
for (const fault of ['none', 'different birth', 'different parent', 'malformed command'])
test(`newborn command capture after empty exec state: ${fault}`, { skip: process.platform !== 'linux', timeout: fixtureTestMs() }, async t => {
  const dir = fixture(t), file = path.join(dir, 'exec-child.cjs');
  fs.writeFileSync(file, '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>process.exit(0));console.log("ready");\n', { mode: 0o755 });
  const read = fs.readFileSync;
  let target, statReads = 0, commandReads = 0, child;
  const mocked = t.mock.method(fs, 'readFileSync', function(name, ...args) {
    const raw = read.call(this, name, ...args);
    const stat = /^\/proc\/(\d+)\/stat$/.exec(String(name));
    if (stat && (target === undefined || target === stat[1])) {
      target ??= stat[1]; statReads++;
      if (['different birth', 'different parent'].includes(fault) && statReads > 2) {
        const text = String(raw), end = text.lastIndexOf(')') + 1;
        const fields = text.slice(end).trim().split(/\s+/);
        const field = fault === 'different birth' ? 19 : 1;
        fields[field] = String(BigInt(fields[field]) + 1n);
        return text.slice(0, end) + ' ' + fields.join(' ') + '\n';
      }
    }
    if (String(name) === `/proc/${target}/cmdline`) {
      if (++commandReads === 1) return '';
      if (fault === 'malformed command') return 'unterminated argv';
    }
    return raw;
  });
  try { child = spawnTracked(file, []); await childCaptureReady(child); }
  finally { mocked.mock.restore(); }
  const exited = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    const attempted = [];
    const kill = t.mock.method(child, 'kill', signal => { attempted.push(signal); return true; });
    try {
      if (fault === 'none') {
        await signalChild(child, 'SIGTERM');
        assert.deepEqual(attempted, ['SIGTERM']);
        assert.ok(commandReads >= 2, 'a fresh complete command must be captured');
      } else {
        await assert.rejects(() => signalChild(child, 'SIGTERM'), fault === 'different birth'
          ? /no captured child birth: .*stale publisher birth/
          : fault === 'different parent' ? /no captured child birth: .*not this parent's child/
          : /no captured child birth: .*incomplete process command/);
        assert.deepEqual(attempted, [], 'an invalid initial capture must never dispatch');
        if (fault === 'malformed command') assert.equal(commandReads, 2, 'malformed nonempty bytes are not retried');
      }
    } finally { kill.mock.restore(); }
  } finally { child.stdin.end(); await exited; }
});

test('persistent empty cmdline yields to sibling timers and owned command timeout', { skip: process.platform !== 'linux', timeout: 20000 }, async t => {
  const read = fs.readFileSync;
  let pid, reads = 0, firstHeartbeat, ticks = 0;
  const started = performance.now();
  const heartbeat = setInterval(() => { firstHeartbeat ??= performance.now() - started; ticks++; }, 20);
  const mocked = t.mock.method(fs, 'readFileSync', function(name, ...args) {
    const data = read.call(this, name, ...args);
    const match = /^\/proc\/(\d+)\/cmdline$/.exec(String(name));
    if (match) { pid ??= Number(match[1]); assert.equal(Number(match[1]), pid); reads++; return ''; }
    return data;
  });
  let pending;
  try {
    // The child has an independent emergency exit for broken implementations.
    // Only its command observation is empty; parent/birth and handle are real.
    pending = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000);setTimeout(()=>process.exit(97),10000)'], {
      timeout: 200, maxBuffer: 1024, env: process.env,
    });
    const spawnReturnMs = performance.now() - started;
    const result = await pending;
    const elapsedMs = performance.now() - started;
    assert.equal(result.error?.code, 'ETIMEDOUT');
    assert.equal(result.signal, 'SIGKILL', 'owned cleanup must precede emergency exit');
    assert.equal(processExists(pid), false, 'timeout resolves only after reaping');
    assert.ok(reads >= 2, 'capture kept observing the incomplete command');
    assert.ok(ticks >= 2 && firstHeartbeat < 1000, `sibling timers ran during capture: ${firstHeartbeat} ms, ${ticks} ticks`);
    assert.ok(spawnReturnMs < 1000, `spawn returned promptly: ${spawnReturnMs} ms`);
    assert.ok(elapsedMs < 2000, `200 ms timeout and reaping stayed active: ${elapsedMs} ms`);
    const readsAtClose = reads;
    await sleep(30);
    assert.equal(reads, readsAtClose, 'child exit cancels pending capture');
    console.log(JSON.stringify({ timeoutMs: 200, spawnReturnMs, elapsedMs, firstHeartbeat, ticks, commandReads: reads, reaped: true }));
  } finally { await pending; clearInterval(heartbeat); mocked.mock.restore(); }
});

for (const mode of ['timeout', 'abort'])
test(`native identity leaf inspection yields and reaps on ${mode}`, { timeout: 20000 }, async () => {
  const abort = new AbortController();
  let firstHeartbeat, ticks = 0;
  const started = performance.now();
  const heartbeat = setInterval(() => { firstHeartbeat ??= performance.now() - started; ticks++; }, 20);
  const timer = mode === 'abort' ? setTimeout(() => abort.abort(Error('fixture capture cancelled')), 200) : undefined;
  try {
    const result = await runInspection(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);setTimeout(()=>process.exit(97),10000)'], {
      timeout: mode === 'timeout' ? 200 : 15000, maxBuffer: 1024, signal: abort.signal,
    });
    assert.equal(result.signal, 'SIGKILL');
    if (mode === 'timeout') assert.equal(result.error?.code, 'ETIMEDOUT');
    else assert.equal(result.error, abort.signal.reason);
    assert.equal(processExists(result.pid), false, 'leaf is reaped before return');
    assert.ok(ticks >= 2 && firstHeartbeat < 1000, 'sibling timers run during native inspection');
    assert.ok(performance.now() - started < 2000, 'owned timeout/abort must not wait for the native inspector');
  } finally { clearInterval(heartbeat); clearTimeout(timer); }
});
