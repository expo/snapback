import { readFileSync, writeFileSync } from 'node:fs';
const stage = process.argv[2];
if (!['before','final'].includes(stage)) throw new Error('choose before/final');
const root = new URL(`./${stage}/snapback2/packages/`, import.meta.url);
const { OfflineRuntime } = await import(new URL('snapback2/src/offline.ts', root).href);
const { PersistentRangeStore } = await import(new URL('snapback2/src/store/range-store.ts', root).href);
const fixtures = JSON.parse(readFileSync(new URL('./final/snapback2/packages/evaluator/src/test-search-v5-fixtures.json',import.meta.url),'utf8'));
const output: any = { stage, cases: [] };
const inputs: any = { provenance: 'Native halo program and first frame unchanged; named mutations are predicted locally. Bounds controls are explicitly synthetic authenticated-envelope derivatives.' };
const make = () => {
  let saved: any;
  const factory = () => new PersistentRangeStore({ carrier: 'bounded-json-memory', open: async()=>saved,
    replace: async(s:any)=>{saved=JSON.parse(JSON.stringify(s));},wipe:async()=>{saved=undefined;},close(){} });
  return { factory, runtime: new OfflineRuntime({store:factory}), snapshot:()=>saved };
};
const halo = fixtures.nativeR8.halo;
inputs.halo = { program: halo.program, frame: halo.first, mutations: ['r0','halo'] };
for (const id of inputs.halo.mutations) {
  const m=make();let runtime=m.runtime;const principal=halo.first.authority.principal;
  await runtime.open(principal,true);await runtime.program(halo.program);
  await runtime.commit('clock.fixed',{},await runtime.accept('clock.fixed',{},halo.first));
  const original=await runtime.twin.evaluate('clock.fixed',{});
  const prediction=await runtime.twin.predict('remove',{id},[]);
  const entry={intent:'remove-one',grant:'probe-grant',offset:0,count:0,ids:[],op:'remove',args:{id},issuedSeq:halo.first.seq,
    state:'queued',predicted:prediction.predicted,trace:prediction.trace,createdAt:1,updatedAt:1};
  await runtime.store.commit({outbox:{put:[entry]},overlay:{put:{'remove-one':prediction.overlay}}});
  const warm=await runtime.twin.evaluate('clock.fixed',{});
  await runtime.close();runtime=new OfflineRuntime({store:m.factory});await runtime.open(principal,true);
  const cold=await runtime.twin.evaluate('clock.fixed',{});
  output.cases.push({name:`halo-delete-${id}`,original,prediction,warm,cold,storedRange:m.snapshot().answers['clock.fixed\u0000{}'].receipt.ranges[0]});
  await runtime.close();
}
inputs.bounds=[];
for (const after of [0,[0],[0,'edge']]) {
  const m=make(),runtime=m.runtime;const principal=halo.first.authority.principal;
  await runtime.open(principal,true);await runtime.program(halo.program);
  const frame=structuredClone(halo.first);frame.state='complete';frame.rows=[];frame.data.rows=[];
  const range=frame.receipt.ranges[0];range.rowIds=[];delete range.haloId;range.stop='Exhausted';range.after=after;
  inputs.bounds.push(frame);
  const before=JSON.stringify(m.snapshot());let admitted=false,error:any,local:any,localError:any;
  try {await runtime.commit('clock.fixed',{},await runtime.accept('clock.fixed',{},frame));admitted=true;}catch(e:any){error={name:e.name,message:e.message,code:e.code};}
  try {local=await runtime.twin.evaluate('clock.fixed',{});}catch(e:any){localError={name:e.name,message:e.message,code:e.code};}
  output.cases.push({name:'empty-bound',after,admitted,error,changed:JSON.stringify(m.snapshot())!==before,local,localError,factSlots:m.snapshot().factSlots});
  await runtime.close();
}
writeFileSync(new URL('./inputs.json',import.meta.url),JSON.stringify(inputs,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
