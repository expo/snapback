import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawnTracked, signalChild } from '../../../scripts/test-signals.mjs';
import { identity, processTable } from '../../../scripts/test-processes.mjs';
import { waitForEmptyGroup } from '../../../scripts/test-command-group.mjs';

// The subprocess invokes the helper before any file keeper of its own exists,
// just like inspector initialization. Only the helper's private group can
// collect its compiler frontend; outer cleanup is not a passing oracle.
for (const driverExitsOnTerm of [false, true])
test(`compiler timeout drains its frontend before returning (driver exits on TERM=${driverExitsOnTerm})`, { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-compiler-group-'));
  const put = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const quoted = name => JSON.stringify(path.join(dir, name));
  put('frontend.cjs', `const fs=require('node:fs');
process.on('SIGTERM',()=>{fs.writeFileSync(${quoted('frontend-term')},'');setTimeout(()=>{fs.writeFileSync(${quoted('emergency')},'');process.exit(1)},10000)});
fs.writeFileSync(${quoted('frontend-pid')},String(process.pid));
setInterval(()=>{if(fs.existsSync(${quoted('release')}))process.exit(0)},10);`);
  put('driver.cjs', `const fs=require('node:fs'),{spawn}=require('node:child_process');
process.on('SIGTERM',()=>{fs.writeFileSync(${quoted('driver-term')},'');${driverExitsOnTerm ? 'process.exit(0)' : ''}});
spawn(process.execPath,[${quoted('frontend.cjs')}],{stdio:'inherit'});
fs.writeFileSync(${quoted('driver-pid')},String(process.pid));
setInterval(()=>{if(fs.existsSync(${quoted('release')}))process.exit(0)},10);`);
  const helper = new URL('../../../scripts/test-owned-command.mjs', import.meta.url).href;
  const code = `import {runOwnedCommand} from ${JSON.stringify(helper)};
const result=await runOwnedCommand(process.execPath,[${quoted('driver.cjs')}],{timeout:5000,grace:1000});
console.log(JSON.stringify({...result,error:result.error?.code,cleanupError:result.cleanupError?.message}));`;
  const runner = spawnTracked(process.execPath, ['--input-type=module', '-e', code]);
  const ended = once(runner, 'close');
  let output = '', stderr = '';
  runner.stdout.on('data', data => { output += data; });
  runner.stderr.on('data', data => { stderr += data; });
  try {
    assert.deepEqual(await ended, [0, null], stderr);
    const result = JSON.parse(output);
    assert.equal(result.error, 'ETIMEDOUT');
    for (const role of ['driver', 'frontend']) {
      const pid = Number(fs.readFileSync(path.join(dir, role + '-pid'), 'utf8'));
      assert.equal((await identity(pid))?.alive ?? false, false, `${role} must be gone before the runner returns`);
      assert.ok(fs.existsSync(path.join(dir, role + '-term')), `${role} received group TERM before KILL`);
    }
    assert.equal(result.cleanupError, undefined);
    assert.ok(Number.isSafeInteger(result.group) && result.group > 0);
    assert.notEqual(result.group, runner.pid, 'the command has a private keeper group');
    assert.deepEqual((await processTable({ group: result.group })).filter(row => row.group === result.group && row.alive), []);
    assert.equal(fs.existsSync(path.join(dir, 'emergency')), false, 'bounded KILL precedes fixture emergency release');
  } finally {
    put('release', '');
    if (runner.exitCode === null && runner.signalCode === null) signalChild(runner, 'SIGTERM');
    await ended;
    const deadline = performance.now() + 10000;
    for (const role of ['driver', 'frontend']) {
      const file = path.join(dir, role + '-pid');
      if (!fs.existsSync(file)) continue;
      while ((await identity(Number(fs.readFileSync(file, 'utf8'))))?.alive) {
        assert.ok(performance.now() < deadline, 'private release must drain the negative-control fixture');
        await sleep(20);
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('group verification requires two complete empty snapshots after living members', async () => {
  const snapshots = ['12 12 S\n13 12 S\n', '1 1 S\n13 12 Z\n', '1 1 S\n'];
  let calls = 0;
  await waitForEmptyGroup(12, async () => ({ status: 0, stdout: snapshots[calls++] }));
  assert.equal(calls, 3);
});
for (const result of [
  { status: 0, stdout: '' }, { status: 2, stdout: '1 1 S\n' },
  { error: Error('ps timed out'), stdout: '1 1 S\n' }, { status: 0, stdout: '12 damaged S\n' },
]) test('incomplete group inspection refuses instead of declaring custody empty: ' + JSON.stringify(result), async () => {
  await assert.rejects(waitForEmptyGroup(12, async () => result), /TEST_COMMAND_INSPECTION/);
});
