// Real SDK watches, actual wasm/memory and native/SQLite devices. No mocked interpreter.
import test from 'node:test';
import assert from 'node:assert/strict';
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
async function until(f,message) {
  for(let i=0;i<400;i++) {if(await f())return;await sleep(25);}
  assert.fail(message);
}
function oldReport(host,persist,name,dir) {
  // Old on-disk shape, built without invoking either predictor or replay.
  const image=JSON.stringify({Row:{id:{Id:'report'},writer:{Id:'dev:alice'},reader:{Id:'moderator'},body:{String:'old client'},pending:{Bool:true}}});
  const entry=JSON.stringify({id:'legacy',seq:1,op:'submit',args:{reader:'moderator'},viewer:'dev:alice',now:100,predictable:true,new_ids:[],predicted:['reports/report']});
  if(host==='wasm-memory')return persist.save(name,[{s:'r',k:'["reports","report"]',v:image},{s:'b',k:'["reports","report"]',v:'null'},{s:'o',k:'legacy',v:entry}]);
  const db=new DatabaseSync(join(dir,`${name}.sqlite`));
  try {
    const number=n=>db.prepare('SELECT num FROM _catalog WHERE name=?').get(n).num;
    // These fixture keys contain no NUL: Id's tag is 6 and its terminator 0,0.
    const key=(...ids)=>Buffer.concat(ids.map(id=>Buffer.concat([Buffer.from([6]),Buffer.from(id),Buffer.from([0,0])])));
    db.exec('BEGIN');
    db.prepare('INSERT INTO r(t,id,data) VALUES (?,?,?)').run(number('reports'),'report',image);
    for(const [index,values] of [['byId',['report']],['byReader',['moderator','report']]]) {
      db.prepare('INSERT INTO i(ti,k,id) VALUES (?,?,?)').run(number(`reports.${index}`),key(...values,'report'),'report');
    }
    db.prepare('INSERT INTO _device_base(t,id,data) VALUES (?,?,NULL)').run('reports','report');
    db.prepare('INSERT INTO _device_outbox(seq,id,entry) VALUES (1,?,?)').run('legacy',entry);
    db.exec('COMMIT');
  } finally {db.close();}
}
for(const host of ['wasm-memory','native-sqlite'])for(const mode of ['revocation','retained','upgrade','report','grant']) {
  test(`${host}: ${mode} filters every watched read`,{timeout:90000},async t=>{
    const directory=mkdtempSync(join(tmpdir(),'sb4-readauth-'));
    mkdirSync(join(directory,'snapback'));
    const reporting=mode==='upgrade'||mode==='report';
    let source=fixture(reporting?'reports.q':'authority.q');
    if(mode==='retained')source=source.replace('read <- .principal = viewer\n  insert','read <- exists seats[.groupId, viewer]\n  insert')
      .replace('  sync to .principal\ntable notes','  sync to seats[.groupId] by .principal\n  retain delivered-history\ntable notes')+'\nmutation leave():\n  delete seats[\'seat\']\n';
    writeFileSync(join(directory,'snapback/schema.q'),'use personas alice\n'+source);
    const server=spawn(binary,['dev','--port','0','--memory','--no-watch','--hold-schedules'],{cwd:directory,stdio:['ignore','pipe','pipe']});
    const exited=once(server,'exit');let log='',url,client,core,name,offline=false;
    const watches=[];
    for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{log+=chunk;url??=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];});
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
    if(mode==='revocation') {
      await mutate('publish');
      await until(()=>watches[0].getSnapshot().data?.id==='note','published note did not render');
      await mutate('revoke');
    } else if(mode==='retained'||mode==='grant')await mutate('noteOnly');
    else if(mode==='report')await mutate('submit',{reader:'moderator'});
    async function hidden() {
      for(let i=0;i<selectors.length;i++) {
        const [op,args,empty]=selectors[i];
        await until(()=>{const r=watches[i]?.getSnapshot();return r&&JSON.stringify(r.data)===JSON.stringify(empty)&&r.complete===false;},`${op} watch leaked or certified absence: ${JSON.stringify(watches[i]?.getSnapshot())}`);
        const result=await client.query({kind:'query',name:op},args);
        assert.deepEqual(result.data,empty,op);assert.equal(result.complete,false,op);
      }
    }
    await hidden();
    if(mode==='grant') {await mutate('grant');await until(()=>watches[0].getSnapshot().data?.id==='note','later grant did not refresh dependent watch');return;}
    for(const w of watches.splice(0))w.close();
    await client.close();client=await createLocalClient(options);
    for(const [op,args] of selectors){const w=client.observe({kind:'query',name:op},args);w.subscribe(()=>{});watches.push(w);}
    await hidden();
    // A nonempty delivered commit triggers replay; reopen offline to inspect
    // watches without a server fallback answering for the device.
    const before=(await core.call({op:'state'})).ok.watermark;
    assert.equal((await post('/m/tick',{args:{}})).state,'sent');
    offline=false;await client.sync();offline=true;
    assert.ok((await core.call({op:'state'})).ok.watermark>before);
    for(const w of watches.splice(0))w.close();await client.close();client=await createLocalClient(options);
    for(const [op,args] of selectors){const w=client.observe({kind:'query',name:op},args);w.subscribe(()=>{});watches.push(w);}
    await hidden();
    assert.ok((await core.call({op:'queued'})).ok.every(q=>q.predictable));
  });
}
