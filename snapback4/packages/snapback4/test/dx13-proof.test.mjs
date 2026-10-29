import '../../../scripts/test-npm-cache.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deploy,startServe,startDev,serveCheck,devAccounts,command} from '../dist/proof.js';
const root=resolve(import.meta.dirname,'../../..'),env={SNAPBACK4_BIN:join(root,'target/debug/snapback4')};
const schema=readFileSync(join(root,'crates/snapback4-lang/src/guide/staging.md'),'utf8').match(/```quarry\n([\s\S]*?)```/)[1];
function scratch(t){const cwd=mkdtempSync(join(tmpdir(),'dx13-proof-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));return cwd;}
async function project(t){const cwd=scratch(t);mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),schema);await deploy('production','snapback',{cwd,env});return cwd;}
function script(cwd,body){writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',scripts:{'probe:serve':'node serve.mjs'}}));writeFileSync(join(cwd,'serve.mjs'),body);}
const idle='console.log(JSON.stringify({password:"DX13-PRIVATE-SENTINEL"}));setInterval(()=>{},1000);';
const opts=cwd=>({cwd,env,deployment:'production',script:'probe:serve',upMs:1,timeoutMs:5000,stopTimeoutMs:1000});
test('missing store is a path error, never a lock claim; secrets stay private',{skip:process.platform==='win32'},async t=>{
 const cwd=await project(t);script(cwd,idle);
 const report=await serveCheck({...opts(cwd),deployment:'wrong'}),text=JSON.stringify(report);
 assert.ok(report.failures.some(f=>f.code==='E_SERVE_STORE_MISSING'&&f.message.includes(join(cwd,'wrong/store.sqlite'))),text);
 assert.ok(!text.includes('E_SERVE_LOCK_HELD')&&!text.includes('DX13-PRIVATE-SENTINEL'),text);
});
test('actual holder and exact store are named for a genuinely held barrier',{skip:process.platform==='win32'},async t=>{
 const cwd=await project(t),host=await startServe('production',{cwd,env});
 const path=join(cwd,'production/serve.lock'),lines=readFileSync(path,'utf8').split('\n');
 const metadata=JSON.parse(lines[3]);metadata.command='DX13-PRIVATE-HOLDER-SENTINEL';lines[3]=JSON.stringify(metadata);writeFileSync(path,lines.join('\n'));
 try {script(cwd,idle);const report=await serveCheck(opts(cwd)),failure=report.failures.find(f=>f.code==='E_SERVE_LOCK_HELD');
 assert.ok(failure,JSON.stringify(report));assert.ok(failure.message.includes(join(cwd,'production/store.sqlite')),failure.message);assert.ok(failure.message.includes(String(host.pid))&&failure.message.includes(host.url),failure.message);assert.ok(!JSON.stringify(report).includes('DX13-PRIVATE-HOLDER-SENTINEL'),JSON.stringify(report));
 }finally{await host.stop();}
});
test('serve script actual --dir is compared even if the requested store exists and is unlocked',{skip:process.platform==='win32'},async t=>{
 const cwd=await project(t);await deploy('actual','snapback',{cwd,env});
 const module=pathToFileURL(join(root,'packages/snapback4/dist/proof.js')).href;
 script(cwd,`import {startServe,serveUntilSignal} from ${JSON.stringify(module)};const dir=process.argv[process.argv.indexOf('--dir')+1];const host=await startServe(dir);console.log(JSON.stringify({backendUrl:host.url}));await serveUntilSignal([host]);`);
 writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',scripts:{'probe:serve':'node serve.mjs --dir actual'}}));
 const report=await serveCheck(opts(cwd)),failure=report.failures.find(f=>f.code==='E_SERVE_DEPLOYMENT_MISMATCH');
 assert.ok(failure,JSON.stringify(report));assert.ok(failure.message.includes(join(cwd,'actual/store.sqlite'))&&failure.message.includes(join(cwd,'production/store.sqlite')),failure.message);
 assert.equal(report.lockReleased,true);assert.equal(report.ok,false);
});
test('users batch creates roleless users beside provisioned roles, uses no service when alone',async t=>{
 const cwd=await project(t),host=await startDev({cwd,env});
 try{
 const sessions=await devAccounts(host,{roles:{member:1},users:1,provision:{name:'provision'}});
 for(const [role,accounts] of Object.entries(sessions)){
  const response=await fetch(host.url+'/q/myRole',{method:'POST',headers:{authorization:`Bearer ${accounts[0].token}`,'content-type':'application/json'},body:'{"args":{}}'}),result=await response.json();
  if(role==='users')assert.equal(result.data,null);else assert.equal(result.data.role,role);
 }
 const users=await devAccounts({...host,operatorToken:()=>{throw Error('roleless batch must not mint service token');}},{users:1});assert.equal(users.users.length,1);
 await assert.rejects(devAccounts(host,{users:1,roles:{users:1},provision:{name:'provision'}}),/E_STAGING_INPUT/);
 await assert.rejects(devAccounts(host,{users:101}),/E_STAGING_INPUT/);
 }finally{await host.stop();}
});
test('provision errors show merged argument shapes and actual parameters with opaque values redacted',async t=>{
 const cwd=await project(t),host=await startDev({cwd,env});
 try{await assert.rejects(host.devAccounts({roles:{member:1},provision:{name:'provision'},args:()=>({role:'DX13-PRIVATE-SENTINEL',extra:'DX13-PRIVATE-SENTINEL'})}),error=>{
 assert.match(error.message,/E_STAGING_PROVISION/);assert.match(error.message,/merged args/);assert.match(error.message,/mutation parameters: principal, role/);assert.ok(error.message.includes('extra')&&!error.message.includes('DX13-PRIVATE-SENTINEL'));return true;
 });}finally{await host.stop();}
});
test('starter installer names its owned wait without polling and preserves a silent npm failure',{skip:process.platform==='win32'},async t=>{
 const cwd=scratch(t);mkdirSync(join(cwd,'bin'));
 const fake=join(cwd,'bin/npm');writeFileSync(fake,'#!/bin/sh\necho run >> npm-runs\nsleep 11\nexit 7\n',{mode:0o755});
 const source=join(root,'crates/snapback4/src/verbs/init/install.mjs');
 const result=await command(process.execPath,[source],{cwd,env:{PATH:join(cwd,'bin')+':'+process.env.PATH},timeoutMs:20000,secret:true});
 assert.equal(result.code,7);assert.match(result.stderr,/frontend install: running/);assert.match(result.stderr,/install\.mjs --wait/);assert.match(result.stderr,/npm install finished \(exit 7\)/);
 const lines=result.stderr.trim().split('\n'), progress=lines.filter(line=>/^frontend install: running; \d+s elapsed; waiting$/.test(line));
 assert.ok(progress.length>=2,'a quiet eleven-second install supplies five-second progress');
 assert.equal(lines.filter(line=>!progress.includes(line)).length,2,'one initial status and one completion apart from progress');
 assert.equal(readFileSync(join(cwd,'npm-runs'),'utf8'),'run\n','one owned installation');
});
