import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),base='/tmp/integ17-upgrade',repo='/home/ccheever/projects/snapback-sb4loop';
const sb=join(repo,'snapback4'),report=join(sb,'reports/integration17/upgrade');mkdirSync(report,{recursive:true});
const old=join(base,'old-tools/node_modules/snapback4-linux-x64/snapback4'),binary=join(sb,'target/debug/snapback4');
const env={...process.env,PATH:'/home/ccheever/.bun-1.4.2/bin:'+process.env.PATH,CI:'1',EXPO_NO_TELEMETRY:'1',CARGO_INCREMENTAL:'0',CARGO_PROFILE_DEV_DEBUG:'0',CARGO_PROFILE_TEST_DEBUG:'0'};
let seq=existsSync(join(base,'old-ready.json'))?100:0;const commands=existsSync(join(report,'commands.json'))?JSON.parse(readFileSync(join(report,'commands.json'))):[];
async function run(cmd,args,cwd,extra={}){
 const record={cmd,args,cwd};commands.push(record);writeFileSync(join(report,'commands.json'),JSON.stringify(commands,null,2));
 try{const r=await exec('timeout',['900s',cmd,...args],{cwd,env:{...env,...extra},timeout:910000,maxBuffer:32*1024*1024});record.exit=0;writeFileSync(join(report,`${String(++seq).padStart(2,'0')}.log`),r.stdout+r.stderr);writeFileSync(join(report,'commands.json'),JSON.stringify(commands,null,2));console.log(cmd,args.join(' '),'PASS');return r.stdout;}
 catch(e){record.exit=e.code;writeFileSync(join(report,`${String(++seq).padStart(2,'0')}-FAILED.log`),(e.stdout??'')+(e.stderr??''));writeFileSync(join(report,'commands.json'),JSON.stringify(commands,null,2));throw e;}
}
async function host(exe,cwd,args=[]){
 const child=spawn('timeout',['120s',exe,'dev','--port','26917','--no-watch',...args],{cwd,env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 commands.push({cmd:exe,args:['dev','--port','26917','--no-watch',...args],cwd,kind:'temporary host'});
 const end=Date.now()+60000;while(!/SNAPBACK4_READY/.test(log)){assert.equal(child.exitCode,null,log);assert.ok(Date.now()<end,log);await new Promise(r=>setTimeout(r,50));}
 return {url:'http://127.0.0.1:26917',async stop(){if(child.exitCode===null)await new Promise(ok=>{child.once('exit',ok);child.kill('SIGTERM');});writeFileSync(join(report,`host-${String(++seq).padStart(2,'0')}.log`),log);}};
}
async function http(h,path,body,headers={}){const r=await fetch(h.url+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return {status:r.status,body:await r.json()};}
async function call(h,kind,name,args={},who='alice',token){const r=await http(h,`/${kind}/${name}`,{args},token?{authorization:'Bearer '+token}:{'x-snapback-persona':who});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
const app=join(base,'expo32'),store=join(base,'store32');
if(!existsSync(join(base,'old-ready.json'))){
 assert.match(await run(old,['--version'],base),/0\.4\.32/);
 await run(old,['init',app,'--expo'],base);
 await run('npm',['install','--save-exact','snapback4@0.4.32','snapback4-expo@0.4.32','--registry','http://127.0.0.1:4873/','--no-audit','--no-fund'],app);
 await run(old,['check'],app);await run('npm',['run','typecheck'],app);
 mkdirSync(join(store,'snapback'),{recursive:true});
 writeFileSync(join(store,'package.json'),JSON.stringify({name:'integ17-store32',private:true,dependencies:{snapback4:'0.4.32'}}));
 await run('npm',['install','--save-exact','snapback4@0.4.32','--registry','http://127.0.0.1:4873/','--no-audit','--no-fund'],store);
 const source="use identity password\nuse personas alice, bob\ntable notes:\n  owner: principal\n  body: text 1..80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  online only\nmutation add(body: text 1..80):\n  return insert notes { owner: viewer, body }\nquery one(note: notes):\n  return notes[note]\n";
 writeFileSync(join(store,'snapback/schema.q'),source);
 await run(old,['check'],store);
 const h=await host(old,store);let id;try{const status=await http(h,'/dev/status');assert.equal(status.status,200);const result=await call(h,'m','add',{body:'preserved-from-0.4.32'});assert.equal(result.state,'sent');id=result.result.id;assert.equal((await call(h,'q','one',{note:id})).data.body,'preserved-from-0.4.32');assert.equal((await call(h,'q','one',{note:id},'bob')).data,null);}finally{await h.stop();}
 const before=JSON.parse(await run(old,['data','notes','--json'],store));assert.equal(before.length,1);
 const hashes={};for(const path of ['snapback/schema.q','package.json','package-lock.json'])hashes[path]=createHash('sha256').update(readFileSync(join(store,path))).digest('hex');
 writeFileSync(join(base,'old-ready.json'),JSON.stringify({id,before,hashes,expoSourceHash:createHash('sha256').update(readFileSync(join(app,'snapback/schema.q'))).digest('hex')},null,2));
 copyFileSync(join(base,'old-ready.json'),join(report,'old-ready.json'));console.log('OLD_READY');
}
if(process.argv.includes('--old-only'))process.exit(0);
const prior=JSON.parse(readFileSync(join(base,'old-ready.json')));
assert.match(await run(binary,['--version'],base),/0\.4\.33/);
const check=JSON.parse(await run(binary,['check','--json'],store));assert.equal(check.ok,true);assert.equal(check.security.notes.filter(n=>n.code==='N_SECURITY_INTENT').length,1);assert.equal(check.security.refuted,undefined);
assert.deepEqual(JSON.parse(await run(binary,['data','notes','--json'],store)),prior.before);
let h=await host(binary,store);try{
 const config=await http(h,'/auth/config');assert.equal(config.body.devDoors,false);
 for(const path of ['/dev/status','/seed','/dev/reset','/dev/clock/advance']){const r=await http(h,path,path==='/dev/status'?undefined:{});assert.ok([401,403,404].includes(r.status),JSON.stringify({path,...r}));}
 const forged=await http(h,'/q/one',{args:{note:prior.id}},{'x-snapback-persona':'alice'});assert.equal(forged.status,401);
 const signed=await http(h,'/auth/signup',{email:'upgrade33@example.test',password:'Integration17-passphrase!'});assert.equal(signed.status,200,JSON.stringify(signed.body));const token=signed.body.session.token;
 const created=await call(h,'m','add',{body:'real-password-user-after-upgrade'},'',token);assert.equal(created.state,'sent');assert.equal((await call(h,'q','one',{note:created.result.id},'',token)).data.body,'real-password-user-after-upgrade');
}finally{await h.stop();}
h=await host(binary,store,['--unsafe-dev-doors']);try{assert.equal((await http(h,'/dev/status')).status,200);assert.equal((await call(h,'q','one',{note:prior.id})).data.body,'preserved-from-0.4.32');}finally{await h.stop();}
const pack=process.env.INTEG17_PACK;if(!pack)throw Error('Set INTEG17_PACK to completed prepare-client pack directory');
const plat=join(base,'upgrade-platform');mkdirSync(plat,{recursive:true});writeFileSync(join(plat,'package.json'),JSON.stringify({name:'snapback4-linux-x64',version:'0.4.33',os:['linux'],cpu:['x64'],files:['snapback4'],bin:{snapback4:'snapback4'}}));copyFileSync(binary,join(plat,'snapback4'));const packed=JSON.parse(await run('npm',['pack','--json','--pack-destination',base],plat))[0];
const artifacts=[join(pack,'snapback4-0.4.33.tgz'),join(pack,'snapback4-expo-0.4.33.tgz'),join(base,packed.filename)];const items=[];for(const path of artifacts){const manifest=JSON.parse(await run('tar',['-xzOf',path,'package/package.json'],base));const bytes=readFileSync(path);items.push({manifest,bytes,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')});}
let origin;const registry=createServer(async(req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(path.startsWith('/_tar/')){res.end(items[Number(path.slice(6))].bytes);return;}const item=items.find(i=>['/'+i.manifest.name,'/'+i.manifest.name+'/0.4.33','/'+i.manifest.name+'/latest'].includes(path));if(item){const m={...item.manifest,dist:{tarball:origin+'/_tar/'+items.indexOf(item),integrity:item.integrity}};res.setHeader('content-type','application/json');res.end(JSON.stringify(path==='/'+m.name?{name:m.name,'dist-tags':{latest:'0.4.33'},versions:{'0.4.33':m}}:m));return;}const r=await fetch('http://127.0.0.1:4873'+req.url,{signal:AbortSignal.timeout(60000)});res.writeHead(r.status,{'content-type':r.headers.get('content-type')??'application/json'});res.end(Buffer.from(await r.arrayBuffer()));}catch(e){if(!res.headersSent)res.writeHead(502);res.end(String(e));}});await new Promise(ok=>registry.listen(0,'127.0.0.1',ok));origin='http://127.0.0.1:'+registry.address().port;
try{
 const extra={npm_config_registry:origin,SNAPBACK4_UPGRADE_HELPER:join(sb,'packages/snapback4/bin/upgrade.js')};
 for(const cwd of [store,app])await run(binary,['upgrade','--to','0.4.33'],cwd,extra);
 for(const name of ['snapback4','snapback4-expo'])assert.equal(JSON.parse(readFileSync(join(app,'node_modules',name,'package.json'))).version,'0.4.33');
 await run(binary,['init','--adapt'],app);await run(binary,['check'],app);await run('npm',['run','typecheck'],app);await run(join(app,'node_modules/.bin/expo'),['export','-p','web','--max-workers','2'],app);
 assert.equal(createHash('sha256').update(readFileSync(join(store,'snapback/schema.q'))).digest('hex'),prior.hashes['snapback/schema.q']);
 assert.ok(JSON.parse(await run(binary,['data','notes','--json'],store)).some(row=>row.id===prior.id&&row.body==='preserved-from-0.4.32'));
}finally{registry.closeAllConnections();await new Promise(ok=>registry.close(ok));}
writeFileSync(join(report,'result.json'),JSON.stringify({status:'passed',from:'0.4.32',to:'0.4.33',storeOldRowPreserved:true,passwordDefaultDevDoorsClosed:true,passwordRealSignupMutationQuery:true,unsafeDevDoorsRestoresOldPersonaWorkflow:true,noInvariantCheckPasses:true,aggregateIntentNotes:1,expoExactPins:true,expoAdapt:true,expoTypecheck:true,expoWebExport:true,packageHashes:Object.fromEntries(items.map(i=>[i.manifest.name,i.integrity]))},null,2));
copyFileSync(import.meta.filename,join(report,'upgrade.mjs'));console.log('UPGRADE_PASS');
