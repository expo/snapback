import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {published,loadWasm} from './helpers/published-capabilities.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const binary=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
const cache=process.env.SNAPBACK4_FENCE_PUBLISHED;
const timeline=readFileSync(join(root,'crates/snapback4-lang/tests/fixtures/timeline-capability.q'),'utf8');
const recorded=`use personas alice
 table posts:
  authorId: principal
  immutable authorId
  read <- allow
  insert <- .authorId = viewer
  sync public
 table likes:
  postId: posts
  principal: principal
  immutable postId
  read <- allow
  insert <- .principal = viewer
  sync public
 maintain totals: count likes by postId.authorId
  read <- allow
 mutation like(postId: posts):
  insert likes {postId, principal: viewer}
 query posts():
  return posts first 10
 query likes():
  return likes first 10
`.replace(/^ /gm,'');
const ordinary=recorded.replace(/maintain totals:[\s\S]*?mutation like/, 'mutation like');
const fixtures=[
  {name:'timeline',source:timeline,plain:timeline.replace(/maintain feed:[\s\S]*?mutation register/,'mutation register').replace(/query following[\s\S]*?query posts/,'query posts'),
    seed:[{table:'profiles',row:{id:'profile',principal:'dev:alice'}}], query:'profiles',op:'publish',args:{postId:'offline'},predictions:3},
  {name:'recorded-attribution',source:recorded,plain:ordinary,
    seed:[{table:'posts',row:{id:'p',authorId:'dev:alice'}}],query:'posts',op:'like',args:{postId:'p'},predictions:2},
];
function dump(path) {
  const db=new DatabaseSync(path,{readOnly:true});
  try {return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all().map(row=>JSON.stringify(row)).sort()]));}
  finally {db.close();}
}
const ok=reply=>{assert.ok(Object.hasOwn(reply,'ok'),JSON.stringify(reply));assert.equal(reply.denied,undefined);return reply.ok;};
const unknown=/unknown variant [`'"]?Capabilities/;

async function harness(t) {
  const dir=mkdtempSync(join(tmpdir(),'sb4-capability-')),children=[];
  t.after(async()=>{for(const {child,exited} of children){if(child.exitCode===null&&child.signalCode===null)child.kill();await exited;}rmSync(dir,{recursive:true,force:true});});
  const legacy=await published(cache,join(dir,'published'),text=>t.diagnostic(text));
  const current=await loadWasm(join(root,'packages/snapback4/src/wasm'));
  const run=(bin,args,input='',cwd=dir)=>spawnSync(bin,args,{cwd,input,encoding:'utf8',timeout:20_000});
  assert.match(run(legacy.binary,['--version']).stdout,/snapback4 0\.2\.33/);
  function native(bin,path,backend,requests=[]) {
    const file=join(dir,'backend.json');if(backend)writeFileSync(file,JSON.stringify(backend));
    const result=run(bin,['device',path,...(backend?[file]:[])],requests.map(r=>JSON.stringify(r)+'\n').join(''));
    return {...result,replies:result.stdout.trim()?result.stdout.trim().split('\n').map(line=>JSON.parse(line)):[]};
  }
  async function start(bin,cwd,args=['dev','--no-watch','--port','0']) {
    const child=spawn(bin,args,{cwd,stdio:['ignore','pipe','pipe']}),exited=once(child,'exit');children.push({child,exited});
    let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{log+=d;});
    for(let n=0;n<1000;n++) {
      const url=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if(url)return {url,stop:async()=>{child.kill();await exited;}};
      assert.equal(child.exitCode,null,log);await delay(20);
    }assert.fail(log);
  }
  const request=async(server,path,body)=>{
    const r=await fetch(server.url+path,{method:body?'POST':'GET',headers:{'x-snapback-persona':'alice','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20_000)});
    const text=await r.text();assert.equal(r.status,200,text);return {text,json:JSON.parse(text)};
  };
  async function app(name,source,seed=[],bin=binary) {
    const cwd=join(dir,name);mkdirSync(join(cwd,'snapback'),{recursive:true});writeFileSync(join(cwd,'snapback/schema.q'),source);
    const server=await start(bin,cwd);if(seed.length)await request(server,'/seed',seed);
    const backend=await request(server,'/schema'),page=await request(server,'/sync',{from:0,limit:10000,pending:[]});
    return {cwd,server,backend:backend.json,text:backend.text,page:page.json};
  }
  return {dir,legacy,current,run,native,start,request,app};
}

for(const f of fixtures)test(`published 0.2.33 capability fence: ${f.name}`,{
  skip:!cache&&'set SNAPBACK4_FENCE_PUBLISHED to an npm tarball cache directory',timeout:120_000,
},async t=>{
  const h=await harness(t),{dir,legacy,current,run,native,app}=h;
  const old=await app('prior',f.plain,f.seed);
  await old.server.stop();
  const next=await app('prior',f.source);
  assert.equal(next.backend.generation,old.backend.generation+1);
  const apply={op:'apply',page:next.page,first:true,viewer:'dev:alice'};
  const entry={id:'offline-write',seq:1,op:f.op,viewer:'dev:alice',args:f.args,now:1000,new_ids:[],predicted:[],predictable:true};
  const admit={op:'admit',entry};
  // This assertion must fail when the timeline derivation is mutated away:
  // it interrogates the published native device before inspecting the marker.
  const fresh=join(dir,'legacy-fresh.sqlite');
  const refused=native(legacy.binary,fresh,next.backend,[apply,admit]);
  assert.notEqual(refused.status,0,'published native device accepted unsupported backend');
  assert.match(refused.stderr+refused.stdout,unknown);
  t.diagnostic(`${f.name} initial native refusal: ${refused.stderr.trim()}`);
  assert.equal(refused.replies.length,0,'must not predict');assert.equal(existsSync(fresh),false,'decode before creating store');
  assert.throws(()=>new legacy.wasm(JSON.stringify(next.backend),'[]'),unknown);
  const markers=Object.values(next.backend.schema.tables).flatMap(t=>t.constraints).filter(c=>c?.Capabilities);
  assert.deepEqual(markers,[{Capabilities:[f.name]}]);
  const currentPath=join(dir,'current.sqlite');
  const accepted=native(binary,currentPath,next.backend,[apply,admit]);
  assert.equal(accepted.status,0,accepted.stderr);accepted.replies.forEach(ok);
  assert.equal(ok(accepted.replies[2]).predictable,true);
  assert.equal(ok(accepted.replies[2]).predicted.length,f.predictions);
  const web=new current(JSON.stringify(next.backend),'[]');
  ok(JSON.parse(web.call(JSON.stringify(apply))));
  assert.equal(ok(JSON.parse(web.call(JSON.stringify(admit)))).predicted.length,f.predictions);
  const kept=web.drain();web.free();
  assert.throws(()=>new legacy.wasm(undefined,kept),unknown);
  const reopenedWeb=new current(undefined,kept);ok(JSON.parse(reopenedWeb.call('{"op":"state"}')));reopenedWeb.free();
  const beforeCurrent=dump(currentPath);
  const oldReopen=native(legacy.binary,currentPath,null,[{op:'state'}]);
  assert.notEqual(oldReopen.status,0);assert.match(oldReopen.stdout+oldReopen.stderr,unknown);
  assert.equal(dump(currentPath),beforeCurrent);assert.equal(native(binary,currentPath,null).status,0);

  // Actual old-generation data, not a stripped 0.3 backend, is the adoption control.
  const query={op:'query',name:f.query,viewer:'dev:alice',args:{},now:1000};
  const priorPath=join(dir,'prior.sqlite');
  const installed=native(legacy.binary,priorPath,old.backend,[{op:'apply',page:old.page,first:true,viewer:'dev:alice'},query]);
  assert.equal(installed.status,0,installed.stderr);installed.replies.forEach(ok);
  const priorAnswer=installed.replies[2];assert.ok(ok(priorAnswer).data.length>0);assert.equal(ok(priorAnswer).complete,true);
  const before=dump(priorPath),candidate=next.backend;
  const adoption=native(legacy.binary,priorPath,null,[{op:'adopt',backend:candidate},query,{op:'state'},{op:'queued'}]);
  assert.equal(adoption.status,0,adoption.stderr);assert.match(JSON.stringify(adoption.replies[1]),unknown);
  t.diagnostic(`${f.name} adoption refusal: ${JSON.stringify(adoption.replies[1])}`);
  assert.deepEqual(adoption.replies[2],priorAnswer);assert.equal(ok(adoption.replies[3]).generation,old.backend.generation);
  assert.deepEqual(ok(adoption.replies[4]),[]);assert.equal(dump(priorPath),before);
  assert.deepEqual(native(legacy.binary,priorPath,null,[query]).replies[1],priorAnswer);
  const priorWeb=new legacy.wasm(JSON.stringify(old.backend),'[]');
  ok(JSON.parse(priorWeb.call(JSON.stringify({op:'apply',page:old.page,first:true,viewer:'dev:alice'}))));
  const webAnswer=JSON.parse(priorWeb.call(JSON.stringify(query))),priorKept=priorWeb.drain();
  assert.match(priorWeb.call(JSON.stringify({op:'adopt',backend:candidate})),unknown);
  assert.equal(priorWeb.drain(),'[]','failed adoption produces no persistent writes');
  assert.deepEqual(JSON.parse(priorWeb.call(JSON.stringify(query))),webAnswer);priorWeb.free();
  const priorAgain=new legacy.wasm(undefined,priorKept);assert.deepEqual(JSON.parse(priorAgain.call(JSON.stringify(query))),webAnswer);priorAgain.free();

  // Unsupported future capabilities use a stable new-device refusal code.
  const future=structuredClone(candidate);
  Object.values(future.schema.tables).flatMap(t=>t.constraints).find(c=>c?.Capabilities).Capabilities.push('future-derivation');
  const denied=native(binary,priorPath,null,[{op:'adopt',backend:future},query]);
  assert.equal(denied.replies[1].denied.code,'E_SCHEMA_CAPABILITY');assert.deepEqual(denied.replies[2],priorAnswer);
  const futurePath=join(dir,'future.sqlite'),futureInstall=native(binary,futurePath,future);
  assert.notEqual(futureInstall.status,0);assert.match(futureInstall.stderr,/E_SCHEMA_CAPABILITY/);
  assert.equal(existsSync(futurePath),false);
  for(const opening of [future,{initial_backend:future}]) {
    assert.throws(()=>new current(JSON.stringify(opening),'[]'),/"code":"E_SCHEMA_CAPABILITY"/);
  }
  const futureKept=JSON.parse(kept).map(change=>change.s==='m'&&change.k==='device:backend'?{...change,v:JSON.stringify(future)}:change);
  assert.notEqual(JSON.stringify(futureKept),kept,'must replace kept backend');
  assert.throws(()=>new current(undefined,JSON.stringify(futureKept)),/"code":"E_SCHEMA_CAPABILITY"/);

  await next.server.stop();await old.server.stop();
  const store=join(next.cwd,'.snapback4/store.sqlite'),stored=dump(store);
  const doctor=run(legacy.binary,['doctor','--store',store],'',next.cwd);
  assert.notEqual(doctor.status,0);assert.match(doctor.stdout+doctor.stderr,/invalid stored schema.*unknown variant [`'"]?Capabilities/);
  assert.equal(dump(store),stored);
  t.diagnostic(`${f.name} stored-engine refusal: ${doctor.stdout.trim()} ${doctor.stderr.trim()}`);
  const release=join(dir,'release');const deployed=run(binary,['deploy',release],'',next.cwd);assert.equal(deployed.status,0,deployed.stdout+deployed.stderr);
  // Keep source old-readable: the refusal must come from the persisted schema.
  writeFileSync(join(release,'releases/1/snapback/schema.q'),f.plain);
  const releaseStore=join(release,'store.sqlite'),releaseBefore=dump(releaseStore);
  const served=run(legacy.binary,['serve',release,'--port','0'],'',next.cwd);
  assert.notEqual(served.status,0);assert.match(served.stdout+served.stderr,unknown);
  assert.equal(dump(releaseStore),releaseBefore,'old serve did not write');
  writeFileSync(join(next.cwd,'snapback/schema.q'),f.plain);
  const wrote=run(legacy.binary,['run',f.op,JSON.stringify(f.args),'--as','alice'],'',next.cwd);
  assert.match(wrote.stdout+wrote.stderr,unknown);
  assert.notEqual(wrote.status,0);assert.equal(dump(store),stored,'old engine did not write');
  // New engine also refuses unknown capabilities when reopening persisted state.
  const db=new DatabaseSync(store);
  const storedSchema=JSON.parse(db.prepare('SELECT schema FROM _generations ORDER BY generation DESC LIMIT 1').get().schema);
  Object.values(storedSchema.tables).flatMap(t=>t.constraints).find(c=>c?.Capabilities).Capabilities.push('future-derivation');
  db.prepare('UPDATE _generations SET schema=?').run(JSON.stringify(storedSchema));db.close();
  const unknownStored=dump(store),newDoctor=run(binary,['doctor','--store',store],'',next.cwd);
  assert.notEqual(newDoctor.status,0);assert.match(newDoctor.stdout+newDoctor.stderr,/E_SCHEMA_CAPABILITY/);assert.equal(dump(store),unknownStored);
  t.diagnostic(`${f.name}: native+WASM initial/refusal, prediction, adoption/store preservation and reopen passed; old engine doctor/serve/write refusal passed`);
});

test('published 0.2.33 control: capability-free bytes and stores stay compatible',{
  skip:!cache&&'set SNAPBACK4_FENCE_PUBLISHED to an npm tarball cache directory',timeout:120_000,
},async t=>{
  const {dir,legacy,current,run,native,app,start}=await harness(t);
  const newApp=await app('new',ordinary,fixtures[1].seed),oldApp=await app('old',ordinary,fixtures[1].seed,legacy.binary);
  assert.equal(newApp.text,oldApp.text,'byte-for-byte compiled backend against published 0.2.33');
  const apply={op:'apply',page:newApp.page,first:true,viewer:'dev:alice'},query={op:'query',name:'posts',viewer:'dev:alice',args:{},now:1000};
  const path=join(dir,'control.sqlite'),result=native(legacy.binary,path,newApp.backend,[apply,query,{op:'adopt',backend:newApp.backend},query]);
  assert.equal(result.status,0,result.stderr);result.replies.forEach(ok);assert.deepEqual(result.replies[2],result.replies[4]);
  assert.equal(native(legacy.binary,path,null,[query]).status,0);
  for(const Web of [legacy.wasm,current]) {const d=new Web(JSON.stringify(newApp.backend),'[]');ok(JSON.parse(d.call(JSON.stringify(apply))));assert.ok(ok(JSON.parse(d.call(JSON.stringify(query)))).data.length);d.free();}
  await newApp.server.stop();await oldApp.server.stop();
  const doctor=run(legacy.binary,['doctor','--store',join(newApp.cwd,'.snapback4/store.sqlite')],'',newApp.cwd);assert.equal(doctor.status,0,doctor.stderr);
  const release=join(dir,'control-release'),deployed=run(binary,['deploy',release],'',newApp.cwd);assert.equal(deployed.status,0,deployed.stderr);
  const server=await start(legacy.binary,newApp.cwd,['serve',release,'--port','0']);await server.stop();
});
