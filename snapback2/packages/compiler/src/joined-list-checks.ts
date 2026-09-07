import assert from "node:assert/strict";
import { lowerProject } from "./project";
import { apiConsumerDiagnostics, withProject, type Test } from "./quarry-check-helpers";
import { custodyActual } from "./capture-custody-checks";
import { decodeProducerValue } from "./capture-producer-checks";
import type { Value } from "./ir";
import { effectfulJoinCases } from "./effectful-join-cases";
import { clonePolicyCases } from "./clone-policy-cases";

type JoinRun = { args: Record<string, Value>; result?: unknown; rows?: number[]; payloads?: unknown[]; pointKeys?: unknown[][]; error?: string };
export type JoinedListCase = { name: string; public?: boolean; source: string; runs?: JoinRun[];
  schema?: string; refusal?: string; nativeRefusal?: boolean; maximum?: number };
export const joinedPublicSchema = `table records:
  d3: decimal 3 ?
  payload: json <=10000 ?
  public
  insert <- allow
`;
export const joinedPrivateSchema = `import {schema,table,t,rule} from 'snapback2';
export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});
export default schema({tables:{records}});`;
const list = (...values: number[]): Value => ({ Array: values.map(Int => ({ Int })) });
const inputs = (values: Value, maybe: Value = "Null", more: Value = list(1,2,3,4,5,6,7)) => ({ values, maybe, more });
const signature = "mutation probe(values: [decimal 3] <=3 ?, maybe: [decimal 3] <=5 ?, more: [decimal 3] <=7):\n";
const privateSource = (body: string, args = "values:t.optional(t.list(t.int(),{max:3})),more:t.list(t.int(),{max:7})") =>
  `import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({${args}},({args,db,ctx})=>{${body}});`;
export const joinedListCases: JoinedListCase[] = [];
for (const [name, setup, selected, nested, allocations] of [
  ["alias", "original = values ?? more", "original", false, 0],
  ["left alias", "left = values\n  original = left ?? more", "original", false, 0],
  ["right alias", "right = more\n  original = values ?? right", "original", false, 0],
  ["input fields", "inputs = {left: values, right: more}\n  original = inputs.left ?? inputs.right", "original", false, 0],
  ["alias chain", "a = values ?? more\n  b = a\n  original = b", "original", false, 0],
  ["object capture", "box = {values: values ?? more}", "box.values", false, 0],
  ["nested object capture", "box = {nested: {values: values ?? more}}", "box.nested.values", false, 0],
  ["optional field", "box = {values}\n  original = box.values ?? more", "original", false, 0],
  ["allocation before field", "box = {ticket: new, values: values ?? more}", "box.values", false, 1],
  ["allocation after field", "box = {values: values ?? more, ticket: new}", "box.values", false, 1],
  ["nested alternatives", "original = values ?? maybe ?? more", "original", true, 0],
  ["right associated alternatives", "original = values ?? (maybe ?? more)", "original", true, 0],
  ["captured optional join", "box = {left: values ?? maybe}\n  original = box.left ?? more", "original", true, 0],
] as const) {
  const rows = (values: number[]): Pick<JoinRun, "result" | "rows"> => ({ rows: values,
    result: { chosen: values, next: `id-${values.length + allocations + 1}` } });
  joinedListCases.push({ name: `public captured ${name}`, public: true, maximum: 7,
    source: `${signature}  ${setup}\n  for value in ${selected}:\n    insert records {d3: value}\n  return {chosen: ${selected}, next: new}\n`,
    runs: [{ args: inputs(list(4321)), ...rows([4321]) }, { args: inputs(list()), ...rows([]) },
      { args: inputs("Null"), ...rows([1,2,3,4,5,6,7]) },
      { args: inputs("Null", list(11,12,13,14,15)), ...rows(nested ? [11,12,13,14,15] : [1,2,3,4,5,6,7]) },
      { args: inputs("Null", list(), list()), ...rows([]) },
      { args: inputs(list(1,2,3,4)), error: "E_FANOUT" },
      { args: { maybe: "Null", more: list() }, error: "E_INPUT: missing arg values" }],
  });
}
for (const [name, setup, selected, nested] of [
  ["literal", "original = values ?? [2,3,4,5]", "original", false],
  ["literal alias", "fallback = [2,3,4,5]\n  original = values ?? fallback", "original", false],
  ["literal field", "box = {fallback: [2,3,4,5]}\n  original = values ?? box.fallback", "original", false],
  ["joined field", "box = {original: values ?? [2,3,4,5]}", "box.original", false],
  ["nested literal", "original = values ?? more ?? [2,3,4,5]", "original", true],
  ["nested literal field", "box = {original: values ?? more ?? [2,3,4,5]}", "box.original", true],
] as const) joinedListCases.push({ name: `public returned ${name}`, public: true, maximum: nested ? 5 : 4,
  source: `mutation probe(values: [int] <=3 ?, more: [int] <=5 ?):\n  ${setup}\n  for value in ${selected}:\n    require value > 0 else BAD\n  return ${selected}\n`,
  runs: [{ args: { values: "Null", more: "Null" }, result: [2,3,4,5] },
    { args: { values: list(), more: list(8,9) }, result: [] },
    { args: { values: list(9), more: "Null" }, result: [9] },
    { args: { values: "Null", more: list(6,7,8,9,10) }, result: nested ? [6,7,8,9,10] : [2,3,4,5] },
    { args: { values: list(0), more: "Null" }, error: "E_REQUIRE" }],
});
for (const field of [false, true]) joinedListCases.push({ name: `public literal source and destination ${field}`, public: true, refusal: "E_DECIMAL_SCALE",
  source: `mutation probe(values: [decimal 3] <=3 ?):\n  original = values ?? [2,3,4,5]\n  box = {original}\n  for value in ${field ? "box.original" : "original"}:\n    insert records {d3: value}\n  return original\n`,
});
for (const flag of [true, false]) joinedListCases.push({ name: `public enclosing branch ${flag}`, public: true,
  source: `mutation probe(values: [decimal 3] <=3 ?, more: [decimal 3] <=7, flag: bool):\n  if flag:\n    box = {values: values ?? more}\n    for value in box.values:\n      insert records {d3: value}\n    return box.values\n  else:\n    original = values ?? more\n    for value in original:\n      insert records {d3: value}\n    return original\n`,
  runs: [{ args: { values: "Null", more: list(11,12,13,14,15,16,17), flag: { Bool: flag } }, result: [11,12,13,14,15,16,17], rows: [11,12,13,14,15,16,17] }],
});
joinedListCases.push({ name: "public nested joined loops", public: true,
  source: `${signature}  original = values ?? more\n  for outer in original:\n    for inner in values ?? maybe ?? more:\n      insert records {d3: inner}\n  return {original, next: new}\n`,
  runs: [{ args: inputs("Null", "Null", list(1,2)), result: { original: [1,2], next: "id-5" }, rows: [1,2,1,2] },
    { args: inputs(list(4321)), result: { original: [4321], next: "id-2" }, rows: [4321] }],
});
joinedListCases.push({ name: "public body point read and allocation", public: true,
  source: `${signature}  original = values ?? more\n  for value in original:\n    row = insert records {d3: value}\n    require row != null else LOST\n  return {original, next: new}\n`,
  runs: [{ args: inputs("Null", "Null", list(1,2)), result: { original: [1,2], next: "id-3" }, rows: [1,2] }],
});
for (const [control, expected] of [["break",[1]], ["continue",[1,2,3]], ["return [...out]",[1]]] as const) joinedListCases.push({
  name: `private early ${control}`, source: privateSource(`const original=args.values??args.more; const out:any=[]; for(const value of original){out.push(value); ${control};} return out;`),
  runs: [{ args: { values: "Null", more: list(1,2,3) }, result: expected },
    { args: { values: list(), more: list(1,2,3) }, result: [] }],
});
joinedListCases.push({ name: "private early return out", refusal: "E_OPAQUE",
  source: privateSource("const original=args.values??args.more; const out:any=[]; for(const value of original){out.push(value); return out;} return out;") });
joinedListCases.push({ name: "public query retains joined capture", public: true,
  source: "query probe(values: [int] <=3 ?, more: [int] <=7):\n  original = values ?? more\n  for value in original:\n    require value > 0 else BAD\n  return original\n",
  runs: [{ args: { values: "Null", more: list(1,2,3) }, result: [1,2,3] },
    { args: { values: list(), more: list(1,2,3) }, result: [] }] });
joinedListCases.push({ name: "private loop shadows captured alias", source: privateSource("const original=args.values??args.more; for(const value of original){const original=[999]; db.require(original.length===1);} return original;"),
  runs: [{ args: { values: "Null", more: list(1,2,3) }, result: [1,2,3] }] });
joinedListCases.push({ name: "private scalar reassignment in branch body", source: privateSource("const original=args.values??args.more;let total=0;for(const value of original){total=total+value;}return {original,total};"),
  runs: [{ args: { values: "Null", more: list(1,2,3) }, result: { original: [1,2,3], total: 6 } }] });
joinedListCases.push({ name: "private body divmod sink", source: privateSource("const original=args.values??args.more;const out:any=[];for(const value of original){const q=divmod(value,2);out.push(q.remainder);}return out;"),
  runs: [{ args: { values: "Null", more: list(1,2,3) }, result: [1,0,1] }] });
for (const before of [false, true]) joinedListCases.push({ name: `public lazy division fallback ${before}`, public: true,
  source: `mutation probe(values: [int] <=3 ?, zero: int):\n${before ? "  first = divmod(1, zero).quotient\n" : ""}  original = values ?? [divmod(2, zero).quotient]\n  for value in original:\n    require value > 0 else BAD\n  return original\n`,
  runs: [{ args: { values: list(7), zero: { Int: 0 } }, ...(before ? { error: "E_DIV_ZERO" } : { result: [7] }) },
    { args: { values: "Null", zero: { Int: 0 } }, error: "E_DIV_ZERO" }],
});
joinedListCases.push({ name: "public lazy allocation fallback", public: true,
  source: "mutation probe(values: [id] <=3 ?):\n  original = values ?? [new]\n  for value in original:\n    require value != null else BAD\n  return {original, next: new}\n",
  runs: [{ args: { values: "Null" }, result: { original: ["id-1"], next: "id-2" } },
    { args: { values: { Array: [{ Id: "given" }] } }, result: { original: ["given"], next: "id-1" } }],
});
for (const body of ["const fallback:any=[1,2];const original=args.values??fallback;fallback.push(9);for(const value of original){}return original;",
  "const original:any=args.values??args.more;original.push(9);for(const value of original){}return original;"])
  joinedListCases.push({ name: `private mutation refusal ${joinedListCases.length}`, source: privateSource(body), refusal: "E_OPAQUE" });
joinedListCases.push({ name: "public joined body integer field merge", public: true,
  schema: joinedPublicSchema.replace("  public", "  group: int ?\n  by byGroup: group, id\n  public"),
  source: "mutation probe(values: [int] <=3 ?, more: [int] <=7):\n  original = values ?? more\n  for value in original:\n    rows = merge records first 2 by byGroup:\n      [row.group] for row in records[] first 2 by byId\n    require value > 0 else BAD\n  return original\n",
  // The bare evaluator has no merge certificate. Native checks and their
  // source/IR binding belong to the release evidence, not this fixture.
  runs: [{ args: { values: "Null", more: list(1) }, error: "E_TRACE_SUBSET" },
    { args: { values: list(), more: list(1) }, result: [] }] });

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — length observes
// the captured list; it does not establish presence or replace its origin.
joinedListCases.push(
  { name: "public length selection public-bounded-list-length", public: true,
    schema: "table records:\n  payload: json <=10000 ?\n  public\n  insert <- allow\n",
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7):
  original = values ?? more
  box = {original}
  return {size: box.original.length, original}
`,
    runs: [{"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":2,"original":[1,2]}},{"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1}]}},"result":{"size":0,"original":[]}}] },
  { name: "public length selection public-direct-bounded-list-length", public: true,
    schema: "table records:\n  payload: json <=10000 ?\n  public\n  insert <- allow\n",
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7):
  original = values ?? more
  box = {original}
  return {size: original.length, original}
`,
    runs: [{"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":2,"original":[1,2]}},{"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1}]}},"result":{"size":0,"original":[]}}] },
  { name: "public length selection length required", public: true,
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7):
  original = more
  return {size: original.length, original: original}
`,
    runs: [{"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":2,"original":[1,2]}},{"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":2,"original":[1,2]}}] },
  { name: "public length selection length required direct", public: true,
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7):
  return {size: more.length, original: more}
`,
    runs: [{"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":2,"original":[1,2]}},{"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":2,"original":[1,2]}}] },
  { name: "public length selection length nested object", public: true,
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7):
  original = values ?? more
  box = {outer: {original}}
  return {size: box.outer.original.length, original: box.outer.original}
`,
    runs: [{"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":2,"original":[1,2]}},{"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":0,"original":[]}}] },
  { name: "public length selection length list literal", public: true,
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7):
  original = [1,2]
  return {size: original.length, original: original}
`,
    runs: [{"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":2,"original":[1,2]}},{"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":2,"original":[1,2]}}] },
  { name: "public length selection length inline selection", public: true,
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7):
  return {size: (values ?? more).length, original: (values ?? more)}
`,
    runs: [{"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":2,"original":[1,2]}},{"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":0,"original":[]}}] },
  { name: "public length selection length presence", public: true,
    source: `mutation probe(values: [int] <=3 ?):
  if values != null:
    return {size: values.length, original: values}
  return {size: 0, original: []}
`,
    runs: [{"args":{"values":{"Array":[{"Int":7}]}},"result":{"size":1,"original":[7]}},{"args":{"values":{"Array":[]}},"result":{"size":0,"original":[]}},{"args":{"values":"Null"},"result":{"size":0,"original":[]}}] },
  { name: "public length selection length required assertion", public: true,
    source: `mutation probe(values: [int] <=3 ?):
  original = values ! else MISSING
  return {size: original.length, original}
`,
    runs: [{"args":{"values":{"Array":[{"Int":7}]}},"result":{"size":1,"original":[7]}},{"args":{"values":{"Array":[]}},"result":{"size":0,"original":[]}},{"args":{"values":"Null"},"error":"E_REQUIRE"}] },
  { name: "public length selection length nested maxima", public: true, maximum: 7,
    source: `mutation probe(values: [int] <=3 ?, maybe: [int] <=5 ?, more: [int] <=7):
  box = {joined: values ?? maybe}
  original = box.joined ?? more
  size = original.length
  for value in original:
    require value > 0 else BAD
  return {size, original}
`,
    runs: [{"args":{"values":"Null","maybe":"Null","more":{"Array":[{"Int":1},{"Int":2},{"Int":3},{"Int":4},{"Int":5},{"Int":6},{"Int":7}]}},"result":{"size":7,"original":[1,2,3,4,5,6,7]}},{"args":{"values":"Null","maybe":{"Array":[{"Int":9},{"Int":8},{"Int":7},{"Int":6},{"Int":5}]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3},{"Int":4},{"Int":5},{"Int":6},{"Int":7}]}},"result":{"size":5,"original":[9,8,7,6,5]}},{"args":{"values":"Null","maybe":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3},{"Int":4},{"Int":5},{"Int":6},{"Int":7}]}},"result":{"size":0,"original":[]}}] },
  { name: "public length selection length before decimal write", public: true, maximum: 7,
    source: `mutation probe(values: [decimal 3] <=3 ?, more: [decimal 3] <=7):
  original = values ?? more
  box = {original}
  size = box.original.length
  for value in original:
    insert records {d3: value}
  return {size, original, again: box.original.length, next: new}
`,
    runs: [{"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2},{"Int":3},{"Int":4},{"Int":5},{"Int":6},{"Int":7}]}},"result":{"size":7,"again":7,"original":[1,2,3,4,5,6,7],"next":"id-8"},"rows":[1,2,3,4,5,6,7]},{"args":{"values":{"Array":[{"Int":4321}]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3},{"Int":4},{"Int":5},{"Int":6},{"Int":7}]}},"result":{"size":1,"again":1,"original":[4321],"next":"id-2"},"rows":[4321]},{"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3},{"Int":4},{"Int":5},{"Int":6},{"Int":7}]}},"result":{"size":0,"again":0,"original":[],"next":"id-1"},"rows":[]},{"args":{"values":{"Array":[{"Int":1},{"Int":2},{"Int":3},{"Int":4}]},"more":{"Array":[]}},"error":"E_FANOUT"},{"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2},{"Int":3},{"Int":4},{"Int":5},{"Int":6},{"Int":7},{"Int":8}]}},"error":"E_FANOUT"}] },
  { name: "public length selection length lazy IDs", public: true, maximum: 3,
    source: `mutation probe(values: [id] <=3 ?):
  original = values ?? [new, new]
  box = {original}
  size = box.original.length
  for key in original:
    stored = records[key]
    require stored = null else EXISTS
  return {size, original, again: original.length, next: new}
`,
    runs: [{"args":{"values":"Null"},"result":{"size":2,"again":2,"original":["id-1","id-2"],"next":"id-3"},"pointKeys":[["id-1"],["id-2"]]},{"args":{"values":{"Array":[{"Id":"given"}]}},"result":{"size":1,"again":1,"original":["given"],"next":"id-1"},"pointKeys":[["given"]]},{"args":{"values":{"Array":[]}},"result":{"size":0,"again":0,"original":[],"next":"id-1"},"pointKeys":[]}] },
  { name: "public length selection length eager IDs", public: true, maximum: 3,
    source: `mutation probe(values: [id] <=3 ?):
  fallback = [new, new]
  original = values ?? fallback
  box = {original}
  size = box.original.length
  for key in original:
    stored = records[key]
    require stored = null else EXISTS
  return {size, original, again: original.length, next: new}
`,
    runs: [{"args":{"values":"Null"},"result":{"size":2,"again":2,"original":["id-1","id-2"],"next":"id-3"},"pointKeys":[["id-1"],["id-2"]]},{"args":{"values":{"Array":[{"Id":"given"}]}},"result":{"size":1,"again":1,"original":["given"],"next":"id-3"},"pointKeys":[["given"]]},{"args":{"values":{"Array":[]}},"result":{"size":0,"again":0,"original":[],"next":"id-3"},"pointKeys":[]}] },
  { name: "public length selection length lazy division", public: true,
    source: `mutation probe(values: [int] <=3 ?, zero: int):
  original = values ?? [divmod(2, zero).quotient]
  return {size: original.length, original}
`,
    runs: [{"args":{"values":"Null","zero":{"Int":0}},"error":"E_DIV_ZERO"},{"args":{"values":{"Array":[{"Int":9}]},"zero":{"Int":0}},"result":{"size":1,"original":[9]}},{"args":{"values":{"Array":[]},"zero":{"Int":0}},"result":{"size":0,"original":[]}},{"args":{"values":"Null","zero":{"Int":2}},"result":{"size":1,"original":[1]}}] },
  { name: "public length selection length eager division", public: true,
    source: `mutation probe(values: [int] <=3 ?, zero: int):
  fallback = [divmod(2, zero).quotient]
  original = values ?? fallback
  return {size: original.length, original}
`,
    runs: [{"args":{"values":"Null","zero":{"Int":0}},"error":"E_DIV_ZERO"},{"args":{"values":{"Array":[{"Int":9}]},"zero":{"Int":0}},"error":"E_DIV_ZERO"},{"args":{"values":{"Array":[]},"zero":{"Int":0}},"error":"E_DIV_ZERO"},{"args":{"values":"Null","zero":{"Int":2}},"result":{"size":1,"original":[1]}}] },
  { name: "public length selection length object field", public: true,
    source: `mutation probe():
  original = [1,2]
  box = {length: 9, original}
  return {field: box.length, size: box.original.length, original}
`,
    runs: [{"args":{},"result":{"field":9,"size":2,"original":[1,2]}}] },
  { name: "public length selection length object only", public: true,
    source: `mutation probe():
  box = {length: 9}
  return box.length
`,
    runs: [{"args":{},"result":9}] },
  { name: "public length selection length row field", public: true,
    schema: "table records:\n  length: int\n  public\n  insert <- allow\n",
    source: `mutation probe():
  row = insert records {length: 9}
  return {size: row.length, row, next: new}
`,
    runs: [{"args":{},"result":{"size":9,"row":{"id":"id-1","length":9},"next":"id-2"}}] },
  { name: "public length selection length refusal absent direct", public: true, refusal: "E_QUARRY_TYPE",
    source: `mutation probe(values: [int] <=3 ?):
  return values.length
`,
  },
  { name: "public length selection length refusal absent captured", public: true, refusal: "E_QUARRY_TYPE",
    source: `mutation probe(values: [int] <=3 ?):
  return ({values}).values.length
`,
  },
  { name: "public length selection length refusal absent alternatives", public: true, refusal: "E_QUARRY_TYPE",
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7 ?):
  return (values ?? more).length
`,
  },
  { name: "public length selection length refusal absent null fallback", public: true, refusal: "E_QUARRY_TYPE",
    source: `mutation probe(values: [int] <=3 ?):
  return (values ?? null).length
`,
  },
  { name: "public length selection length refusal unknown JSON", public: true, refusal: "E_OPAQUE",
    source: `mutation probe(values: json <=1000):
  return values.length
`,
  },
  { name: "public length selection length refusal mixed fallback", public: true, refusal: "E_OPAQUE",
    source: `mutation probe(values: [int] <=3 ?, more: json <=1000):
  return (values ?? more).length
`,
  },
  { name: "public length selection length refusal text", public: true, refusal: "E_QUARRY_UNKNOWN",
    source: `mutation probe(values: text <=20):
  return values.length
`,
  },
  { name: "public length selection length absent count", public: true, refusal: "E_QUARRY_TYPE",
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7 ?):
  return count(values ?? more)
`,
  },
  { name: "public length selection length nullable join narrowed", public: true,
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7 ?):
  original = values ?? more
  if original != null:
    return {size: original.length, original}
  return {size: 0, original: []}
`,
    runs: [{"args":{"values":"Null","more":"Null"},"result":{"size":0,"original":[]}},{"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2},{"Int":3},{"Int":4}]}},"result":{"size":4,"original":[1,2,3,4]}},{"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2}]}},"result":{"size":0,"original":[]}}] },
  { name: "public length selection length tokens", public: true,
    source: `query probe():
  original = tokens('@a @b')
  return {size: original.length, original}
`,
    runs: [{"args":{},"result":{"size":2,"original":["a","b"]}}] },
  { name: "public length selection length nested absent alternatives", public: true, refusal: "E_QUARRY_TYPE",
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7 ?):
  box = {outer: {original: values ?? more}}
  return box.outer.original.length
`,
  },
  { name: "public length selection length nested all nullable", public: true, refusal: "E_QUARRY_TYPE",
    source: `mutation probe(values: [int] <=3 ?, more: [int] <=7 ?, last: [int] <=5 ?):
  original = values ?? (more ?? last)
  return original.length
`,
  },
  { name: "public length selection length direct once IDs", public: true,
    source: `mutation probe(values: [id] <=3 ?):
  size = (values ?? [new,new]).length
  return {size, next: new}
`,
    runs: [{"args":{"values":"Null"},"result":{"size":2,"next":"id-3"}},{"args":{"values":{"Array":[{"Id":"given"}]}},"result":{"size":1,"next":"id-1"}},{"args":{"values":{"Array":[]}},"result":{"size":0,"next":"id-1"}}] },
  { name: "public length selection length eager object capture", public: true,
    source: `mutation probe(values: [id] <=3 ?):
  box = {before: new, fallback: [new,new], after: new}
  original = values ?? box.fallback
  return {size: original.length, original, box, next: new}
`,
    runs: [{"args":{"values":"Null"},"result":{"size":2,"original":["id-2","id-3"],"box":{"before":"id-1","fallback":["id-2","id-3"],"after":"id-4"},"next":"id-5"}},{"args":{"values":{"Array":[]}},"result":{"size":0,"original":[],"box":{"before":"id-1","fallback":["id-2","id-3"],"after":"id-4"},"next":"id-5"}},{"args":{"values":{"Array":[{"Id":"given"}]}},"result":{"size":1,"original":["given"],"box":{"before":"id-1","fallback":["id-2","id-3"],"after":"id-4"},"next":"id-5"}}] },
  { name: "public length selection length earlier error first", public: true,
    source: `mutation probe(values: [int] <=3 ?, first: bool, zero: int):
  require first else FIRST
  original = values ?? [divmod(2,zero).quotient]
  return {size: original.length, original}
`,
    runs: [{"args":{"values":"Null","first":{"Bool":false},"zero":{"Int":0}},"error":"E_REQUIRE"},{"args":{"values":{"Array":[]},"first":{"Bool":false},"zero":{"Int":0}},"error":"E_REQUIRE"}] },
  { name: "public length selection length page explicit index", public: true,
    source: `query probe():
  original = records[] first 3 by byId
  return {size: original.length, original}
`,
  },
  { name: "public length selection count page explicit index", public: true,
    source: `query probe():
  original = records[] first 3 by byId
  return {size: count(original), original}
`,
  },


  { name: "public length selection count nullable direct", public: true, refusal: "E_QUARRY_TYPE",
    source: `mutation probe(values: [int] <=3 ?):
  return count(values)
`,
    runs: [{"args":{"values":"Null"}},{"args":{"values":{"Array":[]}}}] },
);

export function registerJoinedListChecks(test: Test): void {
  for (const item of [...joinedListCases, ...effectfulJoinCases, ...clonePolicyCases]) test(`joined list ${item.name}`, async () => {
    const ext = item.public ? "q" : "ts";
    await withProject({ [`snapback/schema.${ext}`]: item.schema ?? (item.public ? joinedPublicSchema : joinedPrivateSchema),
      [`snapback/probe.${ext}`]: item.source }, async root => {
      const full = await lowerProject(root, item.public ? {} : { authoring: "any" });
      if (item.refusal) { assert(!full.ok, JSON.stringify(full)); assert(full.diagnostics.some(d => d.code === item.refusal), JSON.stringify(full)); return; }
      assert(full.ok, JSON.stringify(full));
      if (item.maximum !== undefined) {
        const bounds: number[] = [];
        const walk = (v: any): void => { if (!v || typeof v !== "object") return;
          if (v.For) bounds.push(v.For.domain.ArgList?.max ?? v.For.domain.DerivedArray?.max
            ?? v.For.domain.LiteralRange?.end_exclusive - v.For.domain.LiteralRange?.start);
          Object.values(v).forEach(walk); };
        walk(full.project.programs[0]!.body);
        assert.equal(Math.max(...bounds), item.maximum);
      }
      for (const run of item.runs ?? []) {
        if (run.error) { assert.throws(() => custodyActual(full, run.args), new RegExp(run.error)); continue; }
        const actual = custodyActual(full, run.args); assert(actual.state === "predicted" && actual.execution, JSON.stringify(actual));
        assert.deepEqual(decodeProducerValue(actual.execution.result), run.result);
        if (run.pointKeys) assert.deepEqual(actual.execution.trace.points.map(point => point.key.map(decodeProducerValue)), run.pointKeys);
        if (run.rows) assert.deepEqual(actual.execution.writes.map(write => {
          assert(write.row && typeof write.row === "object" && "Row" in write.row);
          return decodeProducerValue(write.row.Row.d3!);
        }), run.rows);
        if (run.payloads) assert.deepEqual(actual.execution.writes.map(write => {
          assert(write.row && typeof write.row === "object" && "Row" in write.row);
          return decodeProducerValue(write.row.Row.payload!);
        }), run.payloads);
      }
      if (item.public && (item.name === "public captured alias" || item.name === "public length selection public-bounded-list-length")) {
        const consumer = "import {api,type Op} from 'snapback2/client';import type {Decimal} from 'snapback2';type Args<T>=T extends Op<infer A,unknown>?A:never;const args:Args<typeof api.probe.probe>={more:VALUE};";
        assert.deepEqual(apiConsumerDiagnostics(full.apiDts, consumer.replace("VALUE", item.name === "public captured alias" ? "[4321 as Decimal<3>]" : "[1,2]")), []);
        assert(apiConsumerDiagnostics(full.apiDts, consumer.replace("VALUE", "['wrong']")).some(d => d.includes("TS2322")));
      }
    });
  });
}
