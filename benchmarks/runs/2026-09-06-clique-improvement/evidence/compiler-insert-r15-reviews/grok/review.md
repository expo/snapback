CHANGES_REQUIRED

# R15 insert-result provenance compiler review

Independent mutually-blind review of candidate `dd54ba3b18b21051bbec4ad383e4929eb46463b0` against parent `3a558c2a48c171deddf22815dd775eddcd52db96`. Product source was not modified. No writer reports, peer reviews, sibling reviewer directories, or native-scale trees were read.

## Verdict

The six-path delta correctly makes a **modeled `db.insert` result** a row for closed provenance (LLP 1002 §2): public Quarry `insert records {payload: q}` plus `records[row.id]` compiles, point-read provenance is `Shape`, ID allocation/operands-once/join/capture cases evaluate as authored, omitted optional members stay off the insert snapshot, and several parent `Const` holes on missing members are closed.

It does **not** soundly classify insert members when the insert **input object shape is unknown**. `classifyRow` falls back to **table columns** (`id` plus schema fields), which is the get-row rule. That fallback is now applied to insert snapshots. Parent refused those paths with `E_PROVENANCE_AMBIGUOUS` because insert was not a row. Candidate compiles them, tags the read `Shape`, and the Linux certificate-only checker **issues a certificate** (`error: null`, `prefix_template: "Shape"`). Evaluator then throws `E_SCHEMA: records row lacks id` when the JSON has no `id`.

That is an introduced, in-scope provenance defect. Named fixtures use object literals (Quarry also injects `id: ctx.newId()`), so they do not cover the fallback.

**Required change:** for `isDbInsertCall`, if `knownObjectFields` of the insert input is missing, refuse (`ambiguous` / `E_PROVENANCE_AMBIGUOUS`). Do not use `rowFields(table)` as the insert snapshot. Keep table columns only for `db.get`.

## Model identity

- Effective model stated here: **Grok 4.6** (xAI), this review session.
- Supervisor records the actual CLI terminal and effective model independently.
- No subagents. No product edits.

## Bound inputs (rehashed)

| Item | SHA-256 | Notes |
|---|---|---|
| `input-manifest.json` | `de7c88eed0b8699931298188d7be5de28577f26c79fb6e2da86de26db2de18ae` | 2726 entries |
| `compiler-manifest.json` | `c438d407f65d0bf039476dd1eb7a1b8b141be2533a240db8be9f0e201f85b3ff` | 219 compiler files |
| `delta.patch` | `6c413c78ee4facf2cef6931b140bbe0203fa501c039d1b7f3519f4f8753c725e` | six paths |
| `parent-compiler.tar` | `ce4ac9ecc7b4e215b66305ee6d349029e25141fba4c793f438a1f544df23a075` | Git `3a` export, 218 files |
| `candidate-compiler.tar` | `badafabc80592fde029df7a52a344798ecfbbec06762116bea8593ca217a10ee` | matches live 219 files |
| `packages/evaluator/src/types.ts` | `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618` | protected |
| `packages/evaluator/dist/unicode-tables.ts` | `9eccdccd99e9b936a40dcbf8ae63c55d980086df1ae71f92019f9ab040f6a521` | bound generated Unicode |
| node_modules (320 files) aggregate | `d2fabb9aaba19e45ba0a76b5e803d567aa159e3a00b5f68e38670801fa7bf281` | no install/fetch |

Source/support archive `c9448ddd3351af986977addb38e0a20a2641828ffe3cd55b3af9824820b72134` was **not present** in this snapshot. No hash of those unavailable bytes is claimed.

Live compiler vs candidate tar: **identical**. Manifest vs live: **no mismatches**. After-probe compiler tree compare: **identical** to before. Candidate-only file: `src/insert-provenance-checks.ts`. Five other delta files differ from parent as expected.

## Tool identity (EPYC, rehashed)

Host `expose-builder-pixel`. Exclusive remote: `/home/ccheever/clique-reviews/compiler-insert-r15-dd54-4d5c8109db/grok`.

| Tool | Path | SHA-256 |
|---|---|---|
| Node v22.23.2 | `.../node-v22.23.2-linux-x64/bin/node` | `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327` |
| Bun 1.3.12 | `.../bun-v1.3.12-linux-x64/bin/bun` | `92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa` |
| Linux checker | `.../snapback2-linux-x86_64-debug` | `2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175` |

Checker is certificate-only (`check --ir --json`), source `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`, graph `07d985316ae2d74494980a0c4871a13a877237ca0de15f97e2d12ad337518e70`, v5. Not a whole-source rebuild; not the historical Mac checker. PATH per command: pinned tool dirs + `/usr/bin:/bin`. Deadline 30s per subprocess (`/usr/bin/timeout`). Elapsed in the recorder is integer seconds (sub-second runs show `0`). Wrapper PID is `timeout`; `timeout-pid.txt` is the inner exec.

TypeScript 5.9.2 from bound `node_modules`. No Rust build, no native server, no package/publication/benchmark commands.

## Defect (introduced)

`snapback2/packages/compiler/src/lower/provenance.ts` `classifyRow`:

```347:354:snapback2/packages/compiler/src/lower/provenance.ts
function classifyRow(call: ts.CallExpression, env: Environment, path: readonly string[]): Classification {
  if (path.length === 0) return known("Shape");
  const fields = knownObjectFields(call, env) ?? rowFields(call.arguments[0], env);
  if (fields && !fields.includes(path[0]!)) return absent();
  if (path.length > 1) return ambiguous();
  return { ...known("Shape"), presence: isNullableDbGet(call,
    (binding) => isOperationCompositeBinding(binding, "db", env)) ? "optional" : "required" };
}
```

`knownObjectFields` for insert returns the **input object** (correct: storage-materialized optionals are not on that snapshot). When that is `undefined`, `?? rowFields(table)` treats every schema column including `id` as present on the insert result.

Parent `isRowCall` was only `.get` on the operation `db` binding. Insert member paths were `ambiguous`. Candidate `isRowCall` is `isNullableDbGet || isDbInsertCall` (lexical `db`, not a method-name suffix). That is the right identity rule for modeled inserts; the table-column fallback must not ride along.

### Independent probe (private, `authoring: "any"`)

Schema: `payload: optional json` only (no decimal, so `E_DECIMAL_SCALE` does not mask the path).

```ts
const input:any=args.payload;
const row=db.insert(records,input);
return db.get(records,[row.id]);
```

| Graph | Compile | Read provenance | Evaluator |
|---|---|---|---|
| Parent | `E_PROVENANCE_AMBIGUOUS` | n/a | n/a |
| Candidate | **ok** | **Shape** `records.byId` | payload `{hello:1}` → `E_SCHEMA: records row lacks id`; payload `{id:"given"}` → `{id:"given", payload:null}` |

Ternary `{id: ctx.newId(), payload:null} | {payload:null}`: candidate compiles `Shape`; true branch predicted `{id:"id-1", payload:null}`; false branch `E_SCHEMA: records row lacks id`.

Native certificate-only (candidate IR of the json-arg case), PID 3687439/3687440, exit 0, stdout sha `a8dcbd5ba13746aa9e47ebea822f2549934d585020916e7040307034e2557267`:

- `error: null`
- `plan_hash: b9486b72a8d7afea20517f6559db6d6bf04673109191faacd2b6a06fd3d46f0c`
- `read_sites[0].prefix_template: "Shape"`

With a decimal column, the same unknown insert is often also `E_DECIMAL_SCALE` (`d3: unknown does not prove Decimal<3>`), which **hides** the provenance accept. Removing that column makes the `Shape` accept observable. Missing members **not** in the schema still refuse (`row.missing` → `E_PROVENANCE_AMBIGUOUS`) on both graphs for insert-unknown and on candidate for get-unknown.

Public Quarry inserts emit `id: ctx.newId()` into an object literal, so `knownObjectFields` is defined and this hole is not hit by the named public fixtures.

## What the delta gets right (must keep)

Governing rule: LLP 1002 §2 closed provenance — literals `Const`, args `Arg`, `ctx.viewer` `Viewer`, proved row fields `Shape`; unknown/mutable refuse `E_PROVENANCE_AMBIGUOUS`; lexical `args`/`ctx`/`db` identity, not spelling.

### Original public source (parent refuse → candidate values)

```
mutation probe(values: [int] <=3 ?, more: [int] <=7):
  original = values ?? more
  for value in original:
    q = divmod(value, 2)
    row = insert records {payload: q}
    stored = records[row.id]
    require stored != null else LOST
  return original
```

Parent (PID 3681040/3681041): `ok: false`, `E_PROVENANCE_AMBIGUOUS`, site `snapback/probe.q:6:5`, candidates `<unknown origin>`.

Candidate (PID 3681256/3681257): `ok: true`, Get provenance `Shape` on `records.byId` (two loop-lowered sites). Evaluator (`custodyActual` adapted schema + `new_ids id-1…`; **not** native authority):

| Args | Result | Point keys | Point provenance | Writes (storage row) |
|---|---|---|---|---|
| values `[4,5]`, more `[1,2,3]` | `[4,5]` | `[id-1]`, `[id-2]` | Shape, Shape | `id-1` payload divmod(4); `id-2` divmod(5); storage `d3: null` |
| values `Null`, more `[1,2,3]` | `[1,2,3]` | id-1..id-3 | Shape | matching divmod payloads |
| values `[]`, more `[1,2,3]` | `[]` | none | | no writes |
| values `Null`, more 7 ints | 7 ints | id-1..id-7 | Shape | 7 inserts |
| values 4 ints | `E_FANOUT: arg values exceeds list max 3` | | | |

Insert **return** snapshot for `{payload: q}` is `{id, payload}` (Quarry injected `id`). Storage writes add omitted optional `d3: null`. Direct `return row.d3` after omitted insert remains inherited runtime `E_FIELD: missing field d3` on **both** parent and candidate (not a read key).

Native certificate of this program, PID 3687418/3687419, exit 0, stdout sha `cbadaabe8875b23783cb65058cbb5f5d69328aa72eefc19fc2d1f2dc3d27ea8a`, `error: null`, both read sites `prefix_template: Shape`, `max_rows: 7`. Certificate-only; no native execution claimed.

### Public cases (candidate compile + evaluator)

All named public insert-provenance programs compiled except the intended omitted-optional-key refusal.

- Snapshot direct / alias / object / nested / member: `{row, stored}` both `{id:"id-1", d3:4321, payload: divmod(5)}`, `next: "id-2"`, point `[id-1]` Shape.
- Joined alias/nested/saved: two inserts, `next: "id-3"` (present `[4,5]`) and `next: "id-4"` (nullish `[1,2,3]`).
- Explicit id literal/argument: row id `"given"`, `next: "id-1"` (allocation unused). Allocation `id: new`: row `"id-1"`, `next: "id-2"`.
- Operands once: `earlier=id-1`, row `id-2` payload `{ticket:id-3}`, `next: id-4`.
- Unreadable row false: `stored: null`, insert still written. True: `E_REQUIRE`.
- Error order: require-before-div0 → `E_REQUIRE`; earlier div0 → `E_DIV_ZERO`.
- Argument / object-captured argument point reads: provenance **Arg**, not Shape.
- Capture then update (update allowed): returned `original.d3=2000`, `stored.d3=3000`, same id. Same source without update rule: compile ok, run `E_RULE: records update`.
- Omitted `row.d3` as alternate key: `E_PROVENANCE_AMBIGUOUS` (candidate). Parent also refused, but because insert was not a row at all.
- Explicit `d3: null` alternate key: Shape on `records.byD3`, uncovered partial `["records.byD3"]` without fixture receipt; with constructed absence receipt, predicted `{row,stored}` both `{id, d3:null, payload:null}`, point `[null]`. Native cert PID 3687460/3687461, stdout sha `e640d092969d67ad3b4b27b836e1cde0256bea8d73f9239c89be5cd6bd1121fe`, `prefix_template: Shape` on `byD3`. Fixture receipt is **not** native-issued authority.

### Private cases

Renamed `db:writer` insert+get: Shape, values `{row,stored}` id-1 d3 2000, next id-2. Stable `let` insert snapshot: same row via get.

Refusals that match the suite: reassigned / branch-reassigned insert → `E_PROVENANCE_AMBIGUOUS`; mutated `row.id` → `E_OPAQUE`; unknown insert member, nested json `.payload.id`, `divmod` as row, missing insert/object/read captures before reassignment → `E_PROVENANCE_AMBIGUOUS`; forged `.insert`, `declare function insert()`, shadowed `db` → `E_OPAQUE` (sometimes plus provenance). Helper named `insert` that returns `{id}` keeps **Arg**, not native insert authority. Spread `{...row, id: args.key}` keeps later Arg override (`pointKeys [["given"]]`). Duplicate `{id: args.key, ...row}` is TS `E_OPAQUE` ("'id' is specified more than once") — not a provenance claim.

Immutable capture before reassignment: `box.row` / `box.key` still Shape id-1 after `row = args.payload`.

`const box={...row}` after `{id, payload}` insert: `box` is `{id, payload}` only; `stored` get has `d3: null`. Storage-only field is not copied onto the earlier snapshot.

### Introduced vs inherited missing-member behavior

| Path | Parent | Candidate | Attribution |
|---|---|---|---|
| `records[row.id]` after insert (original) | refuse ambiguous | Shape + values | **introduced accept** (intended) |
| insert result unknown schema member | refuse (insert not a row) | refuse absent → ambiguous | introduced row proof + member filter |
| `db.get` then `[row.missing]` | **compiles**, second get provenance **Const** | refuse `E_PROVENANCE_AMBIGUOUS` | **introduced refuse** (`combineClassifications` no longer drops `absent` to Const) |
| `(args as any).missing` / `{id}.missing` as key | compiles **Const** | refuse | **introduced refuse** (same aggregate/absent rule) |
| `[row.missing, 1]` after get | compiles **Const** | refuse | **introduced refuse** |
| `[row.missing, 1]` after insert | refuse (insert not a row) | refuse | parent inherited; candidate still refuse |
| `return row.d3` omitted optional | compile + runtime `E_FIELD` | same | **inherited** E_FIELD, not a read key |
| insert return omits optional vs storage null | `{id,payload}` vs write `{d3:null,...}` | same | inherited snapshot vs storage |
| unknown insert input `row.id` as key | refuse | **compile Shape**, runtime/schema miss | **introduced unsound accept** |

`combineClassifications`: parent dropped `absent` and could yield `Const` for an aggregate that included a missing member. Candidate: any `absent` → `ambiguous`. That matches LLP 1002 (each key component needs its own origin) and is a keep.

`classifyBoundRow` fallback through `immutableOrigin` when a later assignment clears `objectFields` is required for “capture then reassign” and correctly returns `absent` when the captured insert object lacks the member.

Receiver identity: `(db as any)["insert"]` is `E_OPAQUE` (unmodeled helper) plus provenance refuse on `row.id`. `other.insert` is `E_OPAQUE`. User spelling does not confer `db` authority.

## Typecheck

Original attempts (preserve):

1. `typecheck-six` PID 3681726/3681727 exit 2: `tsc` relative `src/*.ts` with recorder **not chdiring** → `TS6053` file not found.
2. `typecheck-p` PID 3687392/3687393 exit 1: `tsconfig.json` not found, same cwd bug.

Corrected (explicit `cd` to `packages/compiler`): `typecheck-abs` PID 3687651/3687652 exit 2, elapsed 4s. **No** `packages/compiler/src` diagnostics. Ten `error TS*` lines: seven inherited evaluator `TraceRange`/`IndexAtom`/`Scalar` gaps (`runner.ts`, `store.ts`) plus `expo-file-system` / `expo/fetch` and `twin.ts` ClosureReceipt — scoped evaluator/client contract, not this delta.

## Limitations (scoped, not used as skip)

- No claim of complete current main or native **execution**. Compiler-only v5 landing remains held on old-main columns/Scalar decoder; this review did not add a schema adapter or native source change.
- `custodyActual` adapts `index.components` → `columns` for the frozen evaluator and may attach a constructed `schema_hash` receipt. Those are test inputs, not native-issued authority. Raw uncovered `partial` vs receipt-covered `predicted` was kept distinct (byD3).
- Linux checker: certificate only. Certificates above are not runtime traces.
- Recorder elapsed is integer seconds; wrapper PID is `timeout`.
- Archive container bytes were unavailable here.
- `node_modules` aggregate hash is of the bound 320 files in this snapshot after probes; product source hashes were unchanged from the before compare.

## Retained manifests

- Compiler 219 files: `compiler-manifest.json` / live / candidate tar agree.
- Parent tar 218 files; delta is exactly the six paths.
- Input manifest 2726 files, SHA above.
- Evidence on EPYC: `scratch/out/*.json`, `scratch/records/*/`, `scratch/out/ir/*.json`. Copied locally to `scratch/out/` and `scratch/records/` without copying `node_modules`.

## Subprocess register (serial, 30s)

| Record | Wrapper PID | Inner PID | Exit | Elapsed s | CWD | stdout SHA-256 |
|---|---|---|---|---|---|---|
| setup | 3680925 | 3680926 | 0 | 2 | `$SCRATCH` | `a621c394…5c18` |
| parent-original | 3681040 | 3681041 | 0 | 0 | parent compiler | `058f872e…d8af6` |
| parent-missing | 3681085 | 3681086 | 0 | 1 | parent compiler | `3a4dcc33…b70d` |
| parent-extra-shape | 3681164 | 3681165 | 0 | 0 | parent compiler | `94e9d214…352b` |
| candidate-public | 3681256 | 3681257 | 0 | 2 | candidate compiler | `d56d9bc6…f1c9c` |
| candidate-private | 3681516 | 3681517 | 0 | 1 | candidate compiler | `0adee341…c8eb6` |
| candidate-extra | 3681637 | 3681638 | 0 | 0 | candidate compiler | `8fe6804e…d3d09` |
| typecheck-six (fail: relative paths) | 3681726 | 3681727 | 2 | 1 | candidate compiler | `39112359…f2af8` |
| after-hashes | 3681768 | 3681769 | 0 | 0 | `$SCRATCH` | `ecad4269…17e17` |
| parent-extra-shape2 | 3685840 | 3685841 | 0 | 1 | parent compiler | `91824208…e701` |
| candidate-extra-shape2 | 3685885 | 3685886 | 0 | 0 | candidate compiler | `b07e1792…81758` |
| parent-json-only | 3686640 | 3686641 | 0 | 1 | parent compiler | `8e1daac2…fdeec` |
| candidate-json-only | 3686681 | 3686682 | 0 | 0 | candidate compiler | `51108499…ae1b3` |
| emit-ir | 3687347 | 3687348 | 0 | 1 | candidate compiler | `ca35ede3…acf60` |
| typecheck-p (fail: no chdir) | 3687392 | 3687393 | 1 | 0 | candidate compiler | `51e5cb03…271f90` |
| native exact-public | 3687418 | 3687419 | 0 | 0 | `$SCRATCH/out/ir` | `cbadaabe…d27ea8a` |
| native json-only hole | 3687439 | 3687440 | 0 | 0 | `$SCRATCH/out/ir` | `a8dcbd5b…557267` |
| native explicit-null | 3687460 | 3687461 | 0 | 0 | `$SCRATCH/out/ir` | `e640d092…121fe` |
| typecheck-abs (corrected cd) | 3687651 | 3687652 | 2 | 4 | candidate compiler | `e6c5ffa9…922a3` |

Empty stderr SHA on these runs: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Commands are in each `records/*/cmd.txt`.

## Suggested fix (do not apply in this review)

In `classifyRow`, branch on `isDbInsertCall`:

- Insert: `fields = knownObjectFields(call.arguments[1], env)` only. If `fields` is missing, `ambiguous()` for any member path.
- Get: keep `knownObjectFields(call) ?? rowFields(table)`.

Mirror that in `object-shape.ts` so insert never inherits table columns when the input shape is unknown. Add a private control: `db.insert(records, args.payload as any)` then `records[row.id]` / `row.d3` must refuse; do not treat evaluator `E_SCHEMA` or `E_DECIMAL_SCALE` as provenance proof.

Keep the modeled-insert row proof, `combineClassifications` absent→ambiguous, omitted-optional-unproved vs explicit-null-proved, capture-before-reassign, and lexical `db` identity.
