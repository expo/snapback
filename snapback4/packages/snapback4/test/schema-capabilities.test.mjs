import { waitFor as awaitState } from './helpers/wait.mjs';
import { hangBudget } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,readdirSync,readlinkSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {published,loadWasm} from './helpers/published-capabilities.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const binary=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
// The fence runs wherever the published darwin-arm64 binary can: an unset
// cache used to skip it silently in every lane, so a reply-shape change first
// surfaced in the 0.4.11 publication dry run. Only `off` opts out explicitly.
const fenceSetting=process.env.SNAPBACK4_FENCE_PUBLISHED;
const fenceHost=`${process.platform}-${process.arch}`==='darwin-arm64';
const cache=fenceSetting==='off'||!fenceHost?undefined:fenceSetting||join(homedir(),'.cache/snapback4/fence-published-0.2.33');
const fenceSkip=fenceSetting==='off'?'SNAPBACK4_FENCE_PUBLISHED=off':!fenceHost&&'the published 0.2.33 native witness requires darwin-arm64';
// Same-version device and client ship together, so a published client never
// reads a current reply: `scopes` (LLP 3000.023 audience dependencies) is the
// additive query key. RV additionally permits top-level commit certification on
// apply/admit/settle only; their ok payloads and every query key stay exact.
function sameAnswer(actual,published,message,operation='query') {
  // LLP 3000.023 §12: private authority-preservation evidence, never query data.
  if(['apply','admit','settle'].includes(operation)&&Object.hasOwn(actual,'preserved')&&!Object.hasOwn(published,'preserved')) {
    assert.ok(Object.hasOwn(actual,'ok')&&Object.hasOwn(published,'ok')&&!Object.hasOwn(actual,'denied')&&!Object.hasOwn(published,'denied'),'commit evidence requires successful replies');
    assert.ok(Array.isArray(actual.preserved)&&actual.preserved.length<=256&&actual.preserved.every(t=>typeof t==='string'&&t.length<=128));
    const {preserved:_preserved,...rest}=actual;actual=rest;
  }
  if(actual?.ok&&published?.ok&&Object.hasOwn(actual.ok,'scopes')&&!Object.hasOwn(published.ok,'scopes')) {
    const {scopes:_scopes,...rest}=actual.ok;actual={...actual,ok:rest};
  }
  assert.deepEqual(actual,published,message);
}
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
const maintained=ordinary.replace('table posts:\n','table posts:\n likeCount: count likes by postId\n');
const fixtures=[
  {name:'timeline-v2',capabilities:['timeline-event-slots','timeline-v2'],source:timeline,plain:timeline.replace(/maintain feed:[\s\S]*?mutation register/,'mutation register').replace(/query following[\s\S]*?query posts/,'query posts'),
    seed:[{table:'profiles',row:{id:'profile',principal:'dev:alice'}}], query:'profiles',op:'publish',args:{postId:'offline'},predictions:3},
  {name:'recorded-attribution',source:recorded,plain:ordinary,
    seed:[{table:'posts',row:{id:'p',authorId:'dev:alice'}}],query:'posts',op:'like',args:{postId:'p'},predictions:2},
  {name:'maintained-column',source:maintained,plain:ordinary,freshStore:true,
    seed:[{table:'posts',row:{id:'p',authorId:'dev:alice'}}],query:'posts',op:'like',args:{postId:'p'},predictions:1},
];
function storedSchema(path) {
  assert.ok(existsSync(path),`missing engine store ${path}`);
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    const schema=db.prepare('SELECT schema FROM _generations ORDER BY generation DESC LIMIT 1').get()?.schema;
    assert.equal(typeof schema,'string','stored generation must contain schema bytes');
    return schema;
  } finally {db.close();}
}
function dump(path) {
  assert.ok(existsSync(path),`missing store ${path}`);
  const db=new DatabaseSync(path,{readOnly:true});
  try {return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all().map(row=>JSON.stringify(row)).sort()]));}
  finally {db.close();}
}
// Content snapshot includes symlink targets without following them twice.
function files(path) {
  return readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(entry=>{
    const child=join(path,entry.name);
    return [entry.name,entry.isDirectory()?files(child):entry.isSymbolicLink()?{link:readlinkSync(child)}:createHash('sha256').update(readFileSync(child)).digest('hex')];
  });
}
function noEffectKeys(path) {
  const db=new DatabaseSync(path,{readOnly:true});
  try {assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='_effect_keys'").get().n,0,'refusal must not add the once-key table');}
  finally {db.close();}
}
const ok=reply=>{assert.ok(Object.hasOwn(reply,'ok'),JSON.stringify(reply));assert.equal(reply.denied,undefined);return reply.ok;};
const unknown=/unknown variant [`'"]?Capabilities/;
const storedUnknown=/E_STORE: (?:invalid stored schema: )?unknown variant [`'"]?Capabilities/;
const capabilityCode=/"code"\s*:\s*"E_SCHEMA_CAPABILITY"/;
function markers(schema,expected) {
  const constraints=Object.values(schema.tables).flatMap(t=>t.constraints);
  assert.ok(!constraints.some(c=>c==='Recorded'||c==='Capabilities'),'no legacy or unit carrier');
  assert.deepEqual(constraints.filter(c=>c?.Capabilities),expected.length?[{Capabilities:expected}]:[]);
}


async function harness(t) {
  const dir=mkdtempSync(join(tmpdir(),'sb4-capability-')),children=[];
  t.after(async()=>{for(const {child,exited} of children){if(child.exitCode===null&&child.signalCode===null)child.kill();await exited;}rmSync(dir,{recursive:true,force:true});});
  const legacy=await published(cache,join(dir,'published'),text=>t.diagnostic(text));
  const current=await loadWasm(join(root,'packages/snapback4/src/wasm'));
  const run=(bin,args,input='',cwd=dir)=>spawnSync(bin,args,{cwd,input,encoding:'utf8',timeout:hangBudget()});
  assert.match(run(legacy.binary,['--version']).stdout,/snapback4 0\.2\.33/);
  function native(bin,path,backend,requests=[]) {
    const file=join(dir,'backend.json');if(backend)writeFileSync(file,JSON.stringify(backend));
    const result=run(bin,['device',path,...(backend?[file]:[])],requests.map(r=>JSON.stringify(r)+'\n').join(''));
    const replies=result.stdout.trim()?result.stdout.trim().split('\n').map(line=>JSON.parse(line)):[];
    // The CLI emits one opening reply, then one reply for every request.
    if(result.status===0)assert.equal(replies.length,requests.length+1,result.stdout+result.stderr);
    return {...result,replies};
  }
  async function start(bin,cwd,args=['dev','--no-watch','--port','0']) {
    const child=spawn(bin,args,{cwd,stdio:['ignore','pipe','pipe']}),exited=once(child,'exit');children.push({child,exited});
    let log='',stopped=false;for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{log+=d;});
    const assertAlive=()=>{assert.equal(child.exitCode,null,log);assert.equal(child.signalCode,null,log);};
    const url = await awaitState(() => { assertAlive(); return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, "capability server", { diagnostics: () => log });
    return {url,assertAlive,stop:async()=>{if(stopped)return;assertAlive();stopped=true;child.kill();await exited;}};
  }
  const request=async(server,path,body,auth={'x-snapback-persona':'alice'})=>{
    const r=await fetch(server.url+path,{method:body?'POST':'GET',headers:{...auth,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(hangBudget())});
    const text=await r.text();assert.equal(r.status,200,text);return {text,json:JSON.parse(text)};
  };
  async function app(name,source,seed=[],bin=binary) {
    const cwd=join(dir,name);mkdirSync(join(cwd,'snapback'),{recursive:true});writeFileSync(join(cwd,'snapback/schema.q'),source);
    const server=await start(bin,cwd);if(seed.length)await request(server,'/seed',seed);
    const backend=await request(server,'/schema'),page=await request(server,'/sync',{from:0,limit:10000,pending:[]});
    return {cwd,server,backend:backend.json,backendBytes:Buffer.from(backend.text),page:page.json};
  }
  return {dir,legacy,current,run,native,start,request,app};
}

for(const f of fixtures)test(`published 0.2.33 capability fence: ${f.name}`,{
  skip:fenceSkip,timeout:hangBudget(8),
},async t=>{
  const h=await harness(t),{dir,legacy,current,run,native,app}=h;
  const old=await app('prior',f.plain,f.seed);
  await old.server.stop();
  // F1a cannot activate a column on populated storage. Build generation 2
  // on an empty server store, retaining the real prior data for device adoption.
  if(f.freshStore) {
    const empty=await app('candidate',f.plain);await empty.server.stop();
  }
  const next=await app(f.freshStore?'candidate':'prior',f.source,f.freshStore?f.seed:[]);
  assert.equal(next.backend.generation,old.backend.generation+1);
  const apply={op:'apply',page:next.page,first:true,viewer:'dev:alice'};
  const entry={id:'offline-write',seq:1,op:f.op,viewer:'dev:alice',args:f.args,now:1000,new_ids:[],predicted:[],predictable:true};
  const admit={op:'admit',entry};
  // This assertion must fail when the fixture's capability derivation is removed:
  // it interrogates the published native device before inspecting the marker.
  const fresh=join(dir,'legacy-fresh.sqlite');
  const refused=native(legacy.binary,fresh,next.backend,[apply,admit]);
  assert.notEqual(refused.status,0,'published native device accepted unsupported backend');
  assert.match(refused.stderr+refused.stdout,unknown);
  t.diagnostic(`${f.name} initial native refusal: ${refused.stderr.trim()}`);
  assert.equal(refused.replies.length,0,'must not predict');assert.equal(existsSync(fresh),false,'decode before creating store');
  assert.throws(()=>new legacy.wasm(JSON.stringify(next.backend),'[]'),unknown);
  markers(next.backend.schema,f.capabilities??[f.name]);
  const unmarked=structuredClone(next.backend);
  for(const table of Object.values(unmarked.schema.tables))table.constraints=table.constraints.filter(c=>!c?.Capabilities);
  const unfenced=native(legacy.binary,join(dir,'unmarked.sqlite'),unmarked);
  assert.equal(unfenced.status,0,unfenced.stdout+unfenced.stderr);unfenced.replies.forEach(ok);
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
  noEffectKeys(priorPath);
  // A successful current open may migrate the old job bookkeeping columns.
  // It must not create the once-key table. Snapshot that opened store before
  // the separately requested adoption, which must not change any bytes.
  const currentOpen=native(binary,priorPath,null,[query]);
  assert.equal(currentOpen.status,0,currentOpen.stderr);sameAnswer(currentOpen.replies[1],priorAnswer);
  noEffectKeys(priorPath);const beforeBytes=readFileSync(priorPath);
  const denied=native(binary,priorPath,null,[{op:'adopt',backend:future},query]);
  assert.equal(denied.status,0,denied.stdout+denied.stderr);
  assert.equal(dump(priorPath),before,'current adoption refusal preserves the old store');
  noEffectKeys(priorPath);assert.deepEqual(readFileSync(priorPath),beforeBytes,'refused native adoption preserves every SQLite byte');
  assert.deepEqual(native(legacy.binary,priorPath,null,[query]).replies[1],priorAnswer);
  assert.equal(denied.replies[1].denied.code,'E_SCHEMA_CAPABILITY');sameAnswer(denied.replies[2],priorAnswer);
  const futurePath=join(dir,'future.sqlite'),futureInstall=native(binary,futurePath,future);
  assert.notEqual(futureInstall.status,0);assert.match(futureInstall.stdout+futureInstall.stderr,/E_SCHEMA_CAPABILITY/);
  assert.equal(existsSync(futurePath),false);
  for(const opening of [future,{initial_backend:future}]) {
    assert.throws(()=>new current(JSON.stringify(opening),'[]'),capabilityCode);
  }
  const futureKept=JSON.parse(kept).map(change=>change.s==='m'&&change.k==='device:backend'?{...change,v:JSON.stringify(future)}:change);
  assert.notEqual(JSON.stringify(futureKept),kept,'must replace kept backend');
  for(const opening of [undefined,JSON.stringify(old.backend),JSON.stringify({initial_backend:old.backend})]) {
    assert.throws(()=>new current(opening,JSON.stringify(futureKept)),capabilityCode);
  }
  const nativeDb=new DatabaseSync(currentPath);
  nativeDb.prepare('UPDATE _meta SET value=? WHERE key=?').run(JSON.stringify(future),'device:backend');nativeDb.close();
  const futureBefore=dump(currentPath);
  for(const opening of [null,old.backend,{initial_backend:old.backend}]) {
    const refused=native(binary,currentPath,opening,[query]);
    assert.notEqual(refused.status,0);assert.match(refused.stdout+refused.stderr,/E_SCHEMA_CAPABILITY/);
    assert.equal(refused.replies.length,1,'only the opening refusal, no query reply');
    assert.equal(refused.replies[0].denied.code,'E_SCHEMA_CAPABILITY');assert.equal(dump(currentPath),futureBefore,'refused reopening preserves every table');
  }
  const futureWeb=new current(undefined,priorKept);futureWeb.drain();
  const webDenial=JSON.parse(futureWeb.call(JSON.stringify({op:'adopt',backend:future})));
  assert.equal(webDenial.denied.code,'E_SCHEMA_CAPABILITY');assert.equal(futureWeb.drain(),'[]');
  sameAnswer(JSON.parse(futureWeb.call(JSON.stringify(query))),webAnswer);futureWeb.free();

  await next.server.stop();await old.server.stop();
  const store=join(next.cwd,'.snapback4/store.sqlite'),stored=dump(store);
  const doctor=run(legacy.binary,['doctor','--store',store],'',next.cwd);
  assert.notEqual(doctor.status,0);assert.match(doctor.stdout+doctor.stderr,storedUnknown);
  assert.equal(dump(store),stored);
  t.diagnostic(`${f.name} stored-engine refusal: ${doctor.stdout.trim()} ${doctor.stderr.trim()}`);
  const release=join(dir,'release');const deployed=run(binary,['deploy',release],'',next.cwd);assert.equal(deployed.status,0,deployed.stdout+deployed.stderr);
  // Keep source old-readable: the refusal must come from the persisted schema.
  const releaseSource=join(release,'releases/1/snapback/schema.q');
  writeFileSync(releaseSource,f.plain);assert.equal(readFileSync(releaseSource,'utf8'),f.plain);
  const releaseStore=join(release,'store.sqlite'),releaseBefore=dump(releaseStore);
  const served=run(legacy.binary,['serve',release,'--port','0'],'',next.cwd);
  assert.notEqual(served.status,0);assert.match(served.stdout+served.stderr,storedUnknown);
  assert.equal(dump(releaseStore),releaseBefore,'old serve did not write');
  writeFileSync(join(next.cwd,'snapback/schema.q'),f.plain);
  const beforeRun=dump(store);
  const wrote=run(legacy.binary,['run',f.op,JSON.stringify(f.args),'--as','alice'],'',next.cwd);
  assert.match(wrote.stdout+wrote.stderr,storedUnknown);
  assert.notEqual(wrote.status,0);assert.equal(dump(store),beforeRun,'old engine did not write');
  // New engine also refuses unknown capabilities when reopening persisted state.
  const db=new DatabaseSync(store);
  const storedSchema=JSON.parse(db.prepare('SELECT schema FROM _generations ORDER BY generation DESC LIMIT 1').get().schema);
  markers(storedSchema,f.capabilities??[f.name]);
  Object.values(storedSchema.tables).flatMap(t=>t.constraints).find(c=>c?.Capabilities).Capabilities.push('future-derivation');
  db.prepare('UPDATE _generations SET schema=? WHERE generation=(SELECT MAX(generation) FROM _generations)').run(JSON.stringify(storedSchema));
  db.exec('DROP TABLE IF EXISTS _effect_keys');db.close();
  noEffectKeys(store);const engineBeforeBytes=readFileSync(store);
  const unknownStored=dump(store),newDoctor=run(binary,['doctor','--store',store],'',next.cwd);
  assert.notEqual(newDoctor.status,0);assert.match(newDoctor.stdout+newDoctor.stderr,/E_SCHEMA_CAPABILITY/);assert.equal(dump(store),unknownStored);
  const newRun=run(binary,['run',f.op,JSON.stringify(f.args),'--as','alice'],'',next.cwd);
  assert.notEqual(newRun.status,0);assert.match(newRun.stdout+newRun.stderr,/E_SCHEMA_CAPABILITY/);assert.equal(dump(store),unknownStored);
  noEffectKeys(store);assert.deepEqual(readFileSync(store),engineBeforeBytes,'refused engine opening preserves every SQLite byte');
  const releaseDb=new DatabaseSync(releaseStore);
  releaseDb.prepare('UPDATE _generations SET schema=? WHERE generation=(SELECT MAX(generation) FROM _generations)').run(JSON.stringify(storedSchema));releaseDb.close();
  const unknownRelease=dump(releaseStore),newServe=run(binary,['serve',release,'--port','0'],'',next.cwd);
  assert.notEqual(newServe.status,0);assert.match(newServe.stdout+newServe.stderr,/E_SCHEMA_CAPABILITY/);assert.equal(dump(releaseStore),unknownRelease);
  t.diagnostic(`${f.name}: native+WASM initial/refusal, prediction, adoption/store preservation and reopen passed; old engine doctor/serve/write refusal passed`);
});

test('published 0.2.33 control: capability-free bytes and stores stay compatible',{
  skip:fenceSkip,timeout:hangBudget(9),
},async t=>{
  const {dir,legacy,current,run,native,app,start,request}=await harness(t);
  const control='use identity guests\n'+ordinary;
  const newApp=await app('new',control,fixtures[1].seed),oldApp=await app('old',control,fixtures[1].seed,legacy.binary);
  assert.ok(Buffer.isBuffer(newApp.backendBytes));assert.ok(Buffer.isBuffer(oldApp.backendBytes));
  markers(newApp.backend.schema,[]);
  const apply={op:'apply',page:newApp.page,first:true,viewer:'dev:alice'},query={op:'query',name:'posts',viewer:'dev:alice',args:{},now:1000};
  const path=join(dir,'control.sqlite'),result=native(legacy.binary,path,newApp.backend,[apply,query,{op:'adopt',backend:newApp.backend},query]);
  assert.equal(result.status,0,result.stderr);result.replies.forEach(ok);
  assert.equal(result.replies.length,5,'opening, apply, query, adopt, query');
  assert.deepEqual(result.replies[2],result.replies[4]);
  assert.ok(ok(result.replies[2]).data.length>0);assert.equal(ok(result.replies[2]).complete,true);
  const reopened=native(legacy.binary,path,null,[query]);assert.equal(reopened.status,0,reopened.stderr);
  assert.equal(reopened.replies.length,2);reopened.replies.forEach(ok);assert.deepEqual(reopened.replies[1],result.replies[2]);
  for(const Web of [legacy.wasm,current]) {
    const d=new Web(JSON.stringify(newApp.backend),'[]');
    const applied=JSON.parse(d.call(JSON.stringify(apply)));ok(applied);
    sameAnswer(applied,result.replies[1],'capability-free apply payload','apply');
    const answer=JSON.parse(d.call(JSON.stringify(query)));assert.ok(ok(answer).data.length);
    ok(JSON.parse(d.call(JSON.stringify({op:'adopt',backend:newApp.backend}))));
    assert.deepEqual(JSON.parse(d.call(JSON.stringify(query))),answer);
    const kept=d.drain();d.free();
    const reopened=new Web(undefined,kept);
    assert.deepEqual(JSON.parse(reopened.call(JSON.stringify(query))),answer);reopened.free();
  }
  t.diagnostic('capability-free 0.4 backend: published 0.2.33 native and WASM install, adopt, query and reopen passed');
  await newApp.server.stop();await oldApp.server.stop();
  const doctor=run(legacy.binary,['doctor','--store',join(newApp.cwd,'.snapback4/store.sqlite')],'',newApp.cwd);assert.equal(doctor.status,0,doctor.stderr);
  const release=join(dir,'control-release'),deployed=run(binary,['deploy',release],'',newApp.cwd);assert.equal(deployed.status,0,deployed.stderr);
  // Supervisor's 0.4 compatibility policy: a 0.4 release requires a 0.4
  // server. Selection facts/indexes/explanations may change the compiled
  // backend; old devices still accept capability-free backends. An older
  // server recompiles the source differently and must fail closed unchanged.
  // First serve with the matching server establishes the ordinary release
  // store link and proves the release works before testing the old server.
  const server=await start(binary,newApp.cwd,['serve',release,'--port','0']);
  const guest=await request(server,'/auth/guest',{},{});assert.ok(guest.json.session?.token);
  const reply=await request(server,'/q/posts',{args:{}},{authorization:`Bearer ${guest.json.session.token}`});
  assert.equal(reply.json.complete,true);assert.deepEqual(reply.json.data,[]);
  await server.stop();
  // SIGTERM leaves the successful server's WAL to recover. Checkpoint that
  // committed setup before comparing physical bytes across the refusal.
  const closedStore=new DatabaseSync(join(release,'store.sqlite'));
  try {assert.equal(closedStore.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy,0);} finally {closedStore.close();}
  const releaseBefore=files(release),storeBefore=readFileSync(join(release,'store.sqlite'));
  const served=run(legacy.binary,['serve',release,'--port','0'],'',newApp.cwd);
  assert.notEqual(served.status,0);
  assert.match(served.stdout+served.stderr,/E_GENERATION: release source differs from its activated backend; deploy the source as a new release/);
  assert.deepEqual(files(release),releaseBefore,'refused mixed-version serve preserves the release');
  assert.deepEqual(readFileSync(join(release,'store.sqlite')),storeBefore,'refused mixed-version serve preserves every SQLite byte');
  t.diagnostic('published 0.2.33 doctor passed; mixed-version serve refused E_GENERATION and preserved release/store bytes');
  // Pin the complete canonical 0.4 backend after the behavioral checks. This
  // fixture includes the new first-10 site spelling and selection explanation.
  const pinned=readFileSync(new URL('./fixtures/capability-free-0.4.backend.json',import.meta.url));
  assert.equal(pinned.length,2950);
  // /schema also reports the serving store's random identity (LLP 3000.007 §20.4),
  // which is not program content: pin the backend bytes without that last key.
  const schemaText=newApp.backendBytes.toString('utf8'),identity=/,"store_id":"[0-9a-f]{32}"}$/.exec(schemaText);
  assert.ok(identity,'/schema reports the serving store identity as its last key');
  assert.deepEqual(Buffer.from(schemaText.slice(0,identity.index)+'}'),pinned,'byte-for-byte canonical capability-free 0.4 backend');
  const {store_id:_servedStore,...backendProgram}=newApp.backend;
  assert.equal(JSON.stringify(backendProgram),pinned.toString());
  // Stored schema uses Rust's field order; /schema uses canonical key order.
  // Pin its exact change against the real 0.2.33 encoding, allowing only the
  // two documented diagnostic strings per read site, never structural drift.
  let expectedSchema=storedSchema(join(oldApp.cwd,'.snapback4/store.sqlite'));
  for(const table of ['likes','posts']) {
    expectedSchema=expectedSchema.replaceAll(`(${table}[])`,`(${table}[] first 10)`)
      .replaceAll(`scan ${table} by byId: held, no horizon`,`scan ${table} by byId: held, no horizon; selected byId (); result: page; explicit by`);
  }
  assert.equal(storedSchema(join(newApp.cwd,'.snapback4/store.sqlite')),expectedSchema,'byte-for-byte stored 0.4 generation schema');
  assert.deepEqual(JSON.parse(expectedSchema),JSON.parse(pinned).schema);
});

test('RV publication allowance is confined to commit evidence', () => {
  for(const op of ['apply','admit','settle']) sameAnswer({ok:null,preserved:['messages']},{ok:null},op,op);
  for(const op of ['apply','admit','settle']) {
    for(const reply of [{},{denied:{code:'E_RULE'}},{ok:null,denied:{code:'E_RULE'}}]) {
      assert.throws(()=>sameAnswer({...reply,preserved:[]},reply,'unsuccessful',op));
    }
    for(const preserved of [['x'.repeat(129)],['x'.repeat(1_000_000)],Array(257).fill('docs'),[null],'docs']) {
      assert.throws(()=>sameAnswer({ok:null,preserved},{ok:null},'unbounded',op));
    }
    sameAnswer({ok:null,preserved:Array(256).fill('x'.repeat(128))},{ok:null},'bounded',op);
  }
  for(const op of ['query','state','adopt','clear_rows']) assert.throws(()=>sameAnswer({ok:null,preserved:[]},{ok:null},op,op));
  assert.throws(()=>sameAnswer({ok:{data:[]},preserved:[]},{ok:{data:[]}}));
  assert.throws(()=>sameAnswer({ok:{changed:true},preserved:[]},{ok:null},'payload','settle'));
});
