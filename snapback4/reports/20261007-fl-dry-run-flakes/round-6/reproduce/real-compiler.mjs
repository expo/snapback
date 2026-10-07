// Astra's GCC -B reproduction, restricted to our private frontend and runner.
// No detached spawn or group escape occurs inside the compiler invocation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawnTracked } from '../../../../scripts/test-signals.mjs';
import { killOwned } from '../../../../scripts/test-owned-command.mjs';
const dir = fs.mkdtempSync(path.resolve('target/fl-verification/r6-real-gcc-'));
const release = path.join(dir, 'release'), ready = path.join(dir, 'ready'), term = path.join(dir, 'term');
const code = `const fs=require('fs');process.on('SIGTERM',()=>fs.writeFileSync(${JSON.stringify(term)},''));fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))process.exit(0)},10);`;
fs.writeFileSync(path.join(dir, 'cc1'), `#!${process.execPath}\n${code}`, { mode: 0o755 });
fs.writeFileSync(path.join(dir, 'cc'), `#!/bin/sh\nexec /usr/bin/cc -B '${dir}/' "$@"\n`, { mode: 0o755 });
const helper = new URL('../../../../scripts/test-signals.mjs', import.meta.url).href;
const runner = spawnTracked(process.execPath, ['--input-type=module', '-e', `Object.defineProperty(process,'platform',{value:'darwin'});try{await import(${JSON.stringify(helper)})}catch(e){console.log(e.message)}`],
  { env: { ...process.env, PATH: dir + ':' + process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
const ended = once(runner, 'close');
let output = '', stderr = '';
runner.stdout.on('data', data => { output += data; }); runner.stderr.on('data', data => { stderr += data; });
const start = performance.now();
const watchdog = setTimeout(() => killOwned(runner, 'SIGKILL'), 60000);
const state = pid => {
  try {
    const fields = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop().split(' ');
    return { state: fields[0], parent: Number(fields[1]), group: Number(fields[2]) };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
try {
  assert.deepEqual(await ended, [0, null]);
  assert.match(output, /cc ETIMEDOUT/);
  const pid = Number(fs.readFileSync(ready)), remaining = state(pid);
  assert.ok(fs.existsSync(term), 'real GCC frontend received group TERM');
  assert.ok(!remaining || ['Z', 'X'].includes(remaining.state), 'real GCC frontend must not survive helper return');
  console.log(JSON.stringify({ elapsedMs: performance.now() - start, output, stderr, descendantPid: pid, remaining, descendantOutlivesRunner: false }));
} finally {
  clearTimeout(watchdog); fs.writeFileSync(release, '');
  if (runner.exitCode === null && runner.signalCode === null) killOwned(runner, 'SIGKILL');
  await ended;
  if (fs.existsSync(ready)) {
    const pid = Number(fs.readFileSync(ready)), deadline = performance.now() + 10000;
    while (state(pid) && !['Z', 'X'].includes(state(pid).state)) {
      assert.ok(performance.now() < deadline, 'private release completed'); await sleep(20);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
