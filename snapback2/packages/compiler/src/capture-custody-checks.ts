import assert from "node:assert/strict";
import { ClientStore } from "../../evaluator/src/store";
import type { ClosureReceipt } from "../../evaluator/src/types";
import { canonicalSchemaJson } from "../../evaluator/src/certificate-identity";
import { sha256 } from "../../evaluator/src/hash";
import { lowerProject } from "./project";
import { withProject, type Test } from "./quarry-check-helpers";
import { decodeProducerValue } from "./capture-producer-checks";
import type { Value } from "./ir";

export type CustodyCase = { name: string; public?: boolean; source: string; refusal?: string;
  runs?: Array<{ args?: Record<string, Value>; result?: unknown; stored?: unknown; error?: string }> };
export const custodyPublicSchema = `table records:
  d3: decimal 3 ?
  amounts: [decimal 3] <=20 ?
  public
  insert <- allow
`;
export const custodyPrivateSchema = `import {schema,table,t,rule} from 'snapback2';
export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:20}))},rules:{read:rule.allow(),insert:rule.allow()}});
export default schema({tables:{records}});`;
const privateSource = (body: string, args = "", helpers = "") => `import {mutation,t,divmod,concat,range,recurse,mergeByIndex} from 'snapback2';
import {records} from './schema';
${helpers}
export const probe=mutation({${args}},({args,db,ctx})=>{${body}});`;
const minor = { Array: [{ Int: 4321 }] } as Value;
export const custodyCases: CustodyCase[] = [];
for (const [fallback, value] of [["2",2000],["9007199255",9007199255000],["-2",-2000],["(1 + 1)",2000]] as const) {
  for (const capture of ["captured", "box.value"]) custodyCases.push({
    name:`public scalar ${fallback} via ${capture}`,public:true,
    source:`mutation probe(amount: decimal 3 ?):\n  captured = amount ?? ${fallback}\n  box = {value: captured}\n  insert records {d3: ${capture}}\n  return captured\n`,
    runs:[{args:{amount:"Null"},result:value,stored:{d3:value}},{args:{amount:{Int:4321}},result:4321,stored:{d3:4321}}],
  });
}
for (const expression of ["fallback", "box.value"]) custodyCases.push({name:`public captured scalar fallback ${expression}`,public:true,
  source:`mutation probe(amount: decimal 3 ?):\n  fallback = 2\n  box = {value: fallback}\n  captured = amount ?? ${expression}\n  insert records {d3: captured}\n  return {captured, fallback, box}\n`,
  runs:[{args:{amount:"Null"},result:{captured:2000,fallback:2,box:{value:2}},stored:{d3:2000}},
    {args:{amount:{Int:4321}},result:{captured:4321,fallback:2,box:{value:2}},stored:{d3:4321}}]});
for (const [fallback, type, value, refusal] of [
  ["[2,3]","",[2,3],undefined], ["same",", same: [decimal 3] <=3",[321],undefined],
  ["wrong",", wrong: [decimal 2] <=3",[321],"E_DECIMAL_SCALE"],
  ["whole",", whole: [int] <=3",[321],"E_DECIMAL_SCALE"],
] as const) for (const field of [false,true]) custodyCases.push({
  name:`public direct list ${fallback} ${field?"field":"alias"}`,public:true,refusal,
  source:`mutation probe(values: [decimal 3] <=3 ?${type}):\n  original = values ?? ${fallback}\n  box = {amounts: original}\n  insert records {amounts: ${field?"box.amounts":"original"}}\n  return original\n`,
  runs:[{args:{values:"Null",same:{Array:[{Int:321}]},wrong:{Array:[{Int:321}]},whole:{Array:[{Int:321}]}},result:value,stored:{amounts:fallback==="[2,3]"?[2000,3000]:value}},
    {args:{values:minor,same:{Array:[{Int:321}]},wrong:{Array:[{Int:321}]},whole:{Array:[{Int:321}]}},result:[4321],stored:{amounts:[4321]}}],
});
for (const [method, expression] of Object.entries({
  slice:"original.slice(0,3)",map:"original.slice(0,3).map(x=>x)",filter:"original.slice(0,3).filter(x=>true)",
  flatMap:"original.slice(0,3).flatMap(x=>[x])",object:"original.slice(0,3).map(x=>({v:x})).map(x=>x.v)",
  sort:"original.slice(0,3).map(x=>({v:x,at:0})).sort((a,b)=>a.at-b.at).map(x=>x.v)",
  helper:"keep(original.slice(0,3))", reduction:"original.slice(0,3).reduce((a:number,x:number)=>x,args.same)",
  constantMap:"original.slice(0,3).map(x=>args.same)",
})) for (const [origin, fallback] of [["whole","[2,3]"],["wrong","args.wrong"],["minor","args.minors"],["empty","[]"]] as const) {
  const accepts = origin==="minor" || origin==="empty" || method==="constantMap";
  const field = method==="reduction"?"d3":"amounts";
  const args="values:t.optional(t.list(t.decimal(3),{max:3})),wrong:t.list(t.decimal(2),{max:3}),minors:t.list(t.decimal(3),{max:3}),same:t.decimal(3)";
  const setup=`const original=args.values??${fallback}; const amounts=${expression};`;
  const source = privateSource(`${setup} db.insert(records,{id:'record',${field}:amounts}); return original;`,args,"function keep(xs:number[]){return xs.map(x=>x);}");
  const absent = origin==="whole"?[2,3]:origin==="empty"?[]:[321];
  const runs = [true,false].map(nullish=>({args:{values:nullish?"Null" as const:minor,wrong:{Array:[{Int:321}]} as Value,minors:{Array:[{Int:321}]} as Value,same:{Int:4321}} as Record<string,Value>,
    result:nullish?absent:[4321],stored:{[field]:method==="constantMap"?(nullish?absent:[4321]).map(()=>4321):method==="reduction"?(nullish&&origin==="minor"?321:4321):nullish?absent:[4321]}}));
  custodyCases.push({name:`private joined ${origin} ${method}`,source,refusal:accepts?undefined:"E_DECIMAL_SCALE",runs});
  // Destination refusal must not destroy supported source-only immutable paths.
  custodyCases.push({name:`private joined source ${origin} ${method}`,source:privateSource(`${setup} return original;`,args,"function keep(xs:number[]){return xs.map(x=>x);}"),runs:runs.map(({stored,...run})=>run)});
}
for (const [method, result, expression] of [
  ["map",[3],"xs.map(x=>x)"],["reduce",3,"xs.reduce((sum,x)=>sum+x,0)"],
  ["flatMap",[3],"xs.flatMap(x=>[x])"],["filter",[3],"xs.filter(x=>true)"],["some",true,"xs.some(x=>true)"],
] as const) custodyCases.push({name:`private helper ${method} caller registers`,
  source:privateSource("const x=7; const sum=11; const first=values([3]); const second=values([3]); return {first,second,x,sum};","",`function values(xs:number[]){return ${expression};}`),
  runs:[{result:{first:result,second:result,x:7,sum:11}}]});
custodyCases.push({name:"private helper argument register",source:privateSource('const result=values(["long"]); return {result,term:args.term};',"term:t.text(1)","function values(xs:string[]){return xs.map(term=>term);}"),runs:[{args:{term:{String:"x"}},result:{result:["long"],term:"x"}}]});
custodyCases.push({name:"private helper declaration scope and caller snapshot",source:privateSource('const moduleValue=7; const x=9; const output=keep(x); return {output,moduleValue,x};',"","const moduleValue=2; function keep(input:number){return [input].map(x=>({x,input,moduleValue}));}"),runs:[{result:{output:[{x:9,input:9,moduleValue:2}],moduleValue:7,x:9}}]});
// These accepted private receivers deliberately use any, so the checker does not
// conceal missing operand custody behind a TypeScript arity diagnostic.
for (const expression of ["items.map((n:number)=>n,ctx.newId())","items.filter((n:number)=>true,ctx.newId())",
  "items.flatMap((n:number)=>[n],ctx.newId())","items.some((n:number)=>true,ctx.newId())",
  "items.reduce((a:number,n:number)=>a+n,0,ctx.newId())", "items.sort((a:any,b:any)=>a.at-b.at,ctx.newId())",
  "items.slice(0,1,ctx.newId())", "items.count(ctx.newId())", "items.countCapped(ctx.newId())",
  "items.require(ctx.newId())", "items.map((n:number)=>args.big+1,divmod(1,args.zero))",
  "items.reduce((a:number,n:number)=>args.big+1,0,divmod(1,args.zero))",
]) custodyCases.push({name:`private extra operand ${expression}`,source:privateSource(`const items:any=[1,2]; const result=${expression}; return {result,next:ctx.newId()};`,"zero:t.int(),big:t.int()"),refusal:"E_OPAQUE"});
for (const [owner, invocation] of [["c","newId(ctx.newId())"],["c","now(ctx.newId())"],["c","commitTime(ctx.newId())"],
  ["d","get(records,'record',ctx.newId())"],["d","exists(records,[],ctx.newId())"],
  ["d","scan(records,[],{take:2},ctx.newId())"],["d","insert(records,{id:'record'},ctx.newId())"]]) {
  custodyCases.push({name:`private composite extra ${invocation}`,source:privateSource(`const ${owner}:any=${owner==="c"?"ctx":"db"}; return ${owner}.${invocation};`),refusal:"E_OPAQUE"});
}
for (const invocation of ["insert(records,{id:'record'},ctx.newId())","delete(records,'record',ctx.newId())",
  "update(records,'record',{},ctx.newId())","upsert(records,'record',{id:'record'},ctx.newId())",
  "require(true,'CODE',ctx.newId())","assert(true,'CODE',ctx.newId())"]) custodyCases.push({name:`private statement extra ${invocation}`,source:privateSource(`const d:any=db; d.${invocation}; return 1;`),refusal:"E_OPAQUE"});
for (const [setup, expression] of [["const bag:any=new Map();","bag.set('a',1,ctx.newId()); return 1;"],
  ["const bag:any=new Map([['a',1]]);","return bag.get('a',ctx.newId());"],["const bag:any=new Map();","return bag.has('a',ctx.newId());"],
  ["const bag:any=new Set();","bag.add(1,ctx.newId()); return 1;"],["const bag:any=new Set();","return bag.has(1,ctx.newId());"]]) {
  custodyCases.push({name:`private collection extra ${expression}`,source:privateSource(setup+expression),refusal:"E_OPAQUE"});
}
for (const domain of ["range(0,1,divmod(1,args.zero))","mentionTokens('a',ctx.newId())"]){
  const name=domain.startsWith("range")?"range":"mentionTokens";
  custodyCases.push({name:`private ambient domain ${name}`,source:`import {mutation,t,divmod} from 'snapback2';\ndeclare function ${name}(...args:any[]):number[];\nexport const probe=mutation({zero:t.int()},({args,ctx})=>{for(const n of ${domain}){const value=n;} return ctx.newId();});`,refusal:"E_OPAQUE"});
}
for (const [name, operands] of [["normalizeHandle","'a',ctx.newId()"],["normalizeWordPrefix","'a',ctx.newId()"],
  ["memberOf","'room',ctx.newId()"],["decimal","2,3,ctx.newId()"],["words","'word',ctx.newId()"],
  ["mentionTokens","'word',ctx.newId()"],["deterministicShare","1,['a'],'a',ctx.newId()"]]) {
  custodyCases.push({name:`private ambient builtin extra ${name}`,source:`import {mutation} from 'snapback2';
declare function ${name}(...args:any[]):any;
export const probe=mutation({},({ctx})=>{return ${name}(${operands});});`,refusal:"E_OPAQUE"});
}
custodyCases.push({name:"private scan domain extra operand",source:privateSource("for(const row of pages.scan(records,[],{take:2},ctx.newId())){} return ctx.newId();","","declare const pages:{scan(...args:any[]):any};"),refusal:"E_OPAQUE"});
custodyCases.push(
  {name:"public range control",public:true,source:"mutation probe():\n  for n in range(0, 2):\n    insert records {d3: 2}\n  return 7\n",runs:[{result:7,stored:{d3:2000}}]},
  {name:"private map allocations once",source:privateSource("const result=[1,2].map(n=>ctx.newId()); return {result,next:ctx.newId()};"),runs:[{result:{result:["id-1","id-2"],next:"id-3"}}]},
  {name:"private default callback stays lazy for present values",source:privateSource("const items:any=[1,2]; const result=items.map((n:any=ctx.newId())=>n); return {result,next:ctx.newId()};"),runs:[{result:{result:[1,2],next:"id-1"}}]},
  {name:"private helper actuals remain once and ordered",source:privateSource("const result=keep(ctx.newId(),ctx.newId()); return {result,next:ctx.newId()};","","function keep(x:any,y:any){return x;}"),runs:[{result:{result:"id-1",next:"id-3"}}]},
  {name:"private empty callback lazy",source:privateSource("const result=[].map((n:number)=>divmod(1,args.zero)); return {result,next:ctx.newId()};","zero:t.int()"),runs:[{args:{zero:{Int:0}},result:{result:[],next:"id-1"}}]},
  {name:"private reduce initial before callback error",source:privateSource("return [1].reduce((a,n)=>args.big+1,divmod(1,args.zero).quotient);","zero:t.int(),big:t.int()"),runs:[{args:{zero:{Int:0},big:{Int:9007199254740991}},error:"E_DIV_ZERO"}]},
  {name:"private helper unused extra once",source:privateSource("const f:any=0; const result=keep(ctx.newId(),ctx.newId()); return {result,next:ctx.newId()};","","function keep(x:any,...unused:any[]){return x;}"),refusal:"E_OPAQUE"},
  {name:"private require literal default",source:privateSource('db.require(true); db.require(true,"CODE"); db.assert(true); return 7;'),runs:[{result:7}]},
);

/** Only ordinary schema indexes are adapted to the frozen evaluator's fixture
 * format. Program IR is passed unchanged, and this is no native qualification. */
export function custodyActual(full: Extract<Awaited<ReturnType<typeof lowerProject>>, {ok:true}>, args: Record<string,Value> = {},
  fixtureReceipt?: Omit<ClosureReceipt,"schema_hash">) {
  const schema = structuredClone(full.project.schema) as any;
  for (const table of Object.values(schema.tables) as any[]) for (const index of Object.values(table.indexes) as any[]) {
    if (index.components) { index.columns=index.components.map((component:any)=>component.Column); delete index.components; }
  }
  // Explicit initial fixture facts belong to this adapted evaluator schema.
  // They are test inputs, not a native-issued receipt or authority proof.
  const receipt = fixtureReceipt ? {...fixtureReceipt,schema_hash:sha256(canonicalSchemaJson(schema))}
    : {rows:[],ranges:[],absences:[],verdicts:[]};
  const store=new ClientStore(schema,receipt);
  return store.applyMutation(full.project.programs[0]!,{args,viewer:"v",principal_kind:"user",auth_epoch:0,now:0,read_time:0,new_ids:Array.from({length:32},(_,i)=>`id-${i+1}`)});
}
export function registerCustodyChecks(test: Test): void {
  for (const item of custodyCases) test(`custody ${item.name} (complete project)`,async()=>{
    const ext=item.public?"q":"ts";
    await withProject({[`snapback/schema.${ext}`]:item.public?custodyPublicSchema:custodyPrivateSchema,[`snapback/probe.${ext}`]:item.source},async root=>{
      const full=await lowerProject(root,item.public?{}:{authoring:"any"});
      if(item.refusal){assert(!full.ok,JSON.stringify(full));assert(full.diagnostics.some(d=>d.code===item.refusal),JSON.stringify(full));return;}
      assert(full.ok,JSON.stringify(full));
      for(const run of item.runs??[]){
        if(run.error){assert.throws(()=>custodyActual(full,run.args),new RegExp(run.error));continue;}
        const actual=custodyActual(full,run.args);assert(actual.state==="predicted"&&actual.execution,JSON.stringify(actual));
        assert.deepEqual(decodeProducerValue(actual.execution.result),run.result);
        if(run.stored)for(const [name,value] of Object.entries(run.stored)){
          assert(actual.execution.writes.length>0,JSON.stringify(actual));
          for(const write of actual.execution.writes){const row=write.row;assert(row&&typeof row==="object"&&"Row"in row);assert.deepEqual(decodeProducerValue(row.Row[name]!),value);}
        }
      }
    });
  });
}
