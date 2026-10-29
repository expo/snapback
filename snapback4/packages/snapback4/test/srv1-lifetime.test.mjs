import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {deploy,cli,startServe} from '../dist/proof.js';
const root=resolve(import.meta.dirname,'../../..'), binary=join(root,'target/debug/snapback4');
const env={...process.env,SNAPBACK4_BIN:binary,SNAPBACK4_PROBE_HOLD:'1'};
const proof=pathToFileURL(join(root,'packages/snapback4/dist/proof.js')).href;
const wrapper=join(root,'packages/snapback4/bin/snapback4.js');
async function until(fn,ms=12000){const end=performance.now()+ms;while(performance.now()<end){const value=await fn();if(value)return value;await sleep(25);}throw Error('SRV1 deadline expired');}
async function project(t){const cwd=mkdtempSync(join(tmpdir(),'srv1-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),'use identity guests\nquery alive():\n  return true\n');await deploy('production','snapback',{cwd,env});return cwd;}
function launch(t,cwd,command,args,extra={}){const c=spawn(command,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe'],...extra});let out='',err='';c.stdout?.on('data',d=>out+=d);c.stderr?.on('data',d=>err+=d);c.on('error',()=>{});let closed=false;c.once('close',()=>closed=true);t.after(()=>{try{process.kill(-c.pid,'SIGKILL');}catch{}});return {c,out:()=>out,err:()=>err,closed:()=>closed};}
function npmScript(cwd,body,script='node serve.mjs'){writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',scripts:{'prod:serve':script,'probe:serve':script}}));writeFileSync(join(cwd,'serve.mjs'),body);}
// Readiness authorizes signalling only after the lifetime has armed its handlers.
const driver=`import{startServe,serveUntilSignal}from ${JSON.stringify(proof)};const h=await startServe('production');const lifetime=serveUntilSignal([h]);console.log(JSON.stringify({backendUrl:h.url,pid:h.pid,driver:process.pid}));await lifetime;`;
async function ready(run){return until(()=>{const line=run.out().split('\n').find(l=>l.startsWith('{"backendUrl"'));if(line)return JSON.parse(line);assert.equal(run.closed(),false,run.err());});}
async function released(cwd){const result=await cli(['serve','production','--wait-stopped'],{cwd,env});assert.equal(result.code,0,result.stderr);return result;}
async function restarted(cwd){await released(cwd);const h=await startServe('production',{cwd,env});await h.stop();const d=await cli(['deploy','production'],{cwd,env});assert.equal(d.code,0,d.stderr);assert.doesNotMatch(d.stderr,/E_STORE_BUSY/);}

for(const signal of ['SIGTERM','SIGKILL'])for(const direct of [false,true])test(`036/017/008: ${signal} to npm only releases ${direct?'native CLI':'serveUntilSignal driver'} store and pipes`,{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=await project(t);
 npmScript(cwd,direct?'':driver,direct?`node ${JSON.stringify(wrapper)} serve production --port 0`:'node serve.mjs');
 const run=launch(t,cwd,'npm',['run','--silent','prod:serve']);
 if(direct)await until(()=>/SNAPBACK4_READY/.test(run.err()));else await ready(run);
 const stoppedAt=performance.now();run.c.kill(signal);
 const eof=until(run.closed).then(()=>Math.round(performance.now()-stoppedAt));
 const replacement=await startServe('production',{cwd,env});await replacement.stop();
 const pipeEOFms=await eof;console.log(JSON.stringify({shape:'036/017/008',kind:direct?'native CLI':'serveUntilSignal',signal,pipeEOFms,firstCommand:"serve"}));await restarted(cwd);
});

test('024: request-making driver exits; serveUntilSignal child cannot keep | tail open',{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=await project(t);writeFileSync(join(cwd,'serve.mjs'),driver);
 writeFileSync(join(cwd,'driver.mjs'),`import{spawn}from'node:child_process';const c=spawn(process.execPath,['serve.mjs'],{stdio:['ignore','pipe','inherit']});let text='';c.stdout.on('data',async d=>{process.stdout.write(d);text+=d;if(text.includes('\\n')){const {backendUrl}=JSON.parse(text.trim());await fetch(backendUrl+'/auth/config');console.log('024 requests complete; driver exits');process.exit(0);}});`);
 const run=launch(t,cwd,'bash',['-o','pipefail','-c','node driver.mjs | tail -n 2']);
 await until(run.closed);console.log('024 transcript: node driver.mjs | tail -n 2 -> requests complete, EOF, exit 0; next serve/deploy succeeds');assert.match(run.out(),/024 requests complete/);assert.equal(run.c.exitCode,0,run.err());await restarted(cwd);
});

for(const signal of ['SIGTERM','SIGINT','SIGHUP'])test(`serveUntilSignal handles ${signal} and closes inherited pipes`,{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=await project(t);npmScript(cwd,driver);
 const run=launch(t,cwd,process.execPath,['serve.mjs']);await ready(run);run.c.kill(signal);await until(run.closed);assert.equal(run.c.exitCode,0,run.err());await restarted(cwd);
});

test('direct native serve observes launching parent death without wrapper environment',{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=await project(t);writeFileSync(join(cwd,'parent.mjs'),`import{spawn}from'node:child_process';spawn(${JSON.stringify(binary)},['serve','production','--port','0'],{stdio:'inherit'});setInterval(()=>{},1000);`);
 const clean={...env};delete clean.SNAPBACK4_SUPERVISOR_PID;
 const run=launch(t,cwd,process.execPath,['parent.mjs'],{env:clean});await until(()=>/SNAPBACK4_READY/.test(run.err()));run.c.kill('SIGKILL');await until(run.closed);await restarted(cwd);
});

test('harness: detached npm --hold child survives idle and group TERM releases hosts',{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=await project(t);npmScript(cwd,driver.replace("const h=",'const guard=(await import('+JSON.stringify(proof)+')).probeServeGuard();const h=').replace('const lifetime=serveUntilSignal([h]);','const now=Date.now;Date.now=()=>now()+61000;const lifetime=serveUntilSignal([h]);').replace('await lifetime;','await lifetime;guard.close();'));
 const run=launch(t,cwd,'bash',['-c','exec npm run --silent probe:serve']);const value=await ready(run);await sleep(1300);assert.equal(run.closed(),false,run.err());assert.equal((await fetch(value.backendUrl+'/auth/config')).status,200);process.kill(-run.c.pid,'SIGTERM');await until(run.closed);await restarted(cwd);
});

test('E_STORE_BUSY names holder; stop ignores forged PID hints and proves actual store release',{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=await project(t),h=await startServe('production',{cwd,env});try{
 const result=await cli(['serve','production','--port','0'],{cwd,env});assert.notEqual(result.code,0);assert.match(result.stderr,new RegExp(`pid ${h.pid}.*command snapback4 serve.*start time.*still alive: true`));assert.match(result.stderr,/snapback4 stop '.*production'/);
 const record=join(cwd,'production/serve.lock');let lines=readFileSync(record,'utf8').split('\n');lines[2]=`pid ${process.pid}`;writeFileSync(record,lines.join('\n'));
 const stop=await cli(['stop','production'],{cwd,env});assert.equal(stop.code,0,stop.stderr);assert.ok(process.pid);await released(cwd);
 }finally{await h.stop();}
});

test('SIGKILL holder stale record is reclaimed once, with a notice',{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=await project(t),run=launch(t,cwd,binary,['serve','production','--port','0']);await until(()=>/SNAPBACK4_READY/.test(run.err()));run.c.kill('SIGKILL');await until(run.closed);
 const again=await cli(['deploy','production'],{cwd,env});assert.equal(again.code,0,again.stderr);assert.match(again.stderr,/reclaimed stale serve.lock: dead PID/);
 const once=await cli(['deploy','production'],{cwd,env});assert.equal(once.code,0,once.stderr);assert.doesNotMatch(once.stderr,/reclaimed stale/);
});

// Linux-only kernel witness; the remaining process-shape tests run on Darwin.
test('Linux PDEATHSIG spawning-thread exit does not kill a live-parent host',{skip:process.platform!=='linux',timeout:30000},async t=>{
 const cwd=await project(t);
 writeFileSync(join(cwd,'thread.py'),`import threading,subprocess,time,os\nrelease=threading.Event()\ndef spawn():\n subprocess.Popen([${JSON.stringify(binary)},'serve','production','--port','0'])\n release.wait()\nt=threading.Thread(target=spawn);t.start()\nwhile not os.path.exists('release-thread'): time.sleep(.01)\nrelease.set();t.join()\nprint('spawning thread exited',flush=True)\nwhile True: time.sleep(1)\n`);
 const run=launch(t,cwd,'python3',['thread.py']);await until(()=>/SNAPBACK4_READY/.test(run.err()));writeFileSync(join(cwd,'release-thread'),'armed');await until(()=>/spawning thread exited/.test(run.out()));await sleep(500);assert.equal(run.closed(),false,run.err());run.c.kill('SIGKILL');await until(run.closed);await restarted(cwd);
});


test('password starter ships exec serve scripts and bounded prod:check against its real deployment',{skip:process.platform==='win32',timeout:120000},async t=>{
 const parent=mkdtempSync(join(tmpdir(),'srv1-starter-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const init=await cli(['init','app','--web','--password','--no-install'],{cwd:parent,env});assert.equal(init.code,0,init.stderr);
 const cwd=join(parent,'app'),pkg=JSON.parse(readFileSync(join(cwd,'package.json')));
 assert.equal(pkg.scripts['probe:serve'],'exec node scripts/probe-serve.mjs');assert.equal(pkg.scripts['prod:serve'],'exec node scripts/prod-serve.mjs');assert.ok(pkg.scripts['prod:check']);assert.match(init.stdout,/prod:check/);
 mkdirSync(join(cwd,'node_modules'));symlinkSync(join(root,'packages/snapback4'),join(cwd,'node_modules/snapback4'),'dir');mkdirSync(join(cwd,'dist'));writeFileSync(join(cwd,'dist/index.html'),'<h1>production</h1>');
 await deploy('production','snapback',{cwd,env});
 const assertion="node -e \"const r=JSON.parse(process.env.SNAPBACK4_SERVE_JSON); if (!Object.values(r.sessions).flat().length || new URL(r.frontendUrl).searchParams.get('api')!==r.backendUrl) throw Error('production readiness needs users and its actual backend')\"";
 const run=launch(t,cwd,'npm',['run','--silent','prod:check','--','--then',assertion]);await until(run.closed,90000);assert.equal(run.c.exitCode,0,run.err());const report=JSON.parse(run.out().trim());assert.equal(report.ok,true,JSON.stringify(report));assert.equal(report.lockReleased,true);await released(cwd);
 // Pause at the actual generated script's readiness announcement. The
 // controller may signal before console.log returns; cleanup must be armed.
 writeFileSync(join(cwd,'ready-gap.mjs'),`const log=console.log;console.log=(...args)=>{log(...args);if(typeof args[0]==='string'&&args[0].startsWith('{"backendUrl"'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);};`);
 const serving=launch(t,cwd,process.execPath,['--import','./ready-gap.mjs','scripts/prod-serve.mjs']);await ready(serving);serving.c.kill('SIGTERM');await until(serving.closed);assert.equal(serving.c.exitCode,0,serving.err());await restarted(cwd);
});


test('busy persistent dev has exact stop recovery without signalling a PID hint',{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=await project(t),run=launch(t,cwd,binary,['dev','--no-watch','--port','0']);await until(()=>/SNAPBACK4_READY/.test(run.err()));
 const stopped=await cli(['stop',join(cwd,'.snapback4')],{cwd,env});assert.equal(stopped.code,0,stopped.stderr);await until(run.closed);
 const again=launch(t,cwd,binary,['dev','--no-watch','--port','0']);await until(()=>/SNAPBACK4_READY/.test(again.err()));again.c.kill('SIGTERM');await until(again.closed);
});

test('Darwin design witness: C-locale ps captures npm argv and parent birth changes',async()=>{
 const source=`import cp from 'node:child_process';import assert from 'node:assert/strict';import{syncBuiltinESMExports}from'node:module';Object.defineProperty(process,'platform',{value:'darwin'});Object.defineProperty(process,'ppid',{value:12345});let dead=false;cp.execFileSync=(cmd,args,options)=>{assert.equal(options.env.LC_ALL,'C');const pid=Number(args[1]);if(dead&&pid===12346)throw Error('gone');if(pid===12345)return '12346 S Tue Oct 27 21:00:00 2026 /bin/sh';if(pid===12346)return '1 S Tue Oct 27 21:00:00 2026 node /usr/local/lib/node_modules/npm/bin/npm-cli.js run prod:serve';throw Error('unexpected ancestor');};syncBuiltinESMExports();const {watchParent}=await import(${JSON.stringify(pathToFileURL(join(root,'packages/snapback4/dist/parent-lifetime.js')).href)});let observed=false;const stop=watchParent(()=>observed=true);dead=true;await new Promise(r=>setTimeout(r,550));stop();assert.equal(observed,true);`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:'pipe'});let err='';child.stderr.on('data',d=>err+=d);assert.equal(await new Promise(r=>child.once('close',r)),0,err);
});


test('aliased database recovery names its actual deployment control directory',{skip:process.platform==='win32',timeout:60000},async t=>{
 const cwd=await project(t);mkdirSync(join(cwd,'external'),{mode:0o700});writeFileSync(join(cwd,'external/store.sqlite'),'',{mode:0o600});const deployed=await cli(['deploy','aliased','--store','external/store.sqlite'],{cwd,env});assert.equal(deployed.code,0,deployed.stderr);
 const host=await startServe('aliased',{cwd,env});try{
  const busy=await cli(['serve','aliased','--port','0'],{cwd,env});assert.notEqual(busy.code,0);assert.ok(busy.stderr.includes(`snapback4 stop '${cwd}/aliased'`),busy.stderr);
  const stopped=await cli(['stop','aliased'],{cwd,env});assert.equal(stopped.code,0,stopped.stderr);
 }finally{await host.stop();}
});

test('024: request driver awaits npm close through tail after terminating only the wrapper',{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=await project(t);npmScript(cwd,driver);
 writeFileSync(join(cwd,'await-driver.mjs'),`import{spawn}from'node:child_process';const c=spawn('npm',['run','--silent','prod:serve'],{stdio:['ignore','pipe','inherit']});let text='',begun=false;const closed=new Promise(r=>c.once('close',r));c.stdout.on('data',async d=>{text+=d;if(!begun&&text.includes('\\n')){begun=true;const {backendUrl}=JSON.parse(text.trim());await fetch(backendUrl+'/auth/config');console.log('024 request completed; SIGTERM npm wrapper');c.kill('SIGTERM');}});await closed;console.log('024 npm close observed; driver finished');`);
 const run=launch(t,cwd,'bash',['-o','pipefail','-c','node await-driver.mjs | tail -n 2']);await until(run.closed);assert.equal(run.c.exitCode,0,run.err());assert.match(run.out(),/024 request completed.*\n024 npm close observed/s);console.log(run.out().trim());await restarted(cwd);
});


for(const direct of [false,true])test(`036/017/008: deploy immediately after npm TERM (${direct?'native':'proof driver'}) waits for ownership`,{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=await project(t);npmScript(cwd,direct?'':driver,direct?`node ${JSON.stringify(wrapper)} serve production --port 0`:'node serve.mjs');
 const run=launch(t,cwd,'npm',['run','--silent','prod:serve']);if(direct)await until(()=>/SNAPBACK4_READY/.test(run.err()));else await ready(run);
 run.c.kill('SIGTERM');const deployed=await cli(['deploy','production'],{cwd,env});assert.equal(deployed.code,0,deployed.stderr);assert.doesNotMatch(deployed.stderr,/E_STORE_BUSY/);await until(run.closed);await restarted(cwd);
});

test('missing process table retains a living direct parent and detects reparenting',async()=>{
 const source=`import fs from 'node:fs';import assert from 'node:assert/strict';import{syncBuiltinESMExports}from'node:module';Object.defineProperty(process,'platform',{value:'linux'});let parent=12345;Object.defineProperty(process,'ppid',{get:()=>parent});fs.readFileSync=()=>{throw Object.assign(Error('no proc'),{code:'ENOENT'});};process.kill=()=>true;syncBuiltinESMExports();const {watchParent}=await import(${JSON.stringify(pathToFileURL(join(root,'packages/snapback4/dist/parent-lifetime.js')).href)});let lost=false;const stop=watchParent(()=>lost=true);await new Promise(r=>setTimeout(r,300));assert.equal(lost,false);parent=1;await new Promise(r=>setTimeout(r,300));stop();assert.equal(lost,true);`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:'pipe'});let err='';child.stderr.on('data',d=>err+=d);assert.equal(await new Promise(r=>child.once('close',r)),0,err);
});


test('an initially PID-1 npm/service parent is not presumed dead',async()=>{
 const source=`import assert from 'node:assert/strict';Object.defineProperty(process,'ppid',{value:1});process.env.npm_lifecycle_event='prod:serve';const {watchParent}=await import(${JSON.stringify(pathToFileURL(join(root,'packages/snapback4/dist/parent-lifetime.js')).href)});let lost=false;const stop=watchParent(()=>lost=true);await new Promise(r=>setTimeout(r,300));stop();assert.equal(lost,false);`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:'pipe'});let err='';child.stderr.on('data',d=>err+=d);assert.equal(await new Promise(r=>child.once('close',r)),0,err);
});
