import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const stats=xs=>{xs=xs.filter(Number.isFinite).sort((a,b)=>a-b);return {n:xs.length,p50:xs[Math.ceil(xs.length*.5)-1],p95:xs[Math.ceil(xs.length*.95)-1],max:xs.at(-1)};};
for(const path of process.argv.slice(2)){
 const bytes=readFileSync(path),j=JSON.parse(path.endsWith('.gz')?gunzipSync(bytes):bytes);
 const all={},samples=[];
 const senderEvents=j.allEvents?.[0];
 const add=(key,x)=>{(all[key]??=[]).push(x);};
 const counts=(j.serverEvents??[]).filter(x=>x.startsWith('BG_COUNTS ')).map(x=>{const [,at,ms,rows,members]=x.split(' ');return {at:+at,ms:+ms,rows:+rows,members:+members};});
 for(const s of j.samples){
  const start=s.senderEvents.find(e=>e.stage==='sender-call').at,c=s.commit.at;
  add('send_commit_ms',c-start);
  const sendRequest=s.senderEvents.find(e=>e.stage==='request'&&e.path==='/m/send'&&e.at>=start);
  add('send_request_ms',sendRequest?.at-start);add('request_commit_ms',c-sendRequest?.at);
  const senderNotification=(senderEvents??s.senderEvents).find(e=>e.stage==='response'&&e.path==='/changes'&&e.seq>=s.commit.seq&&e.at>=c);
  const views=s.views.map((v,index)=>{
   const end=v.trial.reactCommit,ev=v.events;
   const response=ev.find(e=>e.stage==='response'&&e.path==='/sync'&&e.watermark>=s.commit.seq&&e.at>=c);
   const apply=ev.find(e=>e.stage==='device-end'&&e.op==='apply'&&e.watermark>=s.commit.seq&&e.at>=c);
   const query=ev.find(e=>e.stage==='device-end'&&e.op==='query'&&e.name==='history'&&e.at>=apply?.at);
   // A sync already in flight can publish before the next poll completes.
   // The continuous trace captures that later notification without gaps.
   const change=(j.allEvents?.[index+1]??ev).find(e=>e.stage==='response'&&e.path==='/changes'&&e.seq>=s.commit.seq&&e.at>=c);
   const sync=ev.find(e=>e.stage==='request'&&e.id===response?.id);
   const applyStart=ev.find(e=>e.stage==='device-start'&&e.id===apply?.id);
   const queryStart=ev.find(e=>e.stage==='device-start'&&e.id===query?.id);
   const decoration=ev.find(e=>e.stage==='device-end'&&e.op==='query'&&e.name==='decorations'&&e.at>=apply?.at);
   const decorationStart=ev.find(e=>e.stage==='device-start'&&e.id===decoration?.id);
   const finished=counts.filter(x=>x.at>= (sync?.at??c)&&x.at<=response?.at&&x.rows>=10000);
   const stage={
    commit_notify_ms:change?.at-c,notify_sync_request_ms:sync?.at-change?.at,
    sync_http_ms:response?.at-sync?.at,sync_bytes:response?.bytes,
    live_count_ms:finished.length?Math.max(...finished.map(x=>x.ms)):undefined,
    live_count_rows:finished.length?Math.max(...finished.map(x=>x.rows)):undefined,
    response_apply_start_ms:applyStart?.at-response?.at,apply_ms:apply?.at-applyStart?.at,
    apply_query_ms:query?.at-apply?.at,history_query_call_ms:query?.at-queryStart?.at,
    history_examined:query?.metered?.examined,history_window:query?.rows,
    decoration_query_call_ms:decoration?.at-decorationStart?.at,decoration_examined:decoration?.metered?.examined,
    query_publication_ms:v.trial.published-query?.at,publication_react_ms:end-v.trial.published,
    send_render_ms:end-start,
    query_evaluations:ev.filter(e=>e.stage==='device-end'&&e.op==='query'&&e.at>=c&&e.at<=end).length,
   };
   for(const [key,x]of Object.entries(stage))add(key,x);
   return {member:index+1,...stage,at:{send:start,commit:c,notification:change?.at,syncRequest:sync?.at,syncResponse:response?.at,applyStart:applyStart?.at,applyEnd:apply?.at,historyQuery:query?.at,publication:v.trial.published,react:end}};
  });
  const worst=Math.max(...views.map(v=>v.send_render_ms));add('send_slowest_remote_render_ms',worst);
  samples.push({run:s.run,seq:s.commit.seq,send_commit_ms:c-start,sender_notification_at:senderNotification?.at,worst,views});
 }
 const summary={metadata:j.metadata,stages:Object.fromEntries(Object.entries(all).map(([k,xs])=>[k,stats(xs)])),samples};
 const output=path.replace(/\.json(?:\.gz)?$/,'-summary.json');writeFileSync(output,JSON.stringify(summary,null,2));
 console.log(output,JSON.stringify(summary.stages));
}
