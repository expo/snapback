import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFile, fileTimeout } from '../../../scripts/run-client-tests.mjs';
import { identity, live, processTable } from '../../../scripts/test-processes.mjs';

for (const block of ['event loop', 'leaked handle']) test(`file watchdog diagnoses ${block} and reaps detached descendants`, { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-file-watchdog-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'stuck.test.mjs'), pidFile = join(dir, 'pid');
  writeFileSync(path, `import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync} from 'node:fs';
test('stuck fixture', async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.log('child ready');setInterval(()=>{},1000)"], {detached:true,stdio:['ignore','pipe','ignore']});
  await once(child.stdout,'data');
  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
  console.log('FIXTURE_READY: ${block}');
  ${block === 'event loop' ? 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);' : "throw Error('original assertion failure');"}
});`);
  let output = '';
  const result = await runFile(path, { timeout: 3000, onOutput: text => { output += text; } });
  assert.equal(result.passed, false);
  assert.equal(result.reason, 'TEST_FILE_HANG');
  assert.match(output, /TEST_FILE_HANG/);
  assert.ok(output.includes(path));
  assert.match(output, /FIXTURE_READY/);
  if (block === 'leaked handle') assert.match(output, /original assertion failure/);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  const current = identity(pid);
  assert.equal(current && live(current) || false, false, 'detached child must be gone before the runner returns');
});

test('file runner preserves test failures and continues to a following healthy file', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-file-results-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const failed = join(dir, 'fail.test.mjs'), good = join(dir, 'pass.test.mjs');
  writeFileSync(failed, "import test from 'node:test';test('real failure',()=>{throw Error('kept failure')});");
  writeFileSync(good, "import test from 'node:test';test('healthy',()=>{});");
  let output = '';
  const bad = await runFile(failed, { onOutput: text => { output += text; } });
  const ok = await runFile(good, { onOutput: text => { output += text; } });
  assert.equal(bad.passed, false); assert.equal(bad.counts.fail, 1);
  assert.equal(ok.passed, true); assert.equal(ok.counts.pass, 1);
  assert.match(output, /kept failure/);
});

test('file exit cannot orphan an unreferenced detached child and report success', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-file-orphan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'leak.test.mjs'), pidFile = join(dir, 'pid');
  writeFileSync(path, `import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync} from 'node:fs';
test('leaked child', async () => {
  const child = spawn(process.execPath, ['-e', "console.log('ready');setInterval(()=>{},1000)"], {detached:true,stdio:['ignore','pipe','ignore']});
  await once(child.stdout,'data');
  writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
  child.stdout.destroy(); child.unref();
});`);
  let output = '';
  const result = await runFile(path, { onOutput: text => { output += text; } });
  assert.equal(result.passed, false); assert.equal(result.reason, 'TEST_FILE_LEAK');
  assert.match(output, /TEST_FILE_LEAK/);
  const current = identity(Number(readFileSync(pidFile, 'utf8')));
  assert.equal(current && live(current) || false, false);
});

// The shell exits before inspection. Neither sleep nor its intermediate parent
// is registered by Node; ownership must survive through the file's group.
for (const stalled of [false, true]) test(`double-forked shell helper is killed after a ${stalled ? 'stalled' : 'passing'} file`, { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-double-fork-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'orphan.test.mjs'), pidFile = join(dir, 'pid');
  writeFileSync(path, `import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
test('double fork', () => {
  const pid = execFileSync('/bin/sh', ['-c', 'sleep 600 </dev/null >/dev/null 2>&1 & echo $!'], {encoding:'utf8'}).trim();
  writeFileSync(${JSON.stringify(pidFile)}, pid);
  console.log('ORPHAN_READY');
  ${stalled ? 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);' : ''}
});`);
  let output = '';
  const result = await runFile(path, { timeout: 3000, onOutput: text => { output += text; } });
  assert.equal(result.passed, false, output);
  assert.equal(result.reason, stalled ? 'TEST_FILE_HANG' : 'TEST_FILE_LEAK', output);
  assert.match(output, /ORPHAN_READY/);
  const current = identity(Number(readFileSync(pidFile, 'utf8')));
  assert.equal(current && live(current) || false, false, 'reparented helper must be dead before return');
});

for (const fault of ['exit', 'timeout', 'malformed']) test(`process inspection ${fault} cannot establish a passing cleanup`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-inspection-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'pass.test.mjs'), pidFile = join(dir, 'pid');
  writeFileSync(path, `import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
test('helper', () => writeFileSync(${JSON.stringify(pidFile)}, execFileSync('/bin/sh', ['-c', 'sleep 600 </dev/null >/dev/null 2>&1 & echo $!'])));`);
  let inspections = 0, output = '';
  const result = await runFile(path, { onOutput: text => { output += text; }, inspect: () => {
    if (++inspections > 1) return processTable();
    return processTable({ run: () => fault === 'exit' ? {status:2,stderr:'injected ps exit'}
      : fault === 'timeout' ? {status:null,error:Error('injected ps timeout')}
      : {status:0,stdout:'broken process row'} });
  } });
  assert.equal(result.passed, false, output);
  assert.equal(result.reason, 'TEST_PROCESS_INSPECTION', output);
  assert.match(output, /TEST_PROCESS_INSPECTION/);
  const current = identity(Number(readFileSync(pidFile, 'utf8')));
  assert.equal(current && live(current) || false, false);
});

test('process inspection forces C locale and refuses empty output', () => {
  assert.throws(() => processTable({ run: (_command, _args, options) => {
    assert.equal(options.env.LC_ALL, 'C');
    assert.ok(options.timeout > 0);
    return { status: 0, stdout: '' };
  } }), /TEST_PROCESS_INSPECTION/);
  assert.ok(identity(process.pid)?.alive);
});

test('long-file caps cover aggregate declared guards with margin, including seed overrides', () => {
  assert.equal(fileTimeout('ordinary-search-oracle.test.mjs', {}), 24060000);
  assert.equal(fileTimeout('mixed-evidence-oracle.test.mjs', {}), 5400000);
  assert.equal(fileTimeout('app-session-model.test.mjs', {}), 26150000);
  assert.equal(fileTimeout('online-client-model.test.mjs', {}), 8400000);
  assert.ok(fileTimeout('horizon-boundary.test.mjs') > 82 * (120000 + 5000 * 2000));
  assert.ok(fileTimeout('online-client-model.test.mjs', {SNAPBACK4_ONLINE_SEQUENCES:'6000'}) > 12000000);
  assert.ok(fileTimeout('mixed-evidence-oracle.test.mjs', {RL_SEEDS:'1000'}) > 12000000);
  assert.equal(fileTimeout('ordinary.test.mjs'), 900000);
});

test('persistent inspection failure stays a failure and kills the owned group', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-inspection-persistent-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'leak.test.mjs'), pidFile = join(dir, 'pid');
  writeFileSync(path, `import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
test('helper', () => writeFileSync(${JSON.stringify(pidFile)}, execFileSync('/bin/sh', ['-c', 'sleep 600 </dev/null >/dev/null 2>&1 & echo $!'])));`);
  let output = '';
  const result = await runFile(path, { onOutput: text => { output += text; }, inspect: () => {
    throw Error('TEST_PROCESS_INSPECTION: persistent injected failure');
  } });
  assert.equal(result.passed, false, output);
  assert.equal(result.reason, 'TEST_PROCESS_INSPECTION', output);
  assert.match(result.inspectionFailure, /persistent injected failure/);
  const current = identity(Number(readFileSync(pidFile, 'utf8')));
  assert.equal(current && live(current) || false, false);
});
