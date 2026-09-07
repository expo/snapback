import type { JoinedListCase } from "./joined-list-checks";
import type { Value } from "./ir";

// Whole objects expose policy corruption even when quotient/remainder arithmetic is correct.
export const clonePolicyCases: JoinedListCase[] = [
  { name: "clone grok-divmod-full", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000)),decimals:t.optional(t.list(t.decimal(3),{max:20}))},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({values:t.optional(t.list(t.int(),{max:3})),more:t.list(t.int(),{max:7})},({args})=>{const original=args.values??args.more; const out:any=[]; for(const value of original){const q=divmod(value,2);out.push(q);} return out;});",
    runs: [
      {"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":[{"quotient":0,"remainder":1,"sink":"lexicographic-id"},{"quotient":1,"remainder":0,"sink":"lexicographic-id"},{"quotient":1,"remainder":1,"sink":"lexicographic-id"}]},
      {"args":{"values":{"Array":[{"Int":4},{"Int":5}]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":[{"quotient":2,"remainder":0,"sink":"lexicographic-id"},{"quotient":2,"remainder":1,"sink":"lexicographic-id"}]},
      {"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":[]},
    ],
  },
  { name: "clone public-divmod-full", public: true,
    schema: "table records:\n  d3: decimal 3 ?\n  payload: json <=10000 ?\n  public\n  insert <- allow\n",
    source: "mutation probe(values: [int] <=3 ?, more: [int] <=7):\n  original = values ?? more\n  for value in original:\n    q = divmod(value, 2)\n    return q\n  return null\n",
    runs: [
      {"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":{"quotient":0,"remainder":1,"sink":"lexicographic-id"}},
      {"args":{"values":{"Array":[{"Int":4},{"Int":5}]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":{"quotient":2,"remainder":0,"sink":"lexicographic-id"}},
      {"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":null},
    ],
  },
  { name: "clone public-required-divmod-full", public: true,
    schema: "table records:\n  d3: decimal 3 ?\n  payload: json <=10000 ?\n  public\n  insert <- allow\n",
    source: "mutation probe(values: [int] <=3, more: [int] <=7):\n  original = values ?? more\n  for value in original:\n    q = divmod(value, 2)\n    return q\n  return null\n",
    runs: [
      {"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"error":"E_INPUT"},
      {"args":{"values":{"Array":[{"Int":4},{"Int":5}]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":{"quotient":2,"remainder":0,"sink":"lexicographic-id"}},
      {"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":null},
    ],
  },
  { name: "clone public-object-field-tags", public: true,
    schema: "table records:\n  d3: decimal 3 ?\n  payload: json <=10000 ?\n  public\n  insert <- allow\n",
    source: "mutation probe(values: [int] <=3 ?, more: [int] <=7):\n  original = values ?? more\n  for value in original:\n    q = divmod(value, 2)\n    local = value + 1\n    return {Literal: local, Variable: local, Const: {name: local}, Divmod: {remainder_sink: \"local\"}, Field: {base: local, name: \"local\"}, site: \"probe.probe.0\", q}\n  return null\n",
    runs: [
      {"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":{"Const":{"name":2},"Divmod":{"remainder_sink":"local"},"Field":{"base":2,"name":"local"},"Literal":2,"Variable":2,"q":{"quotient":0,"remainder":1,"sink":"lexicographic-id"},"site":"probe.probe.0"}},
      {"args":{"values":{"Array":[{"Int":4},{"Int":5}]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":{"Const":{"name":5},"Divmod":{"remainder_sink":"local"},"Field":{"base":5,"name":"local"},"Literal":5,"Variable":5,"q":{"quotient":2,"remainder":0,"sink":"lexicographic-id"},"site":"probe.probe.0"}},
      {"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":null},
    ],
  },
  { name: "clone private-object-field-tags", public: false,
    schema: "import {schema,table,t,rule} from 'snapback2';\nexport const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000)),decimals:t.optional(t.list(t.decimal(3),{max:20}))},rules:{read:rule.allow(),insert:rule.allow()}});\nexport default schema({tables:{records}});",
    source: "import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({values:t.optional(t.list(t.int(),{max:3})),more:t.list(t.int(),{max:7})},({args})=>{const original=args.values??args.more;const out:any=[];for(const value of original){const local=value+1;out.push({Literal:local,Variable:local,Const:{name:local},Divmod:{remainder_sink:'local'},Field:{base:local,name:'local'},site:'probe.probe.0',q:divmod(value,2)});}return out;});",
    runs: [
      {"args":{"values":"Null","more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":[{"Const":{"name":2},"Divmod":{"remainder_sink":"local"},"Field":{"base":2,"name":"local"},"Literal":2,"Variable":2,"q":{"quotient":0,"remainder":1,"sink":"lexicographic-id"},"site":"probe.probe.0"},{"Const":{"name":3},"Divmod":{"remainder_sink":"local"},"Field":{"base":3,"name":"local"},"Literal":3,"Variable":3,"q":{"quotient":1,"remainder":0,"sink":"lexicographic-id"},"site":"probe.probe.0"},{"Const":{"name":4},"Divmod":{"remainder_sink":"local"},"Field":{"base":4,"name":"local"},"Literal":4,"Variable":4,"q":{"quotient":1,"remainder":1,"sink":"lexicographic-id"},"site":"probe.probe.0"}]},
      {"args":{"values":{"Array":[{"Int":4},{"Int":5}]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":[{"Const":{"name":5},"Divmod":{"remainder_sink":"local"},"Field":{"base":5,"name":"local"},"Literal":5,"Variable":5,"q":{"quotient":2,"remainder":0,"sink":"lexicographic-id"},"site":"probe.probe.0"},{"Const":{"name":6},"Divmod":{"remainder_sink":"local"},"Field":{"base":6,"name":"local"},"Literal":6,"Variable":6,"q":{"quotient":2,"remainder":1,"sink":"lexicographic-id"},"site":"probe.probe.0"}]},
      {"args":{"values":{"Array":[]},"more":{"Array":[{"Int":1},{"Int":2},{"Int":3}]}},"result":[]},
    ],
  },
];

const list = (...values: number[]) => ({ Array: values.map(Int => ({ Int })) });
const divmod = (n: number) => ({ quotient: Math.floor(n / 2), remainder: n % 2, sink: "lexicographic-id" });
const publicArgs = (values: Value, more = list(1, 2, 3)) => ({ values, more });
const signature = "mutation probe(values: [int] <=3 ?, more: [int] <=7):\n";
const privateSource = (body: string) => `import {mutation,t,divmod} from 'snapback2';import {records} from './schema';export const probe=mutation({values:t.optional(t.list(t.int(),{max:3})),more:t.list(t.int(),{max:7})},({args,db,ctx})=>{${body}});`;

clonePolicyCases.push({ name: "clone public full stored objects and row capture", public: true, maximum: 7,
  source: `${signature}  box = {Literal: {selected: values ?? more}}\n  for value in box.Literal.selected:\n    local = value + 1\n    q = divmod(value, 2)\n    row = insert records {payload: {Literal: local, Variable: local, Divmod: {remainder_sink: "local"}, q}}\n    require row != null else LOST\n  return {original: box.Literal.selected, next: new}\n`,
  runs: ([list(4,5), "Null", list()] as const).map(values => {
    const selected = values === "Null" ? [1,2,3] : values.Array.map(v => v.Int);
    return { args: publicArgs(values), result: { original: selected, next: `id-${selected.length + 1}` },
      payloads: selected.map(n => ({ Literal: n + 1, Variable: n + 1, Divmod: { remainder_sink: "local" }, q: divmod(n) })) };
  }),
});

for (const eager of [false, true]) clonePolicyCases.push({ name: `clone public nested effectful full objects eager ${eager}`, public: true,
  source: `mutation probe(values: [int] <=3 ?, maybe: [int] <=5 ?, zero: int):\n${eager ? "  earlier = divmod(1, zero)\n" : ""}  box = {ticket: new, Literal: {selected: values ?? maybe ?? [divmod(6, zero).quotient, 5]}}\n  for value in box.Literal.selected:\n    q = divmod(value, 2)\n    insert records {payload: {q, ticket: box.ticket}}\n  return {original: box.Literal.selected, next: new}\n`,
  runs: [
    { args: { values: list(4,5), maybe: "Null", zero: { Int: 0 } }, ...(eager ? { error: "E_DIV_ZERO" } : {
      result: { original: [4,5], next: "id-4" }, payloads: [4,5].map(n => ({ q: divmod(n), ticket: "id-1" })) }) },
    { args: { values: list(), maybe: "Null", zero: { Int: 0 } }, ...(eager ? { error: "E_DIV_ZERO" } : {
      result: { original: [], next: "id-2" }, payloads: [] }) },
    { args: { values: "Null", maybe: list(1,2,3,4,5), zero: { Int: 2 } }, result: { original: [1,2,3,4,5], next: "id-7" },
      payloads: [1,2,3,4,5].map(n => ({ q: divmod(n), ticket: "id-1" })) },
    { args: { values: "Null", maybe: "Null", zero: { Int: 0 } }, error: "E_DIV_ZERO" },
    { args: { values: "Null", maybe: "Null", zero: { Int: 2 } }, result: { original: [3,5], next: "id-4" },
      payloads: [3,5].map(n => ({ q: divmod(n), ticket: "id-1" })) },
  ],
});

clonePolicyCases.push({ name: "clone private outer assign push and sort policy",
  source: privateSource("const selected=args.values??args.more;let total=0;const out:any=[];for(const value of selected){const local=value+1;const sorted=[{local:local+1},{local}].sort((a,b)=>a.local-b.local);const q=divmod(value,2);total=total+value;out.push({Literal:local,sorted,q},total);}return {selected,total,out};"),
  runs: [
    { args: publicArgs(list(4,5)), result: { selected: [4,5], total: 9, out: [
      { Literal: 5, sorted: [{ local: 5 },{ local: 6 }], q: divmod(4) }, 4,
      { Literal: 6, sorted: [{ local: 6 },{ local: 7 }], q: divmod(5) }, 9] } },
    { args: publicArgs("Null", list(1)), result: { selected: [1], total: 1, out: [
      { Literal: 2, sorted: [{ local: 2 },{ local: 3 }], q: divmod(1) }, 1] } },
    { args: publicArgs(list()), result: { selected: [], total: 0, out: [] } },
  ],
});

clonePolicyCases.push({ name: "clone private cyclic self length remains refused", refusal: "E_OPAQUE",
  source: privateSource("const selected=args.values??args.more;let total=0;const out:any=[];for(const value of selected){const local=value+1;const sorted=[{local:local+1},{local}].sort((a,b)=>a.local-b.local);const q=divmod(value,2);total=total+value;out.push({Literal:local,sorted,q},out.length);}return {selected,total,out};"),
});

for (const exit of ["break", "continue", "return [...out]"]) clonePolicyCases.push({ name: `clone private full object ${exit}`,
  source: privateSource(`const selected=args.values??args.more;const out:any=[];for(const value of selected){const local=value+1;const q=divmod(value,2);out.push({Literal:local,q});${exit};}return out;`),
  runs: [
    { args: publicArgs(list(4,5)), result: (exit === "continue" ? [4,5] : [4]).map(n => ({ Literal: n + 1, q: divmod(n) })) },
    { args: publicArgs("Null"), result: (exit === "continue" ? [1,2,3] : [1]).map(n => ({ Literal: n + 1, q: divmod(n) })) },
    { args: publicArgs(list()), result: [] },
  ],
});

clonePolicyCases.push({ name: "clone public nested loop policies", public: true,
  source: `${signature}  original = values ?? more\n  for outer in original:\n    for inner in values ?? more:\n      q = divmod(inner, 2)\n      local = outer + inner\n      insert records {payload: {Literal: local, q}}\n  return original\n`,
  runs: [{ args: publicArgs(list(4,5)), result: [4,5], payloads: [4,5].flatMap(a => [4,5].map(b => ({ Literal: a + b, q: divmod(b) }))) },
    { args: publicArgs("Null", list(1,2)), result: [1,2], payloads: [1,2].flatMap(a => [1,2].map(b => ({ Literal: a + b, q: divmod(b) }))) }],
});

clonePolicyCases.push({ name: "clone public scan after write", public: true,
  source: `${signature}  original = values ?? more\n  for value in original:\n    q = divmod(value, 2)\n    insert records {payload: q}\n    rows = records[] first 2 by byId\n    require value > 0 else BAD\n  return original\n`,
  runs: [{ args: publicArgs(list(4)), result: [4], payloads: [divmod(4)] },
    { args: publicArgs("Null", list(1)), result: [1], payloads: [divmod(1)] }],
});

clonePolicyCases.push({ name: "clone public generated merge body", public: true,
  schema: "table records:\n  group: int ?\n  payload: json <=10000 ?\n  by byGroup: group, id\n  public\n  insert <- allow\n",
  source: `${signature}  original = values ?? more\n  for value in original:\n    q = divmod(value, 2)\n    rows = merge records first 2 by byGroup:\n      [row.group] for row in records[] first 2 by byId\n    return q\n  return null\n`,
  // Ordinary generated public lanes; this evaluator fixture has no certificate.
  runs: [{ args: publicArgs(list(4)), error: "E_TRACE_SUBSET" },
    { args: publicArgs("Null", list(1)), error: "E_TRACE_SUBSET" }, { args: publicArgs(list()), result: null }],
});

clonePolicyCases.push({ name: "clone public inserted row point key", public: true,
  source: `${signature}  original = values ?? more\n  for value in original:\n    q = divmod(value, 2)\n    row = insert records {payload: q}\n    stored = records[row.id]\n    require stored != null else LOST\n  return original\n`,
  runs: [{ args: publicArgs(list(4)), result: [4], payloads: [divmod(4)] },
    { args: publicArgs("Null",list(1,2)), result: [1,2], payloads: [divmod(1),divmod(2)] },
    { args: publicArgs(list()), result: [], payloads: [] }],
});

clonePolicyCases.push({ name: "clone public argument element point key", public: true,
  source: "mutation probe(values: [id] <=3 ?, more: [id] <=7):\n  original = values ?? more\n  for value in original:\n    key = value\n    stored = records[key]\n    q = divmod(5, 2)\n    require stored = null else FOUND\n    return {key, q}\n  return null\n",
  runs: [{ args: { values: { Array: [{ Id: "given" }] }, more: { Array: [{ Id: "other" }] } }, result: { key: "given", q: divmod(5) } },
    { args: { values: "Null", more: { Array: [{ Id: "other" }] } }, result: { key: "other", q: divmod(5) } },
    { args: { values: list(), more: { Array: [{ Id: "other" }] } }, result: null }],
});
