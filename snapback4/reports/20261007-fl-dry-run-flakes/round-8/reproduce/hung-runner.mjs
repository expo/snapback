// Real CLI + real stuck test + TERM-resistant descendant. The short injected
// transport clock is only this control; production fixture budgets stay intact.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { fixtureCommand } from '../../../../packages/snapback4/test/helpers/fixture-command.mjs';
import { identity, processTable } from '../../../../scripts/test-processes.mjs';

const sb4 = fileURLToPath(new URL('../../../../', import.meta.url));
const root = fs.mkdtempSync(path.join(sb4, 'target/fl-r8-hung-'));
const file = path.join(root, 'hung.test.mjs'), marker = path.join(root, 'ready'), release = path.join(root, 'release');
const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
fs.writeFileSync(file, `import test from 'node:test';import fs from 'node:fs';import {spawn} from 'node:child_process';import {once} from 'node:events';
test('hung runner control',async()=>{
 const child=spawn(process.execPath,['-e',${JSON.stringify(`const fs=require('node:fs');process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))process.exit(0)},20)`)}],{stdio:['ignore','pipe','ignore']});
 await once(child.stdout,'data');fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,child.pid]));
 while(!fs.existsSync(${JSON.stringify(release)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
});`);
let escaped = false;
const emergency = setTimeout(() => { escaped = true; fs.writeFileSync(release, ''); }, 30000);
const started = performance.now();
try {
  let failed;
  try { await fixtureCommand(process.execPath, [path.join(sb4, 'scripts/run-client-tests.mjs'), '1', 'files', file], { env, timeout: 10000, label: 'deliberately hung real runner' }); }
  catch (error) { failed = error; }
  assert.match(failed?.message ?? '', /TEST_FIXTURE_COMMAND_TIMEOUT: deliberately hung real runner/);
  assert.equal(failed.cause.code, 'ETIMEDOUT');
  assert.equal(failed.result.cleanupError, undefined);
  assert.ok(fs.existsSync(marker), 'fixture really reached its stuck state');
  const pids = JSON.parse(fs.readFileSync(marker));
  const end = performance.now() + 60000;
  for (const pid of pids) while ((await identity(pid))?.alive) {
    assert.ok(performance.now() < end, 'keeper EOF must drain the detached file group'); await sleep(25);
  }
  assert.deepEqual((await processTable({ group: failed.result.group })).filter(r => r.group === failed.result.group && r.alive), []);
  assert.equal(escaped, false, 'timeout cleanup precedes the independent emergency release');
  console.log(failed.message);
  console.log(JSON.stringify({ expectedFailure: true, code: failed.cause.code, pids, descendantsGone: true, groupDrained: true, milliseconds: Math.round(performance.now()-started) }));
} finally {
  clearTimeout(emergency); fs.writeFileSync(release, '');
  if (fs.existsSync(marker)) for (const pid of JSON.parse(fs.readFileSync(marker))) {
    const end = performance.now() + 60000;
    while ((await identity(pid))?.alive) {
      assert.ok(performance.now() < end, 'independent fixture release must complete'); await sleep(25);
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}
