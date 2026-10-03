import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFile, fileStallTimeout, largestGuard } from '../../../scripts/run-client-tests.mjs';
import { identity, live, processTable } from '../../../scripts/test-processes.mjs';
import { createTokenInspector, TOKEN_KEY } from '../../../scripts/test-process-token.mjs';

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
  await new Promise(resolve => process.stdout.write('FIXTURE_READY: ${block}\\n', resolve));
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

test('stall bounds cover single guards with margin, including serial mode and seed overrides', () => {
  const derived = {
    'ordinary-search-oracle': [8592000,10740000], 'web-admission-review': [6832000,8540000],
    'mixed-evidence-oracle': [1800000,2250000], 'app-session-model': [10000000,12500000],
    'online-client-model': [6000000,7500000], 'horizon-boundary': [10120000,12650000],
    'column-stream-recovery': [2160000,2700000], 'timeline-delivery': [2160000,2700000],
    'acquisition': [1320000,1650000], 'sync-overflow': [2168000,2710000],
    'per-row-work': [2120000,2650000], 'per-row-react': [2120000,2650000],
    'social-browser': [726000,907500], 'retained-history': [372000,900000],
  };
  for (const [file, [guard, bound]] of Object.entries(derived)) {
    assert.equal(largestGuard(file+'.test.mjs', {}), guard, file);
    assert.equal(fileStallTimeout(file+'.test.mjs', {}), bound, file);
    assert.equal(fileStallTimeout(file+'.test.mjs', {SNAPBACK4_TEST_SERIAL_CLIENT_FILES:'1'}), bound, file);
  }
  for (const file of ['keep-app-model', 'worker-regressions'])
    assert.equal(fileStallTimeout(file+'.test.mjs', {}), 900000, file);
  assert.equal(fileStallTimeout('online-client-model.test.mjs', {SNAPBACK4_ONLINE_SEQUENCES:'6000'}), 15000000);
  assert.equal(fileStallTimeout('app-session-model.test.mjs', {SNAPBACK4_SESSION_SEQUENCES:'6000'}), 15000000);
  assert.equal(fileStallTimeout('mixed-evidence-oracle.test.mjs', {RL_SEEDS:'1000'}), 7500000);
  assert.equal(fileStallTimeout('ordinary-search-oracle.test.mjs', {SB4_SEARCH_SEEDS:Array(10).fill('75').join(',')}), 3875000);
  assert.equal(fileStallTimeout('ordinary.test.mjs'), 900000);
  for (const file of ['social-browser', 'retained-history', 'app-session-model'])
    assert.equal(fileStallTimeout(file + '.test.mjs', {SNAPBACK4_TEST_SERIAL_CLIENT_FILES:'1'}), fileStallTimeout(file + '.test.mjs', {}));
});

for (const shape of ['setsid', 'setpgid', 'setpgid with cleared token', 'detached Node helper']) test(`file custody reaps a ${shape} orphan after its parent exits`, {timeout:20000}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-token-escape-'));
  const binary = join(dir, 'native-sleep'), pidFile = join(dir, 'pid'), path = join(dir, 'escape.test.mjs');
  let orphan;
  t.after(() => {
    if (orphan && live(orphan)) process.kill(orphan.pid, 'SIGKILL');
    rmSync(dir, {recursive:true,force:true});
  });
  const compiled = spawnSync('cc', [fileURLToPath(new URL('./helpers/process-escape.c', import.meta.url)), '-o', binary], {encoding:'utf8',timeout:10000});
  assert.equal(compiled.status, 0, compiled.stderr);
  const helper = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');
const child=spawn(${JSON.stringify(binary)},['sleep'],{detached:true,stdio:'ignore'});
writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref();`;
  writeFileSync(path, `import test from 'node:test';import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
test('escape with inherited token',()=>{
${shape === 'detached Node helper' ? `execFileSync(process.execPath,['-e',${JSON.stringify(helper)}]);` : `execFileSync(${JSON.stringify(binary)},[${JSON.stringify(shape.startsWith('setpgid') ? 'setpgid' : shape)},${JSON.stringify(pidFile)}]${shape.includes('cleared') ? ',{env:{PATH:process.env.PATH}}' : ''});`}
const end=performance.now()+5000;while((!existsSync(${JSON.stringify(pidFile)})||!readFileSync(${JSON.stringify(pidFile)},'utf8').trim())&&performance.now()<end)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
});`);
  let output = '', keeper;
  const result = await runFile(path, {onStart: child => {keeper=child.pid},onOutput:text=>{output+=text},inspect:()=>{
    if (!orphan && existsSync(pidFile)) orphan=identity(Number(readFileSync(pidFile,'utf8')));
    return processTable();
  }});
  assert.ok(orphan?.alive, 'fixture was live before cleanup');
  assert.notEqual(orphan.group, keeper, 'fixture escaped the keeper group');
  assert.equal(result.passed, false, output);
  assert.equal(result.reason, 'TEST_FILE_LEAK', output);
  assert.match(output, /tokenOwned|sessionOwned/);
  assert.equal(live(orphan), false, output);
});

test('token sweep distinguishes files and never signals a different inherited token', async t => {
  const inspect = createTokenInspector();
  const wanted = 'a'.repeat(64), different = 'b'.repeat(64);
  const child = spawn(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], {env:{...process.env,[TOKEN_KEY]:different},stdio:['ignore','pipe','ignore'],detached:true});
  const record = identity(child.pid);
  t.after(async()=>{if(live(record))child.kill('SIGKILL');await new Promise(resolve=>child.exitCode!==null||child.signalCode!==null?resolve():child.once('exit',resolve));});
  await once(child.stdout,'data');
  assert.deepEqual(inspect(wanted), []);
  assert.ok(inspect(different).some(row=>row.pid===child.pid));
  assert.equal(live(record), true);
});

test('token inspection mechanism errors cannot establish a passing cleanup', async t => {
  const dir=mkdtempSync(join(tmpdir(),'sb4-token-failure-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'pass.test.mjs');writeFileSync(path,"import test from 'node:test';test('pass',()=>{});");
  let output='',inspections=0;
  const result=await runFile(path,{onOutput:text=>{output+=text},inspectToken:()=>{
    inspections++;throw Error('TEST_PROCESS_INSPECTION: injected environment enumeration failure');
  }});
  assert.equal(result.passed,false,output);
  assert.equal(result.reason,'TEST_PROCESS_INSPECTION',output);
  assert.ok(inspections>=1);
  assert.match(result.inspectionFailure,/injected environment enumeration failure/);
});

test('an unreadable candidate is diagnosed once without signaling or refusing a healthy file', async t => {
  const dir=mkdtempSync(join(tmpdir(),'sb4-unreadable-token-'));
  const path=join(dir,'pass.test.mjs');
  writeFileSync(path,"import test from 'node:test';test('healthy',()=>{});");
  let output='',child,record;
  const inspectToken=createTokenInspector({onOutput:text=>{output+=text},read:path=>{
    if(path===`/proc/${child.pid}/environ`)throw Object.assign(Error('injected denial'),{code:'EACCES'});
    return readFileSync(path);
  },run:(command,args,options)=>{
    const result=spawnSync(command,args,options);
    if(result.status===0)result.stdout=JSON.stringify(JSON.parse(result.stdout).map(row=>row.pid===child.pid
      ? {pid:row.pid,session:row.session,match:false,unreadable:'sysctl errno 13'} : row));
    return result;
  }});
  child=spawn(process.execPath,['-e','console.log("ready");setInterval(()=>{},1000)'],{detached:true,stdio:['ignore','pipe','ignore']});
  const exited=once(child,'exit');
  record=identity(child.pid);
  t.after(async()=>{if(live(record))child.kill('SIGKILL');await exited;rmSync(dir,{recursive:true,force:true});});
  await once(child.stdout,'data');
  const result=await runFile(path,{inspectToken,onOutput:text=>{output+=text}});
  assert.equal(result.passed,true,output);
  assert.equal(result.inspectionFailure,undefined,output);
  assert.equal(live(record),true,'unknown ownership never authorizes a signal');
  const diagnostics=output.split('\n').filter(line=>line.startsWith('TEST_PROCESS_UNREADABLE:')&&line.includes(`"pid":${child.pid},`));
  assert.equal(diagnostics.length,1,output);
  const metadata=JSON.parse(diagnostics[0].slice('TEST_PROCESS_UNREADABLE: '.length).split('; not provably ours')[0]);
  assert.match(metadata.executable,/node/);
  assert.equal(metadata.start,processTable().find(row=>row.pid===child.pid).start);
  t.diagnostic(diagnostics[0]);
});

for(const fault of ['exit','timeout','malformed','incomplete','invalid row','malformed kernel result']) test(`token reader mechanism ${fault} fails closed`, {skip:process.platform!=='darwin'}, () => {
  const inspect=createTokenInspector({run:()=>fault==='exit'?{status:1}
    :fault==='timeout'?{error:{code:'ETIMEDOUT'},status:null}
    :{status:0,stdout:fault==='malformed'?'broken':fault==='incomplete'?'[]'
      :JSON.stringify([fault==='invalid row'?{}:{pid:process.pid,match:false,error:'malformed KERN_PROCARGS2 result'}])},
    inspect:(()=>{let initial=true;return()=>{if(initial){initial=false;return [];}return processTable().filter(row=>row.pid===process.pid);};})()});
  assert.throws(()=>inspect('a'.repeat(64)),/TEST_PROCESS_INSPECTION/);
});

test('native environment inspection identifies readable tokens and diagnoses Darwin redaction', async t => {
  let output='';
  const inspect=createTokenInspector({onOutput:text=>{output+=text}}), token='c'.repeat(64);
  const child=spawn('/bin/sleep',['600'],{env:{...process.env,[TOKEN_KEY]:token},stdio:'ignore',detached:true});
  const exited=once(child,'exit');
  t.after(async()=>{child.kill('SIGKILL');await exited;});
  await once(child,'spawn');
  const owned=inspect(token);
  if(process.platform==='darwin') {
    assert.equal(owned.some(row=>row.pid===child.pid),false);
    assert.match(output,/TEST_PROCESS_UNREADABLE:.*sleep.*environment unavailable or empty/);
    assert.ok(output.includes(`"pid":${child.pid},`));
    assert.equal(live(identity(child.pid)),true);
    t.diagnostic(output.trim());
  } else {
    assert.ok(owned.some(row=>row.pid===child.pid), 'readable token must identify the native process');
    t.diagnostic('native environment token is visible');
  }
});

test('a redacted native detached orphan is diagnosed and reaped by its fixture', async t => {
  const dir=mkdtempSync(join(tmpdir(),'sb4-native-token-'));
  const path=join(dir,'native.test.mjs'),pidFile=join(dir,'pid');
  let orphan,output='';
  t.after(()=>{if(orphan&&live(orphan))process.kill(orphan.pid,'SIGKILL');rmSync(dir,{recursive:true,force:true});});
  const helper=`const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');
const child=spawn('/bin/sleep',['600'],{detached:true,stdio:'ignore'});
child.once('spawn',()=>{writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref()});`;
  writeFileSync(path,`import test from 'node:test';import {execFileSync} from 'node:child_process';test('native orphan',()=>execFileSync(process.execPath,['-e',${JSON.stringify(helper)}]));`);
  const result=await runFile(path,{onOutput:text=>{output+=text},inspect:()=>{
    if(!orphan&&existsSync(pidFile))orphan=identity(Number(readFileSync(pidFile,'utf8')));
    return processTable();
  }});
  assert.ok(orphan?.alive);
  if(process.platform==='darwin') {
    assert.equal(result.passed,true,output);
    assert.equal(result.inspectionFailure,undefined,output);
    assert.equal(live(orphan),true,'runner must not signal an opaque orphan');
    const diagnostics=output.split('\n').filter(line=>line.startsWith('TEST_PROCESS_UNREADABLE:')&&line.includes(`"pid":${orphan.pid},`));
    assert.equal(diagnostics.length,1,output);
    assert.match(diagnostics[0],/sleep.*"start":".+".*environment unavailable or empty/);
    t.diagnostic(diagnostics[0]);
    process.kill(orphan.pid,'SIGKILL');
    const deadline=performance.now()+5000;
    while(live(orphan)&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(live(orphan),false,'fixture reaps its own recorded orphan');
  } else {
    assert.equal(result.passed,false,output);
    assert.equal(result.reason,'TEST_FILE_LEAK',output);
    assert.equal(live(orphan),false,output);
  }
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

// Keep this interleaving deterministic: the real ps snapshot contains a shell
// parent; only after the snapshot is taken may it fork, publish the child PID
// and exit. That child never appears in the stale snapshot returned to runFile.
test('group cleanup reaps an unsampled orphan after its sampled parent exits', { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-fork-snapshot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'fork.test.mjs'), go = join(dir, 'go'), ready = join(dir, 'ready'), pidFile = join(dir, 'pid');
  writeFileSync(path, `import test from 'node:test';
import {spawnSync} from 'node:child_process';
test('owned helper', () => {
  spawnSync('/bin/sh', ['-c', '(echo ready > "${ready}"; while [ ! -f "${go}" ]; do sleep 0.01; done; sleep 600 </dev/null >/dev/null 2>&1 & echo $! > "${pidFile}") </dev/null >/dev/null 2>&1 & while [ ! -f "${ready}" ]; do sleep 0.01; done'], {timeout:5000});
});`);
  let inspections = 0, output = '', orphan;
  const { existsSync } = await import('node:fs');
  const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  const result = await runFile(path, { onOutput: text => { output += text; }, inspect: () => {
    const snapshot = processTable();
    if (++inspections === 1) {
      assert.ok(existsSync(ready));
      writeFileSync(go, 'go');
      const deadline = performance.now() + 5000;
      while ((!existsSync(pidFile) || !readFileSync(pidFile, 'utf8').trim()) && performance.now() < deadline) pause();
      orphan = identity(Number(readFileSync(pidFile, 'utf8')));
      assert.ok(orphan?.alive);
      assert.equal(snapshot.some(row => row.pid === orphan.pid), false);
      // Ensure the intermediate parent really exited before returning ps data.
      while (snapshot.some(row => row.group === orphan.group && row.pid !== orphan.group && identity(row.pid)?.alive) && performance.now() < deadline) pause();
      assert.equal(snapshot.some(row => row.group === orphan.group && row.pid !== orphan.group && identity(row.pid)?.alive), false);
    }
    return snapshot;
  } });
  assert.equal(result.passed, true, output);
  assert.equal(result.reason, undefined, output);
  assert.ok(inspections >= 3, 'two fresh empty snapshots after the stale snapshot');
  assert.equal(live(orphan), false, output);
  assert.equal(processTable().some(row => row.group === orphan.group && row.alive), false);
});

test('sequential and nested subtests keep progressing beyond the file stall interval', { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-progress-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'progress.test.mjs');
  writeFileSync(path, `import test from 'node:test';
import {setTimeout as sleep} from 'node:timers/promises';
for(let i=0;i<3;i++) test('sequential '+i, {timeout:1200}, async()=>{await sleep(800)});
test('parent', {timeout:5000}, async t=>{for(let i=0;i<4;i++) await t.test('nested '+i, {timeout:1200}, async()=>{await sleep(800)})});`);
  let output = '';
  const result = await runFile(path, { timeout: 2000, onOutput: text => { output += text; } });
  assert.equal(result.passed, true, output);
  assert.ok(result.elapsed > 2 * result.stallMs);
  assert.equal(result.counts.pass, 8);
  assert.ok(result.progressCount >= 16);
});

test('console chatter cannot keep a stalled file alive; diagnostics include progress and cleanup', { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-no-progress-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'chatter.test.mjs');
  writeFileSync(path, `import test from 'node:test';test('stuck with output', async()=>{setInterval(()=>console.log('# Subtest: fake progress'),20);await new Promise(()=>{})});`);
  let output = '', group;
  const result = await runFile(path, { timeout: 1500, onStart: child => {group=child.pid}, onOutput: text => { output += text; } });
  assert.equal(result.passed, false, output);
  assert.equal(result.reason, 'TEST_FILE_HANG');
  assert.ok(result.elapsed >= 1500 && result.elapsed < 8000, output);
  assert.match(output, /without progress; last progress test:dequeue: stuck with output/);
  assert.match(output, /owned processes:/);
  assert.equal(processTable().some(row => row.group === group && row.alive), false);
});

test('stale exited members do not reset empty snapshots; observed live leaks remain failures', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-stable-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'leak.test.mjs');
  writeFileSync(path, `import test from 'node:test';import {execFileSync} from 'node:child_process';test('helper',()=>{execFileSync('/bin/sh',['-c','sleep 600 </dev/null >/dev/null 2>&1 &'])});`);
  let inspections = 0, before, output = '';
  const result = await runFile(path, {onOutput: text => {output+=text}, inspect: () => {
    const current = processTable();
    inspections++;
    if (inspections === 1) before = current;
    // runFile discovers, stop diagnoses, then cleanup verifies. A stale row
    // whose process has exited cannot revive a leak or reset the empty count.
    if (inspections === 4) return before;
    return current;
  }});
  assert.equal(result.passed, false, output);
  assert.equal(result.reason, 'TEST_FILE_LEAK', output);
  assert.equal(inspections, 4, 'gone members do not invalidate the second empty inspection');
});


test('synchronous subtests renew progress before the reporter can format buffered output', { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-sync-progress-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'sync.test.mjs');
  writeFileSync(path, `import test from 'node:test';
for(let i=0;i<10;i++)test('synchronous '+i,{timeout:500},()=>{
  const end=performance.now()+300;while(performance.now()<end){}
});`);
  let output = '';
  const result = await runFile(path, {timeout:1000,onOutput:text=>{output+=text}});
  assert.equal(result.passed, true, output);
  assert.equal(result.counts.pass, 10);
  assert.ok(result.elapsed > 3 * result.stallMs);
  assert.equal(result.progressCount, 20, 'start and completion for every synchronous body');
});

test('name and skip filters preserve the selected assertion-bearing cases', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-progress-filter-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'filter.test.mjs');
  writeFileSync(path, `import test from 'node:test';
test('wanted',()=>{});test('unwanted',()=>{throw Error('name filter lost')});
test('wanted skip',()=>{throw Error('skip filter lost')});`);
  let output = '';
  const result = await runFile(path, {nodeArgs:['--test-name-pattern=^wanted','--test-skip-pattern=skip'],onOutput:text=>{output+=text}});
  assert.equal(result.passed, true, output);
  assert.equal(result.counts.pass, 1);
  assert.equal(result.counts.tests, 1);
  assert.equal(result.progressCount, 2);
});

// Round 4: enumeration and each per-process read are separate snapshots.
test('a process exiting after enumeration is absent at identity inspection', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume();console.log("ready")'], {stdio:['pipe','pipe','ignore']});
  const exited = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    const row = processTable().find(row => row.pid === child.pid);
    assert.ok(row?.alive);
    child.stdin.end(); await exited;
    assert.equal(identity(row.pid), undefined);
    // Exercise the same vanished PID against partial kernel/ps snapshots.
    for (const raw of [Buffer.alloc(0), Buffer.from(`${row.pid} (truncated`), Buffer.from('unparsable\xff', 'latin1')]) {
      assert.equal(identity(row.pid, {platform:'linux',read:()=>raw}), undefined);
    }
    for (const code of ['ENOENT', 'ESRCH', 'EIO']) {
      assert.equal(identity(row.pid, {platform:'linux',read:()=>{throw Object.assign(Error(code),{code});}}), undefined);
    }
    assert.deepEqual(processTable({run:()=>({status:0,stdout:`${row.pid} truncated\n`})}), []);
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); await exited; }
});

test('stat comm may contain closing and opening parentheses and spaces', () => {
  const fields = ['S', ...Array(49).fill('0')];
  fields[1]='12'; fields[2]='34'; fields[3]='56'; fields[19]='789';
  const raw = Buffer.from(`123 (name ) ( with spaces) ${fields.join(' ')}\n`);
  assert.deepEqual(identity(123,{platform:'linux',read:()=>raw,exists:()=>{throw Error('valid stat needs no retry');}}),
    {pid:123,parent:12,group:34,session:56,start:'789',alive:true});
});

test('ps preserves command spaces and parentheses and validates start and parent metadata', () => {
  const line = `${process.pid} 1 2 ${process.getuid()} Sat Oct  3 01:02:03 2026 S /tmp/a name ) ( helper`;
  const run = () => ({status:0,stdout:line+'\n'});
  assert.equal(processTable({run})[0].executable,'/tmp/a name ) ( helper');
  for (const malformed of [line.replace('Sat Oct','bad day'), line.replace(`${process.pid} 1 2`,`${process.pid} bad 2`)]) {
    assert.throws(()=>processTable({run:()=>({status:0,stdout:malformed})}),/malformed ps row/);
    assert.deepEqual(processTable({run:()=>({status:0,stdout:malformed}),exists:()=>false}),[]);
  }
});

for (const source of ['stat','ps']) test(`present PID with malformed ${source} refuses the file and retains the first error and exact bytes`, async t => {
  const dir=mkdtempSync(join(tmpdir(),'sb4-malformed-metadata-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'healthy.test.mjs');
  writeFileSync(path,"import test from 'node:test';test('healthy',()=>{});");
  const raw=Buffer.concat([Buffer.from(`${process.pid} (bad ) ( metadata) `),Buffer.from([0xff,0,13])]);
  let output='',attempts=0;
  const result=await runFile(path,{onOutput:text=>{output+=text},inspect:()=>{
    if (++attempts>1) throw Error('TEST_PROCESS_INSPECTION: secondary cleanup error');
    if(source==='stat')identity(process.pid,{platform:'linux',read:()=>raw});
    else processTable({run:()=>({status:0,stdout:raw})});
    throw Error('malformed metadata unexpectedly accepted');
  }});
  assert.equal(result.passed,false,output);
  assert.equal(result.reason,'TEST_PROCESS_INSPECTION',output);
  assert.match(result.inspectionFailure,source==='stat'?/malformed \/proc\//:/malformed ps row/);
  assert.ok(result.inspectionFailure.includes(`"rawBase64":"${raw.toString('base64')}"`));
  assert.ok(!result.inspectionFailure.includes('secondary cleanup error'));
  assert.match(output,/secondary cleanup error/);
  const diagnostic=JSON.parse(result.inspectionFailure.split('TEST_PROCESS_INSPECTION: ')[1].split('\n')[0]);
  assert.deepEqual(Buffer.from(diagnostic.rawBase64,'base64'),raw);
});

test('present PID with empty, truncated or missing stat still refuses', () => {
  for (const raw of [Buffer.alloc(0),Buffer.from(`${process.pid} (partial) S 1 2`)]) {
    assert.throws(()=>identity(process.pid,{platform:'linux',read:()=>raw}), error =>
      error.message.includes('malformed /proc/') && error.message.includes(`"rawBase64":"${raw.toString('base64')}"`));
  }
  for(const code of ['ENOENT','ESRCH']) assert.throws(()=>identity(process.pid,{platform:'linux',read:()=>{throw Object.assign(Error(`first ${code}`),{code});}}),new RegExp(`first ${code}`));
});

for (const fault of ['ENOENT','ESRCH','EIO','malformed','unreadable']) test(`per-process environment ${fault}: gone is exited; present stays classified`, () => {
  const row={pid:process.pid,parent:0,uid:process.getuid(),group:process.pid,session:process.pid,start:'test-start',alive:true,executable:'test'};
  for(const present of [false,true]) {
    let first=true,output='';
    const inspector=createTokenInspector({inspect:()=>{if(first){first=false;return [];}return [row];},identify:()=>row,exists:()=>present,
      onOutput:text=>{output+=text},read:()=>{throw Object.assign(Error('ENVIRONMENT_CONTENT_MUST_NOT_LEAK'),{code:fault==='unreadable'?'EACCES':fault});},
      run:()=>({status:0,stdout:JSON.stringify([{pid:row.pid,match:false,...(fault==='ESRCH'||fault==='ENOENT'?{gone:true}:fault==='unreadable'?{session:row.session,unreadable:'sysctl errno 13'}:{error:fault==='malformed'?'malformed KERN_PROCARGS2 result':'sysctl errno 5'})}])})});
    if(present&&fault!=='unreadable')assert.throws(()=>inspector('a'.repeat(64)),/TEST_PROCESS_INSPECTION/);
    else assert.deepEqual(inspector('a'.repeat(64)),[]);
    assert.equal(output.includes('TEST_PROCESS_UNREADABLE'),present&&fault==='unreadable');
    assert.ok(!output.includes('ENVIRONMENT_CONTENT_MUST_NOT_LEAK'));
  }
});

test('a completed file passes when its enumerated group member has exited', async t => {
  const dir=mkdtempSync(join(tmpdir(),'sb4-gone-group-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'healthy.test.mjs'),snapshot=join(dir,'snapshot.json');
  const module=new URL('../../../scripts/test-processes.mjs',import.meta.url).href;
  writeFileSync(path,`import test from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';import {writeFileSync} from 'node:fs';import {processTable} from ${JSON.stringify(module)};
test('transient child',async()=>{
  const child=spawn(process.execPath,['-e','process.stdin.resume();console.log("ready")'],{stdio:['pipe','pipe','ignore']});
  const exited=once(child,'exit');await once(child.stdout,'data');
  writeFileSync(${JSON.stringify(snapshot)},JSON.stringify(processTable().find(row=>row.pid===child.pid)));
  child.stdin.end();await exited;
});`);
  let output='',inspections=0;
  const result=await runFile(path,{onOutput:text=>{output+=text},inspect:()=>{
    const rows=processTable();
    if(++inspections===1) {
      const stale=JSON.parse(readFileSync(snapshot,'utf8'));
      assert.equal(identity(stale.pid),undefined);
      rows.push(stale);
    }
    return rows;
  }});
  assert.equal(result.passed,true,output);
  assert.equal(result.inspectionFailure,undefined,output);
  assert.ok(inspections>=3,'cleanup still requires two fresh empty inspections');
});
