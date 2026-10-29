import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
import {getEncoding} from 'js-tiktoken';
import {probeServeGuard} from '../dist/proof-probe.js';
import {readResponse} from '../dist/http-response.js';
const root=resolve(import.meta.dirname,'../../..'), encoding=getEncoding('o200k_base');
const scratch=t=>{const p=mkdtempSync(join(tmpdir(),'tok1-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;};
test('wave32 Codex 001/025 + Muse 019/028: first schema and exact signatures fit reading budgets',()=>{
 const start=readFileSync(join(root,'crates/snapback4-lang/src/guide/start.md'),'utf8');
 assert.ok(encoding.encode(start).length<=8000);
 for(const module of ['proof','client','auth']){
  const card=readFileSync(join(root,`crates/snapback4-lang/src/guide/api_${module}.md`),'utf8');
  assert.ok(encoding.encode(card).length<=3000,module);
  assert.match(card,/Declaration fingerprint:/);
 }
 execFileSync(process.execPath,['scripts/guide-api.mjs','--check'],{cwd:join(root,'packages/snapback4')});
});
test('wave32 Muse 005/008/017/018/019/024/027/028/029/033/036/037: killed empty >=10s run refuses before deployment; --hold bypasses',t=>{
 const directory=scratch(t);mkdirSync(join(directory,'.snapback4'));
 const started=Date.now()-100000;
 writeFileSync(join(directory,'.snapback4/probe-run.json'),JSON.stringify({pid:2147483647,started,lastSeen:started+10000,requests:0,ready:true}));
 assert.throws(()=>probeServeGuard({directory}),/E_PROBE_IDLE.*probe:check/);
 const guard=probeServeGuard({directory,hold:true});guard.ready();assert.equal(guard.idle(),false);guard.close();
});
test('wave32 Muse foreground wait: first ready empty run ends after 10s; observed request/hold preserve service',t=>{
 const directory=scratch(t);t.mock.timers.enable({apis:['Date','setInterval']});
 const guard=probeServeGuard({directory});guard.ready();
 assert.equal(guard.idle(),false);t.mock.timers.tick(10000);assert.equal(guard.idle(),true);guard.close();
 const activity=probeServeGuard({directory,hold:true});activity.ready();t.mock.timers.tick(61000);assert.equal(activity.idle(),false);activity.close();
});
test('wave32 Muse 019/028/036/029: placement refusal carries a same-image two-column copy recipe and preserves fields',async()=>{
 const why={code:'E_ASSET_PLACED',family:'asset',message:'one home',retryable:false,detail:'own home only'};
 const result=await readResponse(new Response(JSON.stringify({state:'failed',why}),{status:200}));
 assert.equal(result.why.code,why.code);assert.equal(result.why.retryable,false);assert.equal(result.why.detail,why.detail);
 assert.match(result.why.message,/client.upload\(bytes\).*EACH image column.*same record/);
 assert.match(result.why.message,/result.ok.*result.asset.id/);
});
test('wave32 Codex install polls: --status returns before npm completes; --wait preserves failure and success',async t=>{
 const directory=scratch(t),bin=join(directory,'bin');mkdirSync(bin);mkdirSync(join(directory,'scripts'));
 writeFileSync(join(directory,'scripts/install.mjs'),readFileSync(join(root,'crates/snapback4/src/verbs/init/install.mjs')));
 writeFileSync(join(bin,'npm'),'#!/bin/sh\necho npm-progress\nsleep 1\nexit "${MOCK_NPM_EXIT:-0}"\n',{mode:0o755});
 for(const code of [17,0]){
  const env={...process.env,PATH:`${bin}:${process.env.PATH}`,MOCK_NPM_EXIT:String(code)};
  const child=spawn(process.execPath,['scripts/install.mjs','--background'],{cwd:directory,env,stdio:'pipe'});
  const exited=new Promise(r=>child.once('exit',r));
  while(!(()=>{try{return JSON.parse(readFileSync(join(directory,'.snapback4/install.json'))).state==='running';}catch{return false;}})())await new Promise(r=>setTimeout(r,20));
  const status=execFileSync(process.execPath,['scripts/install.mjs','--status'],{cwd:directory,encoding:'utf8'});assert.match(status,/running/);
  const waiter=spawn(process.execPath,['scripts/install.mjs','--wait'],{cwd:directory,env,stdio:'pipe'});
  let output=''; waiter.stdout.on('data',b=>output+=b);
  assert.equal(await new Promise(r=>waiter.once('exit',r)),code);assert.equal(await exited,0);
  assert.equal(output.trim().split('\n').length,1,'wave34 install polling: a blocking join prints only completion');
  assert.match(output,/finished/);
  assert.match(readFileSync(join(directory,'.snapback4/install.log'),'utf8'),/npm-progress/);
 }
});
test('wave32 Muse 028/019/036/029: same selected bytes need two placements even in one row; separate uploads work',async t=>{
 const {startDev,cli}=await import('../dist/proof.js'); const {createClient}=await import('../dist/client.js');
 const cwd=scratch(t);mkdirSync(join(cwd,'snapback'));
 const schema=`use personas alice, bob\ntable photos:\n  owner: principal\n  front: image <=10000\n  back: image <=10000\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation place(front: image <=10000, back: image <=10000):\n  return insert photos {owner: viewer, front, back}\n`;
 writeFileSync(join(cwd,'snapback/schema.q'),schema);
 const env={SNAPBACK4_BIN:join(root,'target/debug/snapback4')};assert.equal((await cli(['check'],{cwd,env})).code,0);
 const host=await startDev({cwd,env,args:['--memory','--no-watch']});
 const alice=createClient({url:host.url,persona:'alice'}),bob=createClient({url:host.url,persona:'bob'});
 try{
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const a=await alice.upload(bytes),b=await alice.upload(bytes);assert.equal(a.ok,true,JSON.stringify(a));assert.equal(b.ok,true,JSON.stringify(b));assert.notEqual(a.asset.id,b.asset.id);
  const op={name:'place',kind:'mutation'};
  const shared=await alice.mutate(op,{front:{id:a.asset.id},back:{id:a.asset.id}});assert.equal(shared.state,'failed');assert.equal(shared.why.code,'E_ASSET_PLACED');assert.match(shared.why.message,/EACH image column/);
  const placed=await alice.mutate(op,{front:{id:a.asset.id},back:{id:b.asset.id}});assert.equal(placed.state,'sent',JSON.stringify(placed));
  const stolen=await bob.mutate(op,{front:{id:a.asset.id},back:{id:b.asset.id}});assert.equal(stolen.state,'failed');
 }finally{await alice.close();await bob.close();await host.stop();}
});
test('wave32 foreground guard counts actual post-ready HTTP requests, excluding host readiness',async t=>{
 const {startDev}=await import('../dist/proof.js');
 const cwd=scratch(t);mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),'use personas alice\nquery alive():\n  return true\n');
 const guard=probeServeGuard({directory:cwd});
 const host=await startDev({cwd,env:{...process.env,SNAPBACK4_BIN:join(root,'target/debug/snapback4')},args:['--memory','--no-watch']});
 try{
  guard.ready();t.mock.timers.enable({apis:['Date'],now:Date.now()});t.mock.timers.tick(10000);assert.equal(guard.idle(),true,'readiness requests do not count');
  const result=await fetch(`${host.url}/q/alive`,{method:'POST',headers:{'content-type':'application/json','x-snapback-persona':'alice'},body:'{}'});assert.equal(result.status,200);
  assert.equal(guard.idle(),false,'a real post-ready request preserves indefinite service');
 }finally{await host.stop();guard.close();}
});
test('wave32 install custody: SIGKILL of owner stops its private npm worker; a delayed request cannot join an earlier success',{skip:process.platform==='win32'},async t=>{
 const directory=scratch(t),bin=join(directory,'bin');mkdirSync(bin);mkdirSync(join(directory,'scripts'));
 const source=join(directory,'scripts/install.mjs');writeFileSync(source,readFileSync(join(root,'crates/snapback4/src/verbs/init/install.mjs')));
 writeFileSync(join(bin,'npm'),'#!/bin/sh\nwhile true; do echo tick >> activity; sleep 0.1; done\n',{mode:0o755});
 const env={...process.env,PATH:`${bin}:${process.env.PATH}`},child=spawn(process.execPath,[source],{cwd:directory,env,stdio:'ignore'});
 const exited=new Promise(r=>child.once('exit',r));
 while(!(()=>{try{return readFileSync(join(directory,'activity'),'utf8').length>0;}catch{return false;}})())await new Promise(r=>setTimeout(r,20));
 child.kill('SIGKILL');await exited;await new Promise(r=>setTimeout(r,300));
 const stopped=readFileSync(join(directory,'activity'),'utf8');await new Promise(r=>setTimeout(r,400));assert.equal(readFileSync(join(directory,'activity'),'utf8'),stopped,'npm made no progress after IPC EOF');
 const state=join(directory,'.snapback4');
 writeFileSync(join(state,'install.json'),JSON.stringify({state:'finished',code:0,pid:1,started:Date.now(),request:'old'}));
 writeFileSync(join(state,'install-request.json'),JSON.stringify({id:'new'}));
 const waiter=spawn(process.execPath,[source,'--wait'],{cwd:directory,env,stdio:'ignore'});let completed=false;const joined=new Promise(r=>waiter.once('exit',c=>{completed=true;r(c);}));
 await new Promise(r=>setTimeout(r,1200));assert.equal(completed,false,'old successful receipt was ignored');
 writeFileSync(join(state,'install.json'),JSON.stringify({state:'finished',code:17,pid:1,started:Date.now(),request:'new'}));assert.equal(await joined,17);
});
test('check-owned probes opt into hold, so an explicit uptime proof can exceed the foreground idle grace',async t=>{
 const {deploy,serveCheck}=await import('../dist/proof.js'),{pathToFileURL}=await import('node:url');
 const cwd=scratch(t);mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),'query alive():\n  return true\n');
 const env={SNAPBACK4_BIN:join(root,'target/debug/snapback4')};await deploy('release','snapback',{cwd,env});
 writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',scripts:{'probe:serve':'node serve.mjs'}}));
 const module=pathToFileURL(join(root,'packages/snapback4/dist/proof.js')).href;
 writeFileSync(join(cwd,'serve.mjs'),`import{probeServeGuard,startServe,serveUntilSignal}from ${JSON.stringify(module)};const guard=probeServeGuard();const host=await startServe('release');guard.ready();const real=Date.now;Date.now=()=>real()+61000;if(guard.idle())throw Error('checker failed to opt into hold');console.log(JSON.stringify({backendUrl:host.url}));try{await serveUntilSignal([host]);}finally{Date.now=real;guard.close();await host.stop();}`);
 const report=await serveCheck({cwd,env,script:'probe:serve',deployment:'release',upMs:500});assert.equal(report.ok,true,JSON.stringify(report));
});

test('VER1: slow failed startup and an intentional held check never poison the next unheld probe',t=>{
 const directory=scratch(t);t.mock.timers.enable({apis:['Date','setInterval']});
 for(const hold of [false,true]){
  const guard=probeServeGuard({directory,hold});if(hold)guard.ready();
  t.mock.timers.tick(30000);guard.close();
  const path=join(directory,'.snapback4/probe-run.json'),previous=JSON.parse(readFileSync(path));
  writeFileSync(path,JSON.stringify({...previous,pid:2147483647}));
  const next=probeServeGuard({directory});next.close();
 }
});

test('VER1: legacy receipts keep their former sixty-second threshold',t=>{
 const directory=scratch(t);mkdirSync(join(directory,'.snapback4'));const path=join(directory,'.snapback4/probe-run.json'),started=Date.now()-100000;
 writeFileSync(path,JSON.stringify({pid:2147483647,started,lastSeen:started+15000,requests:0}));probeServeGuard({directory}).close();
 writeFileSync(path,JSON.stringify({pid:2147483647,started,lastSeen:started+61000,requests:0}));assert.throws(()=>probeServeGuard({directory}),/E_PROBE_IDLE/);
});
