import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFile } from '../../../scripts/run-client-tests.mjs';
import { identity, live } from '../../../scripts/test-processes.mjs';

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
