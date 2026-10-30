import '../../../scripts/test-npm-cache.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {serveCheck, withServeScript, startDev, devAccounts, startServe, deploy, cli, command} from '../dist/proof.js';
const root=resolve(import.meta.dirname,'../../..'), bin=join(root,'target/debug/snapback4');
const env={SNAPBACK4_BIN:bin};
const schema=readFileSync(join(root,'crates/snapback4-lang/src/guide/staging.md'),'utf8').match(/```quarry\n([\s\S]*?)```/)[1];
function scratch(t){const cwd=mkdtempSync(join(tmpdir(),'dx12-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));return cwd;}
async function project(t){const cwd=scratch(t);mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),schema);await deploy('production','snapback',{cwd,env});return cwd;}
function script(cwd,body){writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',scripts:{'probe:serve':'node serve.mjs'}}));writeFileSync(join(cwd,'serve.mjs'),body);}
const ready='console.log(JSON.stringify({backendUrl:"http://127.0.0.1:1",frontendUrl:"http://127.0.0.1:2",password:"PRIVATE-SERVE-SENTINEL"}));setInterval(()=>{},1000);';
// Successful npm/child cleanup uses the public shutdown grace, not a 100 ms scheduler race.
const opts=cwd=>({cwd,env,script:'probe:serve',deployment:'production',timeoutMs:3000,thenTimeoutMs:3000,stopTimeoutMs:5000});
test('serve callback receives private readiness, returns its value and releases the lock', {skip:process.platform==='win32'},async t=>{
 const cwd=await project(t);script(cwd,ready);
 const value=await withServeScript('probe:serve',async (ready,signal)=>{assert.equal(signal.aborted,false);assert.equal(ready.password,'PRIVATE-SERVE-SENTINEL');return 42;},opts(cwd));
 assert.equal(value,42);assert.equal((await cli(['serve','production','--wait-stopped'],{cwd,env})).code,0);
});
test('callback failure and hung callback still release serve group and lock', {skip:process.platform==='win32'},async t=>{
 const cwd=await project(t);script(cwd,ready);
 await assert.rejects(withServeScript('probe:serve',()=>{throw Error('business assertion');},opts(cwd)),/business assertion/);
 let signal;
 await assert.rejects(withServeScript('probe:serve',(_,abort)=>{signal=abort;return new Promise(()=>{});},{...opts(cwd),thenTimeoutMs:50}),/E_SERVE_THEN_TIMEOUT/);
 assert.equal(signal.aborted,true);assert.equal((await cli(['serve','production','--wait-stopped'],{cwd,env})).code,0);
});
test('then command gets readiness and nonzero status; descendants and hung commands are reaped', {skip:process.platform==='win32'},async t=>{
 const cwd=await project(t);script(cwd,ready);
 const result=await serveCheck({...opts(cwd),then:`node -e 'const s=JSON.parse(process.env.SNAPBACK4_SERVE_JSON); if(s.password!=="PRIVATE-SERVE-SENTINEL" || process.env.SNAPBACK_URL!==s.backendUrl || process.env.FRONTEND_URL!==s.frontendUrl) process.exit(9); process.exit(7)'`});
 assert.equal(result.commandCode,7);assert.ok(!JSON.stringify(result).includes('PRIVATE-SERVE-SENTINEL'));
 const hung=await serveCheck({...opts(cwd),then:'node -e "setInterval(()=>{},1000)"',thenTimeoutMs:80});
 assert.ok(hung.failures.some(f=>f.code==='E_SERVE_THEN_TIMEOUT'),JSON.stringify(hung));
 assert.equal((await cli(['serve','production','--wait-stopped'],{cwd,env})).code,0);
});
test('startup hang names script and startup deadline without exposing output', {skip:process.platform==='win32'},async t=>{
 const cwd=await project(t);script(cwd,'setInterval(()=>{},1000)');let called=false;
 const report=await serveCheck({...opts(cwd),timeoutMs:100,then:()=>{called=true;}});
 assert.equal(called,false);assert.match(report.failures.find(f=>f.code==='E_SERVE_NO_JSON').message,/probe:serve.*100 ms/);
});
test('dev accounts use real password signup and ordinary operator provisioning, and refuse serve',async t=>{
 const cwd=await project(t), options={roles:{admin:1,member:1},provision:{name:'provision'}};
 const host=await startDev({cwd,env});
 try {
  const sessions=await devAccounts(host,options);assert.equal(sessions.admin[0].kind,'user');
  for(const [role,accounts] of Object.entries(sessions))for(const account of accounts){
   const response=await fetch(host.url+'/q/myRole',{method:'POST',headers:{authorization:`Bearer ${account.token}`,'content-type':'application/json'},body:'{"args":{}}'});
   assert.equal((await response.json()).data.role,role);
  }
  assert.equal((await host.devAccounts({roles:{member:1},provision:{name:'provision'}})).member.length,1);
 }finally{await host.stop();}
 const serve=await startServe('production',{cwd,env});try{await assert.rejects(devAccounts(serve,options),/E_DEV_ACCOUNTS/);}finally{await serve.stop();}
});
test('packed CLI propagates command status and literal withServeScript guide recipe runs', {skip:process.platform==='win32'},async t=>{
 const cwd=await project(t), pack=scratch(t);
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',pack],{cwd:join(root,'packages/snapback4'),encoding:'utf8'}))[0];execFileSync('tar',['-xzf',join(pack,packed.filename),'-C',pack]);
 mkdirSync(join(cwd,'node_modules'));symlinkSync(join(pack,'package'),join(cwd,'node_modules/snapback4'));
 const module=pathToFileURL(join(pack,'package/dist/proof.js')).href;
 script(cwd,`import {startServe,serveUntilSignal} from ${JSON.stringify(module)}; const host=await startServe('production'); console.log(JSON.stringify({backendUrl:host.url})); await serveUntilSignal([host]);`);
 const result=await command(process.execPath,[join(pack,'package/bin/snapback4.js'),'serve-check','--json','--deployment','production','--script','probe:serve','--then','node -e "process.exit(7)"'],{cwd,env,secret:true});
 assert.equal(result.code,7,result.stderr);assert.equal(JSON.parse(result.stdout).commandCode,7);
 const guide=readFileSync(join(root,'crates/snapback4-lang/src/guide/testing.md'),'utf8');
 const block=guide.split('<!-- DX12 RUN SERVE BEGIN -->')[1].match(/```js\n([\s\S]*?)```/)[1];writeFileSync(join(cwd,'run.mjs'),block);
 const ran=await command(process.execPath,['run.mjs'],{cwd,env,secret:true});assert.equal(ran.code,0,ran.stderr);
 const installed=await import(module);assert.equal(typeof installed.withServeScript,'function');assert.equal(typeof installed.devAccounts,'function');
});

test('serve shutdown failure cannot earn success from a successful command', {skip:process.platform==='win32'},async t=>{
 const cwd=await project(t);script(cwd,'process.on("SIGTERM",()=>process.exit(7));'+ready);
 const preload=join(cwd,'npm-term.cjs');writeFileSync(preload,'if((process.argv[1]?.endsWith("npm-cli.js") || process.argv[1]?.endsWith("/npm"))) process.on("SIGTERM",()=>{});');
 const report=await serveCheck({...opts(cwd),env:{...env,NODE_OPTIONS:`--require=${preload}`},then:'true',stopTimeoutMs:3000});
 assert.equal(report.commandCode,0);assert.equal(report.ok,false,JSON.stringify(report));assert.ok(report.failures.some(f=>f.code==='E_SERVE_STOP_FAILED'),JSON.stringify(report));
});
