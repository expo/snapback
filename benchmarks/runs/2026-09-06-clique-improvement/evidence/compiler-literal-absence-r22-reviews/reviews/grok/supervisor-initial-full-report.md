READY

Scoped compiler literal-absence review of candidate `d3e497acdfd2cbaecbf7c6cb8f7350cb8e63580d` against immediate parent `c73805f6affb01530c7d903c8e22e8a90f49fe48`. Six-file delta: three production Quarry type/join/narrowing files, two test files, and the LLP 1002 literal-absence paragraph. No product edits. No peer findings were read. This review does not claim compiler-package, native, or current-main clearance.

Reviewer model: Grok 4.6 (xAI). Native CLI identity is for the supervisor.

## 1. Verdict

The candidate separates literal `null` from a present element representation, joins only real present alternatives, and restores the public `[2,null]` row/IR/API/evaluator observation that historical dbfe accepted and parent `c738` refused as `E_QUARRY_TYPE`. Reverse `[null,2]` (an inherited parent refusal) now also succeeds, with complete values rather than a pass count. Shared join/narrowing keeps literal presence, all-null, and unknown distinct. Null does not confer numeric/nominal/member/bounds authority. Mixed Decimal/currency/table alternatives still refuse. Private captured nullable composite-key `[null,2]`/`[2,null]` is unchanged: unscaled source tuple, scaled Decimal3 key `2000`, complete row, `next: id-2`.

Limitations named in the request remain limitations: same-table reference/null reaches `E_PROVENANCE_AMBIGUOUS` (parent refused earlier as `E_QUARRY_UNKNOWN`); captured text/null key, required null key, and unscaled fractional list remain refused. The inherited effectful `box.original` join gap was not re-qualified. Packaged guide bytes are identical to parent (`15872`). Only LLP 1002 gained the literal-absence clarification.

## 2. Scope and inputs read first

Read before analysis, from the supplied snapshot only:

- root `AGENTS.md`, `snapback2/AGENTS.md`
- `rules/RULES.md`, `rules/NOT-DOING.md`
- LLP `1002-dev-loop.spec.md` (candidate and parent-docs)
- packaged `snapback2/packages/snapback2/guide/quarry.md` (candidate and parent-docs; SHA `7d95ce22d125b066836243947f6ebba958a77a581ca59f70184dee2d0e26ade2`, `15872` bytes both)
- six-file `delta.patch` and `docs-delta.patch`
- factual project sources/results used as inputs, not as this review’s passes

Not in scope: R21 diagnostics/guide implementation, native/Rust/server/package/publication/benchmark, current-main reconciliation, competitor rerun, repair.

## 3. Custody

Exclusive EPYC work: `/home/ccheever/clique-reviews/compiler-literal-absence-r22-d3e497-f515f287bd/grok`.

Parent execution tree: full copy of the supplied `snapback2` tree with `packages/compiler` replaced from `parent-compiler.tar`. `snapback2/crates/snapback2-core/ir-contract.json` and the 320 prepared `node_modules` files remained available on both trees.

| Object | SHA-256 | Bytes |
|---|---|---|
| `candidate-compiler.tar` | `0d75334296cc5cdfa8eb31fe9a56534d1feacc514c4f73bb291acf9a4226d342` | 2447360 |
| `parent-compiler.tar` | `5bee6bf8f1e1d0449250f849273a82e4d94b5cf5395f913e99371d049e1bfd7a` | 2437120 |
| candidate compiler tree vs tar | 224/224 agree | |
| parent compiler tree vs tar | 223/223 agree | |
| snapshot compiler vs candidate tar | 224/224 agree | |
| `evaluator/src/types.ts` | `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618` | 6075 |
| generated Unicode tables | `9eccdccd99e9b936a40dcbf8ae63c55d980086df1ae71f92019f9ab040f6a521` | 17460 |
| prepared `snapback2/dist/effects-lib.d.ts` | `13dd9d1f06641596a4c6ac1c080b3f45f083485baa55a4a378d5b8eba68b311d` | 434975 |
| compiler source `effects-lib.d.ts` | `c5cf931f7c095f832ca081b644bc06e4c60e4030f647e9fe85fe76931c49c4c0` | 3469 |
| `ir-contract.json` (parent and candidate) | `d09c63f52622b9b8fb2762b94b17b4e2c8882e9feecf0737d24470ec2bde0252` | 148 |
| Node 22.23.2 | `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327` | |
| Bun 1.3.12 | `92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa` | |

Compiler delta vs parent tar (only these compiler paths differ): `src/quarry/value-type.ts`, `src/quarry/program.ts`, `src/quarry/narrowing.ts`, `src/insert-provenance-checks.ts`, plus new `src/literal-absence-cases.ts`. The 226-file source digest is those 224 compiler files plus `llp/1002-dev-loop.spec.md` and packaged `guide/quarry.md`. After probes, candidate `value-type.ts` still hashed `be61511bbef37625437dec90aa2a4e992123d5e1deb4e76c1f90d124c86d884b`; protected evaluator types were unchanged. Original snapshot bytes were not modified.

## 4. What the production change does

Parent `literalType(null)` was `{ kind: "text", max: 1, optional: true }`. Joining `[2,null]` therefore invented a present Text alternative. After `if value != null`, `nonNullable` kept `int | text` alternatives, so `require value > 1` refused `E_QUARRY_TYPE` (“selected alternatives do not prove one numeric representation”).

Candidate:

- `literalType(null)` is `{ kind: "null" }`
- `joinValueTypes` drops `{kind:"null"}` from present alternatives, records nullability separately, and returns `{kind:"null"}` when nothing present remains (distinct from `{kind:"unknown"}` for an empty join)
- `nonNullable` on alternatives re-joins present members only
- `nullableValue` / `isNullableValue` treat `{kind:"null"}` as absence; numeric-literal may carry `optional`
- `coalescedType(null, right)` is `right` (`missing ?? new` keeps the ID, not a fictitious text)
- narrowing uses `nonNullable` instead of toggling `optional`/`nullable` flags that missed `{kind:"null"}`

Generated TS for the public regression is still `[2, null]` with `if ((value != null))`; IR stores `Literal: "Null"`; API is `(number | null)[]`; evaluator returns `["Int":2, "Null"]`. Stored/returned literals are unchanged.

A production comment on `joinValueTypes` says “Literal absence contributes presence”. LLP 1002 and the code implement absence without a present type. Wording only; not treated as a semantic defect.

## 5. Host, load, and probe method

Host `expose-builder-pixel`, 96 CPUs, ~251 GiB. Capacity at admission 2026-09-07T10:58:08Z: load `1.58 1.50 1.27`. A foreign `snapback2 … dev --foreground` (PID 3585645) sat at ~99.6% of one core for ~8 hours in `/home/ccheever/clique-tooling/search-native-linux-26c9-…`. It was not interrupted. Probes were serial. No quiet-host assumption.

Pinned PATH for every child:

```
/home/ccheever/clique-tooling/epyc-linux-tooling-20260907T010007Z-0fd567d96f/node-v22.23.2-linux-x64/bin
:/home/ccheever/clique-tooling/epyc-linux-tooling-20260907T010007Z-0fd567d96f/bun-v1.3.12-linux-x64/bin
:/usr/bin:/bin
```

Semantic compile+evaluator: `bun probes/probe-projects.ts <compilerRoot> <projectsRoot> <outDir> <names…>` with `/usr/bin/timeout` 30s. Transport: same `lowerProject` path the worker compile operation uses (`probes/probe-transport.ts`), timeout 45s, batched originals then adjacent (30 projects × parent/candidate). Selected callable tests: `bun probes/probe-selected.ts` over `registerInsertProvenanceChecks` / `registerJoinedListChecks` / `registerQuarryDiagnosticChecks`. Types: TypeScript 5.9.2 `createProgram` with `strict`, `skipLibCheck`, `types: ["node"]`.

First types run omitted `typeRoots` and reported 33 `TS2307` “Cannot find module 'node:…'” plus `process`/`NodeJS` noise. That was a probe setup error, not a compiler finding. Corrected by setting `typeRoots` to the tree’s `node_modules/@types` and rerunning. Corrected production: 87 files, 0 diagnostics, parent and candidate. Corrected test graph from `bun.d.ts` + `insert-provenance-checks.ts` + `joined-list-checks.ts` + `quarry-program-checks.ts`: candidate 108 files, parent 107 files (the extra file is `literal-absence-cases.ts`), 7 evaluator diagnostics identical on both trees.

Receipts with PID/cwd/PATH/argv/input hashes/stdout/stderr/exit/duration live under `evidence/*/execution.json`. Local copies of complete IR/API/results are under `evidence/*/projects/`.

## 6. Public regression — complete observation, not a pass count

Parent `c738` on `null-last-full-row` (`original = [2,null]` … `require value > 1` … insert … `return {original, next: new}`):

- refuse `E_QUARRY_TYPE` at `snapback/probe.q:5:21`
- message: `selected alternatives do not prove one numeric representation or nominal type`

Candidate (PID 3973111, 0.626s) accepts. Historical dbfe control and this candidate observation are byte-equal on IR project JSON, evaluator result, writes, and 30-step trace:

- `original`: `[{"Int":2},"Null"]`
- write `records/id-1`: `length: {"Int":2}`, `label: "chosen"`, `payload.keep: "row"`, `payload.original` the same array
- `next`: `{"Id":"id-2"}`
- API: `Op<{}, { original: (number | null)[]; next: string; }>`

Reverse `null-first-full-row` (`[null,2]`): parent the same `E_QUARRY_TYPE`; candidate accepts with `original: ["Null",{"Int":2}]`, one row `length: 2`, `next: id-2`, API `(number | null)[]`. That reverse success is **introduced versus parent**, restoring the same join rule in both orders. It is not claimed as a dbfe historical accept (the supplied historical controls are `null-last-full-row`, `declared-optional-full-row`, `fixed-literal-null-first`, `fixed-literal-null-last`).

## 7. Thirty projects — parent 5 accepted / 25 refused; candidate 18 accepted / 12 refused

Independently reproduced. Transport accept/refuse matched the 30s semantic probes with zero mismatches.

### Introduced accepts (parent refused, candidate accepts) — 13

| Project | Parent | Candidate complete observation |
|---|---|---|
| `null-last-full-row` | `E_QUARRY_TYPE` alternatives | predicted; row length 2; source `[2,null]`; next id-2; 30 steps; IR=dbfe |
| `literal-null-narrow-false` | `E_QUARRY_TYPE` | predicted; `[2,null]`; next id-1; no write; 22 steps |
| `literal-null-narrow-true` | `E_QUARRY_TYPE` | predicted; `[null,2]`; next id-1; no write; 22 steps |
| `null-first-full-row` | `E_QUARRY_TYPE` | predicted; `[null,2]`; row length 2; next id-2 |
| `captured-null-full-row` | `E_QUARRY_TYPE` | predicted; `[2,null]` via `missing = null`; row length 2; next id-2 |
| `nested-literal-lists` | `E_QUARRY_TYPE` | predicted; `[[2,null],[null,3]]`; rows length 2 then 3; next id-3; inner maxima 2 |
| `object-field-literals` | `E_QUARRY_TYPE` | predicted; `[{value:2},{value:null}]`; row length 2; next id-2; API union of `{value:number}` and `{value:null}` from TS inference of the literal |
| `absent-object-literal` | `E_QUARRY_UNKNOWN` cannot select `.value` from alternatives | predicted; `[null,{value:2}]`; row length 2; next id-2 |
| `lazy-null-literal-fallback` | `E_QUARRY_TYPE` | Null+zero1 → `[2,null]` next id-1; present empty `[]`+zero0 bypasses fallback (no `E_DIV_ZERO`); Null+zero0 → `E_DIV_ZERO`. Fallback list max 2 is not cut to the left `[int]<=3` |
| `eager-null-literal-capture` | `E_QUARRY_TYPE` | empty+zero0 and Null+zero0 → `E_DIV_ZERO` at earlier `divmod`; Null+zero1 → `{original:[2,null], earlier:{quotient:1,remainder:0,sink:"lexicographic-id"}, next:id-1}` |
| `null-list-first-require` | `E_QUARRY_TYPE` | `E_REQUIRE` (LOW) before later `divmod`/zero — requirement precedes later throw |
| `full-divmod-null` | `E_QUARRY_UNKNOWN` cannot select `.quotient` from alternatives | predicted; original `[{quotient:2,remainder:1,sink:"lexicographic-id"}, Null]`; payload contains the full `part` object, not only quotient; next id-2; 31 steps |
| `decimal-null-compatible` | `E_QUARRY_TYPE` | value 4321 → original `[null,4321]`, insert `d3:4321`, next id-2; value 500 → `E_REQUIRE` |

### Inherited accepts (both) — 5

| Project | Observation |
|---|---|
| `declared-optional-full-row` | Null arg: original `[null,2]`, one row length 2, next id-2, 32 steps. Int 3: original `[3,2]`, rows 3 then 2, next id-3, 44 steps. API `Op<{ maybe?: number \| null }, { original: (number \| undefined)[]; next: string }>` — parent and candidate API bytes equal. Arg keeps `null`; result list uses TS `undefined` for the optional element. Evaluator still returns `Null`. Not new. |
| `fixed-literal-null-first` | TS private composite key `[null,2]`; found row `d3: Null`, `e3: 2000`; result key unscaled `[null,2]`; next id-2; point key `["Null",{"Int":2000}]`; 40 steps. Parent==candidate results. |
| `fixed-literal-null-last` | key `[2,null]`; found `d3:2000`, `e3:Null`; next id-2; 40 steps. Parent==candidate. Historical IR/result/writes equal. |
| `null-capture-fallback-id` | `missing=null`; `value = missing ?? new` → missing Null, value id-1, next id-2, 19 steps |
| `all-null-count` | `[null,null]`, `count` 2, next id-1, API `original: null[]` (all-absent list, not optional int, not unknown) |

### Inherited refuses — 12 (keep as limitations, not old accepts)

| Project | Parent | Candidate | Attribution |
|---|---|---|---|
| `nominal-general-optional` | `E_QUARRY_UNKNOWN` no unique index on `lefts` | same | inherited |
| `nullable-list-without-guard` | `E_QUARRY_TYPE` fictitious alternatives + `E_OPAQUE` `number\|null` vs `number` | `E_QUARRY_TYPE` **ordered comparison `>` requires present operands** + same `E_OPAQUE` | still refuse; message now names missing presence instead of fake Text |
| `real-text-present-alternative` | `E_QUARRY_TYPE` + `E_OPAQUE` `string\|number` | same alternatives refusal | real present Text is not erased |
| `mixed-decimal-null` | `E_QUARRY_TYPE` | `E_QUARRY_TYPE` | Decimal 3 vs 2 survive a null in the list |
| `mixed-whole-null` | `E_QUARRY_TYPE` | `E_QUARRY_TYPE` | Decimal vs int |
| `mixed-money-null` | `E_QUARRY_TYPE` | `E_QUARRY_TYPE` | USD vs EUR |
| `foreign-null-target` | `E_QUARRY_UNKNOWN` | `E_QUARRY_UNKNOWN` | null does not pick a table |
| `same-target-null` | `E_QUARRY_UNKNOWN` frontend (no unique index / `?`) | `E_PROVENANCE_AMBIGUOUS` “candidate direct origins: args.left” | later refusal, not automatic key authority |
| `constant-key-null` | `E_QUARRY_UNKNOWN` | `E_QUARRY_UNKNOWN` | captured text/null key |
| `required-null-key-capture` | `E_QUARRY_UNKNOWN` | `E_QUARRY_UNKNOWN` | `records[missing]` with `missing=null` |
| `fractional-null-literal` | `E_DECIMAL_SCALE` “2.5 has 1 fractional digits but no Decimal scale” | `E_QUARRY_TYPE` “d3 is decimal 3; decimal literal is nominally different” | still refuse; diagnostic family/code changed; not a new accept |
| `optional-element-declaration` | `E_QUARRY_PLACEMENT` + `E_QUARRY_SYNTAX` “list element types cannot be optional” | same | no optional-element syntax added |

## 8. Four historical complete-output comparisons

All four supplied historical controls match this candidate’s IR project JSON, evaluator result, writes, and step counts:

| Control | Steps | Notes |
|---|---|---|
| `null-last-full-row` | 30 | dbfe public row; see §6 |
| `declared-optional-full-row` | 32 (null run) | first historical run compared |
| `fixed-literal-null-first` | 40 | scaled `e3:2000`, unscaled key `[null,2]` |
| `fixed-literal-null-last` | 40 | scaled `d3:2000`, unscaled key `[2,null]` |

## 9. Selected callbacks — 20 new + 24 existing, all pass

Candidate new insert-provenance literal-absence cases (PID 3973600, 1.030s): 20/20. These assert full rows, full Divmod objects (quotient, remainder, sink), object-field payloads, lazy/eager ID order, mixed-unit refusals, and missing-presence refusals — not pass counts.

Existing 24 (joined-list page/API/bounds/lazy-eager/money/absence, six comparison count/length cases, four Quarry diagnostic-recovery cases, four insert-provenance including both private nullable composite keys and public inserted snapshot): parent 24/24 (5.040s), candidate 24/24 (5.190s). Shared load made these slower than a quiet-host 4.27s figure; both finished under the 30s child limit with empty stderr.

Private composite-key helper case remains `id-2` row / `id-3` next because the helper consumes one ID; the two literal key cases remain `next: id-2`. Not new authority.

## 10. Types

Corrected production graph (`compiler.ts`, `project.ts`, `worker.ts`): **87 files, 0 diagnostics**, parent and candidate.

Corrected test graph: **7 foreign evaluator errors, exact same messages on parent and candidate** (`runner.ts` TS2345 ×2 missing `halo`/`n2_suffix` on `TraceRange`; `store.ts` TS2345 ×4 and TS2322 ×1 `IndexAtom[]` vs `Value[]`). Compiler files in that graph: 0 diagnostics. Candidate file count 108 vs parent 107 because of `literal-absence-cases.ts`. These evaluator errors are the unchanged R21 control, not introduced by this delta.

## 11. LLP and guide

`docs-delta.patch` only inserts the LLP 1002 paragraph:

> Literal `null` contributes absence without a present element type. Shared joins retain that distinction through literal lists, object members and captures; presence narrowing removes absence alone. An all-absent value supplies no numeric, member or nominal authority. This adds no optional-element declaration syntax and does not change the stored or returned literal values.

Candidate LLP 1002 is 70437 bytes; parent-docs copy is 70060 bytes. Packaged `guide/quarry.md` is identical to parent (`15872` bytes). This review does not re-qualify R21 guide implementation.

## 12. Exact reproduction (EPYC)

```
export PATH="/home/ccheever/clique-tooling/epyc-linux-tooling-20260907T010007Z-0fd567d96f/node-v22.23.2-linux-x64/bin:/home/ccheever/clique-tooling/epyc-linux-tooling-20260907T010007Z-0fd567d96f/bun-v1.3.12-linux-x64/bin:/usr/bin:/bin"
EPYC=/home/ccheever/clique-reviews/compiler-literal-absence-r22-d3e497-f515f287bd/grok
# parent tree: copy snapback2, replace packages/compiler from parent-compiler.tar
# candidate tree: copy snapback2 (compiler == candidate-compiler.tar)
/usr/bin/timeout --signal=TERM --kill-after=1 30 bun $EPYC/probes/probe-projects.ts \
  $EPYC/exec/{parent,candidate}-snapback2/packages/compiler \
  $EPYC/factual-inputs/projects/base/{originals,adjacent} \
  $EPYC/evidence/<label>/projects <names>
/usr/bin/timeout --signal=TERM --kill-after=1 45 bun $EPYC/probes/probe-transport.ts …  # same 30 names
/usr/bin/timeout --signal=TERM --kill-after=1 30 bun $EPYC/probes/probe-selected.ts <compiler> <24 existing | 20 new>
```

Semantic child durations (s), none timed out: parent originals 0.596, adj 0.590/0.608/0.488; candidate originals 0.626, adj 0.649/0.729/0.479; selected existing 5.040/5.190; selected new 1.030. Transport: parent 0.558+0.920, candidate 0.581+1.005. Corrected types: production 2.748/2.738, test 3.286/3.209.

## 13. Limits of this review

- Did not run native/Rust, full `scripts/test.sh`, package publish, worker stdio probe handshake (`compiler-core.mjs` is a bundled leaf; compile was exercised through `lowerProject`, which is the worker compile operation).
- Did not re-run the blocked historical native source review or current-main graph.
- Did not audit unchanged R21 diagnostics/guide implementation.
- Did not treat supplied factual observation counts as passes; the 30-project 5/18 split and four historical complete-output equalities were re-measured.
- `fractional-null-literal` diagnostic code changed while remaining refused; reported as an inherited limitation with a changed envelope, not as a regression to accept.
- Transport was 30 compiles per tree in four 45s children, not 30 separate `worker.ts --project` processes. Accept/refuse agreed with semantic probes.
- Test-type file count is 108/107 from the four roots used here, not a claim about an unpublished 109-file inventory.

No repair stage. Original input bytes were not modified.
