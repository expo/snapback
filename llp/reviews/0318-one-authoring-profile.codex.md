**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.150.1, `gpt-5.6-sol` at ultra reasoning effort (`-c model_reasoning_effort=ultra`), read-only sandbox, independent ephemeral session. The runner emitted a standing `--dangerously-bypass-hook-trust` warning originating in the user's own `~/.codex/config.toml`; it was not set by this loop.
**Date:** 2026-08-27
**Redacted:** no
**Method:** cli-runner (detached background dispatch, orchestrator polled)

# Snapback simplification batch — Cluster A review artifact — GPT (Codex) family

Lockstep cluster: LLP 0318 (primary) + 0319 + 0320 + 0321 + 0323. This file is the single verbatim
preservation for the cluster in this family; per-target verdicts are
inside the review body. The non-primary targets carry
`.cluster-pointer.md` files pointing here.

## Round 1

- Revision under review: working tree at repository HEAD
  `d49ae32b50fcc1506fe79aee3680cae76eb5c12d`; per-target sha256 recorded
  in [`0318-one-authoring-profile.run.md`](./0318-one-authoring-profile.run.md).
- Capsule: live checkout, read in place. **Structural blindness** with
  respect to this batch — no review artifact for any of the eight targets
  existed anywhere in the tree at launch or during the run. The
  instruction ban on reading `llp/reviews/` is additionally
  **SELF-ATTESTED**, since both runners can read the whole checkout.
- Instruction brief sha256 (common body)
  `1848df190861b08b1d8a041b7131888fe706042de89f0aed861539a11e9e1a82`,
  plus the cluster target list and a runner-specific constraints block.
- Independence: separate process, fresh session, different model family
  from the second reviewer, and different from the orchestrating reviser
  (Claude) which authored the targets and cast no verdict.
- Runtime: dispatched concurrently with the other three round-1 runs; returned at the orchestrator's poll tick.
- Result: **0318 NOT READY (7 MATERIAL), 0319 NOT READY (2), 0320 NOT READY (5), 0321 NOT READY (3), 0323 NOT READY (4), SET NOT READY.**

### Verbatim review body

SET verdict: NOT READY. Every target has blocking defects. I did not consult any review artifact or read any file under `llp/reviews/`.

The 0319 headline inventory—31 `define*` constructors, 13 query constructors, and 140 exports—is correct. Several 0323 counts are also correct: 4,248 tracked identities, a 5,162,043-byte registry containing 1,461 symbols across 56 modules, and a 501,468-byte client root page. The consequential numerical errors are concentrated in 0321.

## LLP 0318

**MATERIAL — §2, OQ4, and §5: the “legacy pin” does not protect existing applications.**

`authoringProfile` is optional in policy v1 and omission currently means Explicit. Todo is a real Explicit application that omits the field. Flipping the omission default would silently reinterpret existing source, despite claiming Explicit remains available through a legacy pin.

Evidence: the policy parser defaults omission to Explicit at [index.mjs:19547](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:19547); todo omits the field at [codegen.policy.json:1](/Users/ccheever/projects/snapback/demos/todo/snapback/codegen.policy.json:1); the guide documents omission as deliberately Explicit at [generated-artifacts.md:144](/Users/ccheever/projects/snapback/guide/getting-started/generated-artifacts.md:144). LLP 0304 requires successor grammar or another explicit compatibility mechanism and forbids silently reinterpreting current source at [LLP 0304:142](/Users/ccheever/projects/snapback/llp/0304-agent-safe-schema-authoring.decision.md:142).

Suggested fix: preserve Explicit as the permanent v1 omission meaning. Either migrate every existing application to an explicit pin before changing scaffold behavior, or introduce a versioned successor policy/profile whose default is Familiar.

**MATERIAL — §2, OQ3, and §6: convergence is not a mechanical naming/layout migration because the profiles have different semantics.**

The shared constructors do not imply identical behavior:

- Canonical `defineTable` starts non-syncable and requires `.sync()`; Familiar’s wrapper unconditionally adds `.sync()` ([define.mjs:1195](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:1195), [familiar.mjs:286](/Users/ccheever/projects/snapback/packages/snapback-codegen/familiar.mjs:286)).
- Familiar discovery currently accepts only `.ts`/`.mts`, while the proposal promises JavaScript or TypeScript ([index.mjs:18343](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:18343)).
- `useSnapbackQuery` returns a full `QueryState`; Familiar `useQuery` returns data/undefined and throws selected errors ([index.d.mts:591](/Users/ccheever/projects/snapback/packages/snapback-react/index.d.mts:591), [familiar.mjs:116](/Users/ccheever/projects/snapback/packages/snapback-react/familiar.mjs:116)).
- Default `useSnapbackMutation` exposes a settled-or-queued outcome, while Familiar `useMutation` deliberately calls the settled-only hook ([index.d.mts:935](/Users/ccheever/projects/snapback/packages/snapback-react/index.d.mts:935), [familiar.mjs:141](/Users/ccheever/projects/snapback/packages/snapback-react/familiar.mjs:141)).

Aliases cannot preserve both contracts.

Suggested fix: define the surviving semantics—not merely names—for syncability, query state/errors, mutation settlement, language admission, and delivery defaults. Treat conversions that change those facts as reviewed migrations, not mechanical codemods.

**MATERIAL — §5: its proposed evidence is insufficient under the accepted promotion decision.**

One repaired Clique matrix cannot authorize the default flip. Accepted LLP 0252 requires three workload families, preregistered N≥3, second-model-family evidence, semantic noninferiority, no expressiveness regression, and a maintenance bound ([LLP 0252:692](/Users/ccheever/projects/snapback/llp/0252-convex-familiar-authoring-profile.rfc.md:692), [LLP 0252:698](/Users/ccheever/projects/snapback/llp/0252-convex-familiar-authoring-profile.rfc.md:698), [LLP 0252:729](/Users/ccheever/projects/snapback/llp/0252-convex-familiar-authoring-profile.rfc.md:729), [LLP 0252:751](/Users/ccheever/projects/snapback/llp/0252-convex-familiar-authoring-profile.rfc.md:751)). LLP 0259 likewise keeps Explicit default until LLP 0252 records Promote ([LLP 0259:360](/Users/ccheever/projects/snapback/llp/0259-agent-first-read-budget.rfc.md:360)).

The cited Familiar green is additionally not a clean paved-loop success: Metro died and the restart happened to recook binding identity ([LLP 0310:286](/Users/ccheever/projects/snapback/llp/0310-published-0127-clique-dx-friction.research.md:286)).

Suggested fix: either retain LLP 0252’s promotion gate or explicitly supersede it with a reasoned decision. A single repaired Clique run may be a diagnostic rerun, not the default-change gate.

**MATERIAL — §§1.3 and 7: the maintenance-cost premise is false as written.**

The profiles are separate source grammars, but they are not duplicate backends where every change is implemented twice. Familiar `query` and `mutation` lower into canonical JS constructors ([familiar.mjs:231](/Users/ccheever/projects/snapback/packages/snapback-codegen/familiar.mjs:231)), and both profiles share the normalized definition, runtime, generated graph, and clients. LLP 0252 already defines how to measure adapter-exclusive production/test/doc work and permits a permanent Tier outcome under a 15% bound ([LLP 0252:704](/Users/ccheever/projects/snapback/llp/0252-convex-familiar-authoring-profile.rfc.md:704), [LLP 0252:792](/Users/ccheever/projects/snapback/llp/0252-convex-familiar-authoring-profile.rfc.md:792)).

Suggested fix: replace “every change is authored twice” with an inventory of genuinely profile-exclusive code, tests, documentation, diagnostics, and qualification time. Use that measurement when deciding Merge/Promote/Tier.

**MATERIAL — OQ2: the authorization rationale misattributes review evidence as enforcement.**

`authScopeField` exists for live-invalidation disjointness and explicitly is not authorization proof. `authorization-review.json` is review evidence, not runtime enforcement; deleting it cannot change authority ([LLP 0173:149](/Users/ccheever/projects/snapback/llp/0173-authorization-review-projection.rfc.md:149), [LLP 0173:167](/Users/ccheever/projects/snapback/llp/0173-authorization-review-projection.rfc.md:167), [LLP 0173:239](/Users/ccheever/projects/snapback/llp/0173-authorization-review-projection.rfc.md:239)). Familiar already carries `authScopeField` into the canonical definition ([familiar.mjs:231](/Users/ccheever/projects/snapback/packages/snapback-codegen/familiar.mjs:231)). LLP 0304 requires both profiles to lower through one normalized semantic boundary; it does not assign enforcement to these projections ([LLP 0304:29](/Users/ccheever/projects/snapback/llp/0304-agent-safe-schema-authoring.decision.md:29)).

Suggested fix: identify the actual runtime authorization owners and separately inventory which declaration/review facts are absent from Familiar. Do not describe `authScopeField` or the review projection as enforcement.

**minor — OQ4: not every fixture is Explicit.**

Four fixture policies already select `snapback-familiar-ts-v1`, including [familiar-todo](/Users/ccheever/projects/snapback/tests/fixtures/familiar-todo/codegen.policy.json:1) and [familiar-vdoc-vertical](/Users/ccheever/projects/snapback/tests/fixtures/familiar-vdoc-vertical/codegen.policy.json:1).

Suggested fix: generate the migration inventory from resolved profile policy rather than asserting the whole fixture corpus is Explicit.

## LLP 0319

**MATERIAL — §§2–6: most query flavors are not a simple cross-product, and the two “domain recipes” cannot be ordinary `defineQuery` recipes.**

The exported `*_SPEC_FIELDS` constants cover only generic query/JS-query/mutation/action forms ([define.mjs:118](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:118)). Search, live search, and vector queries already have separate closed field sets, fixed platform argument schemas, visibility rules, capability requirements, and distinct normalized plans ([define.mjs:2654](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:2654), [define.mjs:2679](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:2679)). Graph, relational, bounded-child, and snapshot forms likewise carry genuinely different plan/result semantics.

`defineJobStatusQuery` and `definePushLedgerQuery` are not conveniences over ordinary `defineQuery`: they emit `jobStatusPlan` and `pushLedgerPlan` with platform-fixed arguments and privacy behavior, whereas ordinary `defineQuery` emits an application-table `plan` ([define.mjs:3276](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:3276), [define.mjs:3317](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:3317), [define.mjs:3339](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:3339)).

Suggested fix: specify an explicit tagged-variant normalization table showing each variant’s fields, normalized plan, runtime owner, result contract, and illegal combinations. Retain genuine domain/platform concepts as named helpers or platform-owned variants. Recast the work as a facade over separate validators, not a mechanical merge suggested by five generic constants.

**minor — §7: a wrong live/one-shot choice does not silently become non-live.**

Subscribing to an ordinary query returns `SNAPBACK_FUNCTION_NOT_LIVE`; the guide says Snapback never silently turns it into polling ([queries.md:447](/Users/ccheever/projects/snapback/guide/backend/queries.md:447)).

Suggested fix: say the wrong constructor produces a late but explicit refusal.

## LLP 0320

**MATERIAL — §§2–4: syntactic lifting is not enough to preserve mutation isolation or authorization semantics.**

JavaScript mutation handlers capture actual row, predicate, and authorization dependencies across the read-to-commit window and validate them at commit. HostPlan mutations are unconditional sequences executed inside the commit transaction; their stale baseline is client-supplied ([LLP 0003:307](/Users/ccheever/projects/snapback/llp/0003-local-storage-and-execution.rfc.md:307), [LLP 0003:368](/Users/ccheever/projects/snapback/llp/0003-local-storage-and-execution.rfc.md:368), [LLP 0004:309](/Users/ccheever/projects/snapback/llp/0004-application-data-api.rfc.md:309)). Translating read-then-write JavaScript into a HostPlan can therefore change race outcomes and conflict behavior even if the operations look equivalent.

Authorization is also plan-class-specific: general JS lacks result provenance, and only restricted plan classes admit structural analysis ([LLP 0170:50](/Users/ccheever/projects/snapback/llp/0170-authorization-obligation-feasibility.research.md:50), [LLP 0170:96](/Users/ccheever/projects/snapback/llp/0170-authorization-obligation-feasibility.research.md:96)). A provenance receipt proves who produced a plan, not that result/policy semantics survived translation.

Suggested fix: define lift admission in terms of concurrency, result-provenance, authorization, and diagnostic equivalence—not syntax alone. Require race tests and exact schema-policy re-derivation per admitted plan class. Remove the claim that no engine-semantic question exists.

**MATERIAL — §2 and OQ2: the performance prior art is misstated.**

Warm VM removed creation cost; it did not establish that the native-plan versus handler gap was closed. LLP 0035 records a remaining warm invocation floor of roughly 800–900 μs and 1.55–2 ms historical live re-query costs ([LLP 0035:159](/Users/ccheever/projects/snapback/llp/0035-local-target-benchmarks.research.md:159)). More importantly, the old fan-out fixtures were later declared unsound and no corrected full-scale rerun exists ([LLP 0035:54](/Users/ccheever/projects/snapback/llp/0035-local-target-benchmarks.research.md:54)). Protected live queries now deliberately use fresh realms ([LLP 0035:78](/Users/ccheever/projects/snapback/llp/0035-local-target-benchmarks.research.md:78)).

Suggested fix: state that current native-versus-handler cost is unknown. Make a corrected, protected-profile measurement a decision gate before treating performance as a weakened HostPlan justification.

**MATERIAL — §§3–5: “a false negative costs a VM invocation” is true only for handlers that were already JS.**

For an existing declarative function rewritten as JS, failure to lift loses more than performance:

- Declarative single-table live queries are the only public cold-retention class; JS handlers are ineligible ([offline-and-retention.md:43](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:43)).
- Generated declarative mutation-plan presence is the replayability predicate and drives the local optimistic operation ([offline-and-retention.md:832](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:832), [offline-and-retention.md:1071](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:1071)).
- Failed lifting also loses static read/write checking, native execution, delta candidacy, and structured authorization evidence.

OQ1 measures only existing `defineJs*` handlers; it does not test whether every existing authored plan can round-trip through JS and relift without losing guarantees.

Suggested fix: separate the “bonus optimization for existing JS” cohort from the mandatory declarative-migration cohort. Require 100% semantic relift for the latter or retain authored declarative sugar/escape hatches.

**MATERIAL — §2 and OQ3: the `live_delta` prior-art statement omits the load-bearing eligibility restriction.**

LLP 0008 does not admit any single-table HostPlan merely because changes exist. `compute_live_delta` must prove exact classification; ordered/limited windows, unanalyzable predicates, and other cases fall back to replace ([LLP 0008:302](/Users/ccheever/projects/snapback/llp/0008-realtime-and-ephemeral.spec.md:302)). LLP 0209 further requires conservative per-node admission and excludes membership until proven ([LLP 0209:2726](/Users/ccheever/projects/snapback/llp/0209-live-query-graphs.spec.md:2726)).

Suggested fix: quote the exact eligibility predicate and require lifted plans to pass the same matcher/SQL agreement and convergence gates. “Produces a HostPlan” alone is insufficient.

## LLP 0321

**MATERIAL — §§1–2: the quantitative baseline is wrong and the proposed custody architecture already exists.**

The ignored materialized directory currently contains 38 files totaling 150,032 logical bytes. “260 KB” is allocated disk usage from `du`, not content bytes; “22 files” counts the directory itself plus top-level entries, not files. `contract/` contains 13 files, not 12, and the backend has six operations, not five—the committed manifest records six at [artifacts.json:743](/Users/ccheever/projects/snapback/demos/todo/snapback/generated/artifacts.json:743).

More importantly, the authoritative manifest already records three custody classes—nine `consumer-committed`, 41 `regenerable-cache`, and one `review-manifest` ([artifacts.json:65](/Users/ccheever/projects/snapback/demos/todo/snapback/generated/artifacts.json:65)). The guide already specifies one digest-bound graph, a hash-addressed hidden cache, and atomic `generated/` materialization ([generated-artifacts.md:18](/Users/ccheever/projects/snapback/guide/getting-started/generated-artifacts.md:18), [generated-artifacts.md:116](/Users/ccheever/projects/snapback/guide/getting-started/generated-artifacts.md:116)). Most generated projections are already absent from diffs under [.gitignore:16](/Users/ccheever/projects/snapback/.gitignore:16).

Suggested fix: rewrite the RFC as a materialization/committed-ledger location change over the existing custody model. Recalculate inventory and logical bytes from `artifacts.json`, not the ignored projection tree.

**MATERIAL — §2 and OQ3: the import-only and determinism-only placement rules break current consumers.**

Application source imports much more than `api.mjs` and `api.d.ts`:

- The todo Contract surface imports artifact, schema, function, contract-data, and runtime-link projections ([main.ts:7](/Users/ccheever/projects/snapback/demos/todo/surfaces/contract/main.ts:7)); Contract source imports generated operation modules ([todo.contract:18](/Users/ccheever/projects/snapback/demos/todo/surfaces/contract/todo.contract:18)).
- Familiar first-generation bootstrap requires `generated/server.{mjs,d.ts}` before definition evaluation ([LLP 0253:305](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:305), [LLP 0253:352](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:352)). Those files are missing from 0321’s application tier even though 0321 wants to follow/fold into 0318.
- Rust compilation uses `include_bytes!` on schema and function manifests before a runtime resolver can regenerate them ([embedded_todo.rs:6](/Users/ccheever/projects/snapback/crates/snapback/examples/embedded_todo.rs:6)).
- Hosted release packaging requires both manifest paths ([pack-hosted-release.mjs:78](/Users/ccheever/projects/snapback/scripts/pack-hosted-release.mjs:78)).

Deterministic derivability does not imply that a source-only or compile-time consumer can omit the artifact.

Suggested fix: retain the existing consumer/bootstrap-based custody rule. Inventory Contract, Familiar bootstrap, Rust compilation, Vite, deployment, release packaging, CLI, and CI before changing any projection’s custody.

**MATERIAL — §2 rule 4 and §6: the promised “three-file backend” does not result from this RFC.**

Moving generated output does not remove `handlers.mjs`, `codegen.policy.json`, or `visibility-override-owners.json`. LLP 0318 retains Explicit compatibility, and Familiar allows arbitrary top-level function modules rather than guaranteeing one `functions` file ([LLP 0253:257](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:257)).

Suggested fix: replace the three-file outcome with the narrower claim that generated materialization and governance projections become visually separated. If exactly three authored files is a product requirement, make it a separate authoring-layout decision and account for policy/governance source.

**minor — OQ5: the sequencing rationale is unsupported.**

Both profiles already emit one graph into `generated/` ([LLP 0253:315](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:315)). Splitting before 0318 does not inherently mean implementing the output split twice.

Suggested fix: make 0321 independent of profile convergence except for the exact profile-specific leaf inventory.

## LLP 0323

**MATERIAL — §§2–3: shrinking the default root and preserving every published identity are mutually exclusive.**

Published identities are module-qualified. For example, the tracked identity is `npm:@expo/snapback-react#useSnapbackAssetUpload` ([published-symbols.json:4126](/Users/ccheever/projects/snapback/guide/reference/published-symbols.json:4126)). Moving it only to `/assets` removes that identity and creates another. A root re-export shim preserves the identity but leaves the root surface flat.

The RFC also omits implemented prior art: React already exports `/core`, `/familiar`, and `/thumbhash` ([package.json:32](/Users/ccheever/projects/snapback/packages/snapback-react/package.json:32)); root is deliberately the Full compatibility composition while `/core` is narrow ([index.mjs:38](/Users/ccheever/projects/snapback/packages/snapback-react/index.mjs:38)). LLP 0145 records that decision and measured roughly 44–46% bundle reductions from `/core` ([LLP 0145:1502](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1502)).

Suggested fix: choose explicitly:

- Keep Full at root and steer templates/reference navigation toward the existing `/core`; or
- supersede the Full-root decision and treat moved root identities as removals requiring lifecycle/deprecation or a major-version migration.

Stop claiming both a small root and zero removed exports.

**MATERIAL — §2 rule 2: published-but-unreferenced `/internal` contradicts LLP 0194.**

LLP 0194 makes the registry complete and requires every public runtime export to have a registry entry ([LLP 0194:104](/Users/ccheever/projects/snapback/llp/0194-generated-api-reference.rfc.md:104)). Publishing `/internal` while excluding it from the published reference either violates that parity gate or leaves “reference” ambiguously meaning only the navigation projection.

Suggested fix: keep `/internal` unpublished, or include it in the registry with an explicit unstable tier and exclude it only from default navigation. If public-but-unregistered is intended, explicitly amend LLP 0194 and its parity acceptance rule.

**MATERIAL — §2 rule 3: the claimed ~1 MB corpus reduction does not follow.**

The reference already opens on an 11,171-byte index with exact lookup and drill-down across 56 module pages ([reference index:18](/Users/ccheever/projects/snapback/guide/reference/index.md:18)). The 501,468-byte file is the broad client root module page, not the first reference page.

Redistributing every capability into tier pages does not remove its documentation. The broad root page shrinks only if old root identities disappear or are omitted from the complete reference—contradicting §§2–3 and LLP 0194. LLP 0314.001 explicitly delegated reduction to 0323 on the premise of “fewer published symbols,” while 0323 promises all identities remain reachable ([LLP 0314.001:90](/Users/ccheever/projects/snapback/llp/0314.001-derived-guide-bytes.rfc.md:90)).

Suggested fix: remove the byte claim until the exact partition is generated and measured. Reconcile the documents around either navigation-only tiering with little total corpus reduction, or actual identity/reference removal with its compatibility cost.

**MATERIAL — §2 rule 1: mutable templates and benchmark fixtures cannot mechanically define a stability tier.**

Routine edits to a template would promote or demote public contracts. Acceptance harness imports would also become Core unless the rule distinguishes app-runtime code from test seams.

The proposed eight-name sketch is not the result of its own rule. The current React template imports `useSnapbackAuth`, `useSnapbackConnection`, `useSnapbackCurrentPrincipal`, `useSnapbackMutation`, and `useSnapbackQueries` ([App.tsx:1](/Users/ccheever/projects/snapback/packages/snapback-cli/templates/react/src/App.tsx:1)); acceptance imports `createSnapbackReactProvider`, `invokeSnapbackMutation`, and `observeSnapbackQueries` ([acceptance.mjs:10](/Users/ccheever/projects/snapback/packages/snapback-cli/templates/react/acceptance.mjs:10)). Conversely, proposed names such as `usePresence`, `useUpload`, and `useConnection` are not current exports.

Suggested fix: define Core in a lifecycle-governed semantic manifest. Treat runtime template imports as coverage assertions, exclude test/harness seams, and require an explicit compatibility decision before demoting a symbol.

**minor — §1: several inventory counts mix closures and categories.**

The 4,248-symbol baseline is publication 0.1.25, while the current registry describes 0.1.27 ([published-symbols.json:1](/Users/ccheever/projects/snapback/guide/reference/published-symbols.json:1), [registry.json:4](/Users/ccheever/projects/snapback/guide/reference/registry.json:4)). Current registry identities including members total 4,464. The client package has 116 physical `files` entries but roughly 43 API module subpaths, so “roughly forty published files” conflates them. React has 30 distinct public hook names across root and `/familiar`, not 28; the list includes non-public `useSnapbackProviderClient` and omits `useAuth`, `useCurrentPrincipal`, and `useQueryState`. `define.mjs` has 12 exported names matching `is*Def`—13 including `isSurfaceBinding`—not roughly 20.

Suggested fix: regenerate the inventory from one current publication closure and distinguish physical files, export subpaths, exported symbols, and member identities.

## Cross-document contradictions

These concerns count against every named target.

**MATERIAL — LLP 0318 §2 versus LLP 0319 §3: the selected surviving APIs are incompatible.**

0318 selects Familiar `query`/`mutation`/`action` with inline handlers and specifically removes `source`/`exportName` indirection ([LLP 0318:118](/Users/ccheever/projects/snapback/llp/0318-one-authoring-profile.rfc.md:118), [LLP 0318:127](/Users/ccheever/projects/snapback/llp/0318-one-authoring-profile.rfc.md:127)). 0319 instead selects public `defineQuery`/`defineMutation` and says absence of `source` means declarative plan ([LLP 0319:80](/Users/ccheever/projects/snapback/llp/0319-one-query-constructor.rfc.md:80), [LLP 0319:93](/Users/ccheever/projects/snapback/llp/0319-one-query-constructor.rfc.md:93)).

Current inline JS queries may have `handler` and no `source`; legacy module handlers require both `source` and `exportName` ([define.mjs:4850](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:4850)). Familiar requires inline `handler` and has no `source` ([LLP 0253:371](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:371)). Under 0319’s rule, 0318’s surviving handler form is classified as a plan.

Suggested fix: choose one final public spelling. Use an explicit tagged implementation union or `handler` presence to select JS; retain `source` plus `exportName` only for legacy Explicit compatibility.

**MATERIAL — LLP 0318 §§2–3 versus LLP 0320 §3: authored-plan preservation and authored-plan removal are mutually exclusive decisions.**

0318 says mutation plans and the analyzable HostPlan vocabulary must survive with a Familiar-authored spelling, and says the RFC should be withdrawn if they cannot ([LLP 0318:149](/Users/ccheever/projects/snapback/llp/0318-one-authoring-profile.rfc.md:149)). 0320 makes JavaScript the only body surface, removes public IR constructors, and makes plan properties conditional on successful lifting ([LLP 0320:114](/Users/ccheever/projects/snapback/llp/0320-plan-ir-as-compiler-output.rfc.md:114), [LLP 0320:129](/Users/ccheever/projects/snapback/llp/0320-plan-ir-as-compiler-output.rfc.md:129)).

Suggested fix: declare the proposals alternatives, or adopt 0320’s narrower fallback that retains declarative query/mutation sugar. If compiler-only plans win, amend 0318’s preservation condition and acknowledge that formerly guaranteed plan-only capabilities become conditional on lift admission.

```text
LLP 0318: NOT READY (7 MATERIAL)
LLP 0319: NOT READY (2 MATERIAL)
LLP 0320: NOT READY (5 MATERIAL)
LLP 0321: NOT READY (3 MATERIAL)
LLP 0323: NOT READY (4 MATERIAL)
SET: NOT READY
```
