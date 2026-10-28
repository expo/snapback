import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const runner = new URL('../bin/proof-runner.js', import.meta.url).href;
function run(body, catchFailure = false) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import {runProofSuite} from ${JSON.stringify(runner)};await runProofSuite(async()=>{${body}})${catchFailure ? ".catch(()=>{})" : ""}`]);
    let stdout='', stderr='';
    child.stdout.on('data', data=>stdout+=data); child.stderr.on('data', data=>stderr+=data);
    const guard=setTimeout(()=>{child.kill('SIGKILL');reject(Error('suite exit stalled'));},5000);
    child.once('error',reject);
    child.once('close',code=>{clearTimeout(guard);resolve({code,stdout,stderr,ms:performance.now()-start});});
  });
}
test('suite and finally cleanup finish before an abandoned race timer is cut', async()=>{
  const result=await run(`try {
    const value=await Promise.race([new Promise(r=>setTimeout(()=>r('tested'),150)),new Promise(r=>setTimeout(()=>r('late'),12000))]);
    console.log(value);
  } finally {await new Promise(r=>setTimeout(r,150));console.log('cleanup finished');}`);
  assert.equal(result.code,0);assert.equal(result.stdout,'tested\ncleanup finished\n');
  assert.match(result.stderr,/lingering handles after suite: Timeout\(1\)/);
  assert.ok(result.ms>=300 && result.ms<5000);
});
test('failure diagnostics and nonzero suite status survive completed cleanup',async()=>{
  const failed=await run(`try {setInterval(()=>{},1000);throw Error('E_FIXTURE: exact failure');}finally{console.log('cleaned');}`);
  assert.equal(failed.code,1);assert.match(failed.stderr,/Error: E_FIXTURE: exact failure/);assert.equal(failed.stdout,'cleaned\n');
  const explicit=await run(`process.exitCode=7;setTimeout(()=>{},12000);console.log('refused');`);
  assert.equal(explicit.code,7);assert.match(explicit.stderr,/exiting with status 7/);
});
test('large reports drain before process exit and ordinary completed suites are quiet',async()=>{
  const result=await run(`console.log('x'.repeat(1024*1024));`);
  assert.equal(result.code,0);assert.equal(result.stdout,'x'.repeat(1024*1024)+'\n');assert.equal(result.stderr,'');
});

test('awaited unref work and cleanup remain live until both settle',async()=>{
  const result=await run(`try {await new Promise(r=>setTimeout(r,100).unref());console.log('tested');}finally{await new Promise(r=>setTimeout(r,100).unref());console.log('cleaned');}`);
  assert.equal(result.code,0);assert.equal(result.stdout,'tested\ncleaned\n');assert.equal(result.stderr,'');assert.ok(result.ms>=200);
});

test('failed suites retain native multiline rendering and native throw status',async()=>{
  const result=await run(`process.exitCode=7;throw Error('E_MULTILINE: first\\nsecond');`);
  assert.equal(result.code,1);assert.match(result.stderr,/node:internal\/modules\/run_main/);
  assert.match(result.stderr,/Error: E_MULTILINE: first\nsecond/);
  assert.equal((result.stderr.match(/Error: E_MULTILINE: first/g)??[]).length,1);
});

test('intercepting a completed failure cannot leave timers pinning the process',async()=>{
  const result=await run(`setTimeout(()=>{},12000);throw Error('E_CAUGHT: still failed');`,true);
  assert.equal(result.code,1);assert.match(result.stderr,/Error: E_CAUGHT: still failed/);
  assert.match(result.stderr,/lingering handles after suite: Timeout\(1\)/);
});

test('queued status changes cannot turn an intercepted failure into success',async()=>{
  const caught=await run(`process.nextTick(()=>{process.exitCode=0;});throw Error('E_STATUS: caught failure');`,true);
  assert.equal(caught.code,1);assert.match(caught.stderr,/E_STATUS: caught failure/);
  const global=await run(`process.on('uncaughtException',()=>{process.exitCode=0;});process.nextTick(()=>{process.exitCode=0;});throw Error('E_STATUS: globally intercepted');`);
  assert.equal(global.code,1);assert.match(global.stderr,/E_STATUS: globally intercepted/);
});
