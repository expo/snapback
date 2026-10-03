import {readFileSync, writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const stats=xs=>{xs=xs.filter(Number.isFinite).sort((a,b)=>a-b);return {n:xs.length,p50:xs[Math.ceil(xs.length*.5)-1],p95:xs[Math.ceil(xs.length*.95)-1],max:xs.at(-1)};};
for(const path of process.argv.slice(2)) {
  const bytes=readFileSync(path), trace=JSON.parse(path.endsWith('.gz')?gunzipSync(bytes):bytes), measurements={};
  const add=(key,value)=>(measurements[key]??=[]).push(value);
  const spans=(events,start,end,filter,begin,finish)=>{
    const ends=new Map(events.filter(e=>e.stage===finish).map(e=>[e.id,e.at]));
    const intervals=events.filter(e=>e.stage===begin&&filter(e)&&ends.has(e.id))
      .map(e=>[Math.max(start,e.at),Math.min(end,ends.get(e.id))]).filter(([a,b])=>a<b).sort((a,b)=>a[0]-b[0]);
    let total=0,until=start;
    for(const [a,b] of intervals){total+=Math.max(0,b-Math.max(a,until));until=Math.max(until,b);}
    return total;
  };
  function window(prefix,events,start,end){
    for(const [label,predicate] of [['prediction',e=>e.op==='admit'],['decorations',e=>e.op==='query'&&e.name==='decorations'],['other_queries',e=>e.op==='query'&&e.name!=='decorations'],['other_vm',e=>!['query','admit'].includes(e.op)]])
      add(`${prefix}_${label}_cpu_ms`,spans(events,start,end,predicate,'wasm-start','wasm-end'));
    for(const kind of ['device','authority'])add(`${prefix}_${kind}_idb_elapsed_ms`,spans(events,start,end,e=>e.kind===kind,'idb-start','idb-end'));
    add(`${prefix}_facade_checks_elapsed_ms`,spans(events,start,end,()=>true,'facade-start','facade-end'));
    add(`${prefix}_authority_transactions`,events.filter(e=>e.stage==='idb-start'&&e.kind==='authority'&&e.at>=start&&e.at<end).length);
    add(`${prefix}_lock_queue_ms`,spans(events,start,end,()=>true,'lock-request','lock-acquired'));
  }
  for(const sample of trace.samples){
    const sender=sample.senderEvents,start=sender.find(e=>e.stage==='sender-call').at;
    const request=sender.find(e=>e.stage==='request'&&e.path==='/m/send'&&e.at>=start)?.at;
    window('send_to_request',sender,start,request);
    for(const view of sample.views){
      const events=view.events,apply=events.find(e=>e.stage==='device-end'&&e.op==='apply'&&e.watermark>=sample.commit.seq&&e.at>=sample.commit.at);
      const query=events.find(e=>e.stage==='device-end'&&e.op==='query'&&e.name==='history'&&e.at>=apply?.at);
      const raw=view.trial['raw-published'],published=view.trial.published;
      add('history_to_raw_ms',raw-query?.at);add('raw_to_public_ms',published-raw);
      window('history_to_public',events,query?.at,published);
    }
  }
  const summary=Object.fromEntries(Object.entries(measurements).map(([k,v])=>[k,stats(v)]));
  const output=path.replace(/\.json(?:\.gz)?$/,'-client.json');writeFileSync(output,JSON.stringify(summary,null,2));
  console.log(output,JSON.stringify(summary));
}
