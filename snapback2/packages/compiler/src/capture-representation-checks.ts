import assert from "node:assert/strict";
import { ClientStore } from "../../evaluator/src/store";
import type { Value } from "./ir";
import { lowerSource } from "./compiler";
import { lowerProject } from "./project";
import { compileInline, directTables, withProject, type Test } from "./quarry-check-helpers";
import { repairSchema, repairSource, type RepairCase } from "./capture-repair-checks";
import { runPure } from "./capture-value-checks";
import { registerProducerChecks } from "./capture-producer-checks";

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — source values keep their representation; every actual operand evaluates once in authored order.
export const representationCases: RepairCase[] = [
  { name: "block assignment preserves minor units", body: "let n=2; {n=args.d2;} db.insert(records,{d2:n}); return n;", result:321, writes:[{d2:321}] },
  { name: "nested block assignment preserves minor units", body: "let n=2; {{n=args.d2;}} db.insert(records,{d2:n}); return n;", result:321, writes:[{d2:321}] },
  { name: "block assignment preserves original scalar capture", body: "let n=2; const original={n}; {n=args.d2;} db.insert(records,{d2:n}); return {n,original};", result:{n:321,original:{n:2}}, writes:[{d2:321}] },
  { name: "block shadow cannot replace outer representation", body: "let n=2; {let n=3; n=args.d2;} db.insert(records,{d2:n}); return n;", result:2, writes:[{d2:200}] },
  { name: "mutable branch mixed scalar refuses", body: "let n=2; if(args.flag){n=args.d2;} db.insert(records,{d2:n}); return n;", refuse:"E_DECIMAL_SCALE" },
  { name: "mutable branch mixed object refuses", body: "let row={d2:2}; if(args.flag){row={d2:args.d2};} db.insert(records,row); return row;", refuse:"E_DECIMAL_SCALE" },
  { name: "mixed nested field join refuses", body: "let row={nested:{d2:2}}; if(args.flag){row={nested:{d2:args.d2}};} db.insert(records,{d2:row.nested.d2}); return row;", refuse:"E_DECIMAL_SCALE" },
  { name: "different object shapes cannot hide mixed representation", body: "let row:any={d2:2}; if(args.flag){row={d2:args.d2,d3:args.d3};} db.insert(records,row); return row;", refuse:"E_DECIMAL_SCALE" },
  { name: "conditional assignment mixed representation refuses", body: "let n=2; args.flag ? n=args.d2 : n=3; db.insert(records,{d2:n}); return n;", refuse:"E_DECIMAL_SCALE" },
  { name: "incompatible direct scale refuses", body: "db.insert(records,{d2:args.d3}); return args.d3;", refuse:"E_DECIMAL_SCALE" },
  { name: "incompatible assigned scale refuses", body: "let n=2; n=args.d3; db.insert(records,{d2:n}); return n;", refuse:"E_DECIMAL_SCALE" },
  { name: "incompatible captured scale refuses", body: "const row={d2:args.d3}; db.insert(records,row); return row;", refuse:"E_DECIMAL_SCALE" },
  { name: "incompatible list scale refuses", body: "const amounts=[args.d2]; db.insert(records,{amounts}); return amounts;", refuse:"E_DECIMAL_SCALE" },
  { name: "bounded loop mixed scalar refuses", body: "let n=2; for(const flag of [args.flag]){if(flag){n=args.d2;}} db.insert(records,{d2:n}); return n;", refuse:"E_DECIMAL_SCALE" },
  { name: "later loop iteration cannot reuse first representation", body: "let n=2; for(const item of [1,2]){db.insert(records,{d2:n}); n=args.d2;} return n;", refuse:"E_DECIMAL_SCALE" },
  { name: "loop representation reaches fixed point across assignments", body: "let a=2,b=2,c=2; for(const item of [1,2,3,4]){db.insert(records,{d2:a}); a=b; b=c; c=args.d2;} return a;", refuse:"E_DECIMAL_SCALE" },
  { name: "continue edge preserves representation", body: "let n=2; for(const flag of [args.flag]){if(flag){n=args.d2; continue;} n=3;} db.insert(records,{d2:n}); return n;", refuse:"E_DECIMAL_SCALE" },
  { name: "break edge preserves representation", body: "let n=2; for(const flag of [args.flag]){if(flag){n=args.d2; break;} n=3;} db.insert(records,{d2:n}); return n;", refuse:"E_DECIMAL_SCALE" },
  { name: "return edge does not overwrite remaining source", body: "let n=2; if(args.flag){n=args.d2; return n;} db.insert(records,{d2:n}); return n;", args:{flag:false},result:2,writes:[{d2:200}] },
  { name: "mixed pushed list refuses", body: "const amounts=[2]; amounts.push(args.d3); db.insert(records,{amounts}); return amounts;", refuse:"E_DECIMAL_SCALE" },
  { name: "mixed branch push refuses", body: "const amounts=[2]; if(args.flag){amounts.push(args.d3);} db.insert(records,{amounts}); return amounts;", refuse:"E_DECIMAL_SCALE" },
  { name: "mixed loop push refuses", body: "const amounts=[2]; for(const item of [1]){amounts.push(args.d3);} db.insert(records,{amounts}); return amounts;", refuse:"E_DECIMAL_SCALE" },
  { name: "whole-unit push keeps appended value", body: "const amounts=[2]; amounts.push(3); db.insert(records,{amounts}); return amounts;", result:[2,3],writes:[{amounts:[2000,3000]}] },
  { name: "minor-unit push preserves representation", body: "const amounts=[args.d3]; amounts.push(args.d3); db.insert(records,{amounts}); return amounts;", result:[4321,4321],writes:[{amounts:[4321,4321]}] },
  { name: "empty list pushed minor units", body: "const amounts=[]; amounts.push(args.d3); db.insert(records,{amounts}); return amounts;", result:[4321],writes:[{amounts:[4321]}] },
  { name: "empty list pushed whole units", body: "const amounts=[]; amounts.push(2); db.insert(records,{amounts}); return amounts;", result:[2],writes:[{amounts:[2000]}] },
  { name: "unmutated mixed list", body: "const amounts=[args.d3,2]; db.insert(records,{amounts}); return amounts;", result:[4321,2],writes:[{amounts:[4321,2000]}] },
  { name: "captured mixed spread preserves both values", body: "const original=[args.d3,2]; const amounts=[...original]; db.insert(records,{amounts}); return {original,amounts};", result:{original:[4321,2],amounts:[4321,2]},writes:[{amounts:[4321,2000]}] },
  { name: "captured field spread preserves elements", body: "const original={amounts:[args.d3,2]}; const amounts=[...original.amounts]; db.insert(records,{amounts}); return amounts;", result:[4321,2],writes:[{amounts:[4321,2000]}] },
  { name: "captured helper spread preserves elements", body: "const original=[args.d3,2]; const amounts=ident([...original]); db.insert(records,{amounts}); return amounts;", result:[4321,2],writes:[{amounts:[4321,2000]}] },
  { name: "spread segments preserve each representation", body: "const original=[args.d3,2]; const amounts=[1,...original,3]; db.insert(records,{amounts}); return {original,amounts};", result:{original:[4321,2],amounts:[1,4321,2,3]},writes:[{amounts:[1000,4321,2000,3000]}] },
  { name: "multiple captured spreads", body: "const a=[args.d3,2],b=[3,args.d3]; const amounts=[...a,...b]; db.insert(records,{amounts}); return amounts;", result:[4321,2,3,4321],writes:[{amounts:[4321,2000,3000,4321]}] },
  { name: "whole spread control", body: "const original=[2,3]; const amounts=[...original]; db.insert(records,{amounts}); return amounts;", result:[2,3],writes:[{amounts:[2000,3000]}] },
  { name: "minor-unit spread control", body: "const original=[args.d3,args.d3]; const amounts=[...original]; db.insert(records,{amounts}); return amounts;", result:[4321,4321],writes:[{amounts:[4321,4321]}] },
  { name: "identity map retains conversion bound", body: "const amounts=[2,3].map(n=>n); db.insert(records,{amounts}); return amounts;", result:[2,3],writes:[{amounts:[2000,3000]}] },
  { name: "mapped minor units stay unchanged", body: "const amounts=[args.d3].map(n=>n); db.insert(records,{amounts}); return amounts;", result:[4321],writes:[{amounts:[4321]}] },
  { name: "mixed map refuses unknown element representation", body: "const amounts=[2,args.d3].map(n=>n); db.insert(records,{amounts}); return amounts;", refuse:"E_DECIMAL_SCALE" },
  { name: "mapped object fields remain supported", body: "const rows=[{d2:2},{d2:3}].map(row=>row); for(const row of rows){db.insert(records,row);} return rows;", result:[{d2:2},{d2:3}],writes:[{d2:200},{d2:300}] },
  { name: "assignment map remains outside legacy subset", body: "let amounts=[1,2]; amounts=[3,4].map(n=>n+1); return amounts;",refuse:"E_OPAQUE" },
  { name: "helper map domain remains outside legacy subset", helpers:"function values(){return [1,2].map(n=>n);}",body:"for(const n of values()){} return null;",refuse:"E_OPAQUE" },
];
for (const flag of [false,true]) representationCases.push(
  { name:`homogeneous branch ${flag}`,args:{flag},body:"let n=2; if(args.flag){n=3;} db.insert(records,{d2:n}); return n;",result:flag?3:2,writes:[{d2:flag?300:200}] },
  { name:`homogeneous object branch ${flag}`,args:{flag},body:"let row={d2:2}; if(args.flag){row={d2:3};} db.insert(records,row); return row;",result:{d2:flag?3:2},writes:[{d2:flag?300:200}] },
  { name:`immutable selected mixed value ${flag}`,args:{flag},body:"const row=args.flag?{d2:args.d2}:{d2:2}; db.insert(records,row); return row;",result:{d2:flag?321:2},writes:[{d2:flag?321:200}] },
);

export type OperandCase = {name:string; body:string; expected?: unknown; error?: string};
export const operandCases: OperandCase[] = [
  {name:"assignment helper twice",body:'let value={a:"",b:""}; value=twice(ctx.newId()); return {value,next:ctx.newId()};',expected:{value:{a:"id-1",b:"id-1"},next:"id-2"}},
  {name:"declaration helper twice control",body:'const value=twice(ctx.newId()); return {value,next:ctx.newId()};',expected:{value:{a:"id-1",b:"id-1"},next:"id-2"}},
  {name:"assignment ignored helper argument",body:'let value=""; value=ignore(ctx.newId(),ctx.newId()); return {value,next:ctx.newId()};',expected:{value:"id-1",next:"id-3"}},
  {name:"assignment object order",body:'let value={z:"",a:""}; value={z:ctx.newId(),a:ctx.newId()}; return {value,next:ctx.newId()};',expected:{value:{z:"id-1",a:"id-2"},next:"id-3"}},
  {name:"assignment selected property consumes siblings",body:'let value=""; value=({a:ctx.newId(),b:ctx.newId()}).a; return {value,next:ctx.newId()};',expected:{value:"id-1",next:"id-3"}},
  {name:"assignment nested property consumes siblings",body:'let value=""; value=({a:{x:ctx.newId(),y:ctx.newId()},b:ctx.newId()}).a.x; return {value,next:ctx.newId()};',expected:{value:"id-1",next:"id-4"}},
  {name:"numeric property authored order",body:'return {"2":ctx.newId(),"1":ctx.newId(),next:ctx.newId()};',expected:{"2":"id-1","1":"id-2",next:"id-3"}},
  {name:"numeric property nested order",body:'return {value:{"2":ctx.newId(),"1":ctx.newId()},next:ctx.newId()};',expected:{value:{"2":"id-1","1":"id-2"},next:"id-3"}},
  {name:"captured concat consumes operands once",body:'const values=[ctx.newId(),...ident([ctx.newId()]),ctx.newId()]; return {values,next:ctx.newId()};',expected:{values:["id-1","id-2","id-3"],next:"id-4"}},
  {name:"top evaluates limit first",body:'return {x:top(numeric(ctx.newId()),[{at:1,id:ctx.newId()}],null,(x:any)=>x.id),next:ctx.newId()};',expected:{x:[{at:1,id:"id-2"}],next:"id-3"}},
  {name:"top evaluates ignored ordinary argument",body:'return {x:top(numeric(ctx.newId()),[{at:1,id:ctx.newId()}],ctx.newId(),(x:any)=>x.id),next:ctx.newId()};',expected:{x:[{at:1,id:"id-2"}],next:"id-4"}},
  {name:"assignment binary helper order",body:'let n=0; n=numeric(ctx.newId())+numeric(ctx.newId()); return {n,next:ctx.newId()};',expected:{n:2,next:"id-3"}},
  {name:"assignment template helper order",body:'let value=""; value=`${ctx.newId()} ${twice(ctx.newId()).a}`; return {value,next:ctx.newId()};',expected:{value:"id-1 id-2",next:"id-3"}},
  {name:"return errors in authored order",body:'return {z:divmod(1,args.zero),a:args.big+1};',error:"E_DIV_ZERO"},
  {name:"reversed error order control",body:'return {a:args.big+1,z:divmod(1,args.zero)};',error:"E_OVERFLOW"},
  {name:"numeric property error order",body:'return {"2":divmod(1,args.zero),"1":args.big+1};',error:"E_DIV_ZERO"},
  {name:"assignment error order",body:'let value:any={}; value={z:divmod(1,args.zero),a:args.big+1}; return value;',error:"E_DIV_ZERO"},
  {name:"ignored assignment helper argument can throw",body:'let value=""; value=ignore(ctx.newId(),divmod(1,args.zero)); return {value,next:ctx.newId()};',error:"E_DIV_ZERO"},
  {name:"unselected property can throw",body:'let value=0; value=({z:divmod(1,args.zero),a:1}).a; return value;',error:"E_DIV_ZERO"},
  {name:"nested array preserves first error",body:'return [{z:divmod(1,args.zero),a:args.big+1},ctx.newId()];',error:"E_DIV_ZERO"},
  {name:"helper argument preserves first error",body:'return ignore({z:divmod(1,args.zero),a:args.big+1},ctx.newId());',error:"E_DIV_ZERO"},
  {name:"binary containing object preserves first error",body:'return ({z:divmod(1,args.zero),a:args.big+1}).a+1;',error:"E_DIV_ZERO"},
  {name:"optional projection preserves first error",body:'return ({z:divmod(1,args.zero),a:args.big+1})?.a;',error:"E_DIV_ZERO"},
  {name:"false branch remains lazy",body:'return args.flag ? {z:divmod(1,args.zero),a:args.big+1} : ctx.newId();',expected:"id-1"},
  {name:"logical argument remains lazy",body:'return {value:false && ignore(ctx.newId(),divmod(1,args.zero)),next:ctx.newId()};',expected:{value:false,next:"id-1"}},
  {name:"nullish argument remains lazy",body:'const kept="kept"; return {value:kept ?? ignore(ctx.newId(),divmod(1,args.zero)),next:ctx.newId()};',expected:{value:"kept",next:"id-1"}},
  {name:"loop helper evaluates ignored argument",body:'for(const n of one(ctx.newId())){} return ctx.newId();',expected:"id-2"},
  {name:"literal range helper evaluates ignored argument",body:'for(const n of interval(ctx.newId())){} return ctx.newId();',expected:"id-2"},
];
export function operandSource(item: OperandCase): string {
  return `import {mutation,t,divmod} from 'snapback2';
function twice(x:any){return {a:x,b:x};} function ignore(x:any,y:any){return x;} function ident(x:any){return x;} function numeric(x:any){return 1;}
function one(x:any){return [1];}
declare const range:(a:number,b:number)=>number[]; function interval(x:any){return range(0,1);}
declare function top(a:any,b:any,c:any,d:any):any;
export const probe=mutation({zero:t.int(),big:t.int(),flag:t.bool()},({args,ctx})=>{${item.body}});`;
}
function decode(value: Value): unknown {
  if (value === "Null") return null;
  if ("Array" in value) return value.Array.map(decode);
  if ("Row" in value) return Object.fromEntries(Object.entries(value.Row).map(([name, item])=>[name,decode(item)]));
  return Object.values(value)[0];
}
export function executeOperands(program: Parameters<ClientStore["applyMutation"]>[0]) {
  const store=new ClientStore({tables:{}},{rows:[],ranges:[],absences:[],verdicts:[]});
  return store.applyMutation(program,{args:{zero:{Int:0},big:{Int:9007199254740991},flag:{Bool:false}},
    viewer:"v",principal_kind:"user",auth_epoch:0,now:0,read_time:0,new_ids:Array.from({length:16},(_,i)=>`id-${i+1}`)});
}
export function registerRepresentationChecks(test: Test, lib: string): void {
  registerProducerChecks(test, lib);
  for (const item of representationCases) test(`representation repair ${item.name} (actual IR values)`,()=>{
    const schema=compileInline([{fileName:"snapback/schema.q",source:repairSchema}]); assert(schema.ok);
    const tables=directTables(schema.project.schema);
    const full=lowerSource(repairSource(item),"probe.ts",lib,{tables});
    if(item.refuse){assert(!full.ok,JSON.stringify(full));assert(full.diagnostics.some(d=>d.code===item.refuse),JSON.stringify(full));return;}
    assert(full.ok,JSON.stringify(full));
    assert.deepEqual(runPure(full.programs[0]!,{term:"café",flag:false,d2:321,d3:4321,...item.args}),
      {result:item.result,scans:[],writes:item.writes??[]});
  });
  for(const item of operandCases) test(`operand repair ${item.name} (actual ClientStore)`,()=>{
    const full=lowerSource(operandSource(item),"operands.ts",lib);assert(full.ok,JSON.stringify(full));
    if(item.error){assert.throws(()=>executeOperands(full.programs[0]!),new RegExp(item.error));return;}
    const actual=executeOperands(full.programs[0]!);assert.equal(actual.state,"predicted");
    assert("execution" in actual && actual.execution);assert.deepEqual(decode(actual.execution.result),item.expected);
  });
  for(const [name,body,error] of [
    ["authored","return {z:divmod(1,zero),a:big+1}","E_DIV_ZERO"],
    ["reversed","return {a:big+1,z:divmod(1,zero)}","E_OVERFLOW"],
    ["bound","z = divmod(1,zero)\n  return {z,a:big+1}","E_DIV_ZERO"],
  ]) test(`public Quarry error order ${name} (actual ClientStore)`,async()=>{
    const source=`mutation probe(zero:int,big:int):\n  ${body}\n`;
    const full=await withProject({"snapback/schema.q":repairSchema,"snapback/probe.q":source},root=>lowerProject(root));
    assert(full.ok,JSON.stringify(full));assert.throws(()=>executeOperands(full.project.programs[0]!),new RegExp(error!));
  });
}
