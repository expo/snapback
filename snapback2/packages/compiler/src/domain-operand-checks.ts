import assert from "node:assert/strict";
import { lowerProject } from "./project";
import { withProject, type Test } from "./quarry-check-helpers";
import { custodyActual } from "./capture-custody-checks";
import { decodeProducerValue } from "./capture-producer-checks";
import type { Value } from "./ir";
import { registerJoinedListChecks } from "./joined-list-checks";

// Complete projects keep Quarry admission, private subset typing, emitted IR and
// actual evaluator values together. These do not certify native execution.
export type DomainOperandCase = {
  name: string; public?: boolean; source: string; refusal?: string;
  max?: number; argsType?: unknown; merge?: boolean; rowField?: string; argumentDomain?: string;
  runs?: Array<{ args?: Record<string, Value>; result?: unknown; rows?: unknown[]; error?: string }>;
};
export const domainPublicSchema = `table records:
  d3: decimal 3 ?
  amounts: [int] <=20 ?
  payload: json <=10000 ?
  group: int ?
  by byGroup: group, id
  public
  insert <- allow
`;
export const domainPrivateSchema = `import {schema,table,t,rule} from 'snapback2';
export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.int(),{max:20})),decimals:t.optional(t.list(t.decimal(3),{max:20})),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});
export default schema({tables:{records}});`;
const privateSource = (body: string, args = "", helpers = "") => `import {mutation,t,divmod,mergeByIndex,recurse} from 'snapback2';
import {records} from './schema';
${helpers}
export const probe=mutation({${args}},({args,db,ctx})=>{${body}});`;
const list = (...values: number[]): Value => ({Array:values.map(Int=>({Int}))});
const inputType = {Optional:{List:{of:{Decimal:{scale:3}},max:3}}};
export const domainOperandCases: DomainOperandCase[] = [];
for (const [name, setup, domain, indent] of [
  ["direct", "", "values ?? []", "  "],
  ["alias", "  original = values ?? []\n", "original", "  "],
  ["optional alias", "  original = values\n", "original ?? []", "  "],
  ["object field", "  box = {values}\n", "box.values ?? []", "  "],
  ["nested object field", "  box = {inner: {values}}\n", "box.inner.values ?? []", "  "],
  ["presence", "  if values != null:\n", "values", "    "],
  ["alias presence", "  original = values\n  if original != null:\n", "original", "    "],
] as const) domainOperandCases.push({name:`public optional list ${name}`,public:true,max:3,argsType:inputType,
  ...(!name.includes("presence")?{argumentDomain:"values"}:{}),
  source:`mutation probe(values: [decimal 3] <=3 ?):\n${setup}${indent}for value in ${domain}:\n${indent}  insert records {d3: value}\n  return 7\n`,
  runs:[{args:{},error:"E_INPUT: missing arg values"},{args:{values:"Null"},result:7,rows:[]},{args:{values:list()},result:7,rows:[]},
    {args:{values:list(4321)},result:7,rows:[4321]},{args:{values:list(1,2,3)},result:7,rows:[1,2,3]},
    {args:{values:list(1,2,3,4)},error:"E_FANOUT"},{args:{values:{String:"bad"}},error:"E_INPUT"},
    {args:{values:{Array:[{String:"bad"}]}},error:"E_INPUT"}]});
for (const [name, setup, domain, optional] of [
  ["required", "", "values", false],
  ["larger fallback", "", "values ?? more", true],
  ["larger fallback alias", "  original = values ?? more\n", "original", true],
  ["larger fallback field", "  box = {values: values ?? more}\n", "box.values", true],
  ["nested alternatives", "", "values ?? maybe ?? more", true],
] as const) domainOperandCases.push({name:`public bound ${name}`,public:true,max:optional?7:3,
  source:`mutation probe(values: [decimal 3] <=3${optional?" ?":""}, maybe: [decimal 3] <=5 ?, more: [decimal 3] <=7):\n${setup}  for value in ${domain}:\n    insert records {d3: value}\n  return 7\n`,
  runs:[{args:{values:list(4321),maybe:list(1,2,3,4,5),more:list(1,2,3,4,5,6,7)},result:7,rows:[4321]},
    ...(optional?[{args:{values:"Null" as const,maybe:"Null" as const,more:list(1,2,3,4,5,6,7)},result:7,rows:[1,2,3,4,5,6,7]}]:[]),
    ...(name==="nested alternatives"?[{args:{values:"Null" as const,maybe:list(1,2,3,4,5),more:list(1,2,3,4,5,6,7)},result:7,rows:[1,2,3,4,5]}]:[])]});
for (const [setup, domain, indent] of [
  ["", "values", "  "], ["  alias = values\n", "alias", "  "],
  ["  box = {values}\n", "box.values", "  "], ["", "values ?? more", "  "],
  ["  if values != null:\n    return 1\n  else:\n", "values", "    "],
] as const) domainOperandCases.push({name:`public absence refusal ${setup} ${domain}`,public:true,refusal:domain==="values ?? more"?"E_OPAQUE":"E_QUARRY_UNKNOWN",
  source:`mutation probe(values: [decimal 3] <=3 ?, more: [decimal 3] <=7 ?):\n${setup}${indent}for value in ${domain}:\n${indent}  insert records {d3: value}\n  return 7\n`});
for (const fallback of ["[2,3,4,5]", "more ?? [2,3,4,5]"]) domainOperandCases.push({
  name:`public larger literal fallback ${fallback}`,public:true,max:5,
  source:`mutation probe(values: [int] <=3 ?, more: [int] <=5 ?):\n  original = values ?? ${fallback}\n  for value in original:\n    require value > 0 else BAD\n  return original\n`,
  // A literal-only fallback has max 4; a nullable max-5 alternative must join it.
  ...(fallback==="[2,3,4,5]"?{max:4}:{}),
  runs:[{args:{values:"Null",more:"Null"},result:[2,3,4,5]},
    {args:{values:list(9),more:list(1,2,3,4,5)},result:[9]},
    ...(fallback.startsWith("more")?[{args:{values:"Null" as const,more:list(1,2,3,4,5)},result:[1,2,3,4,5]}]:[])]});
for (const depth of [1,2,3]) {
  const descriptor = "t.optional(".repeat(depth)+"t.list(t.decimal(3),{max:3})"+")".repeat(depth);
  domainOperandCases.push({name:`private recursive optional wrapper ${depth}`,max:7,
    source:privateSource("const values=args.values??args.more; for(const value of values){db.insert(records,{id:ctx.newId(),d3:value});} return 7;",`values:${descriptor},more:t.list(t.decimal(3),{max:7})`),
    runs:[{args:{values:"Null",more:list(1,2,3,4,5,6,7)},result:7,rows:[1,2,3,4,5,6,7]},{args:{values:list(4321),more:list()},result:7,rows:[4321]}]});
}
for (const [setup, domain] of [
  ["", "(args.values as any)"], ["const xs:any=args.values;", "xs"],
  ["const xs:number[]=args.values as any;", "xs"],
  ["const box:any={values:args.values};", "box.values"],
  ["", "(args.values??args.more) as any"],
  ["const xs:any=args.values; if(xs!=null){const xs:any=args.more;", "xs"],
] as const) domainOperandCases.push({name:`private absence proof ${setup} ${domain}`,refusal:"E_UNBOUND_LOOP",
  source:privateSource(`${setup} for(const value of ${domain}){} ${setup.includes("if(")?"}":""} return 7;`,
    "values:t.optional(t.list(t.int(),{max:3})),more:t.optional(t.list(t.int(),{max:7}))")});
for (const [setup, domain, tail] of [
  ["const xs:any=args.values; if(xs!=null){", "xs", "}"],
  ["if(args.values!=null){const xs:any=args.values;", "xs", "}"],
  ["const box:any={values:args.values}; if(box.values!=null){", "box.values", "}"],
  ["const xs:any=args.values;", "xs??[]", ""],
] as const) domainOperandCases.push({name:`private presence control ${setup}`,max:3,
  source:privateSource(`${setup}for(const value of ${domain}){}${tail} return 7;`,"values:t.optional(t.list(t.int(),{max:3}))"),
    runs:[{args:{values:"Null"},result:7},{args:{values:list(1,2,3)},result:7}]});
for (const [control, expected] of [["break",[1]], ["continue",[1,2,3]], ["return [...out]",[1]]] as const)
  domainOperandCases.push({name:`private empty-default loop ${control}`,
    source:privateSource(`const out:any=[]; for(const value of args.values??[]){out.push(value); ${control};} return out;`,
      "values:t.optional(t.list(t.int(),{max:3}))"),
    runs:[{args:{values:"Null"},result:[]},{args:{values:list(1,2,3)},result:expected}]});
domainOperandCases.push({name:"private empty-default object keeps allocation",
  source:privateSource("const box={ticket:ctx.newId(),values:args.values}; for(const value of box.values??[]){} return ctx.newId();",
    "values:t.optional(t.list(t.int(),{max:3}))"),
  runs:[{args:{values:"Null"},result:"id-2"},{args:{values:list(1)},result:"id-2"}]});
for (const [name, operands, expected, setup] of [
  ["later length", "2,xs.length", [1,2,1], ""],
  ["both lengths", "xs.length,xs.length", [1,1,1], ""],
  ["helper length", "2,keep(xs.length)", [1,2,1], ""],
  ["reduce length", "2,[0].reduce((a,n)=>xs.length,0)", [1,2,1], ""],
  ["three operands", "xs.length,keep(xs.length),[0].reduce((a,n)=>xs.length,0)", [1,1,1,1], ""],
  ["literal control", "2,3", [1,2,3], ""],
  ["bound control", "a,b", [1,1,1], "const a=xs.length; const b=xs.length;"],
  ["one operand", "xs.length", [1,1], ""],
] as const) domainOperandCases.push({name:`private push ${name}`,max:expected.length,
  source:privateSource(`const xs:any=[1]; ${setup} xs.push(${operands}); for(const value of xs){} db.insert(records,{id:'r',payload:xs}); return xs;`,"","function keep(n:number){return n;}"),
  runs:[{result:expected,rows:[expected]}]});
for (const [name, operands, error] of [
  ["division first", "divmod(1,args.zero).quotient,args.big+1", "E_DIV_ZERO"],
  ["overflow first", "args.big+1,divmod(1,args.zero).quotient", "E_OVERFLOW"],
  ["helper division first", "divmod(1,args.zero).quotient,keep(args.big+1)", "E_DIV_ZERO"],
  ["helper overflow first", "args.big+1,keep(divmod(1,args.zero).quotient)", "E_OVERFLOW"],
  ["reduce division first", "divmod(1,args.zero).quotient,[0].reduce((a,n)=>args.big+1,0)", "E_DIV_ZERO"],
  ["reduce overflow first", "args.big+1,[0].reduce((a,n)=>divmod(1,args.zero).quotient,0)", "E_OVERFLOW"],
] as const) domainOperandCases.push({name:`private push ${name}`,
  source:privateSource(`const xs:any=[1]; xs.push(${operands}); return xs;`,"zero:t.int(),big:t.int()","function keep(n:number){return n;}"),
  runs:[{args:{zero:{Int:0},big:{Int:9007199254740991}},error}]});
for (const operands of ["ctx.newId(),ctx.newId()", "ctx.newId(),keep(ctx.newId())", "ctx.newId(),[0].reduce((a,n)=>ctx.newId(),'')"]) {
  domainOperandCases.push({name:`private push allocations ${operands}`,
    source:privateSource(`const xs:any=[]; xs.push(${operands}); db.insert(records,{id:'r',payload:xs}); return {xs,next:ctx.newId()};`,"","function keep(x:any){return x;}"),
    runs:[{result:{xs:["id-1","id-2"],next:"id-3"},rows:[["id-1","id-2"]]}]});
}
domainOperandCases.push({name:"typed variadic declaration refusal",source:privateSource("const xs=[1]; xs.push(2,3); return xs;"),refusal:"E_OPAQUE"});
domainOperandCases.push({name:"private push whole-unit destination",rowField:"decimals",
  source:privateSource("const xs:any=[2]; xs.push(3,4); db.insert(records,{id:'r',decimals:xs}); return xs;"),
  runs:[{result:[2,3,4],rows:[[2000,3000,4000]]}]});
domainOperandCases.push({name:"private push argument destination refusal",refusal:"E_DECIMAL_SCALE",
  source:privateSource("const xs:any=[2]; xs.push(args.n,4); db.insert(records,{id:'r',decimals:xs}); return xs;","n:t.int()")});
// Map.set already captures key/value before mutation; Set.add owns one actual.
for (const [name, body, result] of [
  ["map receiver size", "const xs=new Map([[1,7]]); xs.set(2,xs.size); return xs.get(2);",1],
  ["map actual allocation order", "const xs=new Map(); xs.set(ctx.newId(),[0].reduce((a,n)=>ctx.newId(),'')); return {value:xs.get('id-1'),next:ctx.newId()};",{value:"id-2",next:"id-3"}],
  ["set actual allocation", "const xs=new Set(); xs.add(ctx.newId()); return {has:xs.has('id-1'),next:ctx.newId()};",{has:true,next:"id-2"}],
] as const) domainOperandCases.push({name:`private adjacent ${name}`,source:privateSource(body),runs:[{result}]});
for (const params of ["unused:any=ctx.newId()", "unused:any=divmod(1,args.zero)",
  "unused:any,second:any=ctx.newId()", "unused:any,second:any=divmod(1,args.zero)",
  "...unused:any[]", "unused:any,...rest:any[]", "unused:any,second:any", "unused:any,second?:any",
  "unused?:any", "{id}:any", "[unused]:any", "unused:any,second:any,third:any=ctx.newId()"])
  for (const discovery of [false,true]) domainOperandCases.push({name:`private merge parameters ${discovery} ${params}`,refusal:"E_OPAQUE",
    source:privateSource(`const rows=mergeByIndex([{${discovery?"rows:db.scan(records,[],{take:2}),":""}lane:(${params})=>db.scan(records,[],{take:2})}],2,'lane'); return {rows,next:ctx.newId()};`,"zero:t.int()")});
for (const [params, discovery] of [["",false],["unused:any",false],["row:any",true],["",true]] as const)
  domainOperandCases.push({name:`private lawful merge ${discovery} ${params}`,merge:true,
    source:privateSource(`const rows=mergeByIndex([{${discovery?"rows:db.scan(records,[],{take:2}),":""}lane:(${params})=>db.scan(records,[],{take:2})}],2,'lane'); return {rows,next:ctx.newId()};`)});
domainOperandCases.push({name:"private set size retains identity refusal",source:privateSource("const xs=new Set([7]); xs.add(xs.size); return xs.has(1);"),refusal:"E_OPAQUE"});
domainOperandCases.push({name:"public duplicate merge lanes refuse",public:true,refusal:"E_QUARRY_TYPE",
  source:"query probe():\n  return merge records first 2 by byId:\n    []\n    [] for row in records[] first 2 by byId\n"});
domainOperandCases.push({name:"public generated merge lanes",public:true,merge:true,
  source:"query probe():\n  return merge records first 2 by byGroup:\n    [2]\n    [row.group] for row in records[] first 2 by byId\n"});

export function registerDomainOperandChecks(test: Test): void {
  registerJoinedListChecks(test);
  for (const item of domainOperandCases) test(`domain operand ${item.name}`,async()=>{
    const ext=item.public?"q":"ts";
    await withProject({[`snapback/schema.${ext}`]:item.public?domainPublicSchema:domainPrivateSchema,[`snapback/probe.${ext}`]:item.source},async root=>{
      const full=await lowerProject(root,item.public?{}:{authoring:"any"});
      if(item.refusal){assert(!full.ok,JSON.stringify(full));assert(full.diagnostics.some(d=>d.code===item.refusal),JSON.stringify(full));return;}
      assert(full.ok,JSON.stringify(full));
      if(item.argsType) assert.deepEqual(full.project.programs[0]!.args.values,item.argsType);
      const domains: any[]=[];
      const walk=(v:any):void=>{if(!v||typeof v!=="object")return;if(v.For)domains.push(v.For.domain);Object.values(v).forEach(walk);};
      walk(full.project.programs[0]!.body);
      if(item.max!==undefined){assert(domains.length>0,JSON.stringify(full));assert.equal(Math.max(...domains.map(d=>d.ArgList?.max??d.DerivedArray?.max)),item.max);}
      if(item.argumentDomain){assert(domains.length>0);for(const d of domains)assert.equal(d.ArgList?.name,item.argumentDomain);}
      if(item.merge){assert(JSON.stringify(full.project.programs[0]!.body).includes('"Merge"'));return;}
      for(const run of item.runs??[]){
        if(run.error){assert.throws(()=>custodyActual(full,run.args),new RegExp(run.error));continue;}
        const actual=custodyActual(full,run.args);assert(actual.state==="predicted"&&actual.execution,JSON.stringify(actual));
        assert.deepEqual(decodeProducerValue(actual.execution.result),run.result);
        if(run.rows) assert.deepEqual(actual.execution.writes.map(write=>{
          assert(write.row&&typeof write.row==="object"&&"Row"in write.row);
          return decodeProducerValue(write.row.Row[item.rowField??(item.name.startsWith("private push")?"payload":"d3")]!);
        }),run.rows);
      }
    });
  });
}
