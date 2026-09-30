// @ref LLP 3000.023#10 — FIFO selection inspects bounded heads, not the whole backlog.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sdk} from './helpers/answers-stay.mjs';
const {ReadWork}=await import(new URL('read-work.js',sdk));
const drain=async()=>{for(let i=0;i<15;i++)await Promise.resolve()};
for(const priority of [false,true])test(`queue selection scales linearly, priority=${priority}`,async t=>{
 let visited=0;
 const samples=[];
 for(const n of [1000,10000]){
  const turns=[],work=new ReadWork(fn=>{turns.push(fn);return 1});let count=0;visited=0;
  for(const queue of [work.pending,work.priority,work.urgent])if(queue){
   const key=queue instanceof Map?'keys':Symbol.iterator,iterate=queue[key].bind(queue);
   queue[key]=function*(){for(const value of iterate()){visited++;yield value}};
  }
  const start=performance.now();
  for(let i=0;i<n;i++){work.schedule(i,async()=>{count++});if(priority)work.prioritize(i)}
  await drain();for(let at=0;at<turns.length;at++){turns[at]();await drain()}
  const inspections=visited;work.clear();assert.equal(count,n);
  samples.push({n,inspections,ms:performance.now()-start});
  t.diagnostic(JSON.stringify(samples.at(-1)));
  assert.ok(inspections<=n*4,`${inspections} key visits for ${n} jobs`);
 }
 // Count actual key visits, independent of shared-host timing. Includes both
 // class heads and the scheduler's final capacity check each turn.
 assert.ok(samples[1].inspections<=samples[0].inspections*12,'tenfold backlog stays linear');
});
