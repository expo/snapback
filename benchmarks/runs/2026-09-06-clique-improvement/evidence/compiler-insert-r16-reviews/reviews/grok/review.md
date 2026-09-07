READY

# R16 compiler review: insert snapshot members and current operation receivers

- **Verdict:** READY
- **Candidate:** `e19565bd9bb85ac23a28def94ba2d9163d23e251`
- **Parent:** `dd54ba3b18b21051bbec4ad383e4929eb46463b0` (dd54 tar, not an older archive)
- **Delta:** six paths in `delta.patch` (`compiler.ts`, `insert-provenance-checks.ts`, `lower/collection-origins.ts`, `lower/object-shape.ts`, `lower/operation-context.ts`, `lower/provenance.ts`)
- **Reviewer model (known here):** Grok 4.6 released by xAI. Supervisor records actual CLI/model/terminal independently.
- **Product sources:** not edited.

## Scope and limits

Reviewed the six-path compiler delta with Snapback2 fence (`snapback2/AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`), LLP 1002 provenance/capture/operand rules, and the actual Quarry guide (`snapback2/packages/snapback2/guide/quarry.md`).

Portable validation ran only on exclusive EPYC `ccheever@[EPYC_FLEET_ADDRESS_REDACTED]` under `/home/ccheever/clique-reviews/compiler-insert-r16-e195-9a438eeb7c/grok`. Local reading was source/IR only. No subagents, no peer/author reports, no sibling reviewer paths, no native source rebuild, no server/Rust build, no package/publication, no benchmark, no full native suite, no competitor rerun, no M5 jobs, no scale files.

Evaluator path is the scoped `custodyActual` helper shape: ordinary `Index.components` adapted to frozen evaluator `columns`, optional constructed schema-bound absence fixtures. This is **not** current-main compatibility, native-issued authority, or native server runtime. Raw JSON insert inputs stayed `rawpartial` (unknown object, omitted optionals) unless a constructed covered receipt was passed. Main v2/v5 decoder mismatch was not used as an excuse to skip this compiler review and was not “fixed” with an adapter.

Public Quarry (`.q`, default authoring) and checked-private TypeScript (`authoring: "any"`, `:any` / `as any`) are labeled exactly. Private-only forms are not claimed as public Quarry reach. Compiling a private `.ts` project without `authoring: "any"` refused `E_QUARRY_ONLY` on both parent and candidate.

Native Linux 26c9 certificate checker was not used: the semantic delta is compiler provenance/receiver lowering plus evaluator prediction of those programs. Unchanged native inputs were not re-run against a new compiler hash.

## Hashes (before and after)

Pinned tools, hashed before use:

| Tool | SHA-256 |
|---|---|
| `.../node-v22.23.2-linux-x64/bin/node` | `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327` |
| `.../bun-v1.3.12-linux-x64/bin/bun` | `92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa` |

PATH for every remote command: those two `bin` dirs, then `/usr/bin:/bin`. Node v22.23.2, bun 1.3.12, TypeScript 5.9.2 (320 prepared `node_modules` files; no install).

Bound support, hashed before and after (unchanged):

| Bytes | SHA-256 |
|---|---|
| `input-manifest.json` | `bac3b333eb88533977a21a23f054b4bc7828fd299e57b1e48d495a439f5879e8` |
| `candidate-compiler.tar` | `577e5221ef3f108f02913ddc593ca20a5cd9bcece73672ee26b1ea41e1229a7a` |
| `parent-compiler.tar` | `badafabc80592fde029df7a52a344798ecfbbec06762116bea8593ca217a10ee` |
| `delta.patch` | `8830ac629eadbbbf847d5ed1e09301e877cc0e920aa8e6940709d7772dd05119` |
| evaluator `src/types.ts` | `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618` |
| generated Unicode `evaluator/dist/unicode-tables.ts` | `9eccdccd99e9b936a40dcbf8ae63c55d980086df1ae71f92019f9ab040f6a521` |
| `packages/snapback2/dist/effects-lib.d.ts` | `13dd9d1f06641596a4c6ac1c080b3f45f083485baa55a4a378d5b8eba68b311d` |

Candidate tar `src/` matched the unpacked `snapback2/packages/compiler/src` (empty `diff -rq`). Parent extract lived at remote `review-work/parent-extract/snapback2/packages/compiler`. Full container bytes outside the snapshot were not claimed hashed. Dependencies were linked for resolution, never copied again for evidence.

Collected evidence inventory (does not hash itself): `review-work/evidence-inventory.json` SHA-256 `2c6b69164d9fb3329585c5fde50385ffea17951a66b2a7b571df1ee10137a019` (558 collected files under `review-work/{bin,projects,runs}`).

## What the delta does

Parent `classifyRow` used `knownObjectFields(call) ?? rowFields(table)`. An insert whose captured input shape is unknown therefore inherited **storage columns**, so `row.key` / `row.id` / `row.d3` could be tagged `Shape` even when the member was omitted from the JSON/conditional snapshot.

Candidate:

1. **Insert snapshot:** if insert fields are unknown, prove the selected member in every source alternative via `selectExpressionMember`; schema columns cannot supply missing snapshot members. Absent → `absent`; not found+required → `ambiguous`.
2. **Current receiver:** `isOperationCompositeBinding` returns false when the binding has `provenanceAmbiguity`, even if `operationComposite` metadata remains. Same guard on object-shape / member-selection / row / collection-origin predicates, with the ambiguity check **before** leftover `args`/`ctx` composite field lists.
3. **Assignment order:** RHS `lowerValue` runs under the prior binding; only then `recordAssignmentOrigin` and `mergeAssignedCollectionFacts`. IR is still `[...RHS statements, Assign]`.

Checks added in `insert-provenance-checks.ts` are checked-private (`public: false`) except the pre-existing public Quarry cases.

## Independent projects (not whole registration)

32 complete projects under `review-work/projects/`. Compile: `timeout 30 bun review-work/bin/compile.ts`. Eval: `timeout 30 bun review-work/bin/eval.ts` against `ClientStore.applyMutation` with the components→columns adapter. Serial. Meta in each `review-work/runs/*/meta.txt` (PID, cwd, PATH, command, input hashes, exit, duration). Subprocess times were ~40–360ms, never near 30s.

### Public Quarry (default authoring)

| Project | Parent | Candidate |
|---|---|---|
| `public-inserted-loop` | compile OK; present `[4,5]` two inserts, full Divmod payloads, Shape `row.id` keys; Null fallback uses `more`; present-empty writes nothing; four-int values `E_FANOUT` | same |
| `public-insert-new-id` | `d3: 2` → 2000; `row.id` Shape; next `id-2` | same |
| `public-omitted-d3-key` | `E_PROVENANCE_AMBIGUOUS` (omitted optional is not a proved snapshot member) | same |
| `public-explicit-null-d3-key` | explicit `d3: null` proved; stored optional Null; byD3 key `[null]` Shape | same |
| `public-omitted-d3-return` | compile OK, eval `E_FIELD: missing field d3` | same |

Inherited direct omitted optional **access** remains `E_FIELD` and is distinct from using that member as a read key (`E_PROVENANCE_AMBIGUOUS`) and from captured conditional Decimal (`E_DECIMAL_SCALE`).

### Checked-private `authoring: "any"`

| Project | Parent dd54 | Candidate e195 |
|---|---|---|
| `unknown-json-key` (valid id, omitted `key`) | compile OK; Get `row.key` **Shape**; eval `E_FIELD` missing `key`, `partialSites: ["records.byKey"]` | compile `E_PROVENANCE_AMBIGUOUS` `<unknown origin>` |
| `unknown-json-id` without id | compile OK; eval `E_SCHEMA: records row lacks id` | compile `E_PROVENANCE_AMBIGUOUS` (does not reach `E_SCHEMA`) |
| `unknown-json-id` with id | compile OK; Get Shape; eval stored `{id: given, payload: null}` | compile `E_PROVENANCE_AMBIGUOUS` |
| `conditional-omit-d3` flag true | compile OK; eval `E_FIELD` missing `d3` | `E_PROVENANCE_AMBIGUOUS` |
| `conditional-omit-d3` flag false | compile OK; eval **partial**, key **2000**, write `d3: 2000` (rawpartial present branch) | `E_PROVENANCE_AMBIGUOUS` |
| `common-id-both-branches` | compile+eval OK; flag true snapshot omits `d3`, stored has `d3: null` | same |
| `captured-conditional-decimal` | `E_DECIMAL_SCALE` (unmodeled captured Decimal conversion) | same |
| `nested-unknown-capture` / `inline-unknown-key` | compile Shape; eval `E_FIELD` missing `key` | `E_PROVENANCE_AMBIGUOUS` |
| `known-insert-missing-member` | `E_PROVENANCE_AMBIGUOUS` | same |
| `reassigned-db` (`db=payload` then insert/get) | compile OK; **eval executes native insert+get** (`id-1`, Shape point) | `E_OPAQUE` `db.insert` and `db.get` helpers undefined |
| `after-if-reassign` | compile OK; **eval native insert on both flags** | `E_OPAQUE` |
| `db-eq-insert-return` | IR `Let+Insert+Assign+Return`; eval row `id-1` d3 2000, next `id-2`, no later get | same |
| `db-eq-insert-get` | IR Insert then Assign then **Get** Const `"given"`; eval native get | `E_OPAQUE` only `db.get` (RHS insert still lowered) |
| `throw-rhs` zero | `E_DIV_ZERO`; trace steps 6; no writes; IR Let(object NewId+Divmod) then Insert then Assign | same |
| `throw-rhs` one | full Divmod `{quotient:2,remainder:0,sink:lexicographic-id}`; insert; next `id-2` | same |
| `renamed-writer` (`db:writer`) | compile+eval OK | same |
| `const-alias-db` (`const conn=db`) | `E_OPAQUE` `conn.insert` + provenance on `row.id` | same (not a destructuring rename) |
| `literal-key-insert` (`db["insert"]`) | `E_OPAQUE` | same (literal-key dispatch not a PropertyAccess db insert) |
| `branch-local` | flag true null/no writes; flag false insert+get | same |
| `spread-override-later` | id `id-1` (fresh wins) | same |
| `spread-override-earlier` | id `given` (initial wins) | same |
| `collection-self-spread` / `number-self-assign` | `[1,2,3]` / `2` | same |
| `stable-capture-then-reassign-db` | capture before `db=` kept | same |
| `sparse-snapshot-omit-d3` | snapshot `{id,payload}` without `d3`; stored `d3: null` | same |
| `decimal-units` | `d3: 2` → 2000 | same |
| `explicit-null-key` | null vs `given` keys Shape | same |
| quarry-only compile of private TS | `E_QUARRY_ONLY` | `E_QUARRY_ONLY` |

Parent unknown JSON insert with a valid id still emitted **Shape** on `row.key` and threw `E_FIELD`. JSON lacking id failed **`E_SCHEMA`**, a separate control. Candidate does not inherit table columns for unknown insert snapshots, so those private forms refuse at compile with `E_PROVENANCE_AMBIGUOUS` rather than executing.

Exact transpiled JavaScript for reassigned `db` (supplied factual input, mocked constructors, not native/server): zero initial DB calls, one ID allocated, then `TypeError: db.insert is not a function`. Parent compiler still issued native Insert/Get. Candidate matches the JS refusal at lowering (`E_OPAQUE`).

## Assignment order

Candidate `db=db.insert(...)` IR is `Let insertRow` (operands, including `NewId`) → `Insert` → `Assign db` → later uses. Parent used the same IR order for this form because parent never dropped db authority on assignment; candidate3 (factual original) recorded assignment **before** lowering and then refused the RHS insert as `E_OPAQUE`. e195 restores RHS-under-prior-binding without leaving later `db.get` as a native Get.

Throwing RHS: Divmod sits in the insert-row Let **before** Insert and Assign. Eval `E_DIV_ZERO` has empty writes/points (fork discarded). Runner clones `context`, so the eval driver’s outer `new_ids` array did not shrink; allocation is in the cloned context during that Let, not after Insert/Assign. First error remains `E_DIV_ZERO`. Success path keeps the full Divmod payload and source Decimal-unrelated integer operands.

Self-referential collection assignment `xs=[...xs,3]` and `n=n+1` stay accepted on both.

## Adjacent residuals (not regressions, not public Quarry)

`isOperationCompositeBinding` now ignores leftover `operationComposite` after assignment. `lowerCall` still special-cases `ctx.newId` / `now` / `commitTime` off raw `operationComposite`. Independently, `ctx=payload; return ctx.newId()` compiles on **both** parent and candidate to `Assign ctx` then `Return {Input: NewId}` and evals to `"id-1"`. `args=payload; return args.flag` returns the original `flag` binding on both. These private `any` forms are **not** public Quarry, match parent, and are outside the insert-snapshot / db-receiver paths the six-file delta actually changes. Destructuring rename (`db:writer`) remains the supported alias; `const conn=db` is not.

`checkCallOperands` still consults leftover `operationComposite === "db"` for arity after assignment; that only affects diagnostic shape, not native Insert/Get recognition (`isDbInsertCall` uses the shared receiver predicate).

## Initial fixture/setup errors (preserved)

1. First parent compiles failed in ~45ms: parent extract had no `crates/snapback2-core/ir-contract.json` (`Cannot find module '../../../crates/snapback2-core/ir-contract.json'`). Fixed with a resolution symlink to the snapshot crate; not a dependency recopy. First-attempt stderr kept under `review-work/runs/initial-setup/`.
2. First private project writer ran through an SSH quoting split that stripped `'...'` from imports (`from snapback2`). Candidate then reported `E_OP_NONE` / `E_OPAQUE` / `E_SCHEMA_*` on those broken files. Sources were rewritten with quotes; initial stdout kept. Subsequent compiles are the semantic results above.

## Attribution

- **Parent bug (dd54):** unknown insert snapshots inherit table columns (`classifyRow` `?? rowFields`); reassigned `db` keeps native insert/get from `operationComposite` metadata. Factual JS for the reassigned-db form throws TypeError after one allocation.
- **Candidate (e195):** insert snapshot membership from captured input / every alternative; current db receiver requires a still-proved composite; assignment invalidates after RHS lowering.
- **Unchanged and required:** public inserted-row loop (values, read keys, allocations, max refusal); sparse snapshot vs stored optional Null; explicit-null vs omitted; ordered spread/override; independently declared numeric units (`2` → 2000 at decimal 3); once-only inserts/IDs/effects on accepted paths; lazy bounded fallback / present-empty; earlier captures; full Divmod payloads; ordinary argument origins; `E_FIELD` vs `E_DECIMAL_SCALE` distinction; `E_QUARRY_ONLY` for private TS without `authoring: "any"`.

No CHANGES_REQUIRED on the claimed insert-snapshot and current-db-receiver proof.
