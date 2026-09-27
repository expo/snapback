import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {api} from '../snapback/generated/api.ts';
export async function scaleProbes(ctx,label){
 const result={label,at:Date.now(),deployment:'local npm platform binary, macOS arm64, dev --replay',warmups:3,samples:20,probes:{}};
 const run=async(name,fn)=>{const times=[];let cut=null;for(let i=0;i<23;i++){const start=performance.now();let timer;const r=await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(name+' timeout')),30000)})]).finally(()=>clearTimeout(timer));if(!('data'in r)||r.data===null)throw Error(name+' returned no usable data');cut=r.cut??cut;if(i>=3)times.push(performance.now()-start)}const sorted=[...times].sort((a,b)=>a-b);result.probes[name]={milliseconds:times,p50:sorted[9],p95:sorted[18],cut}};
 const query=(actor,op,args={})=>ctx.query(actor,op,args);
 await run('following500',()=>query('u0500',api.home));await run('following5',()=>query('u0005',api.home));await run('celebrityFollower',()=>query('u0901',api.home));
 const conversation=ctx.chat('g0001');let cursor;for(let page=1;page<50;page++){const r=await query('u0500',api.messaging.history,{conversation,...(cursor?{c:cursor}:{})});cursor=r.next;if(!cursor)throw Error('Busy chat lacks page 50')}
 await run('historyPage1',()=>query('u0500',api.messaging.history,{conversation}));await run('historyPage50',()=>query('u0500',api.messaging.history,{conversation,c:cursor}));await run('globalSearch',async()=>{const r=await query('u0500',api.messaging.searchMessages,{q:'coffee'});if(!r.complete||r.data?.length!==20)throw Error('Global search must return a complete page of known matches');return r});await run('insights',()=>query('u0500',api.insights.summary));await run('trending',()=>query('u0500',api.insights.trending));
 const p=result.probes;result.withinCheckpointRatios={deepPage:p.historyPage50.p95/p.historyPage1.p95,followingFanout:p.following500.p95/p.following5.p95,celebrityRead:p.celebrityFollower.p95/p.following5.p95};writeFileSync('evidence/scale-'+label+'-probes.json',JSON.stringify(result,null,2));return result;
}
