import assert from "node:assert/strict";
import { lowerProject } from "./project";
import { apiConsumerDiagnostics, withProject, type Test } from "./quarry-check-helpers";
import { custodyActual } from "./capture-custody-checks";
import { decodeProducerValue } from "./capture-producer-checks";
import type { Value } from "./ir";
import type { ClosureReceipt } from "../../evaluator/src/types";

export type InsertProvenanceCase = {
  name: string; public: boolean; source: string; schema?: string; refusal?: string;
  runs?: Array<{ args: Record<string, Value>; result?: unknown; rows?: unknown[];
    pointIds?: string[]; pointKeys?: unknown[][]; error?: string;
    receipt?: ClosureReceipt; uncoveredPartialSites?: string[] }>;
};
export const insertPublicSchema = `table records:
  d3: decimal 3 ?
  payload: json <=10000 ?
  public
  insert <- allow
`;
export const insertPrivateSchema = `import {schema,table,t,rule} from 'snapback2';
export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});
export default schema({tables:{records}});`;
const privateSource = (body: string, args = "", declarations = "", bindings = "db,ctx,args") =>
  `import {mutation,t,divmod} from 'snapback2';import {records} from './schema';${declarations}
export const probe=mutation({${args}},({${bindings}})=>{${body}});`;
const list = (...values: number[]): Value => ({ Array: values.map(Int => ({ Int })) });
const q = (n: number) => ({ quotient: Math.floor(n / 2), remainder: n % 2, sink: "lexicographic-id" });
const row = (id: string, d3: number | null, payload: unknown) => ({ id, d3, payload });
const amount = { amount: { Int: 4321 } } satisfies Record<string, Value>;
const signature = "mutation probe(values: [int] <=3 ?, more: [int] <=7):\n";

export const insertProvenanceCases: InsertProvenanceCase[] = [{
  name: "exact public inserted row point key", public: true,
  source: `${signature}  original = values ?? more\n  for value in original:\n    q = divmod(value, 2)\n    row = insert records {payload: q}\n    stored = records[row.id]\n    require stored != null else LOST\n  return original\n`,
  runs: [
    { args: { values: list(4,5), more: list(1,2,3) }, result: [4,5],
      rows: [row("id-1",null,q(4)),row("id-2",null,q(5))], pointIds: ["id-1","id-2"] },
    { args: { values: "Null", more: list(1,2,3) }, result: [1,2,3],
      rows: [1,2,3].map((n,i) => row(`id-${i+1}`,null,q(n))), pointIds: ["id-1","id-2","id-3"] },
    { args: { values: list(), more: list(1,2,3) }, result: [], rows: [], pointIds: [] },
    { args: { values: "Null", more: list(1,2,3,4,5,6,7) }, result: [1,2,3,4,5,6,7],
      rows: [1,2,3,4,5,6,7].map((n,i) => row(`id-${i+1}`,null,q(n))), pointIds: Array.from({length:7},(_,i)=>`id-${i+1}`) },
    { args: { values: list(1,2,3,4), more: list() }, error: "E_FANOUT" },
  ],
}];

for (const [name, capture, key] of [
  ["direct", "", "row.id"],
  ["immutable alias", "  alias = row\n", "alias.id"],
  ["object row capture", "  box = {row}\n", "box.row.id"],
  ["nested object row capture", "  box = {inner: {row}}\n", "box.inner.row.id"],
  ["member capture", "  key = row.id\n  box = {key}\n", "box.key"],
] as const) insertProvenanceCases.push({
  name: `public inserted snapshot ${name}`, public: true,
  source: `mutation probe(amount: decimal 3):\n  q = divmod(5, 2)\n  row = insert records {d3: amount, payload: q}\n${capture}  stored = records[${key}]\n  return {row, stored, next: new}\n`,
  runs: [{ args: amount, result: { row: row("id-1",4321,q(5)), stored: row("id-1",4321,q(5)), next: "id-2" },
    rows: [row("id-1",4321,q(5))], pointIds: ["id-1"] }],
});
for (const [name, capture, key] of [
  ["alias", "    alias = row\n", "alias.id"],
  ["nested capture", "    box = {inner: {row}}\n", "box.inner.row.id"],
  ["saved member", "    key = row.id\n", "key"],
] as const) insertProvenanceCases.push({
  name: `public joined inserted ${name}`, public: true,
  source: `${signature}  original = values ?? more\n  for value in original:\n    row = insert records {payload: divmod(value, 2)}\n${capture}    stored = records[${key}]\n    require stored != null else LOST\n  return {original, next: new}\n`,
  runs: [{ args: { values: list(4,5), more: list(1,2,3) }, result: { original: [4,5], next: "id-3" },
    rows: [row("id-1",null,q(4)),row("id-2",null,q(5))], pointIds: ["id-1","id-2"] },
  { args: { values: "Null", more: list(1,2,3) }, result: { original: [1,2,3], next: "id-4" },
    rows: [1,2,3].map((n,i)=>row(`id-${i+1}`,null,q(n))), pointIds: ["id-1","id-2","id-3"] }],
});
for (const [name, argument, id, args, next] of [
  ["literal", "", "'given'", {}, "id-1"],
  ["argument", "key: id", "key", { key: { Id: "given" } }, "id-1"],
  ["allocation", "", "new", {}, "id-2"],
] as const) insertProvenanceCases.push({
  name: `public explicit insert id ${name}`, public: true,
  source: `mutation probe(${argument}):\n  row = insert records {id: ${id}, d3: 2, payload: divmod(5, 2)}\n  stored = records[row.id]\n  return {row, stored, next: new}\n`,
  runs: [{ args, result: { row: row(name === "allocation" ? "id-1" : "given",2000,q(5)),
    stored: row(name === "allocation" ? "id-1" : "given",2000,q(5)), next },
    rows: [row(name === "allocation" ? "id-1" : "given",2000,q(5))], pointIds: [name === "allocation" ? "id-1" : "given"] }],
});
insertProvenanceCases.push({ name: "public insert operands and read once", public: true,
  source: "mutation probe():\n  earlier = new\n  row = insert records {id: new, d3: 2, payload: {ticket: new}}\n  stored = records[row.id]\n  return {earlier, row, stored, next: new}\n",
  runs: [{ args: {}, result: { earlier: "id-1", row: row("id-2",2000,{ticket:"id-3"}),
    stored: row("id-2",2000,{ticket:"id-3"}), next: "id-4" }, rows: [row("id-2",2000,{ticket:"id-3"})], pointIds: ["id-2"] }],
});
insertProvenanceCases.push({ name: "public inserted decimal alternate key", public: true,
  schema: insertPublicSchema.replace("  public", "  unique byD3: d3\n  public"),
  source: "mutation probe(amount: decimal 3):\n  row = insert records {d3: amount, payload: null}\n  stored = records[d3 = row.d3]\n  return {row, stored, next: new}\n",
  runs: [{ args: amount, result: { row: row("id-1",4321,null), stored: row("id-1",4321,null), next: "id-2" },
    rows: [row("id-1",4321,null)], pointKeys: [[4321]], uncoveredPartialSites: ["records.byD3"],
    receipt: {rows:[],ranges:[],absences:[["records","byD3",[{Int:4321}]]],verdicts:[]} }],
});
for (const required of [false,true]) insertProvenanceCases.push({ name: `public inserted unreadable row ${required}`, public: true,
  schema: insertPublicSchema.replace("  public", "  read <- deny"),
  source: `mutation probe():\n  row = insert records {d3: 2, payload: null}\n  stored = records[row.id]\n${required ? "  require stored != null else LOST\n" : ""}  return {row, stored, next: new}\n`,
  runs: [{ args: {}, ...(required ? {error:"E_REQUIRE"} : {
    result: { row: row("id-1",2000,null), stored: null, next: "id-2" }, rows: [row("id-1",2000,null)], pointIds: ["id-1"] }) }],
});
for (const before of [false,true]) insertProvenanceCases.push({ name: `public insert read first error earlier ${before}`, public: true,
  source: `mutation probe(zero: int):\n${before ? "  first = divmod(1, zero)\n" : ""}  row = insert records {d3: 2, payload: null}\n  stored = records[row.id]\n  require stored = null else FOUND\n  return divmod(2, zero)\n`,
  runs: [{ args: {zero:{Int:0}}, error: before ? "E_DIV_ZERO" : "E_REQUIRE" }],
});
insertProvenanceCases.push({ name: "public ordinary argument point read", public: true,
  source: "mutation probe(key: id):\n  stored = records[key]\n  return {stored, next: new}\n",
  runs: [{ args: {key:{Id:"missing"}}, result: {stored:null,next:"id-1"}, rows: [], pointIds: ["missing"] }],
});
insertProvenanceCases.push({ name: "private renamed operation database insert", public: false,
  source: privateSource("const row=writer.insert(records,{id:ctx.newId(),d3:2,payload:null}); const alias=row; return {row:alias,stored:writer.get(records,[alias.id]),next:ctx.newId()};", "", "", "db:writer,ctx,args"),
  runs: [{ args: {}, result: {row:row("id-1",2000,null),stored:row("id-1",2000,null),next:"id-2"}, rows:[row("id-1",2000,null)],pointIds:["id-1"] }],
});
insertProvenanceCases.push({ name: "private stable let insert snapshot", public: false,
  source: privateSource("let row=db.insert(records,{id:ctx.newId(),d3:2,payload:null}); return db.get(records,[row.id]);"),
  runs: [{args:{},result:row("id-1",2000,null),rows:[row("id-1",2000,null)],pointIds:["id-1"]}],
});
for (const [name, body, args, declarations, refusal] of [
  ["reassigned result", "let row:any=db.insert(records,{id:ctx.newId(),d3:2,payload:null});row=args.payload;return db.get(records,[row.id]);", "payload:t.json(100)", "", "E_PROVENANCE_AMBIGUOUS"],
  ["branch reassigned result", "let row:any=db.insert(records,{id:ctx.newId(),d3:2,payload:null});if(args.flag)row=args.payload;return db.get(records,[row.id]);", "flag:t.bool(),payload:t.json(100)", "", "E_PROVENANCE_AMBIGUOUS"],
  ["mutated member", "const row=db.insert(records,{id:ctx.newId(),d3:2,payload:null});row.id=args.key;return db.get(records,[row.id]);", "key:t.id()", "", "E_OPAQUE"],
  ["unknown row member", "const row:any=db.insert(records,{id:ctx.newId(),d3:2,payload:null});return db.get(records,[row.missing]);", "", "", "E_PROVENANCE_AMBIGUOUS"],
  ["unmodeled nested json", "const row:any=db.insert(records,{id:ctx.newId(),d3:2,payload:args.payload});return db.get(records,[row.payload.id]);", "payload:t.json(100)", "", "E_PROVENANCE_AMBIGUOUS"],
  ["unmodeled builtin object", "const row:any=divmod(5,2);return db.get(records,[row.id]);", "", "", "E_PROVENANCE_AMBIGUOUS"],
  ["forged insert method", "const other:any=args.payload;const row=other.insert(records,{id:ctx.newId()});return db.get(records,[row.id]);", "payload:t.json(100)", "", "E_OPAQUE"],
  ["unmodeled insert function", "const row=insert();return db.get(records,[row.id]);", "", "declare function insert():any;", "E_OPAQUE"],
  ["shadowed database", "const real=db;{const db:any=args.payload;const row=db.insert(records,{id:ctx.newId()});return real.get(records,[row.id]);}", "payload:t.json(100)", "", "E_OPAQUE"],
] as const) insertProvenanceCases.push({ name: `private insert refuses ${name}`, public: false,
  source: privateSource(body,args,declarations), refusal });

insertProvenanceCases.push({ name: "public argument row member capture", public: true,
  source: "mutation probe(key: id):\n  input = {id: key}\n  box = {input}\n  stored = records[box.input.id]\n  return {stored, next: new}\n",
  runs: [{args:{key:{Id:"missing"}},result:{stored:null,next:"id-1"},rows:[],pointIds:["missing"]}],
}, { name: "private helper named insert preserves argument origin", public: false,
  source: privateSource("const row=insert(args.key);return db.get(records,[row.id]);", "key:t.id()", "function insert(id:string){return {id};}"),
  runs: [{args:{key:{Id:"missing"}},result:null,rows:[],pointIds:["missing"]}],
}, { name: "private row spread preserves earlier argument member", public: false,
  source: privateSource("const row=db.insert(records,{id:ctx.newId(),d3:2,payload:null});const box={key:args.key,...row};return db.get(records,[box.key]);", "key:t.id()"),
  runs: [{args:{key:{Id:"missing"}},result:null,rows:[row("id-1",2000,null)],pointIds:["missing"]}],
});
for (const [name, body] of [
  ["read row missing member", "const row:any=db.get(records,[args.key]);return db.get(records,[row.missing]);"],
  ["inline insert missing member", "return db.get(records,[(db.insert(records,{id:ctx.newId(),d3:2,payload:null}) as any).missing]);"],
  ["literal object missing member", "const row:any={id:args.key};return db.get(records,[row.missing]);"],
  ["argument missing member", "return db.get(records,[(args as any).missing]);"],
] as const) insertProvenanceCases.push({name:`private refuses ${name}`,public:false,
  source:privateSource(body,"key:t.id()"),refusal:"E_PROVENANCE_AMBIGUOUS"});

insertProvenanceCases.push({name:"public inserted capture precedes later update",public:true,
  schema:insertPublicSchema+"  update <- allow\n",
  source:"mutation probe():\n  row = insert records {d3: 2, payload: null}\n  box = {row, key: row.id}\n  update records[row.id] {d3: 3}\n  stored = records[box.key]\n  return {original: box.row, stored, next: new}\n",
  runs:[{args:{},result:{original:row("id-1",2000,null),stored:row("id-1",3000,null),next:"id-2"},
    rows:[row("id-1",3000,null)],pointIds:["id-1"]}],
}, {name:"private immutable capture precedes reassignment",public:false,
  source:privateSource("let row:any=db.insert(records,{id:ctx.newId(),d3:2,payload:null});const box={row,key:row.id};row=args.payload;return {original:box.row,stored:db.get(records,[box.key]),next:ctx.newId()};","payload:t.json(100)"),
  runs:[{args:{payload:{Row:{id:{Id:"replacement"}}}},result:{original:row("id-1",2000,null),stored:row("id-1",2000,null),next:"id-2"},rows:[row("id-1",2000,null)],pointIds:["id-1"]}],
});
insertProvenanceCases.push({name:"public inserted capture update remains denied",public:true,
  source:insertProvenanceCases.find(item=>item.name==="public inserted capture precedes later update")!.source,
  runs:[{args:{},error:"E_RULE"}],
});
for (const [name, body] of [
  ["insert member capture", "let row:any=db.insert(records,{id:ctx.newId(),d3:2,payload:null});const key=row.missing;row=args.payload;return db.get(records,[key]);"],
  ["insert object capture", "let row:any=db.insert(records,{id:ctx.newId(),d3:2,payload:null});const box={row};row=args.payload;return db.get(records,[box.row.missing]);"],
  ["read member capture", "let row:any=db.get(records,['missing']);const key=row.missing;row=args.payload;return db.get(records,[key]);"],
] as const) insertProvenanceCases.push({name:`private refuses missing ${name} before reassignment`,public:false,
  source:privateSource(body,"payload:t.json(100)"),refusal:"E_PROVENANCE_AMBIGUOUS"});
insertProvenanceCases.push({name:"public omitted insert member remains unproved",public:true,
  schema:insertPublicSchema.replace("  public","  unique byD3: d3\n  public"),
  source:"mutation probe():\n  row = insert records {payload: null}\n  stored = records[d3 = row.d3]\n  return stored\n",refusal:"E_PROVENANCE_AMBIGUOUS",
}, {name:"private insert spread keeps authored optional omission",public:false,
  source:privateSource("const row=db.insert(records,{id:ctx.newId(),payload:null});const box={...row};return {box,stored:db.get(records,[box.id]),next:ctx.newId()};"),
  runs:[{args:{},result:{box:{id:"id-1",payload:null},stored:row("id-1",null,null),next:"id-2"},rows:[row("id-1",null,null)],pointIds:["id-1"]}],
}, {name:"public explicit null insert member remains proved",public:true,
  schema:insertPublicSchema.replace("  public","  unique byD3: d3\n  public"),
  source:"mutation probe():\n  row = insert records {d3: null, payload: null}\n  stored = records[d3 = row.d3]\n  return {row, stored, next: new}\n",
  runs:[{args:{},result:{row:row("id-1",null,null),stored:row("id-1",null,null),next:"id-2"},rows:[row("id-1",null,null)],pointKeys:[[null]],uncoveredPartialSites:["records.byD3"],
    receipt:{rows:[],ranges:[],absences:[["records","byD3",["Null"]]],verdicts:[]}}],
});

// The reviewer sources are complete checked-private projects. The JSON inputs
// include a valid id with an omitted optional key; storage columns prove neither
// that captured member nor a receiver value after assignment.
insertProvenanceCases.push(...[
  {
    "name": "R16 astra-custom2-0",
    "public": false,
    "schema": "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},indexes:{byD3:{columns:[\"d3\"],unique:true}},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    "source": "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{const data:any=args.flag?{id:ctx.newId(),payload:null}:{id:ctx.newId(),d3:2,payload:null};const row:any=db.insert(records,data);return db.get(records.byD3,[row.d3]);});",
    "refusal": "E_PROVENANCE_AMBIGUOUS"
  },
  {
    "name": "R16 astra-custom2-2",
    "public": false,
    "schema": "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{key:t.optional(t.id()),payload:t.optional(t.json(1000))},indexes:{byKey:{columns:['key'],unique:true}},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    "source": "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(1000)},({db,ctx,args})=>{const row:any=db.insert(records,args.payload as any);return db.get(records.byKey,[row.key]);});",
    "refusal": "E_PROVENANCE_AMBIGUOUS"
  },
  {
    "name": "R16 astra-custom2-3",
    "public": false,
    "schema": "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    "source": "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{db=args.payload as any;const row=db.insert(records,{id:ctx.newId(),d3:2,payload:null});return {row,stored:db.get(records,[row.id]),next:ctx.newId()};});",
    "refusal": "E_OPAQUE"
  },
  {
    "name": "R16 astra-custom2-4",
    "public": false,
    "schema": "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    "source": "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{db=args.payload as any;db.insert(records,{id:\"given\",d3:2,payload:null});return db.get(records,[\"given\"]);});",
    "refusal": "E_OPAQUE"
  },
  {
    "name": "R16 astra-custom2-5",
    "public": false,
    "schema": "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    "source": "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),payload:t.json(100)},({db,ctx,args})=>{if(args.flag)db=args.payload as any;const row=db.insert(records,{id:ctx.newId(),d3:2,payload:null});return db.get(records,[row.id]);});",
    "refusal": "E_OPAQUE"
  },
  {
    "name": "R16 astra-extended-4",
    "public": false,
    "schema": "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{key:t.optional(t.id()),payload:t.optional(t.json(1000))},indexes:{byKey:{columns:['key'],unique:true}},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    "source": "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(1000)},({db,ctx,args})=>{let row:any=db.insert(records,args.payload as any);const box={row,key:row.key};row=null;return db.get(records.byKey,[box.key]);});",
    "refusal": "E_PROVENANCE_AMBIGUOUS"
  },
  {
    "name": "R16 grok-json-only",
    "public": false,
    "schema": "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    "source": "import {mutation,t} from 'snapback2';import {records} from './schema';\nexport const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{const input:any=args.payload; const row=db.insert(records,input); return db.get(records,[row.id]);});",
    "refusal": "E_PROVENANCE_AMBIGUOUS"
  }
]);

for (const [name, body] of [
  ["unknown input nested capture", "const data:any=args.payload;const box={data};const row:any=db.insert(records,box.data);return db.get(records.byKey,[row.key]);"],
  ["unknown input inline member", "return db.get(records.byKey,[(db.insert(records,args.payload as any) as any).key]);"],
  ["reassigned input shape", "let data:any={id:ctx.newId(),key:null,payload:null};data=args.payload;const row:any=db.insert(records,data);return db.get(records.byKey,[row.key]);"],
  ["branch input shape", "let data:any={id:ctx.newId(),key:null,payload:null};if(args.flag)data=args.payload;const row:any=db.insert(records,data);return db.get(records.byKey,[row.key]);"],
] as const) insertProvenanceCases.push({ name: `R16 ${name}`, public: false,
  schema: insertProvenanceCases.find(c=>c.name==="R16 astra-custom2-2")!.schema,
  source: privateSource(body,"payload:t.json(1000),flag:t.bool()"),refusal:"E_PROVENANCE_AMBIGUOUS" });

for (const capture of [false,true]) insertProvenanceCases.push({ name: `R16 common conditional snapshot member capture ${capture}`, public: false,
  source: privateSource(`let input:any=args.flag?{id:ctx.newId(),payload:null}:{id:ctx.newId(),d3:2,payload:null};const box={input};${capture?"input=args.payload;":""}const row=db.insert(records,${capture?"box.input":"input"});return {row,stored:db.get(records,[row.id]),next:ctx.newId()};`,"flag:t.bool(),payload:t.json(100)"),
  // The captured conditional Decimal conversion is independently unmodeled on
  // the parent too. Its exact source remains a refusal control; the ID capture
  // below exercises snapshot membership without hiding behind that boundary.
  ...(capture ? {refusal:"E_DECIMAL_SCALE"} : {}),
  runs: [true,false].map(flag=>({args:{flag:{Bool:flag},payload:{Row:{}}},
    result:{row:flag?{id:"id-1",payload:null}:row("id-1",2000,null),stored:row("id-1",flag?null:2000,null),next:"id-2"},
    rows:[row("id-1",flag?null:2000,null)],pointIds:["id-1"]})),
});
insertProvenanceCases.push({name:"R16 conditional ID input capture before assignment",public:false,
  schema:insertProvenanceCases.find(c=>c.name==="R16 astra-custom2-2")!.schema,
  source:privateSource("let input:any=args.flag?{id:ctx.newId(),payload:null}:{id:ctx.newId(),key:args.key,payload:null};const box={input};input=args.payload;const row=db.insert(records,box.input);return {row,stored:db.get(records,[row.id]),next:ctx.newId()};","flag:t.bool(),key:t.id(),payload:t.json(100)"),
  runs:[true,false].map(flag=>({args:{flag:{Bool:flag},key:{Id:"given"},payload:{Row:{}}},
    result:{row:flag?{id:"id-1",payload:null}:{id:"id-1",key:"given",payload:null},stored:{id:"id-1",key:flag?null:"given",payload:null},next:"id-2"},
    rows:[{id:"id-1",key:flag?null:"given",payload:null}],pointIds:["id-1"],
    uncoveredPartialSites:["records.byKey"],
    receipt:{rows:[],ranges:[],absences:[["records","byKey",[flag?"Null":{Id:"given"}]]],verdicts:[]}})),
});
insertProvenanceCases.push({ name:"R16 conditional explicit null snapshot member",public:false,
  schema:insertProvenanceCases.find(c=>c.name==="R16 astra-custom2-2")!.schema,
  source:privateSource("const input:any=args.flag?{id:ctx.newId(),key:null,payload:null}:{id:ctx.newId(),key:args.key,payload:null};const row=db.insert(records,input);return {row,stored:db.get(records.byKey,[row.key]),next:ctx.newId()};","flag:t.bool(),key:t.id()"),
  runs:[true,false].map(flag=>({args:{flag:{Bool:flag},key:{Id:"given"}},
    result:{row:{id:"id-1",key:flag?null:"given",payload:null},stored:{id:"id-1",key:flag?null:"given",payload:null},next:"id-2"},
    rows:[{id:"id-1",key:flag?null:"given",payload:null}],pointKeys:[[flag?null:"given"]],uncoveredPartialSites:["records.byKey"],
    receipt:{rows:[],ranges:[],absences:[["records","byKey",[flag?"Null":{Id:"given"}]]],verdicts:[]}})),
});
insertProvenanceCases.push({name:"R16 stable inserted capture before receiver assignment",public:false,
  source:privateSource("const row=db.insert(records,{id:ctx.newId(),d3:2,payload:null});const stored=db.get(records,[row.id]);const box={row,stored};db=args.payload as any;return {box,next:ctx.newId()};","payload:t.json(100)"),
  runs:[{args:{payload:{Row:{}}},result:{box:{row:row("id-1",2000,null),stored:row("id-1",2000,null)},next:"id-2"},rows:[row("id-1",2000,null)],pointIds:["id-1"]}],
}, {name:"R16 receiver assignment stays in its branch",public:false,
  source:privateSource("if(args.flag){db=args.payload as any;}else{const row=db.insert(records,{id:ctx.newId(),d3:2,payload:null});return {stored:db.get(records,[row.id]),next:ctx.newId()};}return null;","flag:t.bool(),payload:t.json(100)"),
  runs:[{args:{flag:{Bool:true},payload:{Row:{}}},result:null,rows:[],pointIds:[]},
    {args:{flag:{Bool:false},payload:{Row:{}}},result:{stored:row("id-1",2000,null),next:"id-2"},rows:[row("id-1",2000,null)],pointIds:["id-1"]}],
});
for (const later of [false,true]) insertProvenanceCases.push({name:`R16 ordered input override ${later}`,public:false,
  source:privateSource(`const initial={id:args.key,payload:null};const fresh={id:ctx.newId(),d3:2};const input={...${later?"initial,...fresh":"fresh,...initial"}};const row=db.insert(records,input);const box={row};return {row:box.row,stored:db.get(records,[box.row.id]),next:ctx.newId()};`,"key:t.id()"),
  runs:[{args:{key:{Id:"given"}},result:{row:row(later?"id-1":"given",2000,null),stored:row(later?"id-1":"given",2000,null),next:"id-2"},rows:[row(later?"id-1":"given",2000,null)],pointIds:[later?"id-1":"given"]}],
});

insertProvenanceCases.push(...[
  {
    "name": "R16 receiver assignment RHS uses original binding",
    "public": false,
    "schema": "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    "source": "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{db=db.insert(records,{id:ctx.newId(),d3:2,payload:null}) as any;return {row:db,next:ctx.newId()};});",
    "runs": [
      {
        "args": {},
        "result": {
          "row": {
            "id": "id-1",
            "d3": 2000,
            "payload": null
          },
          "next": "id-2"
        },
        "rows": [
          {
            "id": "id-1",
            "d3": 2000,
            "payload": null
          }
        ],
        "pointIds": []
      }
    ]
  },
  {
    "name": "R16 receiver assignment RHS then no authority",
    "public": false,
    "schema": "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    "source": "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{db=db.insert(records,{id:ctx.newId(),d3:2,payload:null}) as any;return db.get(records,[\"given\"]);});",
    "refusal": "E_OPAQUE"
  }
]);

insertProvenanceCases.push({name:"R16 receiver assignment waits for throwing RHS",public:false,
  source:privateSource("db=db.insert(records,{id:ctx.newId(),payload:divmod(2,args.zero)}) as any;return {row:db,next:ctx.newId()};","zero:t.int()"),
  runs:[{args:{zero:{Int:0}},error:"E_DIV_ZERO"},
    {args:{zero:{Int:1}},result:{row:{id:"id-1",payload:{quotient:2,remainder:0,sink:"lexicographic-id"}},next:"id-2"},
      rows:[row("id-1",null,{quotient:2,remainder:0,sink:"lexicographic-id"})],pointIds:[]}],
});

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — value representation, captured helper members, and current receiver authority remain separate facts.
insertProvenanceCases.push(...[
  { name: "R17 review typed-object-length", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{let box={length:7};box={length:9};return box.length;});",
    runs: [{"args":{},"rows":[],"pointIds":[],"result":9}] },
  { name: "R17 review post-ctx-assignment", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{ctx=args.payload as any;return ctx.newId();});",
    refusal: "E_OPAQUE" },
  { name: "R17 review absent-member-aggregate", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{const row:any=db.insert(records,{id:ctx.newId(),payload:null});return db.get(records,[{id:row.missing} as any]);});",
    refusal: "E_PROVENANCE_AMBIGUOUS" },
  { name: "R17 review assigned-row-length", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2'; export const records=table({columns:{length:t.int(),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}}); export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2'; import {records} from './schema'; export const probe=mutation({flag:t.bool(),key:t.id(),zero:t.int()},({db,ctx,args})=>{let row:any=db.insert(records,{id:ctx.newId(),length:7});row={length:9};return {value:row.length,next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true},"key":{"Id":"missing"},"zero":{"Int":2}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":{"value":9,"next":"id-2"}},{"args":{"flag":{"Bool":false},"key":{"Id":"missing"},"zero":{"Int":0}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":{"value":9,"next":"id-2"}}] },
  { name: "R17 review assigned-object-length", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2'; export const records=table({columns:{length:t.int(),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}}); export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2'; import {records} from './schema'; export const probe=mutation({flag:t.bool(),key:t.id(),zero:t.int()},({db,ctx,args})=>{let box:any={length:7};box={length:9};return box.length;});",
    runs: [{"args":{"flag":{"Bool":true},"key":{"Id":"missing"},"zero":{"Int":2}},"rows":[],"pointIds":[],"result":9},{"args":{"flag":{"Bool":false},"key":{"Id":"missing"},"zero":{"Int":0}},"rows":[],"pointIds":[],"result":9}] },
  { name: "R17 review assigned-row-length-captured", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2'; export const records=table({columns:{length:t.int(),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}}); export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2'; import {records} from './schema'; export const probe=mutation({flag:t.bool(),key:t.id(),zero:t.int()},({db,ctx,args})=>{let row:any=db.insert(records,{id:ctx.newId(),length:7});const saved={row};row={length:9};return {saved:saved.row.length,current:row.length};});",
    runs: [{"args":{"flag":{"Bool":true},"key":{"Id":"missing"},"zero":{"Int":2}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":{"saved":7,"current":9}},{"args":{"flag":{"Bool":false},"key":{"Id":"missing"},"zero":{"Int":0}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":{"saved":7,"current":9}}] },
  { name: "R17 review stable-row-length", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2'; export const records=table({columns:{length:t.int(),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}}); export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2'; import {records} from './schema'; export const probe=mutation({flag:t.bool(),key:t.id(),zero:t.int()},({db,ctx,args})=>{let row:any=db.insert(records,{id:ctx.newId(),length:7});return row.length;});",
    runs: [{"args":{"flag":{"Bool":true},"key":{"Id":"missing"},"zero":{"Int":2}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":7},{"args":{"flag":{"Bool":false},"key":{"Id":"missing"},"zero":{"Int":0}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":7}] },
  { name: "R17 review branch-row-length", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2'; export const records=table({columns:{length:t.int(),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}}); export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2'; import {records} from './schema'; export const probe=mutation({flag:t.bool(),key:t.id(),zero:t.int()},({db,ctx,args})=>{let row:any=db.insert(records,{id:ctx.newId(),length:7});if(args.flag){row={length:9};return row.length;}else{return row.length;}});",
    runs: [{"args":{"flag":{"Bool":true},"key":{"Id":"missing"},"zero":{"Int":2}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":9},{"args":{"flag":{"Bool":false},"key":{"Id":"missing"},"zero":{"Int":0}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":7}] },
  { name: "R17 review self-row-spread", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2'; export const records=table({columns:{length:t.int(),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}}); export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2'; import {records} from './schema'; export const probe=mutation({flag:t.bool(),key:t.id(),zero:t.int()},({db,ctx,args})=>{let row:any=db.insert(records,{id:ctx.newId(),length:7});row={...row,length:9};return row;});",
    runs: [{"args":{"flag":{"Bool":true},"key":{"Id":"missing"},"zero":{"Int":2}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":{"id":"id-1","length":9}},{"args":{"flag":{"Bool":false},"key":{"Id":"missing"},"zero":{"Int":0}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":{"id":"id-1","length":9}}] },
  { name: "R17 review self-row-read-key", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2'; export const records=table({columns:{length:t.int(),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}}); export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2'; import {records} from './schema'; export const probe=mutation({flag:t.bool(),key:t.id(),zero:t.int()},({db,ctx,args})=>{let row:any=db.insert(records,{id:ctx.newId(),length:7});row=db.get(records,[row.id]);return row;});",
    runs: [{"args":{"flag":{"Bool":true},"key":{"Id":"missing"},"zero":{"Int":2}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":["id-1"],"result":{"id":"id-1","length":7,"payload":null}},{"args":{"flag":{"Bool":false},"key":{"Id":"missing"},"zero":{"Int":0}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":["id-1"],"result":{"id":"id-1","length":7,"payload":null}}] },
  { name: "R17 review self-receiver-many-operands", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2'; export const records=table({columns:{length:t.int(),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}}); export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2'; import {records} from './schema'; export const probe=mutation({flag:t.bool(),key:t.id(),zero:t.int()},({db,ctx,args})=>{db=db.insert(records,{id:ctx.newId(),length:divmod(5,args.zero).quotient,payload:db.get(records,[args.key])}) as any;return {row:db,next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true},"key":{"Id":"missing"},"zero":{"Int":2}},"rows":[{"id":"id-1","length":2,"payload":null}],"pointIds":["missing"],"result":{"row":{"id":"id-1","length":2,"payload":null},"next":"id-2"}},{"args":{"flag":{"Bool":false},"key":{"Id":"missing"},"zero":{"Int":0}},"error":"E_DIV_ZERO"}] },
  { name: "R17 review conditional-helper-common-id", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t} from 'snapback2';import {records} from './schema';function data(flag:boolean,id:string){return flag?{id}:{id,payload:null};}export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{const row=db.insert(records,data(args.flag,ctx.newId()));return {row,stored:db.get(records,[row.id]),next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1"},"stored":{"id":"id-1","payload":null},"next":"id-2"}},{"args":{"flag":{"Bool":false}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1","payload":null},"stored":{"id":"id-1","payload":null},"next":"id-2"}}] },
  { name: "R17 review conditional-helper-identical-members", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t} from 'snapback2';import {records} from './schema';function data(flag:boolean,id:string){return flag?{id,payload:1}:{id,payload:2};}export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{const row=db.insert(records,data(args.flag,ctx.newId()));return {row,stored:db.get(records,[row.id]),next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true}},"rows":[{"id":"id-1","payload":1}],"pointIds":["id-1"],"result":{"row":{"id":"id-1","payload":1},"stored":{"id":"id-1","payload":1},"next":"id-2"}},{"args":{"flag":{"Bool":false}},"rows":[{"id":"id-1","payload":2}],"pointIds":["id-1"],"result":{"row":{"id":"id-1","payload":2},"stored":{"id":"id-1","payload":2},"next":"id-2"}}] },
  { name: "R17 review conditional-inline-common-id", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{const row=db.insert(records,args.flag?{id:ctx.newId()}:{id:ctx.newId(),payload:null});return {row,stored:db.get(records,[row.id]),next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1"},"stored":{"id":"id-1","payload":null},"next":"id-2"}},{"args":{"flag":{"Bool":false}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1","payload":null},"stored":{"id":"id-1","payload":null},"next":"id-2"}}] },
  { name: "R17 review literal-helper-common-id", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t} from 'snapback2';import {records} from './schema';function data(id:string){return {id,payload:null};}export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{const row=db.insert(records,data(ctx.newId()));return {row,stored:db.get(records,[row.id]),next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1","payload":null},"stored":{"id":"id-1","payload":null},"next":"id-2"}},{"args":{"flag":{"Bool":false}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1","payload":null},"stored":{"id":"id-1","payload":null},"next":"id-2"}}] },
  { name: "R17 review reassigned-scan-loop", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100),flag:t.bool()},({db,ctx,args})=>{db=args.payload as any;let count=0;for(const row of db.scan(records,[],{take:2})){count++;}return {count,next:ctx.newId()};});",
    refusal: "E_OPAQUE" },
  { name: "R17 review branch-reassigned-scan-loop", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100),flag:t.bool()},({db,ctx,args})=>{if(args.flag){db=args.payload as any;}let count=0;for(const row of db.scan(records,[],{take:2})){count++;}return {count,next:ctx.newId()};});",
    refusal: "E_OPAQUE" },
  { name: "R17 review self-replaced-scan-loop", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100),flag:t.bool()},({db,ctx,args})=>{db=db.insert(records,{id:ctx.newId(),payload:null}) as any;let count=0;for(const row of db.scan(records,[],{take:2})){count++;}return {count,next:ctx.newId()};});",
    refusal: "E_OPAQUE" },
  { name: "R17 review stable-renamed-scan-loop", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100),flag:t.bool()},({db:writer,ctx,args})=>{let count=0;for(const row of writer.scan(records,[],{take:2})){count++;}return {count,next:ctx.newId()};});",
    runs: [{"args":{"payload":{"Row":{}},"flag":{"Bool":true}},"rows":[],"pointIds":[],"result":{"count":0,"next":"id-1"}},{"args":{"payload":{"Row":{}},"flag":{"Bool":false}},"rows":[],"pointIds":[],"result":{"count":0,"next":"id-1"}}] },
  { name: "R17 review grok-ctx-reassign-newId", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';\nexport const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{ctx=args.payload as any;return ctx.newId();});",
    refusal: "E_OPAQUE" },
  { name: "R17 review grok-args-reassign-field", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';\nexport const probe=mutation({flag:t.bool(),payload:t.json(100)},({db,ctx,args})=>{args=args.payload as any;return args.flag;});",
    refusal: "E_OPAQUE" },
  { name: "R17 adjacent length-text-capture", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{let value='a';const saved=value;value='hello';return {saved:saved.length,current:value.length};});",
    runs: [{"args":{},"result":{"saved":1,"current":5},"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent length-list-capture", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{let value=[1];const saved=value;value=[2,3];return {saved:saved.length,current:value.length};});",
    runs: [{"args":{},"result":{"saved":1,"current":2},"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent length-joined-object-fields", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{let value:any={length:7,extra:1};if(args.flag)value={length:9};return value.length;});",
    runs: [{"args":{"flag":{"Bool":true}},"result":9,"rows":[],"pointIds":[]},{"args":{"flag":{"Bool":false}},"result":7,"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent length-joined-insert-fields", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2'; export const records=table({columns:{length:t.int(),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}}); export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{let value:any=db.insert(records,{id:ctx.newId(),length:7,payload:null});if(args.flag)value={length:9};return {value:value.length,next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":{"value":9,"next":"id-2"}},{"args":{"flag":{"Bool":false}},"rows":[{"id":"id-1","length":7,"payload":null}],"pointIds":[],"result":{"value":7,"next":"id-2"}}] },
  { name: "R17 adjacent length-list-to-object", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{let value:any=[1];value={length:9};return value.length;});",
    runs: [{"args":{},"result":9,"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent length-object-to-list", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{let value:any={length:7};value=[2,3];return value.length;});",
    runs: [{"args":{},"result":2,"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent length-helper-values", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';function len(value:any){return value.length;}export const probe=mutation({},({db,ctx,args})=>{return {object:len({length:7}),text:len('abc'),list:len([1,2])};});",
    runs: [{"args":{},"result":{"object":7,"text":3,"list":2},"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent length-ambiguous-representation", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{let value:any={length:7};if(args.flag)value=[1,2];return value.length;});",
    refusal: "E_OPAQUE" },
  { name: "R17 adjacent length-optional-objects", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{const value=args.flag?{length:7}:null;return value?.length;});",
    runs: [{"args":{"flag":{"Bool":true}},"result":7,"rows":[],"pointIds":[]},{"args":{"flag":{"Bool":false}},"result":null,"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent helper-nested-common-id", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';function inner(flag:boolean,id:string){return flag?{id}:{id,payload:null};}function outer(flag:boolean,id:string){return inner(flag,id);}export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{const input=outer(args.flag,ctx.newId());const saved={input};const row=db.insert(records,saved.input);return {row,stored:db.get(records,[row.id]),next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1"},"stored":{"id":"id-1","payload":null},"next":"id-2"}},{"args":{"flag":{"Bool":false}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1","payload":null},"stored":{"id":"id-1","payload":null},"next":"id-2"}}] },
  { name: "R17 adjacent helper-captured-argument-id", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';function data(flag:boolean,id:string){return flag?{id}:{id,payload:null};}export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{let key:any=ctx.newId();const input=data(args.flag,key);key=ctx.newId();const row=db.insert(records,input);return {row,stored:db.get(records,[row.id]),key,next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1"},"stored":{"id":"id-1","payload":null},"next":"id-3","key":"id-2"}},{"args":{"flag":{"Bool":false}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1","payload":null},"stored":{"id":"id-1","payload":null},"next":"id-3","key":"id-2"}}] },
  { name: "R17 adjacent helper-conditional-absent-id-proof", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';function data(flag:boolean,id:string){return flag?{id}:{payload:null};}export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{const row=db.insert(records,data(args.flag,ctx.newId()) as any);return db.get(records,[row.id]);});",
    refusal: "E_PROVENANCE_AMBIGUOUS" },
  { name: "R17 adjacent helper-conditional-unknown-json", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';function data(flag:boolean,payload:any){return flag?payload:{id:\"given\"};}export const probe=mutation({flag:t.bool(),payload:t.json(100)},({db,ctx,args})=>{const row=db.insert(records,data(args.flag,args.payload));return db.get(records,[row.id]);});",
    refusal: "E_PROVENANCE_AMBIGUOUS" },
  { name: "R17 adjacent helper-conditional-lazy-effects", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';function data(flag:boolean,id:string,zero:number){return flag?{id}:{id,payload:divmod(2,zero)};}export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{const row=db.insert(records,data(args.flag,ctx.newId(),args.zero));return {row,stored:db.get(records,[row.id]),next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true},"zero":{"Int":0}},"rows":[{"id":"id-1","payload":null}],"pointIds":["id-1"],"result":{"row":{"id":"id-1"},"stored":{"id":"id-1","payload":null},"next":"id-2"}},{"args":{"flag":{"Bool":false},"zero":{"Int":0}},"error":"E_DIV_ZERO"},{"args":{"flag":{"Bool":false},"zero":{"Int":2}},"rows":[{"id":"id-1","payload":{"quotient":1,"remainder":0,"sink":"lexicographic-id"}}],"pointIds":["id-1"],"result":{"row":{"id":"id-1","payload":{"quotient":1,"remainder":0,"sink":"lexicographic-id"}},"stored":{"id":"id-1","payload":{"quotient":1,"remainder":0,"sink":"lexicographic-id"}},"next":"id-2"}}] },
  { name: "R17 adjacent helper-conditional-eager-actual", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';function data(flag:boolean,id:string,q:any){return flag?{id}:{id,payload:q};}export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{const row=db.insert(records,data(args.flag,ctx.newId(),divmod(2,args.zero)));return {row,stored:db.get(records,[row.id]),next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true},"zero":{"Int":0}},"error":"E_DIV_ZERO"},{"args":{"flag":{"Bool":false},"zero":{"Int":0}},"error":"E_DIV_ZERO"}] },
  { name: "R17 adjacent ctx-reassigned-now", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{ctx=args.payload as any;return ctx.now();});",
    refusal: "E_OPAQUE" },
  { name: "R17 adjacent ctx-reassigned-commitTime", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{ctx=args.payload as any;return ctx.commitTime();});",
    refusal: "E_OPAQUE" },
  { name: "R17 adjacent ctx-branch-reassigned", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),payload:t.json(100)},({db,ctx,args})=>{if(args.flag)ctx=args.payload as any;return ctx.newId();});",
    refusal: "E_OPAQUE" },
  { name: "R17 adjacent ctx-renamed-stable", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx:clock,args})=>{return {first:clock.newId(),now:clock.now(),commit:clock.commitTime(),next:clock.newId()};});",
    runs: [{"args":{},"rows":[],"pointIds":[],"result":{"first":"id-1","now":0,"commit":0,"next":"id-2"}}] },
  { name: "R17 adjacent ctx-assignment-rhs", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{ctx={viewer:ctx.newId()} as any;return 7;});",
    runs: [{"args":{},"result":7,"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent ctx-assignment-throwing-rhs", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({zero:t.int()},({db,ctx,args})=>{ctx={viewer:ctx.newId(),payload:divmod(2,args.zero)} as any;return 7;});",
    runs: [{"args":{"zero":{"Int":0}},"error":"E_DIV_ZERO"},{"args":{"zero":{"Int":2}},"result":7,"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent args-branch-reassigned", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),payload:t.json(100)},({db,ctx,args})=>{if(args.flag)args=args.payload as any;return args.flag;});",
    refusal: "E_OPAQUE" },
  { name: "R17 adjacent args-renamed-stable", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args:input})=>{return {value:input.flag,next:ctx.newId()};});",
    runs: [{"args":{"flag":{"Bool":true}},"rows":[],"pointIds":[],"result":{"value":true,"next":"id-1"}},{"args":{"flag":{"Bool":false}},"rows":[],"pointIds":[],"result":{"value":false,"next":"id-1"}}] },
  { name: "R17 adjacent args-captured-before-reassignment", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),payload:t.json(100)},({db,ctx,args})=>{const saved={value:args.flag};args=args.payload as any;return saved.value;});",
    runs: [{"args":{"flag":{"Bool":true},"payload":{"Row":{}}},"result":true,"rows":[],"pointIds":[]},{"args":{"flag":{"Bool":false},"payload":{"Row":{}}},"result":false,"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent args-whole-after-reassignment", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{args=args.payload as any;return args;});",
    refusal: "E_OPAQUE" },
  { name: "R17 adjacent args-list-current-receiver", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({values:t.list(t.int(),{max:3}),payload:t.json(100)},({db,ctx,args})=>{args=args.payload as any;let count=0;for(const value of args.values){count++;}return count;});",
    refusal: "E_OPAQUE" },
  { name: "R17 adjacent scan-captured-before-reassignment", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{const rows=db.scan(records,[],{take:2});db=args.payload as any;let count=0;for(const row of rows){count++;}return {count,next:ctx.newId()};});",
    runs: [{"args":{"payload":{"Row":{}}},"result":{"count":0,"next":"id-1"},"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent scan-branch-other-arm", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),payload:t.json(100)},({db,ctx,args})=>{if(args.flag){db=args.payload as any;return null;}else{let count=0;for(const row of db.scan(records,[],{take:2})){count++;}return {count,next:ctx.newId()};}});",
    runs: [{"args":{"flag":{"Bool":true},"payload":{"Row":{}}},"result":null,"rows":[],"pointIds":[]},{"args":{"flag":{"Bool":false},"payload":{"Row":{}}},"result":{"count":0,"next":"id-1"},"rows":[],"pointIds":[]}] },
  { name: "R17 adjacent scan-assignment-rhs", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{db=db.scan(records,[],{take:2}) as any;return db;});",
    runs: [{"args":{},"rows":[],"pointIds":[],"result":[]}] },
  { name: "R17 adjacent scan-filter-reassigned", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{db=args.payload as any;let count=0;for(const row of db.scan(records,[],{take:2}).filter(row=>true)){count++;}return count;});",
    refusal: "E_OPAQUE" },
]);

insertProvenanceCases.push(...[
  {"name":"R17 neighbor unknown replacement length scan","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{let value:any=db.scan(records,[],{take:2});value=args.payload;return value.length;});","refusal":"E_OPAQUE"},
  {"name":"R17 neighbor unknown replacement length list","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{let value:any=[1,2];value=args.payload;return value.length;});","refusal":"E_OPAQUE"},
  {"name":"R17 neighbor collection sizes","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({},({db,ctx,args})=>{const map=new Map<string,number>();map.set(\"x\",1);const set=new Set<number>();set.add(1);set.add(1);return {map:map.size,set:set.size};});","runs":[{"args":{},"result":{"map":1,"set":1},"rows":[],"pointIds":[]}]},
  {"name":"R17 neighbor nullable captured text length","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{const value=args.flag?'hello':null;return value?.length;});","runs":[{"args":{"flag":{"Bool":true}},"result":5,"rows":[],"pointIds":[]},{"args":{"flag":{"Bool":false}},"result":null,"rows":[],"pointIds":[]}]},
  {"name":"R17 neighbor nullable captured list length","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{const value=args.flag?[1,2]:null;return value?.length;});","runs":[{"args":{"flag":{"Bool":true}},"result":2,"rows":[],"pointIds":[]},{"args":{"flag":{"Bool":false}},"result":null,"rows":[],"pointIds":[]}]},
  {"name":"R17 neighbor text branch length","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{let value='a';if(args.flag)value='hello';return value.length;});","runs":[{"args":{"flag":{"Bool":true}},"result":5,"rows":[],"pointIds":[]},{"args":{"flag":{"Bool":false}},"result":1,"rows":[],"pointIds":[]}]},
  {"name":"R17 neighbor captured viewer before receiver assignment","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{const saved={viewer:ctx.viewer};ctx=args.payload as any;return saved;});","runs":[{"args":{"payload":{"Row":{}}},"result":{"viewer":"v"},"rows":[],"pointIds":[]}]},
  {"name":"R17 neighbor current args list capture","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({values:t.list(t.int(),{max:3}),payload:t.json(100)},({db,ctx,args})=>{const values=args.values;args=args.payload as any;let count=0;for(const value of values){count++;}return count;});","runs":[{"args":{"values":{"Array":[{"Int":1},{"Int":2}]},"payload":{"Row":{}}},"result":2,"rows":[],"pointIds":[]}]},
]);

insertProvenanceCases.push(...[
  {"name":"R17 representation enum-direct","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({value:t.enum(['a','hello'])},({args,ctx,db})=>{return args.value.length;});","runs":[{"args":{"value":{"String":"hello"}},"result":5,"rows":[],"pointIds":[]}]},
  {"name":"R17 representation enum-assigned","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({value:t.enum(['a','hello']),other:t.enum(['a','hello'])},({args,ctx,db})=>{let value:any=args.value;value=args.other;return value.length;});","runs":[{"args":{"value":{"String":"hello"},"other":{"String":"a"}},"result":1,"rows":[],"pointIds":[]}]},
  {"name":"R17 representation principal-length","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({value:t.principal()},({args,ctx,db})=>{return args.value.length;});","runs":[{"args":{"value":{"Id":"someone"}},"result":7,"rows":[],"pointIds":[]}]},
  {"name":"R17 representation mixed-text-list","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({args,ctx,db})=>{const value=args.flag?'a':[1,2];return value.length;});","runs":[{"args":{"flag":{"Bool":true}},"result":1,"rows":[],"pointIds":[]},{"args":{"flag":{"Bool":false}},"result":2,"rows":[],"pointIds":[]}]},
  {"name":"R17 representation enum-text-branch","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({value:t.enum(['a','b']),flag:t.bool()},({args,ctx,db})=>{let value:any=args.value;if(args.flag)value='hello';return value.length;});","runs":[{"args":{"flag":{"Bool":true},"value":{"String":"a"}},"result":5,"rows":[],"pointIds":[]},{"args":{"flag":{"Bool":false},"value":{"String":"a"}},"result":1,"rows":[],"pointIds":[]}]},
]);

insertProvenanceCases.push(...[
  {"name":"R17 wrapper wrapped-reassigned-scan-loop","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100),flag:t.bool()},({db,ctx,args})=>{db=args.payload as any;let count=0;for(const row of (db as any).scan(records,[],{take:2})){count++;}return {count,next:ctx.newId()};});","refusal":"E_OPAQUE"},
  {"name":"R17 wrapper wrapped-stable-renamed-scan-loop","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100),flag:t.bool()},({db:writer,ctx,args})=>{let count=0;for(const row of (writer as any).scan(records,[],{take:2})){count++;}return {count,next:ctx.newId()};});","runs":[{"args":{"payload":{"Row":{}},"flag":{"Bool":true}},"result":{"count":0,"next":"id-1"},"rows":[],"pointIds":[]},{"args":{"payload":{"Row":{}},"flag":{"Bool":false}},"result":{"count":0,"next":"id-1"},"rows":[],"pointIds":[]}]},
  {"name":"R17 wrapper stable receiver extra operand","public":false,"schema":"import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});","source":"import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({payload:t.json(100),flag:t.bool()},({db:writer,ctx,args})=>{let count=0;for(const row of (writer as any).scan(records,[],{take:2},ctx.newId())){count++;}return {count,next:ctx.newId()};});","refusal":"E_OPAQUE"},
]);


// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — nullable destination conversion guards work, preserves source snapshots and never supplies read authority.
// Checked-private complete projects; these are not claims of additional Quarry syntax.
insertProvenanceCases.push({
  name: "nullable destination 0-nullable-scalar-branch",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),d3:value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true}},"result":{"value":2,"next":"id-2"},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false}},"result":{"value":null,"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination 2-nullable-list-branch",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{let value:any=[2];if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),amounts:value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true}},"result":{"value":[2],"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[2000],"payload":null}]},
    {"args":{"flag":{"Bool":false}},"result":{"value":null,"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination 3-nullable-captured-object",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const box={value};db.insert(records,{id:ctx.newId(),d3:box.value});return {value,box,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true}},"result":{"value":2,"next":"id-2","box":{"value":2}},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false}},"result":{"value":null,"next":"id-2","box":{"value":null}},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination alias",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const saved=value;db.insert(records,{id:ctx.newId(),d3:saved});return {value,saved,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":2,"next":"id-2","saved":2},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-2","saved":null},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination nested-field",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const box={inner:{value}};db.insert(records,{id:ctx.newId(),d3:box.inner.value});return {value,box,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":2,"next":"id-2","box":{"inner":{"value":2}}},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-2","box":{"inner":{"value":null}}},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination captured-row",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const source={id:ctx.newId(),d3:value,payload:{ticket:ctx.newId()}};const saved={source};db.insert(records,saved.source);return {value,source,saved,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":2,"source":{"id":"id-1","d3":2,"payload":{"ticket":"id-2"}},"saved":{"source":{"id":"id-1","d3":2,"payload":{"ticket":"id-2"}}},"next":"id-3"},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":{"ticket":"id-2"}}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"source":{"id":"id-1","d3":null,"payload":{"ticket":"id-2"}},"saved":{"source":{"id":"id-1","d3":null,"payload":{"ticket":"id-2"}}},"next":"id-3"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":{"ticket":"id-2"}}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination capture-before-reassignment",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const source={d3:value};value=3;db.insert(records,{id:ctx.newId(),...source});return {source,value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  refusal: "E_OPAQUE",
});
insertProvenanceCases.push({
  name: "nullable destination helper-effect",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';function keep(x:any,ignored:any){return x;}export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),d3:keep(value,ctx.newId())});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":2,"next":"id-3"},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-3"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination helper-error",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';function keep(x:any,ignored:any){return x;}export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),d3:keep(value,divmod(1,args.zero))});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"error":"E_DIV_ZERO"},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"error":"E_DIV_ZERO"},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination literal-optional-elements",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),amounts:[value,3]});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.optional(t.decimal(3)),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":2,"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[2000,3000],"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[null,3000],"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination captured-optional-elements",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const amounts=[value,3];db.insert(records,{id:ctx.newId(),amounts});return {value,amounts,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.optional(t.decimal(3)),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":2,"next":"id-2","amounts":[2,3]},"rows":[{"id":"id-1","d3":null,"amounts":[2000,3000],"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-2","amounts":[null,3]},"rows":[{"id":"id-1","d3":null,"amounts":[null,3000],"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination optional-list-elements",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=[2,null,3];if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),amounts:value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.optional(t.decimal(3)),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":[2,null,3],"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[2000,null,3000],"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination optional-list-branch-elements",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let x:any=2;if(!args.flag)x=null;let value:any=[x,3];if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),amounts:value});return {x,value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.optional(t.decimal(3)),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":[2,3],"next":"id-2","x":2},"rows":[{"id":"id-1","d3":null,"amounts":[2000,3000],"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-2","x":null},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination nested-optional-list",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=[[2],null,[3,null]];if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),amounts:value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.optional(t.list(t.optional(t.decimal(3)),{max:5})),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":[[2],null,[3,null]],"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[[2000],null,[3000,null]],"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination nested-list-field",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=[2,null];if(!args.flag)value=null;const amounts=[value,[3]];const box={inner:{amounts}};db.insert(records,{id:ctx.newId(),amounts:box.inner.amounts});return {value,box,amounts,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.optional(t.list(t.optional(t.decimal(3)),{max:5})),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":[2,null],"amounts":[[2,null],[3]],"box":{"inner":{"amounts":[[2,null],[3]]}},"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[[2000,null],[3000]],"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"amounts":[null,[3]],"box":{"inner":{"amounts":[null,[3]]}},"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[null,[3000]],"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination nullable-source-object",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any={id:ctx.newId(),d3:2};if(!args.flag)value=null;db.insert(records,value);return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":{"id":"id-1","d3":2},"next":"id-2"},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"error":"E_TYPE"},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination collision",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const __conversionSource1=ctx.newId();const __convertedOptional2=ctx.newId();db.insert(records,{id:ctx.newId(),d3:value});return {value,__conversionSource1,__convertedOptional2,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":2,"__conversionSource1":"id-1","__convertedOptional2":"id-2","next":"id-4"},"rows":[{"id":"id-3","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"__conversionSource1":"id-1","__convertedOptional2":"id-2","next":"id-4"},"rows":[{"id":"id-3","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination overflow-lazy",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=9007199254740991;if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),d3:value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"error":"E_OVERFLOW"},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination overflow-before-error",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=9007199254740991;if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),d3:value,payload:divmod(1,args.zero)});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"error":"E_OVERFLOW"},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"error":"E_DIV_ZERO"},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination error-before-overflow",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=9007199254740991;if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),payload:divmod(1,args.zero),d3:value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"error":"E_DIV_ZERO"},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"error":"E_DIV_ZERO"},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination ordered-spread",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const data={d3:value};db.insert(records,{id:ctx.newId(),...data,d3:3});return {value,data,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  refusal: "E_OPAQUE",
});
insertProvenanceCases.push({
  name: "nullable destination ordered-spread-last",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const data={d3:value};db.insert(records,{id:ctx.newId(),d3:3,...data});return {value,data,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  refusal: "E_OPAQUE",
});
insertProvenanceCases.push({
  name: "nullable destination double-optional-destination",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),d3:value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.optional(t.decimal(3))),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":2,"next":"id-2"},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination effectful-selected-member",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;db.insert(records,{id:ctx.newId(),d3:({ticket:ctx.newId(),value}).value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":2,"next":"id-3"},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"next":"id-3"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination 5-nonnull-scalar-branch-control",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool()},({db,ctx,args})=>{let value=2;if(!args.flag)value=3;db.insert(records,{id:ctx.newId(),d3:value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true}},"result":{"value":2,"next":"id-2"},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false}},"result":{"value":3,"next":"id-2"},"rows":[{"id":"id-1","d3":3000,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination 7-mixed-no-decimal-authority",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),flag2:t.bool(),d3:t.decimal(3),d2:t.decimal(2),key:t.id(),text:t.text(8)},({db,ctx,args})=>{const value=args.flag?'hello':[1,2];db.insert(records,{id:ctx.newId(),d3:value as any});return value;});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  refusal: "E_DECIMAL_SCALE",
});
insertProvenanceCases.push({
  name: "nullable destination 8-mixed-no-member-authority",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),flag2:t.bool(),d3:t.decimal(3),d2:t.decimal(2),key:t.id(),text:t.text(8)},({db,ctx,args})=>{const value=args.flag?'hello':[1,2];return db.get(records,[(value as any).id]);});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  refusal: "E_PROVENANCE_AMBIGUOUS",
});
insertProvenanceCases.push({
  name: "nullable destination 9-mixed-no-list-bound-authority",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),flag2:t.bool(),d3:t.decimal(3),d2:t.decimal(2),key:t.id(),text:t.text(8)},({db,ctx,args})=>{const value=args.flag?'hello':[1,2];let count=0;for(const item of value as any){count++;}return count;});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  refusal: "E_UNBOUND_LOOP",
});
insertProvenanceCases.push({
  name: "nullable destination 10-nullable-same-decimal-source",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),flag2:t.bool(),d3:t.decimal(3),d2:t.decimal(2),key:t.id(),text:t.text(8)},({db,ctx,args})=>{let value:any=args.d3;if(!args.flag)value=null;const box={value};db.insert(records,{id:ctx.newId(),d3:value});return {value,box,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"flag2":{"Bool":false},"d3":{"Int":4321},"d2":{"Int":321},"key":{"Id":"key"},"text":{"String":"hello"}},"result":{"value":4321,"next":"id-2","box":{"value":4321}},"rows":[{"id":"id-1","d3":4321,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false},"flag2":{"Bool":false},"d3":{"Int":4321},"d2":{"Int":321},"key":{"Id":"key"},"text":{"String":"hello"}},"result":{"value":null,"next":"id-2","box":{"value":null}},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":true},"flag2":{"Bool":true},"d3":{"Int":4321},"d2":{"Int":321},"key":{"Id":"key"},"text":{"String":"hello"}},"result":{"value":4321,"next":"id-2","box":{"value":4321}},"rows":[{"id":"id-1","d3":4321,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination 11-nullable-wrong-decimal-source",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),flag2:t.bool(),d3:t.decimal(3),d2:t.decimal(2),key:t.id(),text:t.text(8)},({db,ctx,args})=>{let value:any=args.d3;if(!args.flag)value=null;if(args.flag2)value=args.d2;db.insert(records,{id:ctx.newId(),d3:value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  refusal: "E_DECIMAL_SCALE",
});
insertProvenanceCases.push({
  name: "nullable destination 17-nonnull-list-decimal-control",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),flag2:t.bool(),d3:t.decimal(3),d2:t.decimal(2),key:t.id(),text:t.text(8)},({db,ctx,args})=>{let value:any=[2];if(!args.flag)value=[3];db.insert(records,{id:ctx.newId(),amounts:value});return {value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"flag2":{"Bool":false},"d3":{"Int":4321},"d2":{"Int":321},"key":{"Id":"key"},"text":{"String":"hello"}},"result":{"value":[2],"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[2000],"payload":null}]},
    {"args":{"flag":{"Bool":false},"flag2":{"Bool":false},"d3":{"Int":4321},"d2":{"Int":321},"key":{"Id":"key"},"text":{"String":"hello"}},"result":{"value":[3],"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[3000],"payload":null}]},
    {"args":{"flag":{"Bool":true},"flag2":{"Bool":true},"d3":{"Int":4321},"d2":{"Int":321},"key":{"Id":"key"},"text":{"String":"hello"}},"result":{"value":[2],"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[2000],"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination capture-member-before-reassignment",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const source={d3:value};value=3;db.insert(records,{id:ctx.newId(),d3:source.d3});return {source,value,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"source":{"d3":2},"value":3,"next":"id-2"},"rows":[{"id":"id-1","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"source":{"d3":null},"value":3,"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});

insertProvenanceCases.push({
  name: "nullable destination authored guard name collision",
  public: false,
  source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),zero:t.int()},({db,ctx,args})=>{let value:any=2;if(!args.flag)value=null;const __conversionSource0=ctx.newId();const __convertedOptional1=ctx.newId();db.insert(records,{id:ctx.newId(),d3:value});return {value,__conversionSource0,__convertedOptional1,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":true},"zero":{"Int":0}},"result":{"value":2,"__conversionSource0":"id-1","__convertedOptional1":"id-2","next":"id-4"},"rows":[{"id":"id-3","d3":2000,"amounts":null,"payload":null}]},
    {"args":{"flag":{"Bool":false},"zero":{"Int":0}},"result":{"value":null,"__conversionSource0":"id-1","__convertedOptional1":"id-2","next":"id-4"},"rows":[{"id":"id-3","d3":null,"amounts":null,"payload":null}]},
  ],
});
insertProvenanceCases.push({
  name: "nullable destination full source alternative maximum",
  public: false,
  source: "import {mutation,t} from 'snapback2';import {records} from './schema';export const probe=mutation({flag:t.bool(),absent:t.bool()},({db,ctx,args})=>{let value:any=[2];if(args.flag)value=[3,4,5];if(args.absent)value=null;const box={value};db.insert(records,{id:ctx.newId(),amounts:box.value});return {value,box,next:ctx.newId()};});",
  schema: "import {schema,table,t,rule} from 'snapback2';export const records=table({columns:{d3:t.optional(t.decimal(3)),amounts:t.optional(t.list(t.decimal(3),{max:4})),payload:t.optional(t.json(1000))},rules:{read:rule.allow(),insert:rule.allow()}});export default schema({tables:{records}});",
  runs: [
    {"args":{"flag":{"Bool":false},"absent":{"Bool":false}},"result":{"value":[2],"box":{"value":[2]},"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[2000],"payload":null}]},
    {"args":{"flag":{"Bool":true},"absent":{"Bool":false}},"result":{"value":[3,4,5],"box":{"value":[3,4,5]},"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":[3000,4000,5000],"payload":null}]},
    {"args":{"flag":{"Bool":true},"absent":{"Bool":true}},"result":{"value":null,"box":{"value":null},"next":"id-2"},"rows":[{"id":"id-1","d3":null,"amounts":null,"payload":null}]},
  ],
});

export function registerInsertProvenanceChecks(test: Test): void {
  for (const item of insertProvenanceCases) test(`insert provenance ${item.name}`, async () => {
    const ext = item.public ? "q" : "ts";
    await withProject({ [`snapback/schema.${ext}`]: item.schema ?? (item.public ? insertPublicSchema : insertPrivateSchema),
      [`snapback/probe.${ext}`]: item.source }, async root => {
      const full = await lowerProject(root,item.public ? {} : {authoring:"any"});
      if (item.refusal) { assert(!full.ok,JSON.stringify(full)); assert(full.diagnostics.some(d=>d.code===item.refusal),JSON.stringify(full)); return; }
      assert(full.ok,JSON.stringify(full));
      for (const run of item.runs ?? []) {
        if (run.error) { assert.throws(()=>custodyActual(full,run.args),new RegExp(run.error)); continue; }
        if (run.uncoveredPartialSites) {
          const uncovered=custodyActual(full,run.args);
          assert.equal(uncovered.state,"partial");assert.deepEqual(uncovered.partialSites,run.uncoveredPartialSites);
        }
        const actual=custodyActual(full,run.args,run.receipt);assert(actual.state==="predicted" && actual.execution,JSON.stringify(actual));
        assert.deepEqual(decodeProducerValue(actual.execution.result),run.result);
        if (run.rows) assert.deepEqual(actual.execution.writes.map(write=>write.row && decodeProducerValue(write.row)),run.rows);
        if (run.pointIds) assert.deepEqual(actual.execution.trace.points.map(point=>point.key.map(decodeProducerValue)),run.pointIds.map(id=>[id]));
        if (run.pointKeys) assert.deepEqual(actual.execution.trace.points.map(point=>point.key.map(decodeProducerValue)),run.pointKeys);
      }
      if (item.name === "public inserted snapshot direct") {
        const consumer="import {api,type Op} from 'snapback2/client';type Result<T>=T extends Op<infer A,infer R>?R:never;declare const output:Result<typeof api.probe.probe>;const id:string=output.stored!.id;const amount:TYPE=output.row.d3!;";
        assert.deepEqual(apiConsumerDiagnostics(full.apiDts,consumer.replace("TYPE","number")),[]);
        assert(apiConsumerDiagnostics(full.apiDts,consumer.replace("TYPE","boolean")).some(d=>d.includes("TS2322")));
      }
    });
  });
}
