READY

# Scoped compiler review: argument descriptor provenance

Frozen candidate `9afc84c2fe04ec48e8d373674b32323a804dcb38` from parent `4d8da3f0e6ff376a99d227c0e7cfcf57c50b9291`. This is a mutually blind scoped review of coherent actual argument-descriptor provenance across query, mutation, job, and channel, including recursive Optional/List/Text max/min/format, generation/migration, and shared type analysis. It is not whole-compiler or package clearance. Representation work is separately reviewed. Known existing variadic `push` order, merge-callback defaults, and documented optional-list domain bounds remain queued elsewhere.

Factual-input labels `77961` / `aa18` are **not** this candidate. Historical control labels `baseline4d8` / `final4` / `final5` / `final6` are preserved as labeled source/wrong-output controls, not as this run’s results.

## Frozen receipts (before launch)

| Item | Value |
|---|---|
| Candidate (frozen) | `9afc84c2fe04ec48e8d373674b32323a804dcb38` |
| Parent | `4d8da3f0e6ff376a99d227c0e7cfcf57c50b9291` |
| Snapshot Git | absent |
| Compiler files vs `compiler-source.json` | **208/208 blobs match**; 0 mismatches |
| Claimed source-archive SHA | `041c2801e30d33a4874309bec88fc50a96dfc3c0ba2efccf90f30f7326d22d45` |
| Archive SHA independently reproduced | **no** (path-null concat and git-style blob concatenations did not match; byte-bind is the 208-file manifest plus actual dependency hashes below) |
| Protected `packages/evaluator/src/types.ts` | `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618` **unchanged** |
| `lib.d.ts` | `16beb55a36cae96ecefc4d4345dc7f11552a9a25176545842356fb7fd43c4365` |
| `subset-lib.d.ts` | `34b18fc99720579b7192de9d82065f2ddcbc375e3b5f1c76caa3b7eaf1299145` |
| `packages/snapback2/src/api.ts` | `a52f71467e02b8ade7ece42007794cc10e57682364c3dd4e1306a4552ac315f4` |
| `node_modules/typescript/lib/typescript.js` | `e5f1f6b3e82228a89873cc7b941b2465185e839c0692860f83e3e63e53f94c2b` |
| Reverse `repair.patch` in private scratch | exit 0; parent restored |
| Parent vs candidate compiler delta | 9 files changed + 1 added (`descriptor-project-checks.ts`) |

Snapshot compiler bytes were re-checked after every probe; they still match the 208-file manifest. No product files were edited. No install/fetch, Rust build/server, publication, or benchmark/control rerun.

Supplied implementation-verification numbers (not this review’s execution): 923 callbacks in 41 bounded selections; 787 prior names retained + 136 new; 92 same-source complete projects per version (52 baseline accepts, 35 unsafe close, 17 accepted semantic outputs identical, 40 prior refusals retained); 35 adjacent + 15 extra projects/version; 50 R8 value controls; 60 Column parity; 80 production / 235 test-file types zero; actual 16-field migration ArgType + API proof; ref-check green; six initial timeout/fixture/type/support-manifest failures retained. Missing older remote verdict is not approval.

## Method

Read Snapback2 `AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1000/1001/1002 (authored surface, compiler worker, ArgType/Text constraints), and the current public guides `quarry.md`, `grammar.md`, and `job.md`. Did not read moving worktrees, implementation or peer review reports, benchmarks, or other live review output.

Parent was obtained only in private scratch by reversing `repair.patch`. Independent probes imported `lowerProject` / `lowerSource` / `lowerSchema` from candidate and parent compiler trees, using the frozen TypeScript package already in the snapshot. Every process invocation used an explicit 30-second process-group deadline and a saved `execution.json` (exit, timeout flag, seconds, deadline). Selections were split and run serially. Durable scripts and JSON results live under `.review-scratch/`.

### Independent invocations

| Name | exit | timeout | seconds | deadline |
|---|---:|---|---:|---:|
| candidate-custody | 1 | no | 2.923 | 30 |
| candidate-custody-2 | 0 | no | 3.686 | 30 |
| candidate-neighbors | 0 | no | 3.908 | 30 |
| candidate-flows-query | 0 | no | 4.955 | 30 |
| candidate-flows-mutation | 0 | no | 5.834 | 30 |
| candidate-flows-channel | 0 | no | 6.830 | 30 |
| candidate-migration | 0 | no | 27.433 | 30 |
| candidate-public | 0 | no | 19.129 | 30 |
| candidate-followup | 0 | no | 12.143 | 30 |
| parent-custody | 1 | no | 0.790 | 30 |
| parent-neighbors | 1 | no | 0.861 | 30 |
| parent-flows-query | 1 | no | 0.993 | 30 |
| parent-migration | 1 | no | 1.354 | 30 |
| parent-custody-2 | 0 | no | 2.268 | 30 |
| parent-neighbors-2 | 0 | no | 3.804 | 30 |
| parent-flows-query-2 | 0 | no | 5.966 | 30 |
| parent-migration-2 | 0 | no | 21.514 | 30 |
| parent-public | 0 | no | 19.083 | 30 |
| parent-followup | 0 | no | 11.553 | 30 |

No independent invocation was a 321-second full registration. None of these 30-second processes timed out.

### Initial failures retained

1. `candidate-custody` exit 1 in 2.923s: Bun could not resolve `typescript` from `.review-scratch/scripts`. Diagnosed without install by symlinking the snapshot’s existing `snapback2/node_modules` into scratch; `candidate-custody-2` then passed.
2. `parent-custody`, `parent-neighbors`, `parent-flows-query`, `parent-migration` exit 1 in <1.4s: parent `loadCompilerLib` still lives in `project.ts`, not `project-program.ts`. Follow-ups loaded `subset-lib.d.ts` + `lib.d.ts` from disk and passed.

## What changed (source)

Parent `DescriptorBindings` built a **private no-resolve program** plus an **invented** `descriptor-ambient.d.ts` containing `declare function scalar(): unknown` (and the other legacy names). Native origin was **import spelling** (`from "snapback2"` named `t` / namespace). Unsafe marking used **positive `value()` only**, so `let owner=t; owner.text=…` did not taint `t`. Public `quarryType` invented `json <=1000` / list `max ?? 100` after inner-only wrapper checks.

Candidate binds the **actual checked project** (`createProjectProgram` + `bindDescriptorProgram`) before schema, operations, API, and Quarry-only migration. Native `t` is the library export whose declarations all live in the real `lib.d.ts` file. Legacy constructors are actual ambient/declare/global-augmentation function declarations in the checked graph. Conservative `carried()` flow is wider than positive `value()`: unsupported writes, containers, loops, getters, assignments, unknown calls, tagged templates, yields, and class fields accumulate possible owners. `safe()` is false if that set contains the owner **or** if discovery is incomplete. Authored paths cannot occupy the virtual library slot (`while (files.has(libPath))` prefix `_`). Wrapper-level `lowerArgDescriptor` must succeed before a Quarry signature is printed.

Positive origin still admits: imported `t` / `t as a` / `import * as ns`, `import scalar=ns.t`, `const alias=t`, shorthand `{types}`, static string key, `true?t:t`, zero-argument transparent accessors, and **immutable imported** `const owner=t` / `function get(){return t}` from another module. `export * from "snapback2"` is a value path; `export type *` and `import type` are not.

## Before / after (honest attribution)

### Parent (`4d8da3f0`, reversed in scratch)

- Standalone `scalar()` with **no** user declaration compiled as `{ value: "Scalar" }` (`unboundStandalone` ok true). Invented ambient filled the miss.
- `globalThis.scalar=()=>t.text(31,{min:8,format:"url"})` plus a local `declare function scalar` compiled as `{ value: "Scalar" }` and published `Op<{ value: unknown }, unknown>` (`ambientShadowWrite:query`). That API admits `42`.
- `let owner=t; owner.text=(max)=>originalText(31);` then `t.text(90)` compiled as `{ Text: { max: 90 } }` and `Op<{ value: string }, string>`. Same for array/destructure/rest/getter/container/loop/assignment/unknown-call/yield/class escapes: parent **accepted** and emitted Text90.
- Cross-module `t.text=replacement` and `import * as owners` consumer escape: parent **accepted** Text90.
- Immutable imported `owner.text(31,{min:8,format:"url"})`: parent **refused** (`E_ARGS_DESCRIPTOR`). Same-file spelling could not see the other module’s const alias.
- `export * from "snapback2"` then `owner.text(...)`: parent **refused**.
- Public migration `const max=2; t.list(t.text(31,{min:8,format:"url"}),{max})` offered `query probe(value: [text 8..31 format url] <=100):` — a valid-looking, compilable, **widened** signature. Unknown option `{max:2,unknown:1}` offered `<=2` and dropped the unknown-option refusal. `t.decimal(2)` offered `query probe(value: json <=1000):`.
- Private lowering of the shorthand-max list **already refused** (`E_ARGS_DESCRIPTOR`, rewrite `t.list(t.text(100), { max: 10 })`). The hole was public authoring, not private admission.

### Candidate (`9afc84c2`)

- Standalone missing `scalar()` **refuses** `E_ARGS_DESCRIPTOR` and does not invent an ambient. The same source plus a real `declare function scalar(): Arg<unknown>` in the checker lib **accepts** Scalar. Missing-global failure is distinct from complete-project success.
- Ambient shadow write **refuses** `E_ARGS_DESCRIPTOR`, no `apiDts`. Unwritten genuine ambient global, and local `declare global` **without** a writer, still admit Scalar.
- Every probed owner-flow escape on query, mutation, and channel **refuses** `E_ARGS_DESCRIPTOR` with no API. Cross-module write and namespace-carrier escape refuse. `const owner=t; (owner as any).text=…; t.text(90)` refuses. Unused `let owner=t` **without** a write still admits a later `t.text(31,{min:8,format:"url"})` — positive origin is not the conservative possible-owner set.
- Immutable imported owner/accessor **accepts** `{ Optional: { List: { of: { Text: { max: 31, min: 8, format: "url" } }, max: 2 } } }`. Value `export *` accepts; type-only import/export-star refuse origin.
- Public invalid wrappers **do not** print `query probe(...)`. Ops rewrite is `argument value: t.list arguments do not form a valid descriptor` (or the duplicate-max message). They still emit the ordinary TS-schema `E_QUARRY_ONLY` rewrite `table items:\n  value: json <=1000\n  public` for `snapback/schema.ts`; that is the existing schema-file quarry-only diagnostic, not an argument signature.
- Lawful `t.optional(t.list(t.text(31,{min:8,format:"url"}),{max:2}))` migrates to `query|mutation|channel probe(value: [text 8..31 format url] <=2 ?):`, which **compiles**, IR `{ Optional: { List: { of: { Text: { max: 31, min: 8, format: "url" } }, max: 2 } } }`.
- `t.decimal(2)` → `query probe(value: decimal 2):` compiles to `{ Decimal: { scale: 2 } }` with API `Op<{ /** decimal 2 — minor units */ value: number }, Decimal<2>>`. Money and cursor likewise. `t.ref(records)` migrates to a **non-signature** “no proven Quarry spelling” refusal rather than guessing `records` or `id`.

## Exact observations

### Project IR

Public Quarry text formats survive query, mutation, job, and channel with identical parent/candidate programs:

```
handle: { Text: { max: 20, min: 1, format: "handle" } }
link: { Optional: { Text: { max: 2048, format: "url" } } }
items: { List: { of: { Text: { max: 20, format: "handle" } }, max: 2 } }
optionalItems: { Optional: { List: { of: { Text: { max: 20, format: "handle" } }, max: 2 } } }
nested: { Optional: { List: { of: { List: { of: { Text: { max: 2048, min: 8, format: "url" } }, max: 3 } }, max: 2 } } }
```

Job kind is `"job"`. `text <=20` (absent format) is `{ Text: { max: 20 } }`. `text 0..20 format handle` canonicalizes to `{ Text: { max: 20, format: "handle" } }` (min 0 omitted). `format unknown` and `format null` are `E_QUARRY_SYNTAX` at the authored token (`unknown text format unknown|null`). `fixtures/quarry-todos` still compiles (`todos.add` title Text200, `todos.list` empty args). `fixtures/quarry-jobs` still compiles four jobs including `admin.scoped` `{ scope: { Text: { max: 20 } } }`.

Column diagnostics are **byte-identical** to parent on the eight ordinary/invalid column forms probed (`t.text(31)` admits Text31; `t.text(31,{min:8,format:"url"})` remains `E_SCHEMA_COLUMN` / `t.text(100)`; computed `(t.text)(31)` remains `column type must be a t.* descriptor` / `(t.text(100)`). Argument origin is not applied to columns.

### API consumers (compiled, not string-only)

- Lawful query/mutation migration: `value: string[]` consumer with `"https://x"` has **zero** diagnostics; `42` is `TS2322: Type 'number' is not assignable to type 'string'`. An overlong string also typechecks — generated `string` **cannot** prove max/min/format. That is reported, not treated as a bound proof.
- Lawful channel migration: `Channel<{ value?: string[] | null }, unknown>`; `"https://x"` ok, `42` TS2322.
- Public format query/mutation: `{ handle: 'abc_123', link: 'https://x', items: [''], nested: [['http://x']] }` ok against generated `string` fields.
- Jobs are absent from client `Op` API: format-job `apiDts` has an empty `interface Api {}`; quarry-jobs `fillAvatars` / `scoped` / `fill_profiles_*` are not `*: Op<` in `apiDts`. Channels appear as `Channel<…>`, not ops.
- Genuine Scalar API remains `{ value: unknown }`. Parent’s **wrong** shadowed-global case published that unknown API over a Text factory; candidate publishes nothing for that case.

Decimal caller bindings on the compiled suggested signature remain `value: number` with the `decimal 2 — minor units` comment. That is the existing public Decimal/caller contract, not a json fallback.

### Diagnostics / migration

Private shorthand-max list still refuses with `E_ARGS_DESCRIPTOR` and historical repair `t.list(t.text(100), { max: 10 })`. That rewrite is a descriptor snippet, not a `query probe(...)` header, and is the same private repair parent already emitted. Public authoring no longer turns it into `[text 8..31 format url] <=100`.

Computed callees `t["text"]`, factory `function int(){return t.text(...)}`, and `declare module "snapback2" { export const fake }` remain origin refusals on both sides (callee spelling / structural type / augmentation are not native constructors).

Library-slot probe: authored `__snapback2_lib.d.ts` and `___snapback2_lib.d.ts` keep marker `42`; real library text equals `loadCompilerLib()` and is a distinct SourceFile at `____snapback2_lib.d.ts`. Standalone `createSourceProgram(authored, "bounded-lib.d.ts", lib)` keeps authored source as `bounded-lib.d.ts` and library as `_bounded-lib.d.ts`. Parent `createProjectProgram` has no `library` field and lets authored `__snapback2_lib.d.ts` occupy the virtual slot.

## Public vs private boundary

| Surface | Supported | Unsupported |
|---|---|---|
| Private TS lowering (`authoring: "any"` / `lowerSource`) | Proven native `t.*` and genuine ambient legacy Scalar/id/text/optional/list; recursive Optional/List/Text with literal max/min/format | Unproved origin, non-literal wrapper options, computed callees, factories, type-only imports, mutated/escaped owners |
| Public Quarry grammar | Existing `text <=N`, `text M..N`, `format handle`/`format url`, lists, optionals, jobs, channels; no new grammar | `format unknown` / `format null` at the token |
| Public TS→Quarry migration | Prints a signature only after wrapper-level admission; compiled signatures keep constraints | Invalid wrappers print an origin/wrapper problem, not a usable header; `t.ref` is not guessed |
| Columns | Unchanged `callLeaf` grammar and Column diagnostics | Argument refinements on columns still `E_SCHEMA_COLUMN` |
| Client API | Query/mutation/channel ops; jobs filtered out | Jobs must not appear as `Op` |

No arbitrary setup execution: uninterpreted setup is not run; it only contributes possible owners.

## Tested in this review

Query/mutation/channel owner-flow escapes listed above; cross-module write; namespace carrier; ambient shadow write/no-write; unwritten ambient `.d.ts`; unbound vs genuine standalone Scalar; imported const owner + accessor; import-equals; const alias; value vs type-only star; computed callee; factory binding; module augmentation; owner cycle; shared alias expansion; rest+computed write; unused let; const-then-write; library-slot collision; eight column forms; public format query/mutation/job/channel; unknown/null format; todos fixture; jobs fixture + API absence; lawful query/mutation/channel migration compile + API consumers; decimal/money/cursor suggested-signature compile; private lawful Optional/List/Text IR; private invalid list refusal.

## Untested / not qualified here

- Native v5 wire admission (handle exact ASCII lowercase/digit/underscore; URL exact lowercase http(s) / nonempty rest / no Rust whitespace/control; absent format accepted; present null rejected) was **not** executed against the Rust runtime. Old min-only proofs remain historical. This compiler review does not independently qualify native admission.
- Runtime concat `return [2,3]` / write `[2000,3000]`: the supplied TS snippet (`declare const records:any`) refused `E_OPAQUE` on both parent and candidate (unresolved table). Not an IR/runtime concat proof. Representation is separately reviewed.
- Full 923-callback / 16-field / 50 R8 / 60 Column / 80+235 types suites were **not** re-run. Column parity here is eight forms, not 60.
- Parent mutation/channel owner-flow matrices were not re-probed after the parent import failure; parent query flows plus candidate mutation/channel flows were. Parent origin is per-file invented ambient, so the query hole is the representative parent bug.
- `for-of` destructuring, default-parameter accessor write, and several other in-tree `ownerFlowCases` names were not every one re-hosted here (array rest, getter, tagged, yield, class, method receiver were).
- Effect modules, seed, schedules as clients, and package/benchmark gates: out of scope.
- Native handle/url evaluator in `types.ts` was hash-checked only, not executed.

## Limitations (honest)

Deadline evidence is per process, 30s, saved. The first candidate process failed on module resolution; four parent processes failed on `loadCompilerLib` placement; both classes of failure are retained and were followed by bounded passing reruns. Claimed source-archive SHA was not reproduced; 208 compiler blobs and the listed dependency bytes were. `projectTypeDiagnostics` still filters any filename ending in `__snapback2_lib.d.ts`, which also drops type diagnostics for an authored file of that name after the slot is renamed; library vs authored **bytes** remain distinct, and native `t` still requires the library SourceFile. Incomplete conservative flow (`flowSteps > 100_000`) refuses every subsequent descriptor in that program; the shared-alias expansion case refuses, as required, but this is a coarse fail-closed, not a proof that every large DAG is classified rather than truncated.

No overall compiler or package clearance.

## Verdict

For this scoped descriptor-provenance delta, candidate `9afc84c2` closes the parent holes that published Scalar/unknown or Text90 after unproved owners, invented ambients, and widened public list signatures, without dropping the lawful public Quarry grammar, genuine ambient Scalar, immutable imported `t.*` aliases/accessors, Column diagnostics, job-not-on-client-API behavior, or Decimal minor-unit caller bindings on compiled suggested signatures. READY for this scope.
