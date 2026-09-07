import type { JoinedListCase } from "./joined-list-checks";
import type { Value } from "./ir";

const ints = (...values: number[]): Value => ({ Array: values.map(Int => ({ Int })) });
const ids = (...values: string[]): Value => ({ Array: values.map(Id => ({ Id })) });
const idNames = (count: number, start = 1) => Array.from({ length: count }, (_,i) => `id-${i + start}`);
export const effectfulJoinCases: JoinedListCase[] = [];
for (const earlier of [false, true]) effectfulJoinCases.push({
  name: `effectful division branches ${earlier}`, public: true,
  source: `mutation probe(values: [int] <=3 ?, zero: int):\n${earlier ? "  first = divmod(1, zero).quotient\n" : ""}  original = values ?? [divmod(2, zero).quotient]\n  for value in original:\n    require value > 0 else BAD\n  return original\n`,
  runs: [{ args: { values: ints(), zero: { Int: 0 } }, ...(earlier ? { error: "E_DIV_ZERO" } : { result: [] }) },
    { args: { values: ints(1,2,3), zero: { Int: 0 } }, ...(earlier ? { error: "E_DIV_ZERO" } : { result: [1,2,3] }) },
    { args: { values: "Null", zero: { Int: 1 } }, result: [2] },
    { args: { values: "Null", zero: { Int: -1 } }, error: "E_REQUIRE" },
    { args: { values: ints(0), zero: { Int: 0 } }, error: earlier ? "E_DIV_ZERO" : "E_REQUIRE" },
    { args: { values: ints(1,2,3,4), zero: { Int: 0 } }, error: "E_FANOUT" }],
});
for (const size of [1,2,5,7]) effectfulJoinCases.push({
  name: `effectful tuple ${size} allocations and body writes`, public: true, maximum: Math.max(3,size),
  source: `mutation probe(values: [id] <=3 ?):\n  original = values ?? [${Array(size).fill("new").join(", ")}]\n  for value in original:\n    insert records {payload: {value}}\n  return {original, next: new}\n`,
  runs: [{ args: { values: "Null" }, result: { original: idNames(size), next: `id-${size * 2 + 1}` }, payloads: idNames(size).map(value => ({value})) },
    { args: { values: ids() }, result: { original: [], next: "id-1" }, payloads: [] },
    { args: { values: ids("given", "other") }, result: { original: ["given", "other"], next: "id-3" }, payloads: [{value:"given"},{value:"other"}] }],
});
for (const [name, setup, selected, allocated] of [
  ["alias", "original = values ?? [new, new]\n  alias = original", "alias", 0],
  ["field", "box = {original: values ?? [new, new]}", "box.original", 0],
  ["nested field", "box = {inner: {original: values ?? [new, new]}}", "box.inner.original", 0],
  ["earlier member", "box = {ticket: new, original: values ?? [new, new]}", "box.original", 1],
  ["later member", "box = {original: values ?? [new, new], ticket: new}", "box.original", 0],
  ["intervening allocation", "original = values ?? [new, new]\n  ticket = new", "original", 0],
  ["captured fallback", "fallback = [new, new]\n  original = values ?? fallback", "original", 0],
  ["captured fallback field", "box = {fallback: [new, new]}\n  original = values ?? box.fallback", "original", 0],
] as const) {
  const eager = name.startsWith("captured fallback"), extra = ["earlier member","later member","intervening allocation"].includes(name) ? 1 : 0;
  effectfulJoinCases.push({ name: `effectful capture ${name}`, public: true,
    source: `mutation probe(values: [id] <=3 ?):\n  ${setup}\n  for value in ${selected}:\n    require value != null else BAD\n  return {original: ${selected}, next: new}\n`,
    runs: [{ args: { values: "Null" }, result: { original: idNames(2,allocated + 1), next: `id-${3 + extra}` } },
      { args: { values: ids() }, result: { original: [], next: `id-${1 + extra + (eager ? 2 : 0)}` } },
      { args: { values: ids("given") }, result: { original: ["given"], next: `id-${1 + extra + (eager ? 2 : 0)}` } }],
  });
}
for (const expression of ["values ?? more ?? [new, new]", "values ?? (more ?? [new, new])", "box.left ?? box.right ?? [new, new]"]) {
  effectfulJoinCases.push({ name: `effectful nested ${expression}`, public: true, maximum: 5,
    source: `mutation probe(values: [id] <=3 ?, more: [id] <=5 ?):\n  box = {left: values, right: more}\n  original = ${expression}\n  for value in original:\n    require value != null else BAD\n  return {original, next: new}\n`,
    runs: [{ args: { values: "Null", more: "Null" }, result: { original: idNames(2), next: "id-3" } },
      { args: { values: ids(), more: "Null" }, result: { original: [], next: "id-1" } },
      { args: { values: "Null", more: ids("a","b","c","d","e") }, result: { original: ["a","b","c","d","e"], next: "id-1" } }],
  });
}
effectfulJoinCases.push({ name: "effectful nested independent loops", public: true,
  source: "mutation probe(values: [id] <=3 ?, more: [id] <=5 ?):\n  original = values ?? [new, new]\n  for outer in original:\n    inner = more ?? [new, new]\n    for value in inner:\n      insert records {payload: {outer, value}}\n  return {original, next: new}\n",
  runs: [{ args: { values: "Null", more: "Null" }, result: { original: idNames(2), next: "id-11" },
    payloads: [{outer:"id-1",value:"id-3"},{outer:"id-1",value:"id-4"},{outer:"id-2",value:"id-7"},{outer:"id-2",value:"id-8"}] },
    { args: { values: ids(), more: "Null" }, result: { original: [], next: "id-1" }, payloads: [] }],
});
effectfulJoinCases.push({ name: "effectful minor units through saved tuple", public: true, maximum: 5,
  source: "mutation probe(values: [decimal 3] <=3 ?, d3: decimal 3):\n  original = values ?? [d3, d3, d3, d3, d3]\n  for value in original:\n    insert records {d3: value}\n  return original\n",
  runs: [{ args: { values: "Null", d3: { Int: 4321 } }, result: [4321,4321,4321,4321,4321], rows: [4321,4321,4321,4321,4321] },
    { args: { values: ints(2000), d3: { Int: 4321 } }, result: [2000], rows: [2000] }],
});
effectfulJoinCases.push({ name: "effectful incompatible minor tuple refusal", public: true, refusal: "E_DECIMAL_SCALE",
  source: "mutation probe(values: [decimal 3] <=3 ?, d2: decimal 2):\n  original = values ?? [d2]\n  for value in original:\n    insert records {d3: value}\n  return original\n" });
effectfulJoinCases.push({ name: "effectful tuple division first error", public: true,
  source: "mutation probe(values: [int] <=3 ?, zero: int, big: int):\n  original = values ?? [divmod(2, zero).quotient, big + 1]\n  for value in original:\n    require value > 0 else BAD\n  return original\n",
  runs: [{ args: { values: "Null", zero: { Int: 0 }, big: { Int: 9007199254740991 } }, error: "E_DIV_ZERO" },
    { args: { values: "Null", zero: { Int: 1 }, big: { Int: 9007199254740991 } }, error: "E_OVERFLOW" },
    { args: { values: ints(), zero: { Int: 0 }, big: { Int: 9007199254740991 } }, result: [] }],
});
const privateSource = (body: string, helpers = "") => `import {mutation,t,divmod} from 'snapback2'; import {records} from './schema'; ${helpers}export const probe=mutation({values:t.optional(t.list(t.id(),{max:3}))},({args,db,ctx})=>{${body}});`;
for (const exit of ["break", "continue", "return {original, out:[...out], next:ctx.newId()}"]) effectfulJoinCases.push({
  name: `effectful private early ${exit}`, source: privateSource(`const original=args.values??[ctx.newId(),ctx.newId()];const out:any=[];for(const value of original){out.push(value);${exit};}return {original,out,next:ctx.newId()};`),
  runs: [{ args: { values: "Null" }, result: { original: idNames(2), out: idNames(exit === "continue" ? 2 : 1), next: "id-3" } },
    { args: { values: ids() }, result: { original: [], out: [], next: "id-1" } }],
});
effectfulJoinCases.push({ name: "effectful private nested object tuple", source: privateSource("const original:any=args.values??[{inner:{value:ctx.newId()}},{inner:{value:ctx.newId()}}];const out:any=[];for(const value of original){out.push(value.inner.value);}return {original,out,next:ctx.newId()};"),
  runs: [{ args: { values: "Null" }, result: { original: [{inner:{value:"id-1"}},{inner:{value:"id-2"}}], out: idNames(2), next: "id-3" } }],
});
effectfulJoinCases.push({ name: "effectful public scan read sites", public: true,
  source: "mutation probe(values: [id] <=3 ?):\n  original = values ?? [new, new]\n  for value in original:\n    rows = records[] first 2 by byId\n    require count(rows) >= 0 else BAD\n    insert records {payload: {value}}\n  return {original, next: new}\n",
  runs: [{ args: { values: "Null" }, result: { original: idNames(2), next: "id-5" }, payloads: idNames(2).map(value => ({value})) },
    { args: { values: ids("given") }, result: { original: ["given"], next: "id-2" }, payloads: [{value:"given"}] }],
});
effectfulJoinCases.push({ name: "effectful public body merge", public: true,
  schema: "table records:\n  d3: decimal 3 ?\n  payload: json <=10000 ?\n  group: int ?\n  by byGroup: group, id\n  public\n  insert <- allow\n",
  source: "mutation probe(values: [int] <=3 ?, divisor: int):\n  original = values ?? [divmod(2, divisor).quotient, 3]\n  for value in original:\n    rows = merge records first 2 by byGroup:\n      [row.group] for row in records[] first 2 by byId\n    require value > 0 else BAD\n  return original\n",
  // This fixture deliberately has no native certificate or drained receipt.
  runs: [{ args: { values: "Null", divisor: {Int:1} }, error: "E_TRACE_SUBSET" },
    { args: { values: ints(), divisor: {Int:0} }, result: [] }],
});
effectfulJoinCases.push({ name: "effectful private nested helper declaration refusal", refusal: "E_OPAQUE",
  source: privateSource("function ident(x:any){return x;}const original=args.values??ident([ctx.newId(),ctx.newId()]);const out:any=[];for(const value of original){out.push(value);}return {original,out,next:ctx.newId()};") });
effectfulJoinCases.push({ name: "effectful private module helper saved fallback", source: privateSource("const original=args.values??ident([ctx.newId(),ctx.newId()]);const out:any=[];for(const value of original){out.push(value);}return {original,out,next:ctx.newId()};", "function ident(x:any){return x;}"),
  runs: [{ args: { values: "Null" }, result: { original: idNames(2), out: idNames(2), next: "id-3" } },
    { args: { values: ids() }, result: { original: [], out: [], next: "id-1" } }],
});
effectfulJoinCases.push({ name: "effectful private lexical collision", source: privateSource("const __capturedItem1=ctx.newId();const original=args.values??[ctx.newId(),ctx.newId()];const out:any=[];for(const value of original){const original=ctx.newId();out.push({value,original});}return {original,out,first:__capturedItem1,next:ctx.newId()};"),
  runs: [{ args: { values: "Null" }, result: { original: idNames(2,2), out: [{value:"id-2",original:"id-4"},{value:"id-3",original:"id-5"}], first:"id-1", next: "id-6" } }],
});
effectfulJoinCases.push({ name: "effectful private mutated fallback refusal", refusal: "E_OPAQUE",
  source: privateSource("const fallback:any=[ctx.newId()];const original=args.values??fallback;fallback.push(ctx.newId());for(const value of original){}return original;") });
