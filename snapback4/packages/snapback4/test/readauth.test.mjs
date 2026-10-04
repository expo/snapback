import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
// Real SDK watches, actual wasm/memory and native/SQLite devices. No mocked interpreter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createLocalClient} from '../dist/local.js';
import {webDevice,memoryPersistence} from '../dist/web.js';
import {processDevice} from '../dist/native.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const binary=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
const wasm=readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url));
const fixture=name=>readFileSync(join(root,'crates/snapback4-device/tests/readauth',name),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,message) { return awaitState(f, message); }
async function oldReport(host,persist,name,dir) {
  // Both hosts load identical old-client rows and outbox records. Memory
  // rebuilds its indexes on load; SQLite persists the corresponding keys.
  const rows=[['report','moderator','old client','submit',{reader:'moderator'}],['own','dev:alice','old readable','legacyOwn',{}]];
  const changes=[];
  const db=host==='native-sqlite'?new DatabaseSync(join(dir,`${name}.sqlite`)):null;
  try {
    db?.exec('BEGIN');
    const number=n=>db.prepare('SELECT num FROM _catalog WHERE name=?').get(n).num;
    const key=(...ids)=>Buffer.concat(ids.map(id=>Buffer.concat([Buffer.from([6]),Buffer.from(id),Buffer.from([0,0])])));
    for(const [n,[id,reader,body,op,args]] of rows.entries()) {
      const image=JSON.stringify({Row:{id:{Id:id},writer:{Id:'dev:alice'},reader:{Id:reader},body:{String:body},pending:{Bool:true}}});
      const entry=JSON.stringify({id:`legacy-${id}`,seq:n+1,op,args,viewer:'dev:alice',now:100,predictable:true,new_ids:[],predicted:[`reports/${id}`]});
      if(!db)changes.push({s:'r',k:JSON.stringify(['reports',id]),v:image},{s:'b',k:JSON.stringify(['reports',id]),v:'null'},{s:'o',k:`legacy-${id}`,v:entry});
      else {
        db.prepare('INSERT INTO r(t,id,data) VALUES (?,?,?)').run(number('reports'),id,image);
        for(const [index,values] of [['byId',[id]],['byReader',[reader,id]]])db.prepare('INSERT INTO i(ti,k,id) VALUES (?,?,?)').run(number(`reports.${index}`),key(...values,id),id);
        db.prepare('INSERT INTO _device_base(t,id,data) VALUES (?,?,NULL)').run('reports',id);
        db.prepare('INSERT INTO _device_outbox(seq,id,entry) VALUES (?,?,?)').run(n+1,`legacy-${id}`,entry);
      }
    }
    db?.exec('COMMIT');
    if(!db)await persist.save(name,changes);
  } finally {db?.close();}
}
for(const host of ['wasm-memory','native-sqlite'])for(const mode of ['revocation','retained','upgrade','report','grant']) {
  test(`${host}: ${mode} filters every watched read`,{timeout:hangBudget(43)},async t=>{
    const directory=mkdtempSync(join(tmpdir(),'sb4-readauth-'));
    mkdirSync(join(directory,'snapback'));
    const reporting=mode==='upgrade'||mode==='report';
    let source=fixture(reporting?'reports.q':'authority.q');
    if(mode==='retained')source=fixture('retained.q');
    if(mode==='upgrade')source+="\nmutation legacyOwn():\n  insert reports { id: 'own', writer: viewer, reader: viewer, body: 'old readable' }\n";
    writeFileSync(join(directory,'snapback/schema.q'),'use personas alice\n'+source);
    const server=spawn(binary,['dev','--port','0','--memory','--no-watch','--hold-schedules'],{cwd:directory,stdio:['ignore','pipe','pipe']});
    const exited=once(server,'exit');let log='',url,client,core,name,offline=false;
    const watches=[];
    for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{log+=chunk;url??=log.match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0];});
    t.after(async()=>{for(const w of watches)w.close();await client?.close();if(server.exitCode==null&&server.signalCode==null)server.kill();await exited;rmSync(directory,{recursive:true,force:true});});
    await until(()=>{assert.equal(server.exitCode,null,log);return url;},'server startup');
    const post=async(path,body)=>{const r=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json','x-snapback-persona':'alice'},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
    if(mode==='retained'||mode==='grant') {
      const rows=[{table:'groups',row:{id:'group'}}];
      if(mode==='retained')rows.push({table:'seats',row:{id:'seat',groupId:'group',principal:'dev:alice'}},{table:'grants',row:{id:'grant',groupId:'group',principal:'dev:alice'}});
      assert.equal((await post('/seed',rows)).seeded,rows.length);
    }
    const persist=memoryPersistence(),dir=join(directory,'devices');
    const opener=host==='wasm-memory'?webDevice({wasm,persist}):processDevice({binary,dir});
    const options={url,persona:'alice',device:{open:async(...args)=>{name=args[0];core=await opener.open(...args);return core;}},fetch:async(input,init)=>{
      if(offline)throw new TypeError('offline witness');
      const path=new URL(input).pathname;
      if(path.startsWith('/m/'))return Response.json({denied:{code:'E_BUSY',family:'transport',message:'hold pending writes',retryable:true}});
      if(path==='/changes')return new Promise((_,reject)=>{if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
      return fetch(input,init);
    }};
    client=await createLocalClient(options);assert.equal(client.acquired,true);
    if(mode==='retained') {assert.equal((await post('/m/leave',{args:{}})).state,'sent');await client.sync();assert.equal((await core.call({op:'query',name:'grantRow',viewer:'dev:alice',args:{},now:Date.now()})).ok.data.id,'grant');assert.equal((await post('/q/grantRow',{args:{}})).data,null);}
    offline=true;
    if(mode==='upgrade') {await client.close();await oldReport(host,persist,name,dir);client=await createLocalClient(options);}
    const selectors=reporting?
      [['point',{id:'report'},null],['scan',{reader:'moderator'},[]],['merged',{},[]],['page',{reader:'moderator',c:null},[]],['total',{reader:'moderator'},0],['probe',{id:'report'},false]]:
      [['point',{},null],['scan',{},[]],['merged',{},[]],['page',{c:null},[]],['total',{},0],['probe',{},false],['ruleProbe',{},null]];
    for(const [op,args,empty] of selectors) {
      const watch=client.observe({kind:'query',name:op},args);watches.push(watch);watch.subscribe(()=>{});
      await until(()=>Object.hasOwn(watch.getSnapshot(),'data'),`watch ${op} never answered`);
    }
    const mutate=async(op,args={})=>{const result=await client.mutate({kind:'mutation',name:op},args);assert.equal(result.state,'pending',JSON.stringify(result));const queue=(await core.call({op:'queued'})).ok;assert.equal(queue.at(-1).predictable,true,JSON.stringify(queue));};
    const own={id:'own',writer:'dev:alice',reader:'dev:alice',body:'old readable',pending:true};
    const note={id:'note',groupId:'group',owner:'dev:alice',body:'private',pending:true};
    const check={id:'check',groupId:'group',pending:true};
    async function verify(visible) {
      for(let i=0;i<selectors.length;i++) {
        const [op,args,empty]=selectors[i];
        let data=empty,complete=true;
        if(reporting) {
          if(mode==='upgrade' && op==='merged')data=[own];
        } else if(op==='ruleProbe')data=check; // raw pending note witnesses it
        else if(visible)data=op==='point'?note:op==='probe'?true:op==='total'?1:[note];
        else if(mode==='retained')complete=false;
        // Unknown absence behind retained authority is a client placeholder.
        // Keep the raw device oracle to prove every read still filters the row.
        const placeholder=mode==='retained'&&!visible&&op!=='ruleProbe';
        const matches=r=>placeholder?isDeepStrictEqual(r,{loading:true}):r&&isDeepStrictEqual(r.data,data)&&r.complete===complete&&!r.error&&!r.refusal;
        await until(()=>matches(watches[i]?.getSnapshot()),`${op} watch mismatch: ${JSON.stringify(watches[i]?.getSnapshot())}; expected ${JSON.stringify(data)}/${complete}`);
        const result=await client.query({kind:'query',name:op},args);
        if(placeholder) {
          assert.equal(result.denied?.code,client.link()==='offline'?'E_OFFLINE':'E_QUERY_RETRY',op);
          const raw=(await core.call({op:'query',name:op,viewer:'dev:alice',args,now:Date.now()})).ok;
          assert.deepEqual(raw.data,data,`${op} raw authorization filter`);
          assert.equal(raw.complete,false);assert.equal(raw.unknown,true);
        } else {
          assert.deepEqual(result.data,data,op);assert.equal(result.complete,complete,op);
          assert.ok(!result.error&&!result.refusal,JSON.stringify(result));
        }
      }
      const queue=(await core.call({op:'queued'})).ok;
      assert.ok(queue.length>0 && queue.every(q=>q.predictable),JSON.stringify(queue));
      if(mode==='upgrade') {
        assert.deepEqual(queue.map(q=>q.id),['legacy-report','legacy-own']);
        assert.deepEqual(queue.map(q=>q.predicted),[['reports/report'],['reports/own']]);
        // Prove that the planted hidden row is a point AND scan candidate,
        // independently of Alice's deny verdict, after each load and replay.
        for(const [name,args] of [['point',{id:'report'}],['scan',{reader:'moderator'}]]) {
          const r=(await core.call({op:'query',name,viewer:'moderator',args,now:100})).ok;
          assert.equal((Array.isArray(r.data)?r.data[0]:r.data).id,'report');assert.equal(r.complete,true);
        }
        for(const [name,args,expected] of [['point',{id:'own'},own],['scan',{reader:'dev:alice'},[own]],['page',{reader:'dev:alice',c:null},[own]],['total',{reader:'dev:alice'},1],['probe',{id:'own'},true]]) {
          const r=await client.query({kind:'query',name},args);assert.deepEqual(r.data,expected);assert.equal(r.complete,true);
        }
      }
    }
    let visible=false;
    if(mode==='revocation') {
      await mutate('publish');await verify(true);
      await mutate('revoke');
    } else if(mode==='retained'||mode==='grant')await mutate('noteOnly');
    else if(mode==='report')await mutate('submit',{reader:'moderator'});
    await verify(false);
    if(mode==='grant') {await mutate('grant');visible=true;await verify(true);}
    for(const w of watches.splice(0))w.close();
    await client.close();client=await createLocalClient(options);
    for(const [op,args] of selectors){const w=client.observe({kind:'query',name:op},args);w.subscribe(()=>{});watches.push(w);}
    await verify(visible);
    // A nonempty delivered commit triggers replay; reopen offline to inspect
    // watches without a server fallback answering for the device.
    const before=(await core.call({op:'state'})).ok.watermark;
    assert.equal((await post('/m/tick',{args:{}})).state,'sent');
    offline=false;await client.sync();offline=true;
    assert.ok((await core.call({op:'state'})).ok.watermark>before);
    for(const w of watches.splice(0))w.close();await client.close();client=await createLocalClient(options);
    for(const [op,args] of selectors){const w=client.observe({kind:'query',name:op},args);w.subscribe(()=>{});watches.push(w);}
    await verify(visible);
    assert.ok((await core.call({op:'queued'})).ok.every(q=>q.predictable));
  });
}
