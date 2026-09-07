import { registerDomainOperandChecks } from "./domain-operand-checks";
import { registerCustodyChecks } from "./capture-custody-checks";
import assert from "node:assert/strict";
import { ClientStore } from "../../evaluator/src/store";
import { lowerSource } from "./compiler";
import { lowerSchema } from "./lower/schema";
import { compileInline, type Test } from "./quarry-check-helpers";
import { repairSchema } from "./capture-repair-checks";
import type { Value } from "./ir";

// These are CHECKED PRIVATE TypeScript controls, not additional Quarry grammar.
export type ProducerCase = { name: string; setup: string; value: string; source: unknown;
  stored?: unknown; refusal?: string; sourceRefusal?: string; field?: "d2" | "amounts"; helpers?: string };
export const producerCases: ProducerCase[] = [];
for (const [origin, input, source, stored, refusal] of [
  ["literal", "[2,3]", [2,3], [2000,3000], undefined],
  ["arg-int", "[args.n,3]", [2,3], undefined, "E_DECIMAL_SCALE"],
  ["minor", "[args.d3,args.d3]", [4321,4321], [4321,4321], undefined],
  ["whole-minor", "[2,args.d3]", [2,4321], undefined, "E_DECIMAL_SCALE"],
  ["minor-whole", "[args.d3,2]", [4321,2], undefined, "E_DECIMAL_SCALE"],
  ["wrong-scale", "[args.d2,args.d2]", [321,321], undefined, "E_DECIMAL_SCALE"],
] as const) for (const [producer, expression] of [
  ["concat", `concat(${input},[])`], ["slice", `${input}.slice(0,2)`],
  ["flatMap", `${input}.flatMap(n=>[n])`], ["map", `${input}.map(n=>n)`],
  ["filter", `${input}.filter(n=>true)`],
  ["sort", `${input}.map(n=>({n,at:0})).sort((a,b)=>a.at-b.at).map(row=>row.n)`],
  ["top", `top(2,${input}.map(n=>({n,at:0}))).map(row=>row.n)`],
  ["mergeByTime", `mergeByTime([${input}.map(n=>({n,at:0}))],2).map(row=>row.n)`],
  ["intersectById", `intersectById(${input}.map(n=>({n,at:0})),2).map(row=>row.n)`],
] as const) for (const use of ["alias", "field"] as const) {
  producerCases.push({name:`${producer} ${origin} ${use}`,
    setup:`const list=${expression}; const holder={list}; const alias=list;`, value:use === "alias" ? "alias" : "holder.list",
    source, stored, refusal });
}
producerCases.push(
  {name:"literal binding concat exact",setup:"const n=2; const amounts=concat([n],[3]);",value:"amounts",source:[2,3],stored:[2000,3000]},
  {name:"argument binding concat distinct",setup:"const n=args.n; const amounts=concat([n],[3]);",value:"amounts",source:[2,3],refusal:"E_DECIMAL_SCALE"},
  {name:"nested concat",setup:"const list=concat(concat([2],[3]),[4]);",value:"list",source:[2,3,4],stored:[2000,3000,4000]},
  {name:"concat bounded list arguments",setup:"const list=concat(args.minors,args.minors);",value:"list",source:[4321,4321],stored:[4321,4321]},
  {name:"concat wrong bounded list argument",setup:"const list=concat(args.wrong,args.wrong);",value:"list",source:[321,321],refusal:"E_DECIMAL_SCALE"},
  {name:"concat whole and bounded minor",setup:"const list=concat([2],args.minors);",value:"list",source:[2,4321],refusal:"E_DECIMAL_SCALE"},
  {name:"concat grown bounded list",setup:"const ns=[2]; ns.push(3); const list=concat(ns,[4]);",value:"list",source:[2,3,4],stored:[2000,3000,4000]},
  {name:"direct concat grown bounded list",setup:"const ns=[2]; ns.push(3);",value:"concat(ns,[4])",source:[2,3,4],stored:[2000,3000,4000]},
  {name:"captured field concat grown bounded list",setup:"const ns=[2]; ns.push(3); const holder={list:concat(ns,[4])};",value:"holder.list",source:[2,3,4],stored:[2000,3000,4000]},
  {name:"helper concat source",helpers:"function join(a:any,b:any){return concat(a,b);}",setup:"const list=join([2],[3]);",value:"list",source:[2,3],stored:[2000,3000]},
  {name:"helper field concat source",setup:"const n=2; const box=ident({inner:{list:concat([n],[3])}});",value:"box.inner.list",source:[2,3],stored:[2000,3000]},
  {name:"merge input alias requires explicit lists",setup:"const inputs=[[{n:2,at:0}],[{n:3,at:0}]]; const list=mergeByTime(inputs,4);",value:"list.map(row=>row.n)",source:[2,3],sourceRefusal:"E_OPAQUE"},
  {name:"merge explicit list aliases",setup:"const first=[{n:2,at:0}]; const second=[{n:3,at:0}]; const list=mergeByTime([first,second],4);",value:"list.map(row=>row.n)",source:[2,3],stored:[2000,3000]},
  {name:"heterogeneous tuple capture remains faithful",setup:"const n=2; const list=[n,args.d3];",value:"list",source:[2,4321],stored:[2000,4321]},
  {name:"heterogeneous tuple spread remains faithful",setup:"const n=2; const list=[n,args.d3]; const copy=[...list];",value:"copy",source:[2,4321],stored:[2000,4321]},
  {name:"negative slice bound",setup:"const list=[2,3,4].slice(-2,3);",value:"list",source:[3,4],stored:[3000,4000]},
  {name:"dynamic slice bound",setup:"const list=[2,3,4].slice(args.start,3);",value:"list",source:[3,4],stored:[3000,4000]},
  {name:"negative slice end",setup:"const list=[2,3,4].slice(0,-1);",value:"list",source:[2,3],stored:[2000,3000]},
  {name:"dynamic slice end",setup:"const list=[2,3,4].slice(0,args.start);",value:"list",source:[2],stored:[2000]},
  {name:"negative slice extremes",setup:"const list=[2,3,4].slice(-9007199254740991,9007199254740991);",value:"list",source:[2,3,4],stored:[2000,3000,4000]},
  {name:"empty flatMap callback stays lazy",setup:"const list=[].flatMap(n=>[divmod(1,0).quotient]);",value:"list",source:[],stored:[]},
  {name:"flatMap nested callback field bound",setup:"const list=[{ns:[2,3]},{ns:[4]}].flatMap(row=>row.ns);",value:"list",source:[2,3,4],stored:[2000,3000,4000]},
  {name:"flatMap bounded list argument",setup:"const list=[1,2].flatMap(n=>args.minors);",value:"list",source:[4321,4321],stored:[4321,4321]},
  {name:"flatMap callback wrong-scale field",setup:"const list=[{ns:args.wrong}].flatMap(row=>row.ns);",value:"list",source:[321],refusal:"E_DECIMAL_SCALE"},
  {name:"reduce whole scalar",setup:"const n=[2,3].reduce((a,x)=>a+x,0);",value:"n",field:"d2",source:5,stored:500},
  {name:"reduce minor arithmetic checker refusal",setup:"const n=[args.d2].reduce((a,x)=>a+x,args.d2);",value:"n",field:"d2",source:642,sourceRefusal:"E_OPAQUE"},
  {name:"reduce minor scalar",setup:"const n=[args.d2].reduce((a,x)=>x,args.d2);",value:"n",field:"d2",source:321,stored:321},
  {name:"reduce mixed scalar",setup:"const n=[args.d2].reduce((a,x)=>x,2);",value:"n",field:"d2",source:321,refusal:"E_DECIMAL_SCALE"},
  {name:"reduce wrong scale arithmetic checker refusal",setup:"const n=[args.d3].reduce((a,x)=>a+x,args.d3);",value:"n",field:"d2",source:8642,sourceRefusal:"E_OPAQUE"},
  {name:"reduce wrong scalar scale",setup:"const n=[args.d3].reduce((a,x)=>x,args.d3);",value:"n",field:"d2",source:4321,refusal:"E_DECIMAL_SCALE"},
);
for (const [field, whole, minor, source] of [["d2","2","args.d2",321], ["amounts","[2,3]","[args.d3]",[4321]]] as const) {
  for (const winner of [minor, "minor", "...last"]) producerCases.push({name:`spread override ${field} ${winner}`,
    setup:`const prior={${field}:${whole}}; const minor=${minor}; const last={${field}:minor}; const original={...prior,${winner === "...last" ? winner : `${field}:${winner}`}};`,
    value:`original.${field}`,field,source,stored:source});
}

export function producerSource(item: ProducerCase, destination: boolean): string {
  return `import {mutation,t,concat,divmod} from 'snapback2'; declare const records:any;
function ident(x:any){return x;} declare function top<T>(count:number,items:T[]):T[];
declare function mergeByTime<T>(items:T[][],limit:number):T[]; declare function intersectById<T>(items:T[],limit:number):T[];
${item.helpers ?? ""}
export const probe=mutation({n:t.int(),start:t.int(),d2:t.decimal(2),d3:t.decimal(3),minors:t.list(t.decimal(3),{max:2}),wrong:t.list(t.decimal(2),{max:2})},({args,db,ctx})=>{
${item.setup} ${destination ? `db.insert(records,{id:"record",${item.field ?? "amounts"}:${item.value}});` : ""} return ${item.value};});`;
}

/** The frozen v5 evaluator uses ordinary index columns; emitted programs are
 * unchanged. This JSON fixture is a disclosed schema adaptation, not integrated
 * compiler/runtime qualification. It also permits empty-table scan traces. */
export const producerRuntimeSchema = JSON.parse(`{"tables":{"records":{"columns":{"id":"Id","d2":{"Optional":{"Decimal":{"scale":2}}},"amounts":{"Optional":{"List":{"of":{"Decimal":{"scale":3}},"max":4}}}},"indexes":{"byId":{"columns":["id"],"unique":true}},"rules":{"read":"Allow","insert":"Allow","update":"Allow","delete":"Allow"},"constraints":[]}}}`);
export function producerActual(program: Parameters<ClientStore["applyMutation"]>[0]) {
  const store = new ClientStore(producerRuntimeSchema,{rows:[],ranges:[],absences:[],verdicts:[]});
  return store.applyMutation(program,{args:{n:{Int:2},start:{Int:-2},d2:{Int:321},d3:{Int:4321},minors:{Array:[{Int:4321}]},wrong:{Array:[{Int:321}]},zero:{Int:0},big:{Int:9007199254740991}},
    viewer:"v",principal_kind:"user",auth_epoch:0,now:0,read_time:0,new_ids:Array.from({length:16},(_,i)=>`id-${i+1}`)});
}
export function decodeProducerValue(value: Value): unknown {
  if (value === "Null") return null;
  if ("Array" in value) return value.Array.map(decodeProducerValue);
  if ("Row" in value) return Object.fromEntries(Object.entries(value.Row).map(([name,field])=>[name,decodeProducerValue(field)]));
  return Object.values(value)[0];
}

export const producerOperandCases: Array<{name:string;body:string;helpers?:string;expected?:unknown;error?:string;refusal?:string;after?:string}> = [
  {name:"numeric tuple capture",body:'const value={"10":ctx.newId(),"2":[ctx.newId()]}; return {value,next:ctx.newId()};',expected:{value:{"10":"id-1","2":["id-2"]},next:"id-3"}},
  {name:"numeric operand flush",body:'return [{"10":ctx.newId(),"2":ctx.newId()},ident(ctx.newId())];',expected:[{"10":"id-1","2":"id-2"},"id-3"]},
  {name:"nested concat capture preserves prior sibling",body:'const value={a:ctx.newId(),b:concat([ctx.newId()],[ctx.newId()])}; return {value,next:ctx.newId()};',expected:{value:{a:"id-1",b:["id-2","id-3"]},next:"id-4"}},
  {name:"nested concat helper capture preserves prior sibling",body:'const value=ident({a:ctx.newId(),b:{nested:concat([ctx.newId()],[ctx.newId()])}}); return {value,next:ctx.newId()};',expected:{value:{a:"id-1",b:{nested:["id-2","id-3"]}},next:"id-4"}},
  {name:"Unicode canonical scalar order",body:'return {"𐀀":ctx.newId(),"":ctx.newId()};',expected:{"𐀀":"id-1","":"id-2"}},
  {name:"Unicode first refusal",body:'return {"𐀀":divmod(1,args.zero),"":args.big+1};',error:"E_DIV_ZERO"},
  {name:"numeric capture first refusal",body:'const value={"10":divmod(1,args.zero),"2":[args.big+1]}; return value;',error:"E_DIV_ZERO"},
  {name:"scan reduce authored receiver",body:'const value=db.scan(records,[],{take:2,after:ctx.newId()}).reduce((a,row)=>a,ctx.newId()); return {value,next:ctx.newId()};',expected:{value:"id-2",next:"id-3"},after:"id-1"},
  {name:"scan reduce receiver throws first",body:'return db.scan(records,[],{take:2,after:word(divmod(1,args.zero))}).reduce((a,row)=>a,args.big+1);',error:"E_DIV_ZERO"},
  {name:"array reduce authored receiver",body:'const value=[ctx.newId()].reduce((a,row)=>a,ctx.newId()); return {value,next:ctx.newId()};',expected:{value:"id-2",next:"id-3"}},
  {name:"require throwing code refuses",body:'db.require(true,word(divmod(1,args.zero))); return 1;',refusal:"E_OPAQUE"},
  {name:"require allocating code refuses",body:'db.require(true,ctx.newId()); return ctx.newId();',refusal:"E_OPAQUE"},
  {name:"require literal code keeps condition",body:'db.require(divmod(1,args.zero),"CODE"); return 1;',error:"E_DIV_ZERO"},
  {name:"require default remains admitted",body:'db.require(true); return 1;',expected:1},
  {name:"merge throwing limit refuses",body:'return mergeByIndex([],divmod(1,args.zero).quotient,"page");',refusal:"E_OPAQUE"},
  {name:"scan shorthand operand refuses",body:'const after=ctx.newId(); return db.scan(records,[],{take:2,after});',refusal:"E_OPAQUE"},
  {name:"scan spread operand refuses",body:'return db.scan(records,[],{take:2,...{after:word(divmod(1,args.zero))}});',refusal:"E_OPAQUE"},
  {name:"scan range helper operand refuses",body:'return db.scan(records,[],{take:2,range:ident(divmod(1,args.zero))});',refusal:"E_OPAQUE"},
  {name:"merge spread operand refuses",body:'return mergeByIndex([{...{rows:db.scan(records,[],{take:2,after:word(divmod(1,args.zero))})},lane:(row:any)=>db.scan(records,[],{take:2})}],2,"page");',refusal:"E_OPAQUE"},
  {name:"helper lexical shadow",helpers:'const moduleValue=2; function free(){return moduleValue;}',body:'const moduleValue=7; return free();',expected:2},
  {name:"helper lexical no shadow",helpers:'const moduleValue=2; function free(){return moduleValue;}',body:'return free();',expected:2},
  {name:"helper lexical alias",helpers:'const first=2; const moduleValue=first; function free(){return moduleValue;}',body:'const first=7; const moduleValue=8; return free();',expected:2},
  {name:"helper lexical nested helper",helpers:'const moduleValue=2; function free(){return moduleValue;} function outer(x:any){return free();}',body:'const moduleValue=7; return outer(ctx.newId());',expected:2},
  {name:"helper lexical unsupported object refuses",helpers:'const moduleValue={n:2}; function free(){return moduleValue.n;}',body:'const moduleValue={n:7}; return free();',refusal:"E_OPAQUE"},
  {name:"helper lexical unsupported let refuses",helpers:'let moduleValue=2; function free(){return moduleValue;}',body:'const moduleValue=7; return free();',refusal:"E_OPAQUE"},
  {name:"helper parameter capture keeps caller value",helpers:'const moduleValue=2; function free(moduleValue:any){return moduleValue;}',body:'const moduleValue=7; return free(moduleValue);',expected:7},
];
export function producerOperandSource(item: typeof producerOperandCases[number]): string {
  return `import {mutation,t,divmod,mergeByIndex,concat} from 'snapback2'; declare const records:any;
function ident(x:any){return x;} function word(x:any){return "CODE";} ${item.helpers ?? ""}
export const probe=mutation({zero:t.int(),big:t.int()},({args,ctx,db})=>{${item.body}});`;
}
export function registerProducerChecks(test: Test, lib: string): void {
  registerCustodyChecks(test);
  registerDomainOperandChecks(test);
  const schema=compileInline([{fileName:"snapback/schema.q",source:repairSchema}]); assert(schema.ok);
  const tables=lowerSchema(schema.schema.source,"schema.ts",true).tables;
  test("producer no-op capture preserves F14 bound upsert identity before native certification",()=>{
    for (const [expression,accepted] of [["itemId",true],["ctx.newId()",false]] as const) {
      const source=`import {mutation} from 'snapback2'; declare const records:any;
export const probe=mutation({},({db,ctx})=>{const itemId=ctx.newId(); const row={id:${expression}}; db.upsert(records,itemId,row);});`;
      const full=lowerSource(source,"bound-identity.ts",lib,{tables});
      assert.equal(full.ok,accepted,JSON.stringify(full));
      if (!full.ok) assert(full.diagnostics.some(d=>d.code === "E_SCHEMA_ID_RESERVED"),JSON.stringify(full));
    }
  });
  for (const item of producerOperandCases) test(`producer operand custody ${item.name} (actual ClientStore)`,()=>{
    const full=lowerSource(producerOperandSource(item),"operand.ts",lib,{tables});
    if (item.refusal) {assert(!full.ok,JSON.stringify(full));assert(full.diagnostics.some(d=>d.code === item.refusal),JSON.stringify(full));return;}
    assert(full.ok,JSON.stringify(full));
    if (item.error) {assert.throws(()=>producerActual(full.programs[0]!),new RegExp(item.error));return;}
    const actual=producerActual(full.programs[0]!); assert(actual.state === "predicted" && actual.execution,JSON.stringify(actual));
    assert.deepEqual(decodeProducerValue(actual.execution.result),item.expected);
    if (item.after) assert.deepEqual(actual.execution.trace.ranges[0]?.after,{Id:item.after});
  });
  for (const item of producerCases) test(`producer source and destination ${item.name} (actual ClientStore)`,()=>{
    const source=lowerSource(producerSource(item,false),"producer.ts",lib,{tables});
    if (item.sourceRefusal) {assert(!source.ok,JSON.stringify(source));assert(source.diagnostics.some(d=>d.code === item.sourceRefusal),JSON.stringify(source));return;}
    assert(source.ok,JSON.stringify(source));
    const original=producerActual(source.programs[0]!); assert(original.state === "predicted" && original.execution,JSON.stringify(original));
    assert.deepEqual(decodeProducerValue(original.execution.result),item.source);
    const full=lowerSource(producerSource(item,true),"producer.ts",lib,{tables});
    if (item.refusal) {assert(!full.ok,JSON.stringify(full));assert(full.diagnostics.some(d=>d.code === item.refusal),JSON.stringify(full));return;}
    assert(full.ok,JSON.stringify(full));
    const actual=producerActual(full.programs[0]!); assert(actual.state === "predicted" && actual.execution,JSON.stringify(actual));
    assert.deepEqual(decodeProducerValue(actual.execution.result),item.source);
    const row=actual.execution.writes[0]?.row;assert(row && typeof row === "object" && "Row" in row,JSON.stringify(actual));
    assert.deepEqual(decodeProducerValue(row.Row[item.field ?? "amounts"]!),item.stored);
  });
}
