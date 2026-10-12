// @ref LLP 3000.007#20.24.1 — the actual web wasm device retries an interrupted reference predicate.
// @ref LLP 3000.007#20.24.7 — held groups reserve logical prefix probes on the web too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureStdout} from './helpers/server-output.mjs';
import {waitFor,hangBudget} from './helpers/wait.mjs';
import {createLocalClient} from '../dist/local.js';
import {webDevice,memoryPersistence} from '../dist/web.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const binary=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
const wasm=readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url));

test('wasm pages preserve predicate candidates and held-group logical meters', {timeout:hangBudget(48)}, async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sb4-page-cut-'));
  mkdirSync(join(dir,'snapback'));
  const fixture=name=>readFileSync(join(root,'crates/snapback4-device/tests/cut',name),'utf8');
  writeFileSync(join(dir,'snapback/schema.q'),'use personas alice\n'+fixture('predicates.q')+'\n'+fixture('groups.q'));
  const server=spawn(binary,['dev','--port','0','--memory','--no-watch','--hold-schedules'],{cwd:dir,stdio:['ignore','pipe','pipe']});
  const stdout=captureStdout(server),exited=once(server,'exit');
  let url,log='',client,core;
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{log+=chunk;url??=stdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0];});
  t.after(async()=>{await client?.close();if(server.exitCode===null&&server.signalCode===null)server.kill();await exited;rmSync(dir,{recursive:true,force:true});});
  await waitFor(()=>{assert.equal(server.exitCode,null,log);return url;},'server startup');
  const post=async(path,body)=>{const response=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json','x-snapback-persona':'alice'},body:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
  const seed=[{table:'metas',row:{id:'m1',ok:true}},
    ...[10,5].map((at,n)=>({table:'tasks',row:{id:`t${n+1}`,owner:'dev:alice',meta:'m1',at}})),
    {table:'access',row:{id:'a',bucket:1,principal:'dev:alice'}},
    ...[0,1,2].map(score=>({table:'items',row:{id:`r${score}`,bucket:1,score}}))];
  assert.equal((await post('/seed',seed)).seeded,seed.length);
  const opener=webDevice({wasm,persist:memoryPersistence()});
  client=await createLocalClient({url,persona:'alice',device:{open:async(...args)=>{core=await opener.open(...args);return core;}},fetch:async(input,init)=>{
    if(new URL(input).pathname==='/changes')return new Promise((_,reject)=>{if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
    return fetch(input,init);
  }});
  assert.equal(client.acquired,true);
  const query=async(name,c=null,spent={})=>{
    const result=await core.call({op:'query',name,viewer:'dev:alice',args:{c},now:100,spent:{examined:0,index_entries:0,rule_probes:0,steps:0,heap_bytes:0,output_bytes:0,rows_written:0,...spent}});
    assert.ok(result.ok,JSON.stringify(result));assert.equal(result.ok.unknown,false);return result.ok;
  };
  for(const [name,expected] of [['flagged',['t1','t2']],['ascending',['t2','t1']],['single',['t1','t2']]])for(const remaining of [1,2,3,4,5]){
    const first=await query(name,null,{examined:8192-remaining});
    const rows=first.data.map(r=>r.id);let next=first.next;
    for(let n=0;next&&n<4;n++) {const page=await query(name,next);rows.push(...page.data.map(r=>r.id));next=page.next;}
    assert.equal(next,null);assert.deepEqual(rows,expected,`${name}/${remaining}`);
  }
  const first=await query('flagged',null,{examined:8191});
  const repeat=await query('flagged',first.next,{examined:8191});
  assert.deepEqual(repeat.data,[]);assert.equal(repeat.complete,false);assert.equal(repeat.next,null);
  for(const [name,probes] of [['one',1],['two',2]]) {
    const page=await query(name);
    assert.equal(page.metered.rule_probes,probes);
    assert.deepEqual(page.data.map(r=>r.id),['r2']);
    const cut=await query(name,null,{rule_probes:8192});
    assert.equal(cut.metered.rule_probes,8193);assert.deepEqual(cut.data,[]);assert.equal(cut.complete,false);assert.equal(cut.cut,'meter');
  }
});
