export const quantile=xs=>{xs=xs.filter(Number.isFinite).sort((a,b)=>a-b);return {n:xs.length,p50:xs[Math.ceil(xs.length*.5)-1]??null,p95:xs[Math.ceil(xs.length*.95)-1]??null,max:xs.at(-1)??null};};
function spans(events,start,end,from,to,predicate=()=>true){
 const ends=new Map(events.filter(e=>e.stage===end).map(e=>[e.id,e.at]));
 const intervals=events.filter(e=>e.stage===start&&predicate(e)).map(e=>[Math.max(from,e.at),Math.min(to,ends.get(e.id)??e.at)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
 let total=0,last=from;for(const [a,b]of intervals){total+=Math.max(0,b-Math.max(a,last));last=Math.max(last,b);}return total;
}
export function stamps(s,v){
 const done=s.shape==='repost'?s.server.find(e=>e.stage==='delivery'&&e.kind==='delivery'&&e.done&&e.at>=s.commit.at):s.commit;
 const publication=s.server.find(e=>e.stage==='published'&&e.seq===(done?.seq??s.commit.seq));
 const e=v.events,c=s.commit.at,r=v.trial.render;
 const name=s.shape==='repost'?'home':s.shape==='message'?'history':'reactionRows';
 // The baseline wrapper already stamped HTTP query completion. Server fallback
 // does not return matching rows through DeviceCore.call; use the last completed
 // read of that operation before the matching observation, at/above this commit.
 const evaluation=v.trial.evaluated??e.findLast(x=>x.stage==='response'&&x.path==='/q/'+name&&x.seq>=s.commit.seq&&x.at<=v.trial.published)?.at;
 const notification=e.find(x=>x.stage==='response'&&x.path==='/changes'&&x.seq>=s.commit.seq);
 const deliveredNotice=e.find(x=>x.stage==='response'&&x.path==='/changes'&&x.seq>=(done?.seq??s.commit.seq));
 // The query/sync path can beat the long poll to this cut. Receipt is the
 // first decoded response proving it, independently of the wakeup channel.
 const received=e.find(x=>x.stage==='response'&&(
  ((x.path==='/changes'||x.path==='/q/'+name)&&x.seq>=(done?.seq??s.commit.seq))
  ||(x.path==='/sync'&&x.watermark>=(done?.seq??s.commit.seq))));
 const sync=e.find(x=>x.stage==='response'&&x.path==='/sync'&&x.watermark>=s.commit.seq);
 return {commit:c,delivery:done?.at??c,published:publication?.at,received:received?.at,notice:notification?.at,deliveredNotice:deliveredNotice?.at,sync:sync?.at,evaluation,observation:v.trial.published,render:r};
}
export function stages(s,v){
 const t=stamps(s,v),c=t.commit,r=t.render,e=v.events;
 return {commitToRender:r-c,commitToDelivery:t.delivery-c,commitToPublished:t.published-c,
  deliveryToRender:r-t.delivery,publishedToDeliveredNotice:t.deliveredNotice-t.published,commitToEvaluation:t.evaluation-c,
  publishedToReceived:t.received-t.published,commitToReceived:t.received-c,
  commitToNotice:t.notice-c,commitToSync:t.sync-c,noticeToEvaluation:t.evaluation-t.notice,
  evaluationToPublication:t.observation-t.evaluation,publicationToRender:r-t.observation,
  wasm:spans(e,'wasm-start','wasm-end',c,r),queryWasm:spans(e,'wasm-start','wasm-end',c,r,x=>x.op==='query'),
  idb:spans(e,'idb-start','idb-end',c,r),device:spans(e,'device-start','device-end',c,r),
  queueP95:v.inspection.latency.queueMs.p95,attemptP95:v.inspection.latency.attemptMs.p95};
}
export function summarize(data){
 const groups=new Map();for(const s of data.samples){const key=s.burners+':'+s.shape;if(!groups.has(key))groups.set(key,[]);for(const v of s.views)groups.get(key).push(v.stages??stages(s,v));}
 return {metadata:data.metadata,samples:data.samples.length,errors:data.errors,groups:Object.fromEntries([...groups].map(([key,rows])=>[key,Object.fromEntries(Object.keys(rows[0]).map(field=>[field,quantile(rows.map(r=>r[field]))]))]))};
}
