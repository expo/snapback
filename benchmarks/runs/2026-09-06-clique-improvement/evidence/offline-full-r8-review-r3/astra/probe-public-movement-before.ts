import { readFileSync, writeFileSync } from 'node:fs';
import { OfflineRuntime } from './probe-before/snapback2/packages/snapback2/src/offline.ts';
import { PersistentRangeStore } from './probe-before/snapback2/packages/snapback2/src/store/range-store.ts';
import { createClient, api } from './probe-before/snapback2/packages/snapback2/src/client.ts';

const fixture = JSON.parse(readFileSync('./probe-source/snapback2/packages/evaluator/src/test-search-v5-fixtures.json','utf8')).nativeR8.halo;
Date.now = () => fixture.first.readTime + 1000;
const copy = (v: any) => JSON.parse(JSON.stringify(v));
let saved: any;
const factory = () => new PersistentRangeStore({carrier:'bounded-json',open:async()=>saved,
  replace:async state=>{saved=copy(state);},close(){},wipe:async()=>{}});
const runtime = new OfflineRuntime({store:factory});
await runtime.open(fixture.first.authority.principal,true); await runtime.program(fixture.program);
await runtime.commit('clock.fixed',{},await runtime.accept('clock.fixed',{},copy(fixture.first)));
await runtime.twin.evaluate('clock.fixed',{});
const moved = copy(fixture.first);
moved.seq++; moved.readTime++; moved.planHash=fixture.program.programs['clock.read'].planHash;
moved.validator='d'.repeat(64); moved.receipt={ranges:[],absences:[],verdicts:[]};
moved.rows=moved.rows.filter((r:any)=>['r8','r9'].includes(r.id)).map((r:any,i:number)=>({...r,row:{...r.row,at:100+i}}));
moved.data={now:moved.readTime,rows:moved.rows.map((r:any)=>({$row:{table:r.table,id:r.id}}))};
writeFileSync('probe-public-movement-before-inputs.json',JSON.stringify({program:fixture.program,initial:fixture.first,moved},null,2)+'\n');
await runtime.commit('clock.read',{},await runtime.accept('clock.read',{},moved));
const local:any=await runtime.twin.evaluate('clock.fixed',{});
const held:any=await runtime.store.answer('clock.fixed',{});
writeFileSync('probe-public-movement-before-state.json',JSON.stringify(saved,null,2)+'\n');
await runtime.close();
let requests=0;
const client=createClient({url:'http://bounded.invalid',as:'alice',startOffline:true,offline:{store:factory},
  fetch:async()=>{requests++;throw new Error('No network allowed in this probe');}} as any);
await client.ready;
const publicResult:any=await client.query(api.clock.fixed as any,{});
const compact=(v:any)=>({state:v.state,seq:v.seq,reason:v.reason,rows:v.data?.rows,next:v.next,connection:v.connection});
console.log(JSON.stringify({local:compact(local),held:compact(held),publicResult:compact(publicResult),requests,
  knownHeldHalo:saved.rows['events\0halo']},null,2));
await client.close();
