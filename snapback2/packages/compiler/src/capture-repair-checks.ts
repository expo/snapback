import assert from "node:assert/strict";
import { registerRepresentationChecks } from "./capture-representation-checks";
import { ClientStore } from "../../evaluator/src/store";
import { lowerSource } from "./compiler";
import { lowerSchema } from "./lower/schema";
import { lowerProject } from "./project";
import { compileInline, withProject, type Test } from "./quarry-check-helpers";
import { runPure, type PureValue } from "./capture-value-checks";

export const repairSchema = `table people:
  text: text <=3
  by search: wordPrefixes(text), id
  by ordinary: text, id
  public
table records:
  d2: decimal 2
  d3: decimal 3
  owner: id
  amounts: [decimal 3] <=4
  public
  insert <- allow
  update <- allow
`;
const id1 = "new-id", id2 = "new-id-2", id3 = "new-id-3";
type Actual = ReturnType<typeof runPure>;
export type RepairCase = { name: string; body: string; helpers?: string; args?: Parameters<typeof runPure>[1];
  observations?: Array<{kind:string;value:PureValue}>; addresses?: Array<{operation:string;key:PureValue[]}>; rows?: Parameters<typeof runPure>[2];
  result?: Actual["result"]; writes?: Actual["writes"]; prefix?: Actual["scans"][number]["prefix"]; refuse?: string };
export const repairCases: RepairCase[] = [
  { name: "original literal-origin concat", helpers:"import {concat} from 'snapback2';", body: "const n=2; const amounts=concat([n],[3]); db.insert(records,{amounts}); return amounts;", result:[2,3],writes:[{amounts:[2000,3000]}] },
  { name: "helper-order-array", body: "const x=[ctx.newId(),ident(ctx.newId())]; return x;", result: [id1,id2] },
  { name: "helper-order-object", body: "const x={a:ctx.newId(),b:ident(ctx.newId())}; return x;", result: {a:id1,b:id2} },
  { name: "helper-order-return", body: "return [ctx.newId(),ident(ctx.newId())];", result: [id1,id2] },
  { name: "helper-order-args", body: "return pair(ctx.newId(),ident(ctx.newId()));", result: [id1,id2] },
  { name: "helper-order-key", body: "return db.scan(people.ordinary,[ctx.newId(),ident(ctx.newId())],{take:2});", prefix: [{scalar:id1},{scalar:id2}] },
  { name: "helper-order-cursor", body: "return db.scan(people.ordinary,[ctx.newId()],{take:2,after:ident(ctx.newId())});", prefix: [{scalar:id1}] },
  { name: "object-authored-key-order", body: "return {z:ctx.newId(),a:ctx.newId()};", result:{z:id1,a:id2} },
  { name: "template-helper-once-order", helpers:"function twice(x:any){return {a:x,b:x};}", body: "return `${ctx.newId()} ${twice(ctx.newId()).a}`;", result:`${id1} ${id2}` },
  { name: "reduce-domain-before-initial", body: "return {first:[ctx.newId()].reduce((acc,x)=>x,ctx.newId()),next:ctx.newId()};", result:{first:id1,next:id3} },
  { name: "cursor-range-authored-order", body:"return db.scan(people.ordinary,[ctx.newId()],{take:2,range:{lte:ctx.newId(),gt:ident(ctx.newId())},after:ident(ctx.newId())});", prefix:[{scalar:id1}], observations:[{kind:'after',value:'new-id-4'},{kind:'gt',value:id3},{kind:'lte',value:id2}] },
  { name: "write-key-before-helper-patch", helpers:"function numeric(x:any){return 2;}", body:"db.update(records,ctx.newId(),{d2:numeric(ctx.newId())}); return ctx.newId();",result:id3,writes:[{d2:200}],addresses:[{operation:'Update',key:[id1]}] },
  { name: "write-callback-key-once", body:"db.update(records,ctx.newId(),row=>({d2:2})); return ctx.newId();",rows:{records:[{}]},result:id2,writes:[{d2:200}],addresses:[{operation:'Get',key:[id1]},{operation:'Update',key:[id1]}] },
  { name: "nested-tuple-order", body: "const x={a:ctx.newId(),b:[ctx.newId()]}; return x;", result: {a:id1,b:[id2]} },
  { name: "nested-helper-order", body: "return {a:ctx.newId(),b:[{c:ident(ctx.newId()),d:ctx.newId()}]};", result: {a:id1,b:[{c:id2,d:id3}]} },
  { name: "object-override-order", body: "return {a:ctx.newId(),a:ident(ctx.newId()),next:ctx.newId()};", refuse:"E_OPAQUE" },
  { name: "object-spread-override-order", body: "return {a:ctx.newId(),...{a:ident(ctx.newId())},next:ctx.newId()};", refuse:"E_OPAQUE" },
  { name: "array-spread-order", body: "return [ctx.newId(),...ident([ctx.newId()]),ctx.newId()];", result: [id1,id2,id3] },
  { name: "call-binary-order", helpers: "function numeric(x:any){return 2;}", body: "return {n:numeric(ctx.newId()) + ident(numeric(ctx.newId())),next:ctx.newId()};", result: {n:4,next:id3} },
  { name: "short-circuit-false", body: "return {x:false && ident(ctx.newId()),next:ctx.newId()};", result:{x:false,next:id1} },
  { name: "short-circuit-true", body: "return {x:true || ident(ctx.newId()),next:ctx.newId()};", result:{x:true,next:id1} },
  { name: "coalesce-lazy", body: "const x='x'; return {x:x ?? ident(ctx.newId()),next:ctx.newId()};", result:{x:'x',next:id1} },
  { name: "list-alias-decimal", body: "const n=2; const amounts=[n,3]; const row={amounts}; db.insert(records,row); return {row,amounts};", result:{row:{amounts:[2,3]},amounts:[2,3]},writes:[{amounts:[2000,3000]}] },
  { name: "helper-in-array-decimal", body: "const n=2; const row={amounts:ident([n,3])}; db.insert(records,row); return row;", result:{amounts:[2,3]},writes:[{amounts:[2000,3000]}] },
  { name: "list-spread-decimal", body: "const n=2; const amounts=[n,3]; const row={amounts:[...amounts]}; db.insert(records,row); return {row,amounts};", result:{row:{amounts:[2,3]},amounts:[2,3]},writes:[{amounts:[2000,3000]}] },
  { name: "object-spread-decimal", body: "const n=2; const row={d2:n,d3:n}; const alias={...row}; db.insert(records,alias); return {row,alias};", result:{row:{d2:2,d3:2},alias:{d2:2,d3:2}},writes:[{d2:200,d3:2000}] },
  { name: "helper-object-decimal", body: "const n=2; const row=ident({d2:n,d3:n}); db.insert(records,row); return row;", result:{d2:2,d3:2},writes:[{d2:200,d3:2000}] },
  { name: "conditional-single-decimal", body: "const row=true?{d2:2}:{d2:3}; db.insert(records,row); return row;", result:{d2:2},writes:[{d2:200}] },
  { name: "coalesce-single-decimal", body: "const empty=null; const row=empty??{d2:2}; db.insert(records,row); return row;", result:{d2:2},writes:[{d2:200}] },
  { name: "conditional-object-decimal", body: "const n=2; const row=true?{d2:n,d3:n}:{d2:3,d3:3}; db.insert(records,row); return row;", result:{d2:2,d3:2},writes:[{d2:200,d3:2000}] },
  { name: "coalesce-object-decimal", body: "const n=2; const empty=null; const row=empty??{d2:n,d3:n}; db.insert(records,row); return row;", result:{d2:2,d3:2},writes:[{d2:200,d3:2000}] },
  { name: "field-access-decimal", body: "const original={d2:2,d3:2}; db.insert(records,{d2:original.d2,d3:original.d3}); return original;", result:{d2:2,d3:2},writes:[{d2:200,d3:2000}] },
  { name: "mutated-list-destination-keeps-all-values", body: "const amounts=[2]; amounts.push(3); db.insert(records,{amounts}); return amounts;", result:[2,3],writes:[{amounts:[2000,3000]}] },
  { name: "optional-field-decimal", body:"const original={d2:2}; db.insert(records,{d2:original?.d2}); return original;", result:{d2:2},writes:[{d2:200}] },
  { name: "optional-field-list", body:"const original={amounts:[2,3]}; db.insert(records,{amounts:original?.amounts}); return original;", result:{amounts:[2,3]},writes:[{amounts:[2000,3000]}] },
  { name: "field-access-list", body: "const original={amounts:[2,3]}; db.insert(records,{amounts:original.amounts}); return original;", result:{amounts:[2,3]},writes:[{amounts:[2000,3000]}] },
  { name: "let-origin-capture", body: "let n=2; const original={d2:n,d3:n}; n=7; db.insert(records,original); return {n,original};", result:{n:7,original:{d2:2,d3:2}},writes:[{d2:200,d3:2000}] },
  { name: "let-origin-field", body: "let n=2; const original={d2:n}; n=7; db.insert(records,{d2:original.d2}); return {n,original};", result:{n:7,original:{d2:2}},writes:[{d2:200}] },
  { name: "mutable-row-reassigned-destination", body: "let row={d2:2,d3:2}; row={d2:3,d3:3}; db.insert(records,row); return row;", result:{d2:3,d3:3},writes:[{d2:300,d3:3000}] },
  { name: "mutable-row-captured-before-assignment", body: "let row={d2:2,d3:2}; const original={d2:row.d2,d3:row.d3}; row={d2:3,d3:3}; db.insert(records,original); return {row,original};", result:{row:{d2:3,d3:3},original:{d2:2,d3:2}},writes:[{d2:200,d3:2000}] },
  { name: "decimal-arg-control", body: "const row={d2:args.d2,d3:args.d3}; db.insert(records,row); return row;", args:{d2:321,d3:4321},result:{d2:321,d3:4321},writes:[{d2:321,d3:4321}] },
  { name: "literal-id-control", body: "const original='café'; const alias=original; db.insert(records,{owner:alias}); return alias;", result:'café',writes:[{owner:'café'}] },
  { name: "helper-text-id-refusal-control", body: "const original='café'; const alias=ident(original); db.insert(records,{owner:alias}); return alias;",refuse:"E_ARGS_ID_SCALAR" },
  { name: "bounded-conditional-search-refusal-control", body: "return db.scan(people.search,[args.flag?args.term:'x'],{take:2});",refuse:"E_ARGS_TYPE" },
];
for (const flag of [false,true]) {
  const n=flag?2:3;
  for (const destination of ["row","{...row}","{d2:row.d2,d3:row.d3,amounts:row.amounts}"])
    repairCases.push({ name:`selected-list-object-${flag}-${destination}`,args:{flag},
      body:`const row=args.flag?{d2:2,d3:2,amounts:[2,4]}:{d2:3,d3:3,amounts:[3,5]}; db.insert(records,${destination}); return row;`,
      ...(destination==="{...row}"?{refuse:"E_OPAQUE"}:{}), result:{d2:n,d3:n,amounts:[n,n+2]},writes:[{d2:n*100,d3:n*1000,amounts:[n*1000,(n+2)*1000]}] });
}
for (const flag of [false,true]) for (const destination of ["row","{d2:row.d2,amounts:row.amounts}"]) {
  for (const empty of [false,true]) repairCases.push({name:`mixed-selected-representation-${flag}-${empty}-${destination}`,args:{flag,d2:321},
    body:`let choose=args.flag; const row=choose?{d2:args.d2,amounts:${empty?'[]':'[2,4]'}}:{d2:2,amounts:[3]}; choose=!choose; db.insert(records,${destination}); return row;`,
    result:{d2:flag?321:2,amounts:flag?(empty?[]:[2,4]):[3]},writes:[{d2:flag?321:200,amounts:flag?(empty?[]:[2000,4000]):[3000]}]});
}
for (const flag of [false,true]) repairCases.push({name:`mixed-coalesced-representation-${flag}`,args:{flag,d2:321},
  body:"let choose=args.flag; const prior=choose?{d2:args.d2,amounts:[2]}:null; const row=prior??{d2:2,amounts:[3]}; choose=!choose; db.insert(records,row); return row;",
  result:{d2:flag?321:2,amounts:flag?[2]:[3]},writes:[{d2:flag?321:200,amounts:flag?[2000]:[3000]}]});
for (const write of ["insert(records,row)","update(records,'id',row)","upsert(records,'id',row)"])
  repairCases.push({name:`write-destination-${write}`,body:`const row={d2:2,d3:3}; db.${write}; return row;`,result:{d2:2,d3:3},writes:[{d2:200,d3:3000}]});

export function repairSource(item: RepairCase) {
  return `import {mutation,t} from 'snapback2'; declare const people:any; declare const records:any;
function ident(x:any){return x;} function pair(x:any,y:any){return [x,y];} ${item.helpers??''}
export const probe=mutation({term:t.text(2000),flag:t.bool(),d2:t.decimal(2),d3:t.decimal(3)},({db,args,ctx})=>{${item.body}});`;
}

export function registerCaptureRepairChecks(test: Test, lib: string) {
  test("builtin concat of captured int retains the R6 Decimal representation refusal", () => {
    const schema = compileInline([{ fileName: "snapback/schema.q", source: repairSchema }]); assert(schema.ok);
    const tables = lowerSchema(schema.schema.source, "schema.ts", true).tables;
    const source = "import {mutation,t,concat} from 'snapback2'; declare const records:any; export const probe=mutation({n:t.int()},({db,args})=>{const n=args.n; const amounts=concat([n],[3]); db.insert(records,{amounts}); return amounts;});";
    const result = lowerSource(source, "probe.ts", lib, { tables });
    assert(!result.ok, JSON.stringify(result));
    assert.deepEqual(result.diagnostics.map(d => ({ code: d.code, message: d.message, site: d.site })), [
      { code: "E_DECIMAL_SCALE", message: "int does not prove the representation required by Decimal<3>", site: "probe.ts:1:157" },
      { code: "E_DECIMAL_SCALE", message: "int does not prove the representation required by Decimal<3>", site: "probe.ts:1:193" },
    ]);
  });
  registerRepresentationChecks(test, lib);
  for (const item of repairCases) test(`capture repair ${item.name} (actual IR values)`, () => {
    const schema=compileInline([{fileName:'snapback/schema.q',source:repairSchema}]); assert(schema.ok);
    const tables=lowerSchema(schema.schema.source,'schema.ts',true).tables;
    const full=lowerSource(repairSource(item),'probe.ts',lib,{tables});
    if (item.refuse) { assert(!full.ok); assert(full.diagnostics.some(d=>d.code===item.refuse)); return; }
    assert(full.ok,JSON.stringify(full));
    const observations: Array<{kind:string;value:PureValue}> = [];
    const addresses: Array<{operation:string;key:PureValue[]}> = [];
    const actual=runPure(full.programs[0]!,{term:'café',flag:true,d2:0,d3:0,...item.args},item.rows,addresses,observations);
    if (item.observations) assert.deepEqual(observations,item.observations);
    if (item.addresses) assert.deepEqual(addresses,item.addresses);
    if (item.name==='helper-order-cursor') assert.deepEqual(observations,[{kind:'after',value:id2}]);
    if ('result' in item) assert.deepEqual(actual.result,item.result);
    if (item.writes) assert.deepEqual(actual.writes,item.writes);
    if (item.prefix) assert.deepEqual(actual.scans[0]?.prefix,item.prefix);
  });
  for (const item of repairCases.filter(c=>['helper-order-array','helper-order-object','nested-tuple-order','nested-helper-order','array-spread-order'].includes(c.name))) {
    test(`capture repair ${item.name} (ClientStore ID envelope)`, () => {
      const full=lowerSource(repairSource(item),'probe.ts',lib); assert(full.ok,JSON.stringify(full));
      const store=new ClientStore({tables:{}},{rows:[],ranges:[],absences:[],verdicts:[]});
      const actual=store.applyMutation(full.programs[0]!,{args:{term:{String:'café'},flag:{Bool:true},d2:{Int:0},d3:{Int:0}},viewer:'viewer-1',principal_kind:'user',auth_epoch:0,now:0,read_time:0,new_ids:[id1,id2,id3]});
      assert.equal(actual.state,'predicted');
      assert('execution' in actual && actual.execution);
      const decode=(value: unknown): unknown=> {
        if(value==='Null') return null;
        if(typeof value!=='object'||!value) return value;
        if('Row' in value && value.Row && typeof value.Row==='object') return Object.fromEntries(Object.entries(value.Row).map(([k,v])=>[k,decode(v)]));
        if('Array' in value && Array.isArray(value.Array)) return value.Array.map(decode);
        return Object.values(value)[0];
      };
      assert.deepEqual(decode(actual.execution.result),item.result);
    });
  }
  for (const [name,source,result,writes] of [
    ['public-reversed-field-order','mutation probe():\n  return {z: new, a: new}\n',{z:id1,a:id2},[]],
    ['public-new-order','mutation probe():\n  value = {a: new, b: [new]}\n  return value\n',{a:id1,b:[id2]},[]],
    ['public-aliased-list','mutation probe():\n  amounts = [2, 3]\n  row = {amounts}\n  insert records {d2: 0, d3: 0, owner: "owner", amounts: row.amounts}\n  return {row, amounts}\n',{row:{amounts:[2,3]},amounts:[2,3]},[{d2:0,d3:0,owner:'owner',amounts:[2000,3000],id:id1}]],
  ] as const) test(`capture repair ${name} (public Quarry actual values)`,async()=>{
    const full=await withProject({'snapback/schema.q':repairSchema,'snapback/probe.q':source},root=>lowerProject(root));
    assert(full.ok,JSON.stringify(full)); const actual=runPure(full.project.programs[0]!);
    assert.deepEqual(actual.result,result); assert.deepEqual(actual.writes,writes);
  });
  registerMergeCaptureChecks(test,lib);
}

export const repairHeldSchema = `table rooms:
  public
table memberships:
  room: rooms
  principal: principal
  unique auth: room, principal
  by discovery: principal, room, id
  read <- exists memberships[.room, viewer] by auth
table docs:
  room: rooms
  text: text <=3
  at: int
  by search: room, wordPrefixes(text), at, id
  read <- exists memberships[.room, viewer] by auth
`;
function registerMergeCaptureChecks(test:Test,lib:string) {
  for(const callbackUsesRow of [false,true]) test(`capture repair merge callback isolates helper m rowUsed=${callbackUsesRow}`,()=>{
    const schema=compileInline([{fileName:'snapback/schema.q',source:repairHeldSchema}]); assert(schema.ok);
    const tables=lowerSchema(schema.schema.source,'schema.ts',true).tables;
    const source=`import {query,t,mergeByIndex} from 'snapback2'; declare const db:any; declare const ctx:any; declare const args:any; declare const memberships:any; declare const docs:any;
function outer(m:string){return {page:mergeByIndex([{rows:db.scan(memberships.discovery,[ctx.viewer],{take:3}),lane:(m:any)=>db.scan(docs.search,[${callbackUsesRow?'m.room':"'room-1'"},args.term],{take:2})}],2,'page'),captured:m};}
export const probe=query({term:t.text(2000)},({db,args,ctx})=>outer(args.term));`;
    const full=lowerSource(source,'probe.ts',lib,{tables}); assert(full.ok,JSON.stringify(full));
    const actual=runPure(full.programs[0]!,{term:'café'},{memberships:[{room:'room-1',principal:'viewer-1'}]});
    assert.deepEqual(actual.result,{page:[],captured:'café'});
    assert.deepEqual(actual.scans.map(s=>s.prefix),[[{scalar:'viewer-1'}],[{scalar:'room-1'},{source:'café',Q:2000}]]);
  });
}
