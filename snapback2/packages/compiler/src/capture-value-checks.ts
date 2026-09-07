import { registerCaptureRepairChecks } from "./capture-repair-checks";
import assert from "node:assert/strict";
import { searchWords } from "../../evaluator/src/unicode";
import { lowerSource } from "./compiler";
import { lowerSchema } from "./lower/schema";
import { lowerProject } from "./project";
import { withProject, type Test } from "./quarry-check-helpers";
import type { Expr, Program, Scan, Stmt, Value } from "./ir";

const schema = `table people:
  text: text <=3
  by search: wordPrefixes(text), id
  by ordinary: text, id
  public
table records:
  narrow: text <=5
  wide: text <=4000
  terms: [text <=200] <=101
  d2: decimal 2
  d3: decimal 3
  public
  insert <- allow
`;

export type PureValue = null | boolean | number | string | PureValue[] | { [name: string]: PureValue };
/** Executes pure IR and records scan operands/writes. Scans return supplied rows;
 * this is deliberately no storage, certification, normalization or authority proof. */
export function runPure(program: Program, args: Record<string, PureValue> = {}, rows: Record<string, PureValue[]> = {},
  addresses: Array<{ operation: string; key: PureValue[] }> = [], observations: Array<{kind:string;value:PureValue}> = []): { result: PureValue; scans: Array<{ table: string; prefix: Array<{ source: PureValue; Q: number } | { scalar: PureValue }> }>; writes: PureValue[] } {
  const vars = new Map<string, PureValue>(Object.entries(args));
  const scans: Array<{ table: string; prefix: Array<{ source: PureValue; Q: number } | { scalar: PureValue }> }> = [];
  const writes: PureValue[] = [];
  const returned = Symbol("return");
  let result: PureValue = null;
  let newIds = 0;
  function decode(value: Value): PureValue {
    if (value === "Null") return null;
    if ("Array" in value) return value.Array.map(decode);
    if ("Row" in value || "Map" in value) return Object.fromEntries(Object.entries("Row" in value ? value.Row : value.Map).map(([k,v]) => [k,decode(v)]));
    return Object.values(value)[0];
  }
  function scan(value: Scan): PureValue[] {
    scans.push({ table: value.table, prefix: value.prefix.map(key => "WordPrefix" in key
      ? { source: evaluate(key.WordPrefix.source), Q: key.WordPrefix.source_max } : { scalar: evaluate(key.Scalar) }) });
    if (value.after) observations.push({kind:"after",value:evaluate(value.after)});
    if (value.before) observations.push({kind:"before",value:evaluate(value.before)});
    if (value.range) for (const [kind,bound] of Object.entries(value.range)) if (bound) observations.push({kind,value:evaluate(bound)});
    return rows[value.table] ?? [];
  }
  function evaluate(expr: Expr): PureValue {
    if ("Literal" in expr) return decode(expr.Literal);
    // IR variables carry values; a spread copy must not share the harness's JS array identity.
    if ("Variable" in expr) { assert(vars.has(expr.Variable), `unbound ${expr.Variable}`); return structuredClone(vars.get(expr.Variable)!); }
    if ("Input" in expr) return expr.Input === "Viewer" ? "viewer-1" : expr.Input === "NewId" ? (++newIds === 1 ? "new-id" : `new-id-${newIds}`) : 0;
    if ("Array" in expr) return expr.Array.map(evaluate);
    if ("Object" in expr) return Object.fromEntries(Object.entries(expr.Object).map(([k,v]) => [k,evaluate(v)]));
    if ("Field" in expr) {
      const base = evaluate(expr.Field.base);
      assert(base && typeof base === "object" && !Array.isArray(base), "Field requires an object");
      return base[expr.Field.name] ?? null;
    }
    if ("Unary" in expr) { const value = evaluate(expr.Unary.value); if (expr.Unary.op === "Not") return !value; assert.equal(typeof value,"number"); return -Number(value); }
    if ("Binary" in expr) {
      const a = evaluate(expr.Binary.left), b = evaluate(expr.Binary.right);
      if (expr.Binary.op === "Eq") return a === b;
      if (expr.Binary.op === "Ne") return a !== b;
      assert(typeof a === "number" && typeof b === "number", "numeric binary operands");
      if (expr.Binary.op === "Add") return a + b;
      if (expr.Binary.op === "Sub") return a - b;
      if (expr.Binary.op === "Mul") return a * b;
      if (expr.Binary.op === "Lt") return a < b;
      if (expr.Binary.op === "Gt") return a > b;
    }
    if ("Builtin" in expr) {
      const args = expr.Builtin.args.map(evaluate);
      if (expr.Builtin.builtin === "Words") { const input=args[0]; assert(input === null || typeof input === "string"); return searchWords(input, typeof input === "string" ? [...input].length : 0); }
      if (expr.Builtin.builtin === "Len") { const value=args[0]; assert(typeof value === "string" || Array.isArray(value)); return value.length; }
      if (expr.Builtin.builtin === "Concat") { const [a,b]=args; return Array.isArray(a) && Array.isArray(b) ? [...a,...b] : String(a)+String(b); }
    }
    if ("Scan" in expr) return scan(expr.Scan);
    if ("Get" in expr || "Exists" in expr) {
      const read = "Get" in expr ? expr.Get : expr.Exists;
      addresses.push({ operation: "Get" in expr ? "Get" : "Exists", key: read.key.map(evaluate) });
      const row = rows[read.table]?.[0] ?? null;
      return "Get" in expr ? row : row !== null;
    }
    if ("Merge" in expr) {
      const values: PureValue[] = [];
      for (const lane of expr.Merge.lanes) for (const row of lane.source ? scan(lane.source) : [null]) {
        if (lane.binding) vars.set(lane.binding,row);
        statements(lane.setup ?? []);
        values.push(...scan(lane.scan));
      }
      return values;
    }
    throw new Error(`unsupported pure expression ${JSON.stringify(expr)}`);
  }
  function statements(body: Stmt[]) {
    for (const stmt of body) {
      if (typeof stmt === "string") throw new Error(`unsupported ${stmt}`);
      if ("Const" in stmt || "Let" in stmt) { const v = "Const" in stmt ? stmt.Const : stmt.Let; vars.set(v.name,evaluate(v.value)); }
      else if ("Assign" in stmt) vars.set(stmt.Assign.name,evaluate(stmt.Assign.value));
      else if ("If" in stmt) statements(evaluate(stmt.If.condition) ? stmt.If.then_body : stmt.If.else_body);
      else if ("Return" in stmt) { result=evaluate(stmt.Return); throw returned; }
      else if ("Insert" in stmt) writes.push(evaluate(stmt.Insert.row));
      else if ("Update" in stmt || "Upsert" in stmt || "Delete" in stmt) {
        const write = "Update" in stmt ? stmt.Update : "Upsert" in stmt ? stmt.Upsert : stmt.Delete;
        addresses.push({ operation: "Update" in stmt ? "Update" : "Upsert" in stmt ? "Upsert" : "Delete", key: [evaluate(write.key)] });
        if ("Update" in stmt) writes.push(evaluate(stmt.Update.patch));
        if ("Upsert" in stmt) writes.push(evaluate(stmt.Upsert.row));
      }
      else if ("Require" in stmt) assert(evaluate(stmt.Require.condition),stmt.Require.code);
      else if ("For" in stmt) {
        const d=stmt.For.domain;
        const values="DerivedArray" in d ? evaluate(d.DerivedArray.value) : "ArgList" in d ? vars.get(d.ArgList.name) : "Page" in d ? scan(d.Page) : undefined;
        assert(Array.isArray(values), "pure for domain");
        for (const value of values) { vars.set(stmt.For.binding,value); statements(stmt.For.body); }
      } else if ("Push" in stmt) { const value=vars.get(stmt.Push.target); assert(Array.isArray(value)); value.push(evaluate(stmt.Push.value)); }
      else throw new Error(`unsupported pure statement ${JSON.stringify(stmt)}`);
    }
  }
  try { statements(program.body); } catch (error) { if (error !== returned) throw error; }
  return { result, scans, writes };
}

async function compile(source: string, customSchema = schema) {
  return withProject({ "snapback/schema.q": customSchema, "snapback/probe.q": source }, root => lowerProject(root));
}

export function registerCaptureValueChecks(test: Test, lib: string) {
  registerMutableKeyChecks(test, lib);
  registerCaptureRepairChecks(test, lib);
  for (const max of [4000,1073741824]) for (const place of ["none","before","after"]) {
    test(`literal capture has exact Q4 with ${max} target ${place} (pure IR)`, async () => {
      const write="  if false:\n    insert records { narrow: '', wide: original, terms: [], d2: 0, d3: 0 }\n";
      const source=`mutation probe():\n  original = 'café'\n${place==='before'?write:''}  page = people[original] first 2 by search\n${place==='after'?write:''}  return page\n`;
      const full=await compile(source,schema.replace('wide: text <=4000',`wide: text <=${max}`));
      assert(full.ok,JSON.stringify(full));
      assert.deepEqual(runPure(full.project.programs[0]!).scans[0]!.prefix,[{source:'café',Q:4}]);
    });
  }
  for (const helper of [false,true]) for (const search of [false,true]) for (const shadow of [false,true]) {
    test(`tuple capture helper=${helper} search=${search} shadow=${shadow} retains actual x`, async () => {
      const base=await compile('query probe():\n  return null\n'); assert(base.ok);
      const tables=lowerSchema(base.quarry.find(q=>q.file==='snapback/schema.q')!.source,'schema.ts',true).tables;
      const source=`import {query,t} from 'snapback2'; declare const people:any;
${helper?'function key(x:string) {return [x];}':''}
export const probe=query({term:t.text(2000)},({db,args})=>{
  const wide='x'; const original=${helper?'key(wide)':'[wide]'};
  if(true){const ${shadow?'wide':'other'}=args.term; return db.scan(people.${search?'search':'ordinary'},original,{take:2});} return null;
});`;
      const full=lowerSource(source,'probe.ts',lib,{tables}); assert(full.ok,JSON.stringify(full));
      assert.deepEqual(runPure(full.programs[0]!,{term:'café'}).scans[0]!.prefix,search?[{source:'x',Q:1}]:[{scalar:'x'}]);
    });
  }
  for (const initial of ["wide", "wide ?? ''", "{text:wide}.text", "{nested:{text:wide}}.nested.text"]) {
    for (const widen of [false,true]) test(`captured ${initial} ${widen?'widens':'narrows'} only at later binding (pure IR)`, async () => {
      const full=await compile(`mutation probe(term: text <=2000):\n  wide = ${widen?"'x'":'term'}\n  original = ${initial}\n  alias = original\n  if true:\n    wide = ${widen?'term':"'x'"}\n    page = people[alias] first 2 by search\n    if false:\n      insert records { narrow: alias, wide: original, terms: [], d2: 0, d3: 0 }\n    return { original, alias, page, wide }\n  return null\n`);
      assert(full.ok,JSON.stringify(full));
      const value=widen?'x':'café'; const actual=runPure(full.project.programs[0]!,{term:'café'});
      assert.deepEqual(actual.scans[0]!.prefix,[{source:value,Q:widen?1:2000}]);
      assert.deepEqual(actual.result,{original:value,alias:value,page:[],wide:widen?'café':'x'});
    });
  }
  test('tuple aliases and helper parameters reuse captured values across same-name shadows', async () => {
    const base=await compile('query probe():\n  return null\n'); assert(base.ok);
    const tables=lowerSchema(base.quarry[0]!.source,'schema.ts',true).tables;
    const full=lowerSource(`import {query,t} from 'snapback2'; declare const people:any;
function scan(key:string[]) {return db.scan(people.search,key,{take:2});} declare const db:any;
export const probe=query({term:t.text(2000)},({args,db})=>{ const x='x'; const key=[x]; const alias=key;
 if(true){const x=args.term; const key=[args.term]; return {key:alias, page:scan(alias)};} return null; });`,'probe.ts',undefined,{tables});
    assert(full.ok,JSON.stringify(full));
    const actual=runPure(full.programs[0]!,{term:'café'});
    assert.deepEqual(actual.scans[0]!.prefix,[{source:'x',Q:1}]);
    assert.deepEqual(actual.result,{key:['x'],page:[]});
  });
  for (const reverse of [false,true]) test(`target Decimal conversions preserve ordinary captured values (${reverse})`, async () => {
    const assignments=reverse?'d3: value, d2: value':'d2: value, d3: value';
    const base=await compile('query probe():\n  return null\n'); assert(base.ok);
    const tables=lowerSchema(base.quarry[0]!.source,'schema.ts',true).tables;
    const full=lowerSource(`import {mutation} from 'snapback2'; declare const records:any; export const probe=mutation({},({db})=>{ const value=2; const original=value; db.insert(records,{narrow:'',wide:'',terms:[],${assignments}}); return {value,original}; });`,'probe.ts',lib,{tables});
    assert(full.ok,JSON.stringify(full));
    const actual=runPure(full.programs[0]!);
    assert.deepEqual(actual.result,{value:2,original:2});
    assert.deepEqual(actual.writes,[{narrow:'',wide:'',terms:[],d2:200,d3:2000}]);
  });
  for (const helper of [false,true]) test(`captured row conversions retain original fields and alias values (${helper})`, async () => {
    const base=await compile('query probe():\n  return null\n'); assert(base.ok);
    const tables=lowerSchema(base.quarry[0]!.source,'schema.ts',true).tables;
    const source=`import {mutation} from 'snapback2'; declare const records:any;
      function row(x:number) {return {narrow:'',wide:'',terms:[],d2:x,d3:x};}
      export const probe=mutation({},({db})=>{const n=2; const original=${helper?'row(n)':"{narrow:'',wide:'',terms:[],d2:n,d3:n}"}; const alias=original;
        if(true){const n=7; db.insert(records,alias);} return {n,original,alias};});`;
    const full=lowerSource(source,'probe.ts',lib,{tables}); assert(full.ok,JSON.stringify(full));
    const actual=runPure(full.programs[0]!);
    const row={narrow:'',wide:'',terms:[],d2:2,d3:2};
    assert.deepEqual(actual.result,{n:2,original:row,alias:row});
    assert.deepEqual(actual.writes,[{...row,d2:200,d3:2000}]);
  });
  test('ordinary lexical variables survive nested blocks, loops, callbacks and operation-argument shadows', () => {
    const full=lowerSource(`import {query,t} from 'snapback2';
      export const probe=query({n:t.int()},({args})=>{const n=2; const original=n;
        if(true){const n=7; const original=n;}
        for(const n of [8,9]) { const original=n; }
        const values=[10,11].map(n=>n+1);
        const sum=[3,4].reduce((n,original)=>n+original,0);
        return {n,original,argument:args.n,values,sum};});`,'probe.ts',lib);
    assert(full.ok,JSON.stringify(full));
    assert.deepEqual(runPure(full.programs[0]!,{n:23}).result,{n:2,original:2,argument:23,values:[11,12],sum:7});
  });
  test('nested helper substitutions evaluate argument values once and retain per-use scales', async () => {
    const base=await compile('query probe():\n  return null\n'); assert(base.ok);
    const tables=lowerSchema(base.quarry[0]!.source,'schema.ts',true).tables;
    const full=lowerSource(`import {mutation} from 'snapback2'; declare const records:any;
      function inner(x:number){return x;} function outer(x:number){return inner(x);}
      export const probe=mutation({},({db})=>{const x=2;
        db.insert(records,{narrow:'',wide:'',terms:[],d2:outer(x),d3:outer(x)}); return x;});`,'probe.ts',lib,{tables});
    assert(full.ok,JSON.stringify(full));
    const actual=runPure(full.programs[0]!);
    assert.equal(actual.result,2);
    assert.deepEqual(actual.writes,[{narrow:'',wide:'',terms:[],d2:200,d3:2000}]);
  });

  test('a helper actual argument is evaluated once even when its parameter is used twice', () => {
    const full=lowerSource(`import {mutation} from 'snapback2'; function pair(x:string){return [x,x];}
      export const probe=mutation({},({ctx})=>{const values=pair(ctx.newId()); const next=ctx.newId(); return {values,next};});`,'probe.ts',lib);
    assert(full.ok,JSON.stringify(full));
    assert.deepEqual(runPure(full.programs[0]!).result,{values:['new-id','new-id'],next:'new-id-2'});
  });
  test('tuple components capture a mutable scalar before its later assignment', async () => {
    const base=await compile('query probe():\n  return null\n'); assert(base.ok);
    const tables=lowerSchema(base.quarry[0]!.source,'schema.ts',true).tables;
    const full=lowerSource(`import {query,t} from 'snapback2'; declare const people:any;
      export const probe=query({term:t.text(2000)},({db,args})=>{let x='x'; const key=[x]; x=args.term;
        const page=db.scan(people.ordinary,key,{take:2}); return {key,page,x};});`,'probe.ts',lib,{tables});
    assert(full.ok,JSON.stringify(full));
    const actual=runPure(full.programs[0]!,{term:'café'});
    assert.deepEqual(actual.result,{key:['x'],page:[],x:'café'});
    assert.deepEqual(actual.scans[0]!.prefix,[{scalar:'x'}]);
  });
  test('nested list and Id conversions apply only to their row destination', async () => {
    const custom=schema.replace('d2: decimal 2','owner: id\n  amounts: [decimal 3] <=4\n  d2: decimal 2');
    const base=await compile('query probe():\n  return null\n',custom); assert(base.ok);
    const tables=lowerSchema(base.quarry[0]!.source,'schema.ts',true).tables;
    const full=lowerSource(`import {mutation} from 'snapback2'; declare const records:any;
      export const probe=mutation({},({db})=>{const n=2; const original={owner:'id',amounts:[n,3],d2:n,d3:n}; const alias=original;
        if(true){const n=7; db.insert(records,alias);} return {n,original};});`,'probe.ts',lib,{tables});
    assert(full.ok,JSON.stringify(full));
    const actual=runPure(full.programs[0]!);
    assert.deepEqual(actual.result,{n:2,original:{owner:'id',amounts:[2,3],d2:2,d3:2}});
    assert.deepEqual(actual.writes,[{owner:'id',amounts:[2000,3000],d2:200,d3:2000}]);
    assert(JSON.stringify(full.programs[0]).includes('"Literal":{"Id":"id"}'));
    assert(JSON.stringify(full.programs[0]).includes('"Literal":{"String":"id"}'));
  });

  test('generated capture and binding registers cannot collide with authored names', () => {
    const full=lowerSource(`import {query} from 'snapback2'; function pair(x:number){return [x,x];}
      export const probe=query({},()=>{const __helperArgument0=42; const __capturedItem1=43; const __nBinding2=44;
        const n=2; const key=pair(n); if(true){const n=7;}
        return {key,n,a:__helperArgument0,b:__capturedItem1,c:__nBinding2};});`,'probe.ts',lib);
    assert(full.ok,JSON.stringify(full));
    assert.deepEqual(runPure(full.programs[0]!).result,{key:[2,2],n:2,a:42,b:43,c:44});
  });

  for (const helper of [false,true]) test(`tuple cursor context follows lexical aliases and helper arguments (${helper})`, async () => {
    const custom=schema.replace('text: text <=3','text: text <=3\n  at: int').replace('by ordinary: text, id','by ordinary: text, at, id');
    const base=await compile('query probe():\n  return null\n',custom); assert(base.ok);
    const tables=lowerSchema(base.quarry[0]!.source,'schema.ts',true).tables;
    const full=lowerSource(`import {query} from 'snapback2'; declare const people:any;
      function inner(key:any){return key;} function outer(key:any){return inner(key);}
      export const probe=query({},({db})=>{const key=['x',7]; const alias=key;
        if(true){const key=alias; return db.scan(people.ordinary,${helper?'outer(key)':'key'},{take:2,after:'id'});} return null;});`,'probe.ts',lib,{tables});
    assert(full.ok,JSON.stringify(full));
    assert.deepEqual(runPure(full.programs[0]!).scans[0]!.prefix,[{scalar:'x'},{scalar:7}]);
    assert(JSON.stringify(full.programs[0]).includes('"after":{"Literal":{"Id":"id"}}'));
  });

  for (const [expression,expected] of [['-n',-2],['n+3',5],['true?n:3',2],['empty??n',2]] as const) {
    test(`captured row field ${expression} converts its evaluated result without changing the source`, async () => {
      const base=await compile('query probe():\n  return null\n'); assert(base.ok);
      const tables=lowerSchema(base.quarry[0]!.source,'schema.ts',true).tables;
      const full=lowerSource(`import {mutation} from 'snapback2'; declare const records:any;
        export const probe=mutation({},({db})=>{const n=2; const empty=null; const original={d2:${expression},d3:${expression}};
          db.insert(records,original); return {n,original};});`,'probe.ts',lib,{tables});
      assert(full.ok,JSON.stringify(full));
      const actual=runPure(full.programs[0]!);
      assert.deepEqual(actual.result,{n:2,original:{d2:expected,d3:expected}});
      assert.deepEqual(actual.writes,[{d2:expected*100,d3:expected*1000}]);
    });
  }

}

export const addressSchema = `import {schema,table,t,rule} from 'snapback2';
export const people=table({columns:{text:t.text(3)},indexes:{
 search:{components:[{WordPrefixes:{fields:['text'],contract:'u17-nfc-scf-nfc-wsp-p'}},{Column:'id'}]},
 ordinary:{components:[{Column:'text'},{Column:'id'}],unique:true}},
 rules:{read:rule.allow(),update:rule.allow(),delete:rule.allow(),insert:rule.allow()}});
export default schema({tables:{people}});`;

export function mutableKeyCases() {
  const cases: Array<{name:string; body:string; accepted:boolean; prefix?: Array<{scalar:string}|{source:string;Q:number}>}> = [];
  for (const [name, setup, key] of [
    ['push', "const key=['x']; key.push('y');", 'key'],
    ['empty push', "const key:string[]=[]; key.push('x');", 'key'],
    ['repeated push', "const key=['x']; key.push('y'); key.push('z');", 'key'],
    ['branch push', "const key=['x']; if(args.flag){key.push('y');}", 'key'],
    ['loop push', "const key=['x']; for(const x of ['y']){key.push(x);}", 'key'],
    ['conditional push', "const key=['x']; args.flag ? key.push('y') : key.push('z');", 'key'],
    ['alias push', "const key=['x']; const alias=key; key.push('y');", 'alias'],
    ['alias receiver', "const key=['x']; const alias=key; alias.push('y');", 'key'],
    ['alias after push', "const key=['x']; key.push('y'); const alias=key;", 'alias'],
    ['field escape', "const key=['x']; key.push('y'); const box={key};", 'box.key'],
    ['tuple escape', "const key=['x']; key.push('y'); const outer=[key];", 'outer'],
    ['helper result', "const key=['x']; key.push('y');", 'identity(key)'],
    ['helper alias', "const key=['x']; key.push('y'); const alias=identity(key);", 'alias'],
    ['copy push', "const original=['x']; const key=[...original]; key.push('y');", 'key'],
    ['copy after push', "const original=['x']; original.push('y'); const key=[...original];", 'key'],
    ['branch copy after push', "const original=['x']; if(args.flag){original.push('y');} const key=[...original];", 'key'],
    ['assigned tuple', "let key=['x']; key=['y'];", 'key'],
    ['assigned tuple alias', "let key=['x']; const alias=key; key=['y'];", 'alias'],
    ['assigned unknown tuple', "let key=args.keys; key=['y'];", 'key'],
    ['list argument', "const key=args.keys;", 'key'],
    ['element assignment', "const key=['x']; key[0]='y';", 'key'],
    ['length assignment', "const key=['x']; key.length=0;", 'key'],
  ]) for (const search of [false,true]) cases.push({name:`mutable address ${name} ${search?'search':'ordinary'}`,
    body:`${setup} const page=db.scan(people.${search?'search':'ordinary'},${key},{take:2}); return {key,page};`, accepted:false});
  for (const [name, setup, key] of [
    ['immutable alias', "const key=['x']; const alias=key;", 'alias'],
    ['immutable helper', "const key=['x'];", 'identity(key)'],
    ['stable let', "let key=['x'];", 'key'],
    ['mutable scalar capture', "let x='x'; const key=[x]; x=args.term;", 'key'],
    ['mutable scalar helper capture', "let x='x'; const key=identity([x]); x=args.term;", 'key'],
    ['shadowed mutable collection', "const key=['x']; if(true){const key=['z']; key.push('y');}", 'key'],
  ]) for (const search of [false,true]) cases.push({name:`fixed address ${name} ${search?'search':'ordinary'}`,
    body:`${setup} const page=db.scan(people.${search?'search':'ordinary'},${key},{take:2}); return {key,page};`, accepted:true,
    prefix:search?[{source:'x',Q:1}]:[{scalar:'x'}]});
  cases.push({name:'fixed address immutable field',body:"const key=['x']; const box={key}; const page=db.scan(people.ordinary,box.key,{take:2}); return {key,page};",accepted:true,prefix:[{scalar:'x'}]});
  cases.push({name:'fixed address spread copy before source mutation',body:"const original=['x']; const key=[...original]; original.push('y'); const page=db.scan(people.ordinary,key,{take:2}); return {key,page};",accepted:true,prefix:[{scalar:'x'}]});
  for (const operation of ['get','exists']) cases.push({name:`mutable address ${operation}`,
    body:`const key=['x']; key.push('y'); const result=db.${operation}(people.ordinary,key); return {key,result};`,accepted:false});
  for (const operation of ['update','upsert','delete']) for (const callback of operation==='delete'?[false]:[false,true]) {
    const row=operation==='upsert'?"{id:'x',text:'z'}":"{text:'z'}";
    cases.push({name:`mutable address ${operation} callback=${callback}`,
      body:`const key=['x']; key.push('y'); db.${operation}(people,key${operation==='delete'?'':','+(callback?'row=>('+row+')':row)}); return key;`,accepted:false});
  }
  return cases.map(c=>({...c,source:`import {mutation,t} from 'snapback2'; declare const people:any;
function identity(x:string[]){return x;}
export const probe=mutation({term:t.text(2000),flag:t.bool(),keys:t.list(t.text(3),{max:3})},({db,args})=>{${c.body}});`}));
}

function registerMutableKeyChecks(test: Test, lib: string) {
  const {tables,diagnostics}=lowerSchema(addressSchema,'schema.ts');
  assert.deepEqual(diagnostics,[]);
  for(const c of mutableKeyCases()) test(c.name,()=>{
    const full=lowerSource(c.source,'probe.ts',lib,{tables});
    assert.equal(full.ok,c.accepted,JSON.stringify(full));
    if(full.ok){
      const actual=runPure(full.programs[0]!,{term:'café',flag:true,keys:['y']});
      assert.deepEqual(actual.scans[0]!.prefix,c.prefix);
      assert.deepEqual(actual.result,{key:['x'],page:[]});
    } else {
      assert(full.diagnostics.some(d=>d.code==='E_OPAQUE'||d.code==='E_PROVENANCE_AMBIGUOUS'),JSON.stringify(full));
      for(const d of full.diagnostics){assert(d.site.startsWith('probe.ts:'));assert(d.rewrite);assert(d.guide);}
      if(c.name.includes('alias push')||c.name.includes('alias receiver')||c.name.includes('alias after push')) {
        assert(full.diagnostics.some(d=>d.message.includes('aliased under another binding')));
      } else if(!c.name.includes('element assignment')&&!c.name.includes('length assignment')) {
        assert(full.diagnostics.some(d=>d.message.includes('address tuples require a fixed immutable shape')));
      }
    }
  });
  test('fixed scalar write identities retain their actual value through a capture',()=>{
    const full=lowerSource(`import {mutation} from 'snapback2'; declare const people:any;
      export const probe=mutation({},({db})=>{let x='x'; const id=x; x='y';
        db.update(people,id,{text:'z'}); db.delete(people,id); return {id,x};});`,'probe.ts',lib,{tables});
    assert(full.ok,JSON.stringify(full));
    const addresses: Array<{operation:string;key:PureValue[]}> = [];
    const actual=runPure(full.programs[0]!,{}, {},addresses);
    assert.deepEqual(addresses,[{operation:'Update',key:['x']},{operation:'Delete',key:['x']}]);
    assert.deepEqual(actual.result,{id:'x',x:'y'});
  });
  test('mutable arrays remain usable as collections when they are not address tuples',()=>{
    const full=lowerSource(`import {mutation} from 'snapback2'; export const probe=mutation({},()=>{
      const key=['x']; key.push('y'); return key;});`,'probe.ts',lib);
    assert(full.ok,JSON.stringify(full)); assert.deepEqual(runPure(full.programs[0]!).result,['x','y']);
  });
  for (const method of ['push','append']) test(`Quarry refuses address array ${method} at the public grammar`,async()=>{
    const full=await compile(`query probe():\n  key = ['x']\n  key.${method}('y')\n  return people[key] first 2 by ordinary\n`);
    assert(!full.ok);
    assert(full.diagnostics.some(d=>d.code==='E_QUARRY_SYNTAX'&&d.site.startsWith('snapback/probe.q:3:')));
  });
  test('Quarry addresses contain positional scalar expressions, not a list-valued component',async()=>{
    const full=await compile("query probe():\n  key = ['x']\n  return people[key] first 2 by ordinary\n");
    assert(!full.ok);
    assert(full.diagnostics.some(d=>d.code==='E_QUARRY_UNKNOWN'&&d.message.includes('expects text')&&d.site.startsWith('snapback/probe.q:3:')));
  });
}
