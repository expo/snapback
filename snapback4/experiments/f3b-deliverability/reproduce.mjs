// Revision 7: the original historical-image counterexample, driven through
// the production SDK on both device stores, is a positive recovery regression.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, copyFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalClient} from '../../packages/snapback4/dist/local.js';
import {memoryPersistence, webDevice} from '../../packages/snapback4/dist/web.js';
import {processDevice} from '../../packages/snapback4/dist/native.js';

async function until(check, message) {
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) { if(await check())return; await new Promise(r=>setTimeout(r,20)); }
  assert.fail(message);
}
function parkedChanges(signal) {
  let cleanup;
  return new Response(new ReadableStream({
    start(controller) {
      const beat=()=>controller.enqueue(new Uint8Array([32,10]));
      const timer=setInterval(beat,500);
      const abort=()=>{cleanup();controller.error(signal.reason);};
      cleanup=()=>{clearInterval(timer);signal.removeEventListener('abort',abort);};
      if(signal.aborted)abort();else {signal.addEventListener('abort',abort,{once:true});beat();}
    }, cancel(){cleanup();},
  }));
}
export async function recoverTimeline() {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const binary=resolve(process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4'));
  const directory=await mkdtemp(join(tmpdir(),'sb4-f3b-delivery-'));
  await mkdir(join(directory,'snapback'));
  await copyFile(new URL('./schema.q',import.meta.url),join(directory,'snapback/schema.q'));
  const server=spawn(binary,['dev','--port','0','--fresh','--no-watch'],{cwd:directory,stdio:['ignore','pipe','pipe']});
  const exited=once(server,'exit');
  let log='',url;
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{log+=chunk;url??=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];});
  const devices=[];
  try {
    await until(()=>{assert.equal(server.exitCode,null,log);return url;},'server startup');
    const request=async(path,body)=>{
      const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'x-snapback-persona':'author','content-type':'application/json'},signal:AbortSignal.timeout(30000),...(body===undefined?{}:{body:JSON.stringify(body)})});
      const text=await response.text();assert.equal(response.status,200,text);return {data:JSON.parse(text),bytes:Buffer.byteLength(text)};
    };
    const mutate=async(op,args={})=>{const {data}=await request('/m/'+op,{args});assert.equal(data.state,'sent',JSON.stringify(data));return data;};
    await mutate('register');
    const {data:backend}=await request('/schema');
    const wasm=readFileSync(new URL('../../packages/snapback4/src/wasm/snapback4_device_bg.wasm',import.meta.url));
    const query={kind:'query',name:'following'};
    for(const host of ['wasm-memory','native-sqlite']) {
      const opener=host==='wasm-memory'?webDevice({wasm,persist:memoryPersistence()}):processDevice({binary,dir:join(directory,'device')});
      const f={host,offline:false,holdWrites:true,pages:[],core:null,client:null};
      devices.push(f);
      f.client=await createLocalClient({url,persona:'author',device:{open:async(...args)=>{
        f.core=await opener.open(...args);return f.core;
      }},fetch:async(input,init)=>{
        if(f.offline)throw new TypeError('offline witness');
        const path=new URL(input).pathname;
        if(path==='/changes')return parkedChanges(init.signal);
        // Delay mutation submission independently of reads. A retryable transport
        // response leaves the SDK's durable outbox live throughout reacquisition.
        if(f.holdWrites&&path.startsWith('/m/'))return Response.json({denied:{code:'E_BUSY',family:'transport',message:'submission held by witness',retryable:true}});
        const response=await fetch(input,init);
        if(path==='/sync') {
          const page=await response.clone().json();
          f.pages.push({request:JSON.parse(init.body),denied:page.denied?.code,snapshot:page.snapshot,watermark:page.watermark});
        }
        return response;
      }});
      assert.equal(f.client.acquired,true);
      f.before=(await f.core.call({op:'state'})).ok.watermark;
      assert.deepEqual((await f.client.query(query,{})).data,[]);
      f.offline=true;
      f.write=await f.client.mutate({kind:'mutation',name:'post'},{postId:'pending-'+host});
      assert.equal(f.write.state,'pending');
      f.queued=(await f.core.call({op:'queued'})).ok;
      assert.equal(f.queued.length,1);
      assert.equal(f.queued[0].predictable,true);
      assert.equal(f.queued[0].predicted.length,3);
      assert.equal((await f.client.query(query,{})).data.length,1);
      f.pages.length=0;
    }
    const before=devices[0].before;
    const published=await mutate('publish');
    const first=await request('/sync',{from:before,stream:true,limit:1,pending:[]});
    assert.equal(first.data.denied,undefined);
    assert.equal(first.data.events.length,1024);
    const noteIds=first.data.events.filter(e=>e.table==='notes').map(e=>e.id);
    assert.equal(noteIds.length,1021);
    let watermark=published.seq,largestUpdateBytes=0;
    for(const noteId of noteIds) {
      const grown=await mutate('grow',{noteId,body:'\n'.repeat(9000)});
      const page=await request('/sync',{from:watermark,stream:true,limit:1,pending:[]});
      assert.equal(page.data.denied,undefined);assert.equal(page.data.events.length,1);
      largestUpdateBytes=Math.max(largestUpdateBytes,page.bytes);watermark=grown.seq;
    }
    const catchup=await request('/sync',{from:before,stream:true,limit:1,pending:[]});
    assert.equal(catchup.data.denied?.code,'E_BOUND');assert.equal(catchup.data.snapshot,true);
    assert.equal(catchup.data.generation,backend.generation);
    const online=(await request('/q/following',{args:{}})).data;
    assert.equal(online.data.length,1);
    const observed=[];
    for(const f of devices) {
      assert.equal((await f.core.call({op:'state'})).ok.watermark,before);
      f.offline=false;await f.client.sync();
      const terminal=f.pages.findIndex(p=>p.denied==='E_BOUND'&&p.request.limit===1);
      assert.ok(terminal>=0,'SDK reached the indivisible commit at limit 1');
      assert.equal(f.pages[terminal].snapshot,true);
      assert.equal(f.pages[terminal+1].request.from,0,'SDK restarted snapshot acquisition');
      assert.equal(f.pages[terminal+1].snapshot,true);
      const state=(await f.core.call({op:'state'})).ok;
      assert.equal(state.watermark,watermark);assert.equal(state.generation,backend.generation);
      assert.equal(f.client.acquired,true);
      const queued=(await f.core.call({op:'queued'})).ok;
      assert.deepEqual(queued.map(q=>[q.id,q.args,q.new_ids,q.predicted]),f.queued.map(q=>[q.id,q.args,q.new_ids,q.predicted]),'pending identity, arguments and predicted rows survived snapshot restart');
      const local=await f.client.query(query,{});
      assert.equal(local.complete,true);
      const committed=local.data.filter(r=>r.postId==='original').map(({pending,...r})=>r);
      assert.deepEqual(committed,online.data);
      assert.equal(local.data.filter(r=>r.postId==='pending-'+f.host).length,1);
      observed.push({host:f.host,before,after:state.watermark,following:committed.length,pending:queued.length,restarted:true});
    }
    // Release the retained writes and observe their ordinary receipts and exact
    // final page; the restart must neither duplicate nor orphan derived rows.
    for(const f of devices)f.holdWrites=false;
    await until(async()=>{
      await Promise.all(devices.map(f=>f.client.sync()));
      return (await Promise.all(devices.map(f=>f.client.write(f.write.id)))).every(w=>w.state==='sent');
    },'pending timeline posts did not settle');
    const final=(await request('/q/following',{args:{}})).data;
    assert.equal(final.data.length,3);
    for(const f of devices) {
      await f.client.sync();
      assert.deepEqual((await f.client.query(query,{})).data,final.data);
      assert.deepEqual((await f.core.call({op:'queued'})).ok,[]);
    }
    return {originalCommitBytes:first.bytes,originalCommitEvents:1024,largestUpdateBytes,ceiling:16<<20,sameGeneration:true,devices:observed,settledFollowing:final.data.length};
  } finally {
    for(const f of devices)await f.client?.close();
    if(server.exitCode==null&&server.signalCode==null)server.kill('SIGTERM');
    await exited;await rm(directory,{recursive:true,force:true});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await recoverTimeline(),null,2));
