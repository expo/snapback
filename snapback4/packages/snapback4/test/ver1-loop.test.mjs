import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../../..');
const scratch=t=>{const p=mkdtempSync(join(tmpdir(),'ver1-'));t.after(()=>rmSync(p,{recursive:true,force:true}));mkdirSync(join(p,'scripts'));mkdirSync(join(p,'bin'));return p;};
const copy=(cwd,name)=>writeFileSync(join(cwd,'scripts',name),readFileSync(join(root,'crates/snapback4/src/verbs/init',name)));
const run=(cwd,args,env)=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{cwd,env,stdio:'pipe'});let out='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>out+=b);c.once('error',reject);c.once('close',code=>resolve({code,out}));});
test('wave34 redundant verify calls: one ordered loop; each red stops later proofs; refusal precedes summary',{skip:process.platform==='win32'},async t=>{
 const cwd=scratch(t);copy(cwd,'verify.mjs');copy(cwd,'verify-parent.mjs');copy(cwd,'verify-cache.mjs');
 writeFileSync(join(cwd,'bin/npm'),`#!/bin/sh
echo "$3" >> phases
if [ "$3" = "$FAIL_PHASE" ]; then
 echo 'proof refusal: operation reserve; role owner; E_INPUT; field until'
 echo '# likely fix: supply until'
 echo 'AssertionError: original comparison'
 exit 17
fi
`,{mode:0o755});
 const steps=['check','acceptance','frontend:proof','probe:check'];
 for(const failed of [...steps,'']){
  writeFileSync(join(cwd,'phases'),'');
  const r=await run(cwd,['scripts/verify.mjs'],{...process.env,PATH:join(cwd,'bin')+':'+process.env.PATH,FAIL_PHASE:failed});
  assert.equal(r.code,failed?17:0,r.out);
  const expected=failed?steps.slice(0,steps.indexOf(failed)+1):steps;
  assert.deepEqual(readFileSync(join(cwd,'phases'),'utf8').trim().split('\n'),expected);
  assert.ok(r.out.trim().split('\n').length<=(failed?9:3),r.out);
  if(failed) {assert.ok(r.out.startsWith('proof refusal:'),r.out);assert.match(r.out,/# likely fix: supply until/);assert.match(readFileSync(join(cwd,'.snapback4/last/verify.txt'),'utf8'),/AssertionError/);}
  assert.equal(statSync(join(cwd,'.snapback4/last/verify.txt')).mode&0o777,0o600);
 }
});
test('Codex exec teardown: detached installer survives caller process-group SIGKILL ten times',{skip:process.platform==='win32',timeout:30000},async t=>{
 const cwd=scratch(t);copy(cwd,'install.mjs');
 writeFileSync(join(cwd,'bin/npm'),'#!/bin/sh\necho npm-progress\nsleep 0.2\nexit "${MOCK_NPM_EXIT:-0}"\n',{mode:0o755});
 // Wrapper owns a new group. After the command returns it kills only its own
 // group, exactly the tool boundary that broke the IPC-owned background path.
 writeFileSync(join(cwd,'wrapper.mjs'),`import{spawn}from'node:child_process';const c=spawn(process.execPath,['scripts/install.mjs','--background'],{stdio:'ignore'});c.once('exit',code=>{if(code)process.exit(code);process.kill(0,'SIGKILL');});`);
 for(let i=0;i<10;i++){
  const env={...process.env,PATH:join(cwd,'bin')+':'+process.env.PATH,MOCK_NPM_EXIT:String(i===9?17:0)};
  const child=spawn(process.execPath,['wrapper.mjs'],{cwd,env,detached:true,stdio:'ignore'});
  assert.deepEqual(await new Promise(r=>child.once('exit',(code,signal)=>r({code,signal}))),{code:null,signal:'SIGKILL'});
  const joined=await run(cwd,['scripts/install.mjs','--wait'],env);assert.equal(joined.code,i===9?17:0,joined.out);
  const state=JSON.parse(readFileSync(join(cwd,'.snapback4/install.json')));assert.equal(state.state,'finished');
  assert.match(execFileSync(process.execPath,['scripts/install.mjs','--status'],{cwd,encoding:'utf8'}),/finished/);
 }
});

test('delayed detached owner cannot expose a previous successful receipt',{skip:process.platform==='win32',timeout:15000},async t=>{
 const cwd=scratch(t);copy(cwd,'install.mjs');mkdirSync(join(cwd,'.snapback4'));
 writeFileSync(join(cwd,'.snapback4/install.json'),JSON.stringify({state:'finished',request:'old',started:Date.now(),code:0,pid:1}));
 writeFileSync(join(cwd,'.snapback4/install-request.json'),JSON.stringify({id:'old'}));
 writeFileSync(join(cwd,'bin/npm'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 writeFileSync(join(cwd,'slow.mjs'),`if(process.argv[1]?.endsWith('install.mjs')&&process.argv.length===2)await new Promise(r=>setTimeout(r,5500));`);
 const env={...process.env,PATH:join(cwd,'bin')+':'+process.env.PATH,NODE_OPTIONS:`--import ${join(cwd,'slow.mjs')}`};
 const launch=await run(cwd,['scripts/install.mjs','--background'],env);assert.equal(launch.code,1,launch.out);
 const status=await run(cwd,['scripts/install.mjs','--status'],env);assert.match(status.out,/requested run starting/);assert.doesNotMatch(status.out,/finished/);
 const joined=await run(cwd,['scripts/install.mjs','--wait'],env);assert.equal(joined.code,0,joined.out);
 assert.notEqual(JSON.parse(readFileSync(join(cwd,'.snapback4/install.json'))).request,'old');
});

test('verify SIGKILL and outer npm death stop the active phase and never start later proofs',{skip:process.platform==='win32',timeout:15000},async t=>{
 for(const mode of ['verify','npm']){
  const cwd=scratch(t);copy(cwd,'verify.mjs');copy(cwd,'verify-parent.mjs');copy(cwd,'verify-cache.mjs');
  writeFileSync(join(cwd,'package.json'),JSON.stringify({scripts:{verify:'node scripts/verify.mjs'}}));
  writeFileSync(join(cwd,'bin/npm'),`#!/bin/sh\necho "$3" >> phases\nwhile true; do echo tick >> activity; sleep 0.05; done\n`,{mode:0o755});
  const env={...process.env,PATH:join(cwd,'bin')+':'+process.env.PATH};
  // Real outer npm, fake phase npm. Outer launch retains its original PATH.
  const executable=mode==='verify'?process.execPath:execFileSync('which',['npm'],{encoding:'utf8'}).trim();
  const args=mode==='verify'?['scripts/verify.mjs']:['run','--silent','verify'];
  const child=spawn(executable,args,{cwd,env,stdio:'ignore'});const exited=new Promise(r=>child.once('exit',r));
  const until=Date.now()+5000;while(Date.now()<until){try{if(readFileSync(join(cwd,'activity'),'utf8').length)break;}catch{}await new Promise(r=>setTimeout(r,20));}
  assert.ok(readFileSync(join(cwd,'activity'),'utf8').length);child.kill('SIGKILL');await exited;
  await new Promise(r=>setTimeout(r,800));const stopped=readFileSync(join(cwd,'activity'),'utf8');await new Promise(r=>setTimeout(r,200));
  assert.equal(readFileSync(join(cwd,'activity'),'utf8'),stopped);assert.equal(readFileSync(join(cwd,'phases'),'utf8').trim(),'check');
 }
});

test('a waiting install join pins its request even when a later successful run supersedes the pointer',async t=>{
 const cwd=scratch(t);copy(cwd,'install.mjs');mkdirSync(join(cwd,'.snapback4'));mkdirSync(join(cwd,'.snapback4/install-runs'));
 const state=join(cwd,'.snapback4'),a={state:'running',request:'a',pid:process.pid,started:Date.now()};
 writeFileSync(join(state,'install.json'),JSON.stringify(a));writeFileSync(join(state,'install-runs/a.json'),JSON.stringify(a));writeFileSync(join(state,'install-request.json'),JSON.stringify({id:'a'}));
 const child=spawn(process.execPath,['scripts/install.mjs','--wait'],{cwd,stdio:'pipe'});let output='';child.stdout.on('data',b=>output+=b);const joined=new Promise(r=>child.once('exit',r));
 await new Promise(r=>setTimeout(r,200));
 writeFileSync(join(state,'install-request.json'),JSON.stringify({id:'b'}));writeFileSync(join(state,'install.json'),JSON.stringify({...a,state:'finished',request:'b',code:0}));writeFileSync(join(state,'install-runs/a.json'),JSON.stringify({...a,state:'finished',code:17}));
 assert.equal(await joined,17,output);assert.match(output,/exit 17/);
});

test('parent loss at a phase boundary is checked before the next npm starts',{skip:process.platform==='win32',timeout:7000},async t=>{
 const cwd=scratch(t);copy(cwd,'verify.mjs');copy(cwd,'verify-parent.mjs');copy(cwd,'verify-cache.mjs');
 writeFileSync(join(cwd,'bin/npm'),`#!/bin/sh\necho "$3" >> phases\nkill -9 "$VER1_OUTER"\nexit 0\n`,{mode:0o755});
 writeFileSync(join(cwd,'outer.mjs'),`import{spawn}from'node:child_process';spawn(process.execPath,['scripts/verify.mjs'],{env:{...process.env,VER1_OUTER:String(process.pid)},stdio:'ignore'});`);
 const child=spawn(process.execPath,['outer.mjs'],{cwd,env:{...process.env,PATH:join(cwd,'bin')+':'+process.env.PATH},stdio:'ignore'});await new Promise(r=>child.once('exit',r));
 await new Promise(r=>setTimeout(r,500));assert.equal(readFileSync(join(cwd,'phases'),'utf8').trim(),'check');
});

test('duplicate admission pins its alias before another launcher replaces the pointer',async t=>{
 const cwd=scratch(t);copy(cwd,'install.mjs');const dir=join(cwd,'.snapback4');mkdirSync(dir);mkdirSync(join(dir,'install-runs'));
 const a={state:'running',request:'a',pid:process.pid,started:Date.now()};
 writeFileSync(join(dir,'install.lock'),String(process.pid));writeFileSync(join(dir,'install.json'),JSON.stringify(a));writeFileSync(join(dir,'install-runs/a.json'),JSON.stringify(a));
 // Deterministically insert launcher C exactly after B's admission points to A,
 // before B's wait starts; real interprocess scheduling can make the same write.
 writeFileSync(join(cwd,'interleave.mjs'),`import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const write=fs.writeFileSync;fs.writeFileSync=(path,data,...args)=>{const value=write(path,data,...args);if(path==='.snapback4/install-request.json'&&JSON.parse(data).id==='a'){const a=JSON.parse(fs.readFileSync('.snapback4/install.json'));write(path,JSON.stringify({id:'c'}));write('.snapback4/install-runs/a.json',JSON.stringify({...a,state:'finished',code:17}));write('.snapback4/install.json',JSON.stringify({...a,request:'c',state:'finished',code:0}));}return value;};syncBuiltinESMExports();`);
 const result=await run(cwd,['scripts/install.mjs'],{...process.env,SNAPBACK4_INSTALL_REQUEST:'b',NODE_OPTIONS:`--import ${join(cwd,'interleave.mjs')}`});assert.equal(result.code,17,result.out);assert.match(result.out,/exit 17/);
});
