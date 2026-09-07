import { readFileSync, writeFileSync } from 'node:fs';
const root=new URL('./before-source/snapback2/packages/',import.meta.url);
const {OfflineRuntime}=await import(new URL('snapback2/src/offline.ts',root).href);
const {PersistentRangeStore}=await import(new URL('snapback2/src/store/range-store.ts',root).href);
const h=JSON.parse(readFileSync(new URL('evaluator/src/test-search-v5-fixtures.json',root),'utf8')).nativeR8.halo;
const output:any={source:'cb578e197535290d9c3c7394246584e12459e77a',scope:'Native initial program/frame; synthetic later authenticated clock.read row pools, not native emitted movement',cases:[]};
const inputs:any[]=[];
for(const moved of [[],['r9'],['r8','r9']]){
 let saved:any;const factory=()=>new PersistentRangeStore({carrier:'bounded-json-memory',open:async()=>saved,replace:async(s:any)=>{saved=JSON.parse(JSON.stringify(s))},wipe:async()=>{saved=undefined},close(){}});
 let r=new OfflineRuntime({store:factory});await r.open(h.first.authority.principal,true);await r.program(h.program);
 await r.commit('clock.fixed',{},await r.accept('clock.fixed',{},h.first));const initial=await r.twin.evaluate('clock.fixed',{});
 const frame=structuredClone(h.first);frame.seq++;frame.readTime++;frame.validator='b'.repeat(64);frame.state='capped';frame.receipt={ranges:[],absences:[],verdicts:[]};frame.rows=frame.rows.filter((x:any)=>moved.includes(x.id)).map((x:any,i:number)=>({...x,row:{...x.row,at:100+i}}));frame.data={now:frame.readTime,rows:frame.rows.map((x:any)=>({$row:{table:x.table,id:x.id}}))};inputs.push(frame);
 let error:any;try{await r.commit('clock.read',{},await r.accept('clock.read',{},frame))}catch(e:any){error={name:e.name,code:e.code,message:e.message}}
 const warm=await r.twin.evaluate('clock.fixed',{});const retained=structuredClone(saved.answers['clock.fixed\0{}'].receipt);await r.close();r=new OfflineRuntime({store:factory});await r.open(h.first.authority.principal,true);const cold=await r.twin.evaluate('clock.fixed',{});await r.close();output.cases.push({moved,error,initial,warm,cold,retained});
}
writeFileSync(new URL('./movement-inputs.json',import.meta.url),JSON.stringify({program:h.program,initial:h.first,frames:inputs},null,2)+'\n');console.log(JSON.stringify(output,null,2));
