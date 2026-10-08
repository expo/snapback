import { signalChild, spawnTracked as spawn } from '../../../../scripts/test-signals.mjs';
import { captureStdout } from './server-output.mjs';
import { hangBudget, waitFor as awaitState } from './wait.mjs';
// Revision 7: the original historical-image counterexample, driven through
// the production SDK on both device stores, is a positive recovery regression.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, mkdir, copyFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalClient} from '../../dist/local.js';
import {memoryPersistence, webDevice} from '../../dist/web.js';
import {processDevice} from '../../dist/native.js';

async function until(check, message) { return awaitState(check, message); }
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
  const root=fileURLToPath(new URL('../../../../',import.meta.url));
  const binary=resolve(process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4'));
  const directory=await mkdtemp(join(tmpdir(),'sb4-f3b-delivery-'));
  await mkdir(join(directory,'snapback'));
  await copyFile(new URL('./timeline-recovery.q',import.meta.url),join(directory,'snapback/schema.q'));
  const server=spawn(binary,['dev','--port','0','--fresh','--no-watch'],{cwd:directory,stdio:['ignore','pipe','pipe']});
  const readStdout = captureStdout(server);
  const exited=once(server,'exit');
  let log='',url;
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{log+=chunk;url??=readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0];});
  const devices=[];
  try {
    await until(()=>{assert.equal(server.exitCode,null,log);return url;},'server startup');
    const request=async(path,body)=>{
      const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'x-snapback-persona':'author','content-type':'application/json'},signal:AbortSignal.timeout(hangBudget()),...(body===undefined?{}:{body:JSON.stringify(body)})});
      const text=await response.text();assert.equal(response.status,200,text);return {data:JSON.parse(text),bytes:Buffer.byteLength(text)};
    };
    const mutate=async(op,args={})=>{const {data}=await request('/m/'+op,{args});assert.equal(data.state,'sent',JSON.stringify(data));return data;};
    await mutate('register');
    const {data:backend}=await request('/schema');
    const wasm=readFileSync(new URL('../../src/wasm/snapback4_device_bg.wasm',import.meta.url));
    const query={kind:'query',name:'following'};
    for(const host of ['wasm-memory','native-sqlite']) {
      const opener=host==='wasm-memory'?webDevice({wasm,persist:memoryPersistence()}):processDevice({binary,dir:join(directory,'device')});
      const f={host,offline:false,holdWrites:true,pages:[],heldSubmissions:0,core:null,client:null};
      devices.push(f);
      f.options={url,persona:'author',device:{open:async(...args)=>{
        f.core=await opener.open(...args);return f.core;
      }},fetch:async(input,init)=>{
        if(f.offline)throw new TypeError('offline witness');
        const path=new URL(input).pathname;
        if(path==='/changes')return parkedChanges(init.signal);
        // Delay mutation submission independently of reads. A retryable transport
        // response leaves the SDK's durable outbox live throughout reacquisition.
        if(f.holdWrites&&path.startsWith('/m/')) { f.heldSubmissions++; return Response.json({denied:{code:'E_BUSY',family:'transport',message:'submission held by witness',retryable:true}}); }
        const response=await fetch(input,init);
        if(path==='/sync') {
          const page=await response.clone().json();
          f.pages.push({request:JSON.parse(init.body),denied:page.denied?.code,snapshot:page.snapshot,watermark:page.watermark});
        }
        return response;
      }};
      f.client=await createLocalClient(f.options);
      assert.equal(f.client.acquired,true);
      f.before=(await f.core.call({op:'state'})).ok.watermark;
      assert.deepEqual((await f.client.query(query,{})).data,[]);
      f.offline=true;
      f.write=await f.client.mutate({kind:'mutation',name:'post'},{postId:'pending-'+host});
      assert.equal(f.write.state,'pending');
      f.queued=(await f.core.call({op:'queued'})).ok;
      assert.equal(f.queued.length,1);
      assert.equal(f.queued[0].predictable,true);
      assert.equal(f.queued[0].op,'post');
      assert.deepEqual(f.queued[0].args,{postId:'pending-'+host});
      const own=createHash('sha256').update(JSON.stringify([{String:'snapback4.timeline.v1'},{String:'feed'},{String:'Feed'},{Id:f.queued[0].viewer},{Id:'pending-'+host},'Null'])).digest('hex');
      assert.deepEqual(f.queued[0].predicted.toSorted(),['posts/pending-'+host,'feedPosts/pending-'+host,'feedFeed/'+own].toSorted());
      assert.equal((await f.client.query(query,{})).data.length,1);
      f.pages.length=0;
    }
    const before=devices[0].before;
    const published=await mutate('publish');
    const first=await request('/sync',{from:before,stream:true,limit:1,pending:[]});
    assert.equal(first.data.denied,undefined);
    assert.equal(first.data.events.length,1024);
    const noteIds=first.data.events.filter(e=>e.table==='notes').map(e=>e.id);
    assert.equal(noteIds.length,1020);
    let watermark=published.seq,largestUpdateBytes=0,historicalCommitMinimumBytes=0;
    for(const noteId of noteIds) {
      const grown=await mutate('grow',{noteId,body:'\n'.repeat(9000)});
      const page=await request('/sync',{from:grown.seq-1,stream:true,limit:1,pending:[]});
      assert.equal(page.data.denied,undefined);assert.equal(page.data.events.length,1);
      largestUpdateBytes=Math.max(largestUpdateBytes,page.bytes);watermark=grown.seq;
      assert.equal(page.data.events[0].id,noteId);
      historicalCommitMinimumBytes+=Buffer.byteLength(JSON.stringify(page.data.events[0].data));
    }
    assert.ok(historicalCommitMinimumBytes>(16<<20));
    const catchup=await request('/sync',{from:before,stream:true,limit:1,pending:[]});
    assert.equal(catchup.data.denied?.code,'E_BOUND');assert.equal(catchup.data.snapshot,true);
    assert.equal(catchup.data.generation,backend.generation);
    const online=(await request('/q/following',{args:{}})).data;
    assert.equal(online.data.length,1);
    const observed=[];
    const localQuery=async(f,name,args={})=>{
      const answer=await f.core.call({op:'query',name,viewer:f.queued[0].viewer,args,now:Date.now()});
      assert.equal(answer.denied,undefined,JSON.stringify(answer.denied));
      assert.equal(answer.ok.denied,undefined,JSON.stringify(answer.ok.denied));
      assert.equal(answer.ok.complete,true);
      return answer.ok;
    };
    const checkNotes=async f=>{
      const seen=new Set();let c=null;
      do {
        const page=await localQuery(f,'noteRows',{c});
        for(const row of page.data) {
          assert.ok(!seen.has(row.id));seen.add(row.id);
          assert.equal(row.owner,f.queued[0].viewer);assert.equal(row.body,'\n'.repeat(9000));
          assert.ok(row.pending===undefined || row.pending===false);
        }
        c=page.next;
      } while(c);
      assert.deepEqual([...seen].sort(),noteIds.toSorted());
      return seen.size;
    };
    const checkCopies=async(f,pending)=>{
      const copies=(await localQuery(f,'ownCopies')).data;
      const expected=pending?['original','pending-'+f.host]:['original',...devices.map(d=>'pending-'+d.host)];
      assert.deepEqual(copies.map(r=>r.eventId).sort(),expected.sort());
      for(const row of copies) {
        assert.equal(row.readerId,f.queued[0].viewer);
        if(pending && row.eventId==='pending-'+f.host)assert.equal(row.pending,true);
        else assert.ok(row.pending===undefined || row.pending===false);
      }
    };
    for(const f of devices) {
      assert.equal((await f.core.call({op:'state'})).ok.watermark,before);
      f.offline=false;await f.client.sync();
      const terminal=f.pages.findIndex(p=>p.denied==='E_BOUND'&&p.request.limit===1);
      assert.ok(terminal>=0,'SDK reached the indivisible commit at limit 1');
      assert.equal(f.pages[terminal].snapshot,true);
      assert.equal(f.pages[terminal+1].request.from,0,'SDK restarted snapshot acquisition');
      assert.equal(f.pages[terminal+1].snapshot,true);
      assert.equal(f.pages[terminal+1].denied,undefined);
      await until(()=>f.heldSubmissions>0,'SDK did not attempt the held submission after reacquisition');
      // Reopen the same persisted device while offline, before accepting its
      // outbox and recovered images as durable evidence.
      f.offline=true;await f.client.close();
      f.client=await createLocalClient(f.options);
      f.offline=false;
      const state=(await f.core.call({op:'state'})).ok;
      assert.equal(state.watermark,watermark);assert.equal(state.generation,backend.generation);
      assert.equal(f.client.acquired,true);
      const queued=(await f.core.call({op:'queued'})).ok;
      assert.deepEqual(queued.map(q=>[q.id,q.args,q.new_ids,q.predicted]),f.queued.map(q=>[q.id,q.args,q.new_ids,q.predicted]),'pending identity, arguments and predicted rows survived snapshot restart');
      const local=await f.client.query(query,{});
      assert.equal(local.complete,true);
      assert.deepEqual(local.data.map(r=>r.postId).sort(),['original','pending-'+f.host].sort());
      for(const row of local.data) {
        if(row.postId==='original')assert.ok(row.pending===undefined || row.pending===false);
        else assert.equal(row.pending,true);
      }
      const committed=local.data.filter(r=>r.postId==='original').map(({pending,...r})=>r);
      assert.deepEqual(committed,online.data);
      assert.equal(local.data.filter(r=>r.postId==='pending-'+f.host).length,1);
      assert.ok(f.heldSubmissions>0,'SDK attempted submission and received retryable E_BUSY');
      const recoveredNotes=await checkNotes(f);await checkCopies(f,true);
      observed.push({host:f.host,generation:state.generation,recoveredNotes,heldSubmissions:f.heldSubmissions,before,after:state.watermark,following:committed.length,pendingBefore:f.queued,pendingAfter:queued,restartLimit:f.pages[terminal].request.limit,restartFrom:f.pages[terminal+1].request.from,restartSnapshot:f.pages[terminal+1].snapshot});
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
      const local=await f.client.query(query,{});
      assert.equal(local.complete,true);
      assert.deepEqual(local.data,final.data);
      const observation=observed.find(o=>o.host===f.host);
      observation.finalFollowing=local.data;
      observation.settledNotes=await checkNotes(f);await checkCopies(f,false);
      assert.deepEqual((await f.core.call({op:'queued'})).ok,[]);
    }
    return {historicalCommitMinimumBytes,serverFollowing:final.data,originalCommitBytes:first.bytes,originalCommitEvents:first.data.events.length,largestUpdateBytes,ceiling:16<<20,sameGeneration:observed.every(d=>d.generation===backend.generation),devices:observed,settledFollowing:final.data.length};
  } finally {
    for(const f of devices)await f.client?.close();
    if(server.exitCode==null&&server.signalCode==null)await signalChild(server, 'SIGTERM');
    await exited;await rm(directory,{recursive:true,force:true});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await recoverTimeline(),null,2));
