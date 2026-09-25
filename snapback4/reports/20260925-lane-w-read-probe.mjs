// Usage: node reports/20260925-lane-w-read-probe.mjs FIXTURE BINARY [dev flags...]
// Fixture: SB4_READ_FIXTURE=... cargo test -p snapback4 --test read_latency create_read_latency_fixture -- --ignored
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {loadavg} from 'node:os';
import {resolve} from 'node:path';

const [directory, executable, ...flags] = process.argv.slice(2);
assert.ok(directory && executable, 'usage: node read-probe.mjs FIXTURE BINARY [dev flags...]');
const binary = resolve(executable);
const child = spawn(binary, ['dev', '--port', '0', ...flags], {cwd:directory, stdio:['ignore','pipe','pipe']});
const exited = once(child, 'exit');
let output = '', url;
for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { output += part; url ??= output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const close = process.env.SB4_PROBE_CONNECTION_CLOSE === '1';
const report = {binary, flags, connectionClose:close, platform:process.platform, load:loadavg(), probes:[]};
const bins = [0.5,1,2,3,5,10,20,25,32,50,100,Infinity];
try {
  const deadline = Date.now() + 60000;
  while (!url) { assert.equal(child.exitCode, null, output); assert.ok(Date.now() < deadline, output); await sleep(20); }
  await sleep(1500);
  for (const [name, op, persona, args] of [
    ['following-5', 'home', 'u0005', {c:null}],
    ['following-500', 'home', 'u0500', {c:null}],
    ['busy-chat', 'history', 'u0500', {conversationId:'chat-0', c:null}],
    ['insights', 'insights', 'u0500', {}],
  ]) {
    const samples = [], start = performance.now();
    let rows;
    for (let n = -20; n < 1000; n++) {
      const before = performance.now();
      const response = await fetch(url + '/q/' + op, {method:'POST', headers:{'content-type':'application/json', 'x-snapback-persona':persona, ...(close ? {connection:'close'} : {})}, body:JSON.stringify({args})});
      const body = await response.json();
      const duration = performance.now() - before;
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.denied, undefined, JSON.stringify(body));
      if (op !== 'insights') assert.equal(body.data?.length, op === 'history' ? 50 : 20, `${name}: expected a full page`);
      if (n >= 0) samples.push(duration);
      rows = Array.isArray(body.data) ? body.data.length : null;
    }
    const ordered = samples.toSorted((a,b) => a-b);
    const histogram = bins.map((upper,i) => ({ms:i ? `${bins[i-1]}..${upper}` : `0..${upper}`, count:samples.filter(n => n <= upper && (!i || n > bins[i-1])).length}));
    report.probes.push({name, rows, elapsedMs:performance.now()-start, p50:ordered[499], p95:ordered[949], p99:ordered[989], max:ordered[999], histogram, samples});
  }
  console.log(JSON.stringify(report));
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await exited;
  if (child.exitCode !== 0) process.stderr.write(output);
}
