CHANGES_REQUIRED

Fresh scoped review of frozen `77961d4b9fa338e87a20eae1e767636ceaedfd6e`, the descriptor-origin delta from `aa18e57a084fb2719625cab206dcc38695220d98`, and the earlier Text.format propagation represented by `format.patch`. Three descriptor-custody issues remain. All three also reproduce at the reconstructed aa18 baseline: these are incomplete closure of the requested descriptor scope, not newly introduced representation regressions.

The source snapshot was preserved. I read Snapback2's AGENTS instructions, RULES/NOT-DOING, LLP 1000, relevant governing clauses in LLPs 1001/1002/1003/1004/1010/1011/1012/1016, and the current Quarry, grammar/type, and job guides and their compiler implementations. No peer review, implementation report, benchmark report, moving worktree, or Git history was consulted. The 16892 side was inspected through the supplied patch, not executed as a separate checkout.

**P1 — Writes and escapes through unsupported aliases leave the original native owner falsely trusted.**

The positive resolver follows only `const` variable bindings, while invalidation silently does nothing when that resolver cannot resolve a write's receiver. Thus refusing a mutable alias as a descriptor owner does not invalidate native `t` when that alias modifies it. Arrays, array destructuring, getters, and assignment escapes create related holes. See [descriptor-origin.ts:108](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/snapback2/packages/compiler/src/lower/descriptor-origin.ts:108) and [invalidation at line 173](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/snapback2/packages/compiler/src/lower/descriptor-origin.ts:173).

Exact executed `snapback/ops.ts`:

```ts
import {query,mutation,channel,schema,rule,t,t as a} from 'snapback2'; import * as ns from 'snapback2';
const originalText=t.text;let owner=t;owner.text=(max:number)=>originalText(31);
export const probe=query({value:t.text(90)},({args})=>args.value);
```

The complete project also contains:

```ts
import {schema} from 'snapback2';export default schema({tables:{}});
```

Both standalone strict checking and complete private project compilation accept this source. The assigned function ignores 90 and calls the saved constructor with 31, but `ProjectJson` emits `{"Text":{"max":90}}`. The generated API is usable, with `Op<{ value: string }, string>`; the real consumer accepts a URL string and rejects number 42. That primitive-type check supplies no evidence for the emitted bound. Default public-authoring refusal also fabricates `query probe(value: text <=90):` as its migration signature.

This compiler does not execute authored setup bodies. The required result is therefore a precise unsupported-origin refusal, rather than interpreting a replaced method as the native constructor. Following the original import spelling is insufficient once its owner has been modified.

Independent complete projects also accepted these mutations/escapes before `t.text(90)`:

- `const owners=[t]; owners[0].text=(max:number)=>originalText(31);`
- `const [owner]=[t]; owner.text=(max:number)=>originalText(31);`
- `let holder={types:t}; holder.types.text=(max:number)=>originalText(31);`
- `const holder={get types(){return t;}}; holder.types.text=(max:number)=>originalText(31);`
- Passing `[t]`, `...[t]`, or `{get types(){return t;}}` to an unknown consumer; assigning `t` into an externally owned property.

The mutable-alias and array-write counterexamples retain the wrong Text90 descriptor through query, mutation, and channel projects, including `Optional(List(Optional(...), max 2))`. The final split executions include generated API consumers for those accepted descriptors. Direct object writes and supported plain-object escapes are correctly refused by the registered controls; these other paths bypass that protection.

Evidence: [exact mutable-alias source](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/runs-v2/mutable-alias-write/candidate/query-direct/snapback/ops.ts), [complete result](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/runs-v2/mutable-alias-write/candidate/query-direct/project-result.json), [API consumer results](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/runs-v2/mutable-alias-write/candidate/query-direct/consumer-results.json), [recursive channel result and consumers](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/runs-v2/mutable-alias-write-split-channelTrue/candidate/results.json). Preserve conservative refusal for unsupported aliases, but make invalidation account for the native owners they can carry; accepting additional authoring grammar is unnecessary.

**P1 — The synthetic, single-file binding program cannot establish actual project-wide native or legacy origin.**

[descriptor-origin.ts:50](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/snapback2/packages/compiler/src/lower/descriptor-origin.ts:50) reparses only the calling source, adds invented ambient functions, and uses `noResolve`. [legacyDescriptorName](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/snapback2/packages/compiler/src/lower/descriptor-origin.ts:22) can consequently certify its own synthetic `scalar` declaration instead of the binding supplied by the actual checked project. Native import safety is likewise computed independently for each file.

Exact executed `snapback/legacy.ts`:

```ts
import {t} from "snapback2"; declare global {function scalar():import("snapback2").Arg<string>;} globalThis.scalar=()=>t.text(31,{min:8,format:"url"});
import {query} from "snapback2"; export const other=query({},()=>true);
```

Exact executed `snapback/ops.ts`, with the empty schema shown above:

```ts
import {query,mutation,channel,schema,rule,t,t as a} from 'snapback2'; import * as ns from 'snapback2';
import "./legacy";
export const probe=query({value:scalar()},({args})=>args.value);
```

This is a complete checked project with a concrete assigned factory body, not merely a handwritten declaration claiming native origin. Compilation succeeds without diagnostics and emits `ops.probe.args.value = "Scalar"`, losing max 31, min 8, and format url. The actual generated declaration is `Op<{ value: unknown }, string>`. Both URL-string and number-42 consumers pass. Standalone checking of `ops.ts` alone cannot find the external global; that isolated result is retained and is not claimed as a complete-project type failure.

The supported legacy form `optional(list(scalar(),{max:2}))` also succeeds in complete query and mutation projects, emitting `{"Optional":{"List":{"max":2}}}`. Its generated API accepts both `["https://x"]` and `[42]`. Genuine ambient legacy Scalar controls must remain supported, but a synthetic declaration cannot establish that a project's actual factory belongs to that legacy grammar.

The native counterpart is a second module containing `const originalText=t.text; t.text=(max:number)=>originalText(31);` plus an ordinary exported query. An importing module's `t.text(90)` remains accepted as Text90. Complete query, mutation, and channel projects reproduce this, including recursive native wrappers and real API consumers. Native channel parsing does not support the legacy Scalar grammar; the channel witness uses the native cross-module write, not an invented public/legacy channel form.

Evidence: [complete Scalar project](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/runs-v2/legacy-complete-query-direct/candidate/query-direct/project-result.json), [generated Scalar API and consumers](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/runs-v2/legacy-complete-query-direct/candidate/results.json), [supported recursive legacy consumer results](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/runs-v3/legacy-supported-query-recursive/candidate/results.json), [native cross-module recursive channel](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/runs-v2/cross-module-complete-split-channelTrue/candidate/results.json). Origin must be bound to the actual checked project and its relevant writes/escapes, or explicitly refused when that proof is unavailable.

**P2 — Migration validates the Text leaf but invents a List bound for unsupported wrapper syntax.**

[project-authoring.ts:118](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/snapback2/packages/compiler/src/project-authoring.ts:118) descends into a wrapper without validating the wrapper's own descriptor. [Line 147](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/snapback2/packages/compiler/src/project-authoring.ts:147) substitutes 100 for an unreadable list maximum.

Exact executed `snapback/ops.ts`:

```ts
import {query,mutation,channel,schema,rule,t,t as a} from 'snapback2'; import * as ns from 'snapback2';
const max=2;
export const probe=query({value:t.list(t.text(31,{min:8,format:"url"}),{max})},({args})=>args.value);
```

Standalone TypeScript checking accepts it. Private project lowering correctly returns the sited `E_ARGS_DESCRIPTOR` message `invalid argument descriptor value; t.list arguments do not form a valid descriptor`, without an API. Default authoring instead supplies this valid-looking migration header:

```q
query probe(value: [text 8..31 format url] <=100):
```

I compiled that exact header with `return value` in a complete public Quarry project. It succeeds with `List.max = 100`, and the generated API consumer containing three URLs succeeds. This is a concrete widening of the authored maximum 2 during migration. Unknown list options also receive a usable signature with the unknown option discarded. Wrapper validation should produce the existing precise argument guidance before rendering a migration signature; this does not require allowing nonliteral bounds in either grammar.

Evidence: [private refusal](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/runs-v2/list-invalid-migration/candidate/query-direct/project-result.json), [migration diagnostic](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/runs-v2/list-invalid-migration/candidate/query-direct/migration-result.json), [compiled public rewrite](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/final-checks/migration/candidate/project-result.json), [three-element API consumer](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/final-checks/migration/candidate/consumer.ts).

**What the candidate does establish within this review.**

The three supplied local factory failures were independently reproduced at aa18 in complete projects: import-equals `scalar=factory.make` emitted Scalar; local `text(90)` emitted Text90; local `int()` emitted Int, admitted number 42 in its generated API, and rejected a URL string. The candidate refuses all three without publishing an API. The recursive channel `int()` factory control is also fixed. Their exact sources, complete results, and API consumers are under `.review-scratch/runs-v2/original-*`.

All 138 registered candidate descriptor/format callbacks passed; all 91 corresponding baseline callbacks passed. These include the 47 added origin/Column groups, original bracket/parenthesized-callee/undefined-format controls, direct/native aliases, renamed and namespace imports, import-equals owner aliases, object destructuring and shorthand, static keys/choices, transparent function and arrow accessors, factory/getter/dynamic refusals, lexical shadows, malformed constructors and recursive wrappers, legacy Scalar controls, option validation, and migration controls. This is execution of those registrations, not all 642 compiler registrations.

Independent public testing exercised 45 descriptor combinations per query/mutation/job/channel: omitted/handle/url format, minima 0/8/31, and five supported scalar/Optional/List/nested-list shapes, for 180 combinations per version. Formatted and matching unformatted projects produced eight complete projects per version. Candidate/baseline ProjectJson, generated API declarations, and source maps match exactly for all eight pairs. Formatted/unformatted operation bodies and table schemas match; there are no added argument body guards. Query/mutation/channel positive and negative consumers use the emitted API plus declarations derived from the actual client `src/api.ts`. Jobs are intentionally excluded from client operations at `project.ts:200`; generated declarations and a real consumer prove their absence with TS2339. No client job signature was fabricated to make the test pass.

The accepted Text descriptors retain max, nonzero optional min, and optional exact handle/url strings recursively. Omitted format and min zero retain canonical omission; present null/undefined, invalid formats, invalid bounds, malformed options, and unsupported public optional list elements have executed refusal controls. Many invalid option cases deliberately exercise unchecked lowering; the saved full-project probes and registered project cases identify the checked subset. A checked wrapper overload is not counted as runtime admission evidence.

**Representation, source custody, and limits.**

Reverse-applying `repair.patch` succeeded only in private scratch. Actual candidate/baseline file-byte comparison finds precisely the six advertised changed compiler files. The delta changes constructor recognition and its consumers; it contains no edits to operand representation/conversion, argument normalization, Column storage grammar, source_max, wire identity, or core identifiers. The type-analysis and generated-API dispatch changes were inspected as possible representation seams, rather than assumed harmless because the other files match.

An independent 60-record Column parser/diagnostic comparison is byte-identical, including all diagnostic fields. The exact committed literal-origin concat source returns `[2,3]` and writes `{amounts:[2000,3000]}` in the TS IR probe on both versions. The exact argument-origin source keeps both `E_DECIMAL_SCALE` diagnostics, at `probe.ts:1:157` and `probe.ts:1:193`, with message `int does not prove the representation required by Decimal<3>`. Source, lowered results, diagnostics, and literal execution records are byte-identical. These controls do not clear the separately queued helper-register, optional-Decimal, nullable-list-producer, or extra-operand representation defects.

All 1,279 relevant supplied manifest entries matched actual bytes before copying, including all 205 compiler files, materialized dependencies, rules, and patches. Final verification finds zero source changes. Protected `evaluator/src/types.ts` remains exactly `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618`. Independent finding fixtures add no casts, forged native descriptors, or type bypasses. The registered tests retain their original source bytes, including their existing syntax controls.

Probes used cached TypeScript 5.9.2 and Bun 1.3.12 with `--no-install`. Every subprocess group had a 30-second deadline. The durable record contains 176 independent private-project results, 88 per version, including initial invalid attempts; this count is not a claim that every attempt passed. The 138/91 registered callback results are separate. Full scripts, exact authored sources, ProjectJson, declarations, consumers, diagnostic results, exit status, and deadlines are retained in [the scratch directory](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch), with [summary and first failures](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/summary.json), [byte comparison](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/delta-byte-comparison.json), and [script/input provenance](/Users/ccheever/clique-improvement/reviews/compiler-argument-format-r3/astra/.review-scratch/script-input-provenance.json).

First failures were preserved: early replacement functions returned Arg where the original overload required Column; initial auxiliary modules lacked an exported operation; an initial legacy nested-Optional fixture failed its unchanged wrapper declaration; the first job consumer incorrectly assumed a client Op; and the first broad TypeScript invocation used the scratch working directory and missed Node ambient types. Follow-up fixtures/checks have distinct names or script versions. An early multi-module summary selected `programs[0]`; complete JSON was retained, and v2 selects `ops.probe`. No original result was overwritten to hide these mistakes.

There were 15 preserved 30-second timeouts: eight larger descriptor/API groups and seven broader TypeScript invocations. Required finding witnesses have completed bounded split records. The corrected-directory production/full-config TypeScript attempts still timed out; I do not independently substantiate the supplied 79-file/zero-diagnostic or full-config/same-ten-error claims. The original job-consumer assertion failures are retained alongside corrected checks proving the intended unavailable client API. These are scoped split executions, never a renamed full-suite green.

No Unicode tables or effects ES2020 library were generated in this review; existing materialized Unicode inputs/artifacts were copied and byte-bound. Client API declarations were derived from the pinned actual client TypeScript source through the existing helper, with source/compiler inputs recorded. No Rust build, native runtime admission suite, server, benchmark, package build/full package suite, publication, or migration application was run. Native v5 omitted/null admission and exact handle/URL value rules are treated as the supplied runtime contract, not independently re-proved here; neither wrapper typechecking nor matching wire fields substitutes for that separate runtime review. This verdict clears neither the whole compiler nor the package.
