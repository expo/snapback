READY

# Compiler final R13 review (combined R9+R10+R11+R12+R13)

Mutually blind code and behavior review of frozen compiler `251efd3872b99adc05aa0098ed2f6855829032f5` against immediate parent `410c56de3e15ac92ea8f2cb6868a04385fb4c8e9` (Git-export `parent-r12-compiler.tar`), combined parent `9afc84c2fe04ec48e8d373674b32323a804dcb38`, and additional R11 parent `0aba7948f0618283795bbb4af08ed45d7ef5047e`. This is an authorized review of immutable code, not a release claim.

## Binding

| Item | Actual |
|---|---|
| Candidate compiler archive | `c827a77860bc8734282583d20209bec8ef283f9771414679bc7aba15e645bdaa` |
| Compiler files | 218/218 match working tree, `compiler-manifest.json`, and archive |
| Input manifest | 7720 path→hash entries |
| `evaluator/src/types.ts` | `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618` |
| Immediate-parent patch | `fe78478da282b29997b84b5cdd95b8e4981427bc315c476c7e47d2b5e74c9000` |
| Combined patch | `a1cc34793600aa393c51f88ec5fead79df6104096ced97a547ecdfe86cee1978` |
| Parent-r12 archive (410c) | `f9ec9baaf8d125a64eced2b400b0b7fe9fb38ddd723be17274e9edbc18205aca` |
| This graph | not a git repository; commit SHAs are launch bindings. Compiler *bytes* were independently hashed. |

Remote exclusive directory `/home/ccheever/clique-reviews/compiler-final-r13-251efd-5350b3b6e5/grok` independently repeated the 218-file match. Host `expose-builder-pixel` (Linux x86_64). Tooling PATH was set per command only:

- Node 22.23.2 SHA `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327`
- Bun 1.3.12 SHA `92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa`
- Native checker SHA `2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175` (Linux debug, source `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`; **different executable** from historical Mac owner `4d0f8f0176…`)

No install/fetch, no Rust build/server, no Darwin esbuild on Linux, no M5 jobs, no product edit.

Local static review: Darwin `MacBookPro` arm64. Substantial compile/type/eval/native-check ran only in the exclusive remote directory.

## Verdict

The 410c→final structural clone walk is the right repair for the recorded policy/object-value defects, and the combined R9–R12 surfaces that this review executed still hold. Full returned objects, not quotient/remainder-only assertions, were compared. Native `check --ir` certificates were treated as certification only: the original wrong full-value programs already certified.

## R13 clone repair (code)

Immediate-parent.patch replaces the recursive JSON walk in `lower/joined-list-domain.ts` `freshLoop` with a typed IR visitor `lower/loop-copy.ts` `copyLoop`.

**Root cause (410c / parent-r12).** Nullish lowering records `condition: left == null`, so `whenTrue` is the absent/fallback leaf and `whenFalse` is the present leaf (`lower/choice.ts`). `freshLoop` leaves the first leaf uncloned and clones every later leaf. Present `values ?? more` therefore runs the cloned body. The old walker:

1. Treated `remainder_sink` under parent key `Divmod` as a register name, so Builtin policy `"lexicographic-id"` became `__joinBinding5`.
2. Used `if (parent === "Literal") return value`, so an **object field named `Literal`** (data) blocked renaming of captured locals beneath it.
3. Treated object keys `Const`/`Variable`/`Field`/`Divmod`/`site` as IR tags when they were payload field names.

There is no statement-form `Divmod` in compiler IR (`ir.ts` `Stmt`). Divmod is `Builtin: { builtin: { Divmod: { remainder_sink: "lexicographic-id" } }, args }`. `copyLoop` spreads Builtin args only and leaves `remainder_sink` as policy data. Object literals remap **expression values**, not keys.

`copyLoop` covers the current IR unions: Expr (`Literal`/`Input` early-return; `Variable`/`Field`/`Array`/`Object`/`Binary`/`Unary`/`Builtin`/`Get`/`Exists`/`Scan`/`Merge`), Stmt (`Const`/`Let` bind; `Assign`/`Push` reference; `If`/`For`/`Require`/`Insert`/`Update`/`Upsert`/`Delete`/`Emit`/`Return`; `"Break"`/`"Continue"`), LoopDomain, Scan/Read, IndexKeyExpr, HeldSearchDescriptor. `unhandled` is `never`.

Outer Assign/Push targets stay shared (reference, not binding). Inner Const/Let/For/source-lane Merge bindings are collected then renamed. Scan/read sites in `[accessStart, accessStart+accessCount)` get fresh ordinals; source-site maps are copied.

## Before / after (source-bound)

Public Quarry:

```q
mutation probe(values: [int] <=3 ?, more: [int] <=7):
  original = values ?? more
  for value in original:
    q = divmod(value, 2)
    return q
  return null
```

**Parent-r12 IR** (present/cloned `else_body` For over `values`):

```json
"builtin": { "Divmod": { "remainder_sink": "__joinBinding5" } }
```

**Candidate IR** (same cloned For):

```json
"builtin": { "Divmod": { "remainder_sink": "lexicographic-id" } }
```

Absent/`more` leaf stayed `"lexicographic-id"` on both graphs (uncloned first alternative).

**Parent-r12 evaluator** (present `[4,5]`): `{ quotient: 2, remainder: 0, sink: "__joinBinding5" }` — matches factual-input baseline `public-divmod-full/result.json`.

**Candidate evaluator:** `{ quotient: 2, remainder: 0, sink: "lexicographic-id" }` for both Null/`more` and present `[4,5]`. Empty present list returns `null`. Required `values: [int] <=3` still `E_INPUT` on missing `values`.

Public object field tags: `{Literal: local, Variable: local, Const: {name: local}, Divmod: {remainder_sink: "local"}, Field: {base: local, name: "local"}, site: "probe.probe.0", q}`.

- Parent present path: `E_INPUT: unknown variable __localBinding3` (Literal-as-tag skipped renaming). Parent cloned variables still contain `__localBinding3` next to `__joinBinding7`.
- Candidate present path: `{ Literal: 5, Variable: 5, Const: { name: 5 }, Divmod: { remainder_sink: "local" }, Field: { base: 5, name: "local" }, site: "probe.probe.0", q: { quotient: 2, remainder: 0, sink: "lexicographic-id" } }`. Object keys stay data. Cloned locals are `__joinBinding6`; first-leaf locals remain `__localBinding3`.

Private `xs.push(q)` of full divmod objects: parent present sink `__joinBinding6`; candidate `lexicographic-id` on both branches.

Native Linux `check --ir` on candidate `clone_public-divmod-full` IR: exit 0, `error: null`, `evaluator_version: bounded-spike-rust-search-text-refinements-4`, `value_model_version: i53-codepoint-bytes-unicode-search-text-refinements-v5`. Historical Mac owner also certified the **wrong** parent IR (`plan_hash` `8f770996…`). Certification is not the repair proof.

Clone complete-project group: **candidate 18/18**, **parent-r12 3/15**. Parent passes only refusals that do not execute the cloned present body (`cyclic self length` `E_OPAQUE`, `inserted row key` `E_PROVENANCE_AMBIGUOUS`, and generated merge `E_TRACE_SUBSET` / empty). Parent merge IR still forges `remainder_sink: "__joinBinding7"`; candidate keeps `"lexicographic-id"` on both leaves.

## Combined R9–R12 surfaces (preserved)

Independent portable complete-project controls, each in its own 30s subprocess (PID/cmd/cwd/exit/timing/stdout/stderr hashed). No full `bun src/test.ts` and no 825-callback registration sweep.

| Group | Candidate | Parent-r12 | Notes |
|---|---|---|---|
| clone policy | 18/18 | 3/15 | R13 repair |
| original join-core (lazy div/alloc + representative captures) | 11/11 | 11/11 | R11/R12 joins |
| all joined-list cases | 39/39 | (not re-run; join-core green) | includes 6 nonempty/larger + 3 dynamic |
| effectful joins | 31/31 | — | once-only values, lazy fallback, IDs |
| public bound / larger fallback | 7/7 | 7/7 | max across alternatives |
| optional-list presence / empty-default | 29/29 | — | `?? []`, `!= null`, alias/field |
| merge callback grammar | 30/30 | 30/30 | 0/1 identifier admitted; defaults/rest/extra/optional/destructure `E_OPAQUE` |
| source custody | 42/42 | — | authored vs library identity |
| descriptor sample | 8/8 | — | Text `{max:31,min:8,format:"url"}`; invented max/format refused |
| product `registerDomainOperandChecks` push+effectful slice | 51/51 | — | exact in-tree assertions |

### Optional lists

`values:[decimal 3] <=3 ?` keeps declared max 3 independent of presence (`binding-bound.ts` unwraps Optional). Bare optional / `as any` absence is `E_UNBOUND_LOOP` / Quarry unknown. `values ?? []` lowers to native `ArgList` plus `If Ne null` (`empty-list-domain.ts` + `compiler.ts`), not a derived replay. Null / missing / empty / present / oversize distinguished (`E_INPUT` missing, `E_FANOUT` oversize). Public `if values != null` and alias/object/nested fields passed.

### Joins (mandatory six + three)

Public larger fallback, alias, field, nested alternatives, literal `[2,3,4,5]` (max 4), and `more ?? [2,3,4,5]` (max 5) passed on candidate and parent-r12. Dynamic: `values ?? [divmod(2, zero).quotient]` does not divide for present empty or nonempty; absence divides once; earlier `divmod(1, zero)` remains first error. `values:[id]? ?? [new]` allocates fallback IDs only on absence; `{original, next:new}` is `id-1`/`id-2` vs present `given`/`id-1`. These are require-only loops, not row-write native execution claims.

### Push (checked-private)

`xs:any=[1]; xs.push(2, xs.length)` returns `[1,2,1]`; both lengths `[1,1,1]`; helper/reduce/three-operand/literal/bound/single controls pass under the product register function. Compiler stages every actual into `Const` `__pushArgument*` **before** any `Push` (`compiler.ts`). Typed variadic `[1].push(2,3)` remains `E_OPAQUE`. Decimal literal return `[2,3,4]` vs write `[2000,3000,4000]`; argument-origin incompatible scale refused. Adjacent Map.set/Set.add order preserved; Set.add(size) still `E_OPAQUE`.

### Merge callbacks

Zero or one plain identifier lane callback admitted (public generated Quarry lanes and private `() / (row)`). Defaults, rest, extra, optional, and destructured parameters refuse `E_OPAQUE` with the modeled rewrite. Public generated merge in a joined body still `E_TRACE_SUBSET` on the bare evaluator (no fabricated cert). Ordinary first-attempt `E_TRACE_SUBSET` retained.

### Source custody

`export declare const marker: MissingType` under `ordinary.d.ts`, `bounded-lib.d.ts`, `./bounded-lib.d.ts`, `child/../bounded-lib.d.ts` keeps authored bytes distinct from `lib.d.ts`; MissingType does not disappear. Diagnostics filter by `item.file === library`, not suffix `__snapback2_lib.d.ts`. Collision chains of 1/2/5 underscores keep the real library. Companion `const bad:number='wrong'` is a type diagnostic, not `E_OP_NONE`. Duplicate equivalent paths with different bytes throw before substitution.

### Descriptors / API

Supported `t.text(31,{min:8,format:"url"})` (and parenthesized/cast/computed-owner forms) emit `{ Text: { max: 31, min: 8, format: "url" } }`. Generated API consumer accepts a url string and TS2322-rejects `1`. Nonliteral maximum, `format: null`, min>max, unknown factory refuse. Origin remains checked-project native owner, not callee spelling.

## Public vs checked-private

Public Quarry grammar used for joins, optional lists, generated merge, object field tags, nested loops, scans after writes. Checked-private TypeScript (`authoring: "any"`) used for push staging, merge parameter refusals, helper/reduce/ID order, lexical shadowing, break/continue/return. No new public ternary, no public variadic push, no arbitrary JS execution, no new runtime semantics demanded.

## Native checker

Linux debug `snapback2-linux-x86_64-debug` `check --ir` only. 16 clone IR files plus 3 lazy-join IR files certified, each <30s, empty stderr. v5 identities unchanged. Not native execution, not server, not Mac-owner equivalence.

## Not run / inherited gaps

- Full compiler `test.ts` registration (includes capture-repair/search/guide batteries). Not required; semantic inputs of the clone walk plus representative preserved boundaries were executed.
- Historical 18 omitted-key HTTP200 transport cases: out of scope; retained v5 owner evidence stands. Raw evaluator missing-key `E_INPUT` is a different boundary.
- Seven foreign evaluator errors and standalone Scalar-merge evaluator gap: version-bound inherited; dependencies not modified.
- Query held-search clone (`HeldSearchDescriptor.discovery.binding` is a reference, not a new binding). Mutation clone cases have no held_search. Untested corner, not a demonstrated fail.
- Nested for-of that reuses the same binding spelling across clone maps (public nested uses `outer`/`inner`).
- `OperandOrder` still walks pending Expr objects structurally (`"Variable" in value && typeof === "string"`). Not in this delta; Literal rows with a field named `Variable` could theoretically spoof a register read. Neighboring residual.
- `Scan.take` `{ Arg: { name } }` is not remapped; take is an operation argument in admitted programs.

## Process

Every remote test/compile/type/native process used the original 30s deadline wrapper (`scratch/harness/run-bounded.mjs`). First effectful import miss (harness did not re-export `effectfulJoinCases`) and a harness rows-field mismatch on push were **harness** errors; they were not product failures. Re-runs: effectful 31/31; product `registerDomainOperandChecks` push+effectful 51/51. No timeout. Receipts under `scratch/remote/receipts/` and `scratch/evidence-manifest.json`.

Model: Grok 4.6. Local read-only source review on Darwin; remote validation on `expose-builder-pixel` with pinned Node/Bun/Linux checker. No writer reports, peer output, subagents, or moving worktrees were read.
