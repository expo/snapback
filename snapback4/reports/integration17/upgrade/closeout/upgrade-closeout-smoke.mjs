import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),cwd='/tmp/integ17/upgrade-closeout-smoke',output='/tmp/integ17',binary='/home/ccheever/projects/snapback-sb4loop/snapback4/target/debug/snapback4',clientPack='/tmp/integ17/prepared-qualified/snapback4-0.4.33.tgz';
const prior=JSON.parse(readFileSync('/tmp/integ17-upgrade/old-ready.json','utf8')),env={...process.env};delete env.SNAPBACK4_BIN;
const commands=[];async function run(args){const r=await exec('timeout',['120s',binary,...args],{cwd,env,timeout:130000,maxBuffer:32*1024*1024});commands.push({cmd:'timeout',args:['120s',binary,...args],cwd,exit:0});return r.stdout;}
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal((await run(['--version'])).trim(),'snapback4 0.4.33');
const checked=JSON.parse(await run(['check','--json']));assert.equal(checked.ok,true);assert.equal(checked.security.notes.filter(n=>n.code==='N_SECURITY_INTENT').length,1);assert.equal(checked.security.invariants.length,0);
const rows=JSON.parse(await run(['data','notes','--json']));assert.ok(rows.some(r=>r.id===prior.id&&r.body==='preserved-from-0.4.32'));
const {api}=await import(cwd+'/snapback/generated/api.ts');const {createClient}=await import(cwd+'/node_modules/snapback4/dist/client.js');const {signup}=await import(cwd+'/node_modules/snapback4/dist/auth.js');
async function host(args=[]){const s=createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const port=s.address().port;await new Promise(ok=>s.close(ok));const argsAll=['120s',binary,'dev','--port',String(port),'--no-watch',...args];const child=spawn('timeout',argsAll,{cwd,env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);const deadline=Date.now()+30000;while(!log.includes('SNAPBACK4_READY')){assert.equal(child.exitCode,null);assert.ok(Date.now()<deadline);await new Promise(ok=>setTimeout(ok,20));}commands.push({cmd:'timeout',args:argsAll,cwd,kind:'temporary host'});return {url:'http://127.0.0.1:'+port,async stop(){if(child.exitCode===null)await new Promise(ok=>{child.once('exit',ok);child.kill('SIGTERM');});}};}
async function request(h,path,body,headers={}){const r=await fetch(h.url+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return {status:r.status,body:await r.json()};}
let h=await host(),client;try{
 assert.equal((await request(h,'/auth/config')).body.devDoors,false);
 for(const path of ['/dev/status','/seed','/dev/reset','/dev/clock/advance'])assert.ok([401,403,404].includes((await request(h,path,path==='/dev/status'?undefined:{})).status));
 assert.equal((await request(h,'/q/one',{args:{note:prior.id}},{'x-snapback-persona':'alice'})).status,401);
 const signed=await signup(h.url,'final-cli-upgrade@example.test','Final-cli-upgrade-proof!');assert.equal(signed.ok,true);
 client=createClient({url:h.url,session:signed.session});
 const hidden=await client.query(api.one,{note:prior.id});assert.equal(hidden.data,null);
 const added=await client.mutate(api.add,{body:'final-cli-account-check'});assert.equal(added.state,'sent');assert.ok(added.result.id);
 const one=await client.query(api.one,{note:added.result.id});assert.equal(one.data.body,'final-cli-account-check');
}finally{await client?.close();await h.stop();}
h=await host(['--unsafe-dev-doors']);try{assert.equal((await request(h,'/dev/status')).status,200);const old=await request(h,'/q/one',{args:{note:prior.id}},{'x-snapback-persona':'alice'});assert.equal(old.status,200);assert.equal(old.body.data.body,'preserved-from-0.4.32');}finally{await h.stop();}
const binding=JSON.parse(readFileSync(output+'/upgrade-closeout-original-binding.json','utf8'));for(const [path,digest] of Object.entries(binding.hashes))assert.equal(sha(binding.source+'/'+path),digest,'original upgrade evidence store unchanged');
assert.equal(sha(cwd+'/snapback/schema.q'),prior.hashes['snapback/schema.q']);
const result={status:'passed',from:'0.4.32',to:'0.4.33',method:'minimal final-runtime replay on a private SQLite backup of the fully upgraded store',clientPack,clientSha256:sha(clientPack),binary,binarySha256:sha(binary),oldRowPreserved:true,sourceUnchanged:true,aggregateMissingIntentNotes:1,passwordDefaultDevDoorsClosed:true,forgedPersonaRefused:true,finalPackedClientSignupMutationQuery:true,unsafeDevDoorsOldPersonaWorkflow:true,originalEvidenceStoreUnchanged:true};
writeFileSync(output+'/upgrade-closeout-result.json',JSON.stringify(result,null,2)+'\n');writeFileSync(output+'/upgrade-closeout-commands.json',JSON.stringify(commands,null,2)+'\n');console.log(JSON.stringify(result));
