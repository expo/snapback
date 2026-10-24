import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {serveCheck, provisionAccounts, deploy, startServe, cli, command} from '../dist/proof.js';
const root=resolve(import.meta.dirname,'../../..');
const bin=resolve(root,'target/debug/snapback4');
const fixture=t=>{const dir=mkdtempSync(join(tmpdir(),'dx10-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
const write=(cwd,name,body)=>writeFileSync(join(cwd,name),body);
const env={SNAPBACK4_BIN:bin};
const plan={roles:{admin:1,member:1},provision:{name:'provision'}};
const guide=readFileSync(resolve(root,'crates/snapback4-lang/src/guide/staging.md'),'utf8');
const schema=guide.match(/```quarry\n([\s\S]*?)```/)[1];
async function project(t){const cwd=fixture(t);mkdirSync(join(cwd,'snapback'));write(cwd,'snapback/schema.q',schema);await deploy('production','snapback',{cwd,env});return cwd;}
function npmScript(cwd,source){write(cwd,'package.json',JSON.stringify({type:'module',scripts:{'prod:serve':'node serve.mjs'}}));write(cwd,'serve.mjs',source);}
const jsonLine='console.log(JSON.stringify({backendUrl:"http://example",password:"SECRET-NEVER-REPORT"}));';
const hold='setInterval(()=>{},1000);';
for(const [label,source,expected] of [
 ['clean',jsonLine+hold,[]],
 ['npm-banner','console.log("npm banner");'+jsonLine+hold,['E_SERVE_EXTRA_OUTPUT']],
 ['no-json',hold,['E_SERVE_NO_JSON']],
 ['early-exit',jsonLine,['E_SERVE_EARLY_EXIT']],
 ['ignored-term','process.on("SIGTERM",()=>{});'+jsonLine+hold,['E_SERVE_CHILD_RUNNING']],
 ['driver-death','const {execFileSync}=await import("node:child_process");const driver=Number(execFileSync("ps",["-o","pgid=","-p",String(process.pid)]));setTimeout(()=>process.kill(driver,"SIGKILL"),40);'+jsonLine+hold,['E_SERVE_DRIVER_EXIT']],
 ['trailing-output',jsonLine+'process.on("SIGTERM",()=>{process.stdout.write("trailing");process.exit(0)});'+hold,['E_SERVE_EXTRA_OUTPUT']],
])test(`serve-check ${label}`,{skip:process.platform==='win32'},async t=>{
 const cwd=await project(t);npmScript(cwd,source);
 const report=await serveCheck({cwd,env,deployment:'production',timeoutMs:1000,upMs:60,stopTimeoutMs:150});
 for(const code of expected)assert.ok(report.failures.some(f=>f.code===code),JSON.stringify(report));
 assert.equal(report.ok,expected.length===0,JSON.stringify(report));
 assert.ok(!JSON.stringify(report).includes('SECRET-NEVER-REPORT'));
});
test('serve-check reports a held real store lock before forced cleanup',{skip:process.platform==='win32'},async t=>{
 const cwd=await project(t);
 npmScript(cwd,`import {startServe} from ${JSON.stringify(pathToFileURL(resolve(root,'packages/snapback4/dist/proof.js')).href)};const host=await startServe('production');process.on('SIGTERM',()=>{});${jsonLine}${hold}`);
 const report=await serveCheck({cwd,env,deployment:'production',timeoutMs:10000,upMs:60,stopTimeoutMs:150});
 assert.ok(report.failures.some(f=>f.code==='E_SERVE_CHILD_RUNNING'));
 assert.ok(report.failures.some(f=>f.code==='E_SERVE_LOCK_HELD'),JSON.stringify(report));
 assert.equal((await cli(['serve','production','--wait-stopped'],{cwd,env})).code,0);
});
test('production roster survives restarts with stable principals and 0600 credentials',async t=>{
 const cwd=await project(t);let first;
 for(let i=0;i<3;i++){
  const host=await startServe('production',{cwd,env});
  try {
   const roster=await host.provisionAccounts(plan);
   const ids=Object.values(roster).flat().map(a=>a.principal);
   if(!first)first=ids;else assert.deepEqual(ids,first);
   await assert.rejects(host.provisionAccounts({...plan,roles:{admin:2}}),/E_PRODUCTION_ROSTER/);
  }finally{await host.stop();}
 }
 assert.equal(statSync(join(cwd,'production/proof-accounts/default.json')).mode&0o777,0o600);
 const result=await cli(['sql','select count(*) as n from roles','--release','production','--json'],{cwd,env});
 assert.equal(result.code,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).rows,[[2]]);
});
for(const stage of ['signup','provision'])test(`roster resumes an ambiguous ${stage} reply without another account`,async t=>{
 const cwd=fixture(t);let signupCalls=0,provisions=0,exists=false,lost=true;const ids=[];
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  if(url.endsWith('/auth/config'))return Response.json({environment:'production',development:false,password:true});
  if(url.endsWith('/schema'))return Response.json({service_identities:['service:operator']});
  const session={session:{principal:'user:stable',kind:'user',token:'secret',expiresAt:Date.now()+10000}};
  if(url.endsWith('/auth/login'))return Response.json(exists?session:{denied:{code:'E_AUTH'}});
  if(url.endsWith('/auth/signup')){signupCalls++;exists=true;if(stage==='signup'&&lost){lost=false;throw Error('lost signup reply');}return Response.json(session);}
  provisions++;ids.push(JSON.parse(init.body).id);if(stage==='provision'&&lost){lost=false;throw Error('lost provision reply');}return Response.json({state:'sent'});
 });
 const host={url:'http://example',operatorToken:async()=> 'operator',deploymentDir:cwd};const options={roles:{member:1},provision:{name:'provision'}};
 await assert.rejects(provisionAccounts(host,options),/lost/);
 assert.equal((await provisionAccounts(host,options)).member[0].principal,'user:stable');
 await provisionAccounts(host,options);assert.equal(signupCalls,1);
 assert.equal(provisions,stage==='signup'?1:2);if(ids.length===2)assert.equal(ids[0],ids[1]);
});
test('packed package executes both stage recipes and the serve-check recipe literally',{skip:process.platform==='win32'},async t=>{
 const cwd=await project(t), packdir=fixture(t);
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',packdir],{cwd:resolve(root,'packages/snapback4'),encoding:'utf8'}))[0];
 execFileSync('tar',['-xzf',join(packdir,packed.filename),'-C',packdir]);
 mkdirSync(join(cwd,'node_modules'));symlinkSync(join(packdir,'package'),join(cwd,'node_modules/snapback4'));
 const kit=await import(pathToFileURL(join(packdir,'package/dist/proof.js')));
 mkdirSync(join(cwd,'versions/v2'),{recursive:true});write(cwd,'versions/v2/schema.q',schema.replace('body: text 1..200','body: text 1..300'));
 const testing=readFileSync(resolve(root,'crates/snapback4-lang/src/guide/testing.md'),'utf8');
 const section=testing.slice(testing.indexOf('## Check an npm serve script'));
 const blocks=[...section.matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]);assert.equal(blocks.length,3);
 for(const [i,source] of blocks.slice(1).entries()){
  write(cwd,`stage-${i}.mjs`,source);const result=await command(process.execPath,[`stage-${i}.mjs`],{cwd,env,timeoutMs:120000});assert.equal(result.code,0,result.stderr);
 }
 npmScript(cwd,`import {startServe} from 'snapback4/proof';const host=await startServe('production');${jsonLine}const hold=setInterval(()=>{},1000);process.on('SIGTERM',async()=>{await host.stop();clearInterval(hold)});`);
 write(cwd,'serve-check.mjs',blocks[0]);
 const result=await command(process.execPath,['serve-check.mjs'],{cwd,env,timeoutMs:60000,secret:true});assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).ok,true);
 const wrapper=await command(process.execPath,[join(packdir,'package/bin/snapback4.js'),'serve-check','--deployment','production','--up-ms','50'],{cwd,env,timeoutMs:30000,secret:true});assert.equal(wrapper.code,0,wrapper.stderr);assert.equal(JSON.parse(wrapper.stdout).ok,true);
 assert.equal(typeof kit.serveCheck,'function');
});

test('resuming a provision canonicalizes reordered nested arguments',async t=>{
 const cwd=fixture(t);let exists=false,lost=true,prior;
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  if(url.endsWith('/auth/config'))return Response.json({environment:'production',development:false,password:true});
  if(url.endsWith('/schema'))return Response.json({service_identities:['service:operator']});
  const session={session:{principal:'user:stable',kind:'user',token:'secret',expiresAt:Date.now()+10000}};
  if(url.endsWith('/auth/login'))return Response.json(exists?session:{denied:{code:'E_AUTH'}});
  if(url.endsWith('/auth/signup')){exists=true;return Response.json(session);}
  const id=JSON.parse(init.body).id;if(lost){prior=id;lost=false;throw Error('lost provision reply');}assert.equal(id,prior);return Response.json({state:'sent'});
 });
 const host={url:'http://example',operatorToken:async()=> 'operator',deploymentDir:cwd};
 const options={roles:{member:1},provision:{name:'provision'}};
 await assert.rejects(provisionAccounts(host,{...options,args:()=>({meta:{a:1,b:2}})}),/lost/);
 await provisionAccounts(host,{...options,args:()=>({meta:{b:2,a:1}})});
});

test('production roster refuses concurrent setup and never replaces a known failed login',async t=>{
 const cwd=fixture(t);let hold,entered;const waiting=new Promise(resolve=>{entered=resolve;});let initialized=false,signups=0,failLogin=false;
 t.mock.method(globalThis,'fetch',async(url)=>{
  if(url.endsWith('/auth/config')){if(!initialized){initialized=true;entered();await new Promise(resolve=>{hold=resolve;});}return Response.json({environment:'production',development:false,password:true});}
  if(url.endsWith('/schema'))return Response.json({service_identities:['service:operator']});
  if(url.endsWith('/auth/login'))return Response.json(failLogin?{denied:{code:'E_AUTH'}}:{session:{principal:'user:stable',kind:'user',token:'secret',expiresAt:Date.now()+10000}});
  if(url.endsWith('/auth/signup')){signups++;return Response.json({session:{principal:'user:stable',kind:'user',token:'secret',expiresAt:Date.now()+10000}});}
  return Response.json({state:'sent'});
 });
 const host={url:'http://example',operatorToken:async()=> 'operator',deploymentDir:cwd};const options={roles:{member:1},provision:{name:'provision'}};
 const first=provisionAccounts(host,options);await waiting;
 await assert.rejects(provisionAccounts(host,options),/E_PRODUCTION_ROSTER_BUSY/);hold();await first;
 failLogin=true;await assert.rejects(provisionAccounts(host,options),/saved account login failed/);assert.equal(signups,1);
});
