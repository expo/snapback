// From snapback4/: node reports/20260930-pr-subscription-pressure/round4/queue-cost.mjs
// Round 3 SDK control is built as described in REPORT.md. No production swap.
import {performance} from 'node:perf_hooks';
import {ReadWork as current} from '../../../packages/snapback4/dist/read-work.js';
import {ReadWork as base} from '../../../target/pr-round3/dist/read-work.js';
const drain=async()=>{for(let i=0;i<15;i++)await Promise.resolve()};
async function trial(Work,n,priority){
 const turns=[],work=new Work(fn=>{turns.push(fn);return 1});let count=0;
 const start=performance.now();
 for(let i=0;i<n;i++){work.schedule(i,async()=>{count++});if(priority)work.prioritize(i)}
 await drain();for(let at=0;at<turns.length;at++){turns[at]();await drain()}
 work.clear();if(count!==n)throw Error(`drained ${count} of ${n}`);
 return performance.now()-start;
}
for(const priority of [false,true])for(const n of [1000,10000]){
 const all={round3:[],round4:[]};
 for(let i=0;i<14;i++)for(const [name,Work]of i%2 ? [['round4',current],['round3',base]] : [['round3',base],['round4',current]]){
  const time=await trial(Work,n,priority);if(i>3)all[name].push(time);
 }
 const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return (sorted[4]+sorted[5])/2};
 console.log(JSON.stringify({n,priority,round3Median:median(all.round3),round4Median:median(all.round4),samples:all}));
}
