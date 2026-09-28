// @ref LLP 3000.028#7.3 — the calibration builder, with only the declared interaction policy/body edits.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, appendFileSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {createClient, mintId} from '../../packages/snapback4/dist/client.js';
import {createLocalClient} from '../../packages/snapback4/dist/local.js';
import {processDevice} from '../../packages/snapback4/dist/native.js';
import {webDevice, memoryPersistence} from '../../packages/snapback4/dist/web.js';
import {login} from '../../packages/snapback4/dist/auth.js';

const sb4=resolve(import.meta.dirname,'../..'), work=join(import.meta.dirname,'.work/ok'), app=join(work,'app');
const out=join(sb4,'reports/20260928-ok-owner-key-coverage');
const binary=join(sb4,'target/debug/snapback4');
const original=readFileSync(join(import.meta.dirname,'builder.q'),'utf8');
export function ownerProgram(source) {
  return source.replace('sync public last 2000 by .at','sync public last 2000 by .at with own keys .principal')
    .replace('sync public last 1000 by .at\n\ntable follows','sync public last 1000 by .at with own keys .actor\n\ntable follows')
    .replace('view ownLikes: count likes by .principal, .post\n','').replace('view ownReposts: count reposts by .actor, .post\n','')
    .replaceAll('ownLikes[viewer, .id] > 0','exists likes[.id, viewer]').replaceAll('ownReposts[viewer, .id] > 0','exists reposts[viewer, .id]')
    .replaceAll('ownLikes[viewer, post] > 0','exists likes[post, viewer]').replaceAll('ownReposts[viewer, post] > 0','exists reposts[viewer, post]');
}
const source=ownerProgram(original)+`\nuse personas okowner, okempty, oknext
query okOther(post: posts, other: principal):
  return exists likes[post, other]
query okImage(post: posts):
  return likes[post, viewer]
query okCounts(post: posts):
  return posts[post] { likeCount, repostCount }
`;
mkdirSync(out,{recursive:true});writeFileSync(join(app,'snapback/schema.q'),source);
writeFileSync(join(out,'builder-owner.q'),source);
const db=new DatabaseSync(join(app,'.snapback4/store.sqlite'),{readOnly:true});
function rows(table) {
  const t=db.prepare('select num from _catalog where name=?').get(table).num;
  return db.prepare('select data from r where t=?').all(t).map(({data})=>Object.fromEntries(Object.entries(JSON.parse(data).Row).map(([k,v])=>[k,v && typeof v==='object'?Object.values(v)[0]:null])));
}
const profiles=rows('profiles'), likes=rows('likes'), reposts=rows('reposts'), posts=rows('posts');
const viewers=Object.fromEntries(['u0500','u0001'].map(handle=>[handle,profiles.find(p=>p.handle===handle).principal]));
const old=likes.toSorted((a,b)=>b.at-a.at).slice(2000);
const mine=old.find(r=>r.principal===viewers.u0500), other=old.find(r=>r.principal!==viewers.u0500);
assert.ok(mine && other,'full corpus includes old own and other keys');db.close();
writeFileSync(join(out,'census.json'),JSON.stringify({likes:likes.length,reposts:reposts.length,viewers:Object.fromEntries(Object.entries(viewers).map(([h,id])=>[h,{likes:likes.filter(r=>r.principal===id).length,reposts:reposts.filter(r=>r.actor===id).length}]))},null,2));
const q=name=>({kind:'query',name}),m=name=>({kind:'mutation',name});
const clients=[];let server,log='';
function record(stage,data){appendFileSync(join(out,'acceptance.jsonl'),JSON.stringify({stage,...data})+'\n');console.log(stage);}
async function until(fn,label,ms=180000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(20);}throw Error(label);}
async function sent(c,name,args){const w=await c.mutate(m(name),args);assert.equal(w.state,'sent',JSON.stringify(w));return w.result;}
function unavailable(r){assert.ok(r.loading || r.denied?.code==='E_OFFLINE',JSON.stringify(r));assert.equal(r.data,undefined);}
function known(r,want){assert.deepEqual(r.data,want,JSON.stringify(r));assert.equal(r.complete,true,JSON.stringify(r));}
function parked(signal){return new Promise((_,reject)=>{if(signal?.aborted)return reject(signal.reason);signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});});}
try {
  const adoption=performance.now();
  server=spawn(binary,['dev','--port','0','--no-watch','--replay'],{cwd:app,stdio:['ignore','pipe','pipe']});
  for(const s of [server.stdout,server.stderr])s.on('data',b=>{log+=b;appendFileSync(join(out,'server.log'),b);});
  const url=await until(()=>{assert.equal(server.exitCode,null,log.slice(-3000));return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];},'server adoption');
  record('adoption',{readyMs:performance.now()-adoption});
  const evidence='/home/ccheever/sb4-intent/rg-evidence/lane';
  async function auth(handle){
    const line=readFileSync(join(evidence,'instrument/fixtures/scale.log'),'utf8').split('\n').find(l=>l.includes(` ${handle} register `));
    const t=line.match(/"(?:[^"\\]|\\.)*"|\S+/g).map(v=>v.startsWith('"')?JSON.parse(v):v);
    const r=await login(url,t[3],t[4]);assert.ok(r.ok);return {session:r.session};
  }
  const scaleAuth=await auth('u0500');
  const owner=createClient({url,persona:'okowner'}),emptyOnline=createClient({url,persona:'okempty'});
  clients.push(owner,emptyOnline);
  for(const [client,handle] of [[owner,'okowner'],[emptyOnline,'okempty']])
    await sent(client,'saveProfile',{displayName:handle,handle,bio:'',location:'',link:null});
  const post=mintId();await sent(owner,'publish',{id:post,text:'Owner key lifecycle',parent:null,images:null,video:null});
  async function local(tier,name,credentials,options={}) {
    let offline=!!options.offline,core;const requests=[],applied=[],raw=[];
    const persist=options.persist??memoryPersistence();
    const opener=options.opener??(tier==='wasm'?webDevice({wasm:readFileSync(join(sb4,'packages/snapback4/src/wasm/snapback4_device_bg.wasm')),persist}):processDevice({binary,dir:join(work,'devices',name)}));
    let coldBytes=0,syncs=0,snapshotPages=0;
    const started=performance.now();
    const client=await createLocalClient({url,...credentials,storeName:name,waitSeconds:0,device:{async open(...args){core=await opener.open(...args);const current=core;return {close:()=>current.close(),async call(req){const r=await current.call(req);if(req.op==='query')raw.push(r);if(req.op==='apply')applied.push(req.page);return r;}};}},fetch:async(input,init)=>{
      if(offline)throw TypeError('owner coverage offline');
      const path=new URL(input).pathname;requests.push(path);
      if(path==='/changes')return parked(init?.signal);
      if(options.cut && path==='/sync' && syncs++>=options.cut)throw TypeError('crash before publication');
      const response=await fetch(input,init);
      if(path==='/sync'){const text=await response.clone().text();coldBytes+=Buffer.byteLength(text);if(JSON.parse(text).snapshot)snapshotPages++;}
      return response;
    }});clients.push(client);
    await client.sync();
    record('acquire',{tier,name,ms:performance.now()-started,wireBytes:coldBytes,snapshotPages,acquired:client.acquired,residency:await client.residency(),rss:process.memoryUsage().rss});
    return {client,persist,opener,requests,applied,raw,core:()=>core,
      async network(on){offline=!on;await client.sync();},
      async read(name,args){const start=requests.length;const read=await client.query(q(name),args);record(`${tier}:${name}`,{args,read,requests:requests.slice(start),raw:raw.at(-1)});return read;}};
  }
  for(const tier of ['process','wasm']) {
    const s=await local(tier,`${tier}-u0500`,scaleAuth);
    await s.network(false);
    known(await s.read('postState',{post}),{liked:false,reposted:false});
    assert.equal((await s.read('postState',{post:mine.post})).data?.liked,true);
    unavailable(await s.read('okOther',{post:other.post,other:other.principal}));assert.equal(s.raw.at(-1).ok.unknown,true);
    unavailable(await s.read('okImage',{post:mine.post}));
    assert.ok(!s.requests.slice(-3).some(p=>p.startsWith('/q/')));
    await s.client.close();
    const zero=await local(tier,`${tier}-empty`,{persona:'okempty'});
    await zero.network(false);known(await zero.read('postState',{post}),{liked:false,reposted:false});
    known(await zero.read('post',{id:post}),{...(await zero.client.query(q('post'),{id:post})).data,liked:false,reposted:false});
    await sent(emptyOnline,'setLike',{post,active:true});await sent(emptyOnline,'setRepost',{post,active:true});
    await zero.network(true);await zero.network(false);known(await zero.read('postState',{post}),{liked:true,reposted:true});
    await sent(emptyOnline,'setLike',{post,active:false});await sent(emptyOnline,'setRepost',{post,active:false});
    const stale=await zero.read('postState',{post});known(stale,{liked:true,reposted:true});assert.equal(stale.fresh,false);
    await zero.network(true);await zero.network(false);known(await zero.read('postState',{post}),{liked:false,reposted:false});
    await sent(emptyOnline,'setLike',{post,active:true});await sent(emptyOnline,'setRepost',{post,active:true});
    await zero.network(true);await zero.network(false);known(await zero.read('postState',{post}),{liked:true,reposted:true});
    const predicted=await zero.client.mutate(m('setLike'),{post,active:false});assert.equal(predicted.state,'pending');
    const pending=await zero.client.pendingWrites();assert.ok(pending.some(w=>w.op==='setLike'&&w.predicted.length>0));
    assert.equal((await zero.client.write(predicted.id)).state,'pending');
    const predictedRead=await zero.read('postState',{post});assert.ok(predictedRead.loading || predictedRead.data?.liked===false);
    const unpredictedPost=posts.find(p=>p.id!==post && !likes.some(l=>l.post===p.id&&l.principal==='dev:okempty')).id;
    const unpredicted=await zero.client.mutate(m('setLike'),{post:unpredictedPost,active:true});assert.equal(unpredicted.state,'pending');
    const intents=await zero.client.pendingWrites();assert.ok(intents.some(w=>w.op==='setLike'&&w.predicted.length===0));record(`${tier}:pending`,{intents});
    assert.equal((await zero.client.write(unpredicted.id)).state,'pending');
    const unsettled=await zero.read('postState',{post:unpredictedPost});
    assert.ok(unsettled.loading || unsettled.denied || unsettled.data?.liked===false,'unpredicted insert never fabricates a present settled key');
    await zero.client.signOut();assert.equal(zero.client.viewer(),null);
    // Same device directory/persistence, new principal, stopped before its first acquisition.
    const next=await local(tier,`${tier}-empty`,{persona:'oknext'},{opener:zero.opener,persist:zero.persist,cut:1});
    await next.network(false);assert.equal(next.client.acquired,false);unavailable(await next.read('postState',{post}));
    await next.client.close();
    const resumed=await local(tier,`${tier}-empty`,{persona:'oknext'},{opener:zero.opener,persist:zero.persist});
    await resumed.network(false);known(await resumed.read('postState',{post}),{liked:false,reposted:false});await resumed.client.close();
    known(await owner.query(q('okCounts'),{post}),{likeCount:1,repostCount:1});
    await sent(emptyOnline,'setLike',{post,active:false});await sent(emptyOnline,'setRepost',{post,active:false});
    record(`${tier}:passed`,{pass:true});
  }
  // Hub cold acquisition is measured separately from the sparse u0500 viewer.
  const hub=await local('process','process-u0001',await auth('u0001'));await hub.client.close();
  record('finished',{pass:true});
} catch(error){record('failure',{message:error.stack});process.exitCode=1;}
finally {for(const c of clients.reverse())await c.close().catch(()=>{});if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}}
