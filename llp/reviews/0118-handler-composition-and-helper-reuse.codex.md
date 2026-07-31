# LLP 0118 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind
**Target SHA-256:** `3e1e2ce6951490156dafca4ae8bf6034a6f70c78762b6dc8bb806b0aff625d97`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## Verbatim review

## 1. Overall assessment

This is a strong, unusually well-evidenced research document. Its diary reconstruction is accurate, its description of inline-handler extraction and identity is mostly code-faithful, and it maintains good decision hygiene by leaving the normative choice to LLP 0108’s follow-on.

It does not yet meet the stated READY bar. Two pre-empirical gaps remain load-bearing:

- The option space omits same-file lexical helper closure, a materially narrower design than either full module bundling or declared helper cells.
- The analysis conflates dependency admission/resolution policy with bundler implementation, causing it to dismiss controlled stock-bundler and hermetically pinned package-graph variants without actually evaluating them.

Those omissions could change both the mechanism ranking and the claimed necessity of a large v2 module-graph design.

## 2. Strengths

- **The field evidence is accurately and cautiously presented.** The Streak Lab duplication and measurements match [Diary 0032](</Users/ccheever/projects/snapback/diaries/0032-streak-lab-main-rerun.diary.md:100>); the Relay Board helper pressure and confounding result-contract verbosity match [Diary 0033](</Users/ccheever/projects/snapback/diaries/0033-relay-board-main-rerun.diary.md:41>) and its explicit duplicated indexed reads at [line 193](</Users/ccheever/projects/snapback/diaries/0033-relay-board-main-rerun.diary.md:193>). The aggregate 2,196-versus-2,176 comparison also matches [Diary 0039](</Users/ccheever/projects/snapback/diaries/0039-snapback-convex-main-rerun-report.diary.md:191>). Section “How they differ” correctly avoids treating all line growth as helper-duplication evidence.

- **The current inline-handler contract is reconstructed accurately.** The closed global set and free-identifier refusal are visible in [inline-handlers.mjs](</Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:15>) and [line 318](</Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:318>); marker hashing and replacement match [lines 507–531](</Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:507>); and one generated registry entry per operation matches [line 544](</Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:544>).

- **The v1 identity consequence is correctly identified.** Current identity contains `{form: "inline", canonicalAst}` and no dependency graph in [index.mjs](</Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:4156>). Treating shared executable dependencies as a new identity-format design rather than a trivial extractor relaxation is sound.

- **The runtime-backstop account is code-supported.** Runtime construction uses `ex_hermes_create_no_eval()` at [runtime.rs](</Users/ccheever/projects/snapback/src/runtime.rs:607>), while the dynamic-code probes cover the named constructor routes before application evaluation at [lines 3004–3021](</Users/ccheever/projects/snapback/src/runtime.rs:3004>).

- **The historical reconstruction is valuable.** The document correctly distinguishes the legacy closed single-file handler profile from Convex-style open imports. LLP 0010 explicitly says handler imports were rejected before emission at [LLP 0010](</Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:398>).

- **Empirical and decision hygiene are generally good.** The document labels the Convex overview as general background, labels diary observations separately, records confounding factors, and turns the group-bundle versus resolve-and-splice question into an explicit follow-on decision rather than pretending research settled it.

## 3. Concerns

### 3.1 BLOCKING-FOR-BAR — A narrower same-file lexical-helper option is missing

**Gap.** The option space jumps from full bounded transitive ESM bundling to proprietary declared helper cells. It does not evaluate admitting statically reachable sibling functions and constants from the same `functions.mjs` source file, without following any import graph.

This is not a cosmetic variant:

- It uses ordinary TypeScript function declarations rather than `defineHelper`.
- It restores the exact one-file sharing unit the historical analysis identifies.
- It avoids filesystem/module-resolution semantics and third-party dependencies.
- It can potentially retain per-operation reachability, emission, and invalidation.
- It directly addresses both diary cases if the calendar and indexed-read helpers are colocated with their operations.
- The superseded design itself explicitly admitted “lexical constants, local helper functions” separately from imports in [LLP 0108](</Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:119>).

The target’s own history—one file per app becoming one expression per operation—makes this omission especially conspicuous at [LLP 0118](</Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:166>).

**What resolves it.** Add a distinct option for bounded same-module lexical closure. Analyze static reachability, declaration order/cycles, top-level initializer rules, type flow, source spans, per-operation versus group identity, and adversarial laundering. State whether it meets CV-7’s exit criterion and why it should lead, complement, or lose to options 1 and 2.

### 3.2 BLOCKING-FOR-BAR — Resolver policy and bundler implementation are conflated

**Gap.** Option 3 argues that using a stock bundler necessarily delegates resolution and yields only post-hoc attestation. That is not exhaustive. A Snapback-owned resolver/admission policy can feed an existing bundler or constrain it through resolver/load plugins, with every admitted input recorded before output acceptance.

Current definition evaluation already demonstrates exactly this hybrid shape: it invokes esbuild at [index.mjs](</Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7031>) while Snapback controls dynamic-import, CommonJS, ambient, and bare-specifier refusal through a plugin at [lines 7066–7134](</Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7066>). Therefore “stock bundler” and “Snapback-owned admission” are not mutually exclusive options.

The document’s description of the definitions resolver as “literal-relative” is also too strong. The implementation accepts relative, `file:`, and absolute local specifiers at [lines 7095–7107](</Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7095>) and can assign identities to app, toolchain, repository, and installed-package files at [lines 7496–7522](</Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7496>). It is closed and attested, but it is not merely literal-relative-from-app-root.

**What resolves it.** Recast the taxonomy along independent axes:

- admission/resolution policy;
- allowed source roots and dependency classes;
- bundler/transform implementation;
- identity inputs and toolchain-version pinning;
- runtime emission shape.

Then evaluate “Snapback-controlled graph plus pinned stock transform” as an implementation variant of bounded bundling rather than dismissing it as inherently post-hoc. Correct the factual description of the shipped definitions graph.

### 3.3 MATERIAL — Hermetic package dependencies are excluded by assumption, not analysis

**Gap.** Option 4 equates package imports with ambient, machine-dependent `node_modules`, then says deterministic regeneration and the supply-chain boundary are structurally discarded at [LLP 0118](</Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:299>). That describes one open-import design, but not the whole space.

A distinct design could admit only lockfile-resolved, integrity-verified, size-bounded ESM package closures; record package, export-condition, file, and toolchain identities; and still refuse undeclared ambient checkout state. Whether that complexity is worthwhile is open, but it cannot be ruled out by the stated argument. It matters because third-party date/decimal helpers are option 4’s principal advertised benefit.

**What resolves it.** Add a hermetic-package-closure variant, or explicitly bound it out with a governing constraint from LLP 0115/0108. Compare its reviewability, conditional-export semantics, lockfile custody, package-manager dependence, source-map precision, and supply-chain evidence with vendoring and app-relative imports.

### 3.4 MATERIAL — Pure helpers and capability-bearing helpers are not separated

**Gap.** The two diary examples exercise different semantic classes:

- Streak Lab’s calendar logic is pure value transformation.
- Relay Board’s shared indexed reader accepts runtime context and performs declared storage reads.

Options 1 and 2 discuss syntax, graph identity, and reflection laundering, but not whether a reusable helper may receive `ctx`, perform reads, cross query/mutation/action kinds, or exercise ambient action capabilities. This matters to no-evidence-regression: Snapback must continue deriving authority from operation declarations, not from helper behavior. A helper reused by operations with different read sets or runtime classes has a different risk profile from a pure calendar helper.

Option 7 recognizes a pure-helper category, but that distinction is not propagated through the main mechanisms.

**What resolves it.** Add a semantic matrix covering at least pure/value helpers, `ctx.db` read helpers, mutation helpers, and action/egress helpers. Explain whether v1 sharing is pure-only, caller-ceiling-bound, kind-specific, or fully general, and how declarations and diagnostics prove that a helper cannot expand authority.

### 3.5 MATERIAL — Several pre-empirical hypotheses are stated as findings

**Gap.**

- “Helper pressure grows with app size, so the measured gap is a floor” at [LLP 0118](</Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:183>) is plausible but not established by the seven small apps.
- Duplicate-subtree tooling is called “small and immediately landable” at [line 328](</Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:328>), although “near-identical” detection, false-positive policy, renamed locals, and copy provenance are nontrivial.
- The findings say divergence is a silent bug “no diagnostic can see” at [line 415](</Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:415>), while option 5 proposes heuristic diagnostics intended to see it.

**What resolves it.** Reclassify these as named empirical questions: helper-reuse frequency versus app size; usefulness and false-positive rate of exact/near-duplicate detection; implementation effort; and whether drift diagnostics change author behavior. Narrow the absolute diagnostic claim to “the current identity model records no intended equivalence.”

### 3.6 DETAIL — One current-main statement is stale

**Gap.** Finding 9 says the Relay Board attribution “should ride [LLP 0115’s] next revision” at [LLP 0118](</Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:434>). Current LLP 0115 v0.4 already records that correction in its revision history at [LLP 0115](</Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:8>) and in CV-7 at [line 408](</Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:408>).

**What resolves it.** Say LLP 0115 is corrected and only LLP 0108 still carries the Campfire misattribution.

### 3.7 DETAIL — A few Convex/package claims need clearer provenance labels

**Gap.** The top-level Convex mechanism is appropriately labeled general background, but later claims about arbitrary third-party pure libraries and what “Convex-trained agents” will do are presented inside option analysis without being included clearly in the diary-evidenced or general-background inventory. The diaries prove ordinary shared helpers, not the behavior or suitability of arbitrary package dependencies.

**What resolves it.** Mark those statements as general background/hypothesis, or narrow them to what the diaries observed. If third-party package support becomes load-bearing to an option, re-verify it against current primary Convex documentation in the follow-on.

## 4. Suggestions

- Add a compact comparison table with rows for same-file lexical closure, bounded relative imports, declared helper cells, hermetic package closure, open ambient imports, duplication tooling, and stdlib. Useful columns would be authoring familiarity, pure/effectful support, graph scope, identity blast radius, type flow, source-span quality, supply-chain evidence, and implementation size.

- Refine “a reviewer reading the authored declaration sees everything that executes” at [LLP 0118](</Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:144>). That is true of self-contained v1, but imported bounded graphs require the reviewer to follow an enumerated dependency graph. The durable invariant is complete, bounded, inspectable custody—not necessarily single-declaration visibility.

- Separate two independent choices currently grouped under “group-bundle or resolve-and-splice”: dependency admission shape and runtime emission/pool shape. The same admitted graph could support several emission strategies.

- Preserve the distinction between authored duplication and generated duplication; it is one of the document’s best analytical observations and deserves an explicit comparison dimension.

## 5. Open questions

1. Can same-file lexical reachability satisfy both known diary cases while retaining one emitted module and implementation identity per operation?

2. Does CV-7 actually require cross-file imports, or only a helper written once? Its stated exit criterion requires the latter.

3. Which helper classes are in scope for the first follow-on: pure functions, `ctx.db` readers, mutations, and/or action helpers?

4. If helper code receives `ctx`, how is its effective authority bounded by each consuming operation’s declared reads, writes, effects, and runtime kind?

5. Is a controlled esbuild transform under Snapback-owned resolution materially different from the already shipped definitions-side pattern, beyond the stronger handler initializer and capability rules?

6. Should hermetically pinned third-party ESM dependencies be evaluated now, explicitly deferred, or permanently excluded as a product boundary?

7. For resolve-and-splice, is implementation identity based on reachable source graph, transformed helper ASTs, or final emitted bytes—and what source-level evidence permits a reviewer to reproduce that derivation?

## 6. Verdict

**NOT READY.**

The document is close in evidence quality and substantially correct about current inline v1, but it has not exhausted the pre-empirical option space. Same-file lexical closure, controlled-bundler implementation, hermetic package closure, and the pure-versus-capability-bearing helper distinction could materially change the follow-on design.

## 7. Recommended next step

Revise LLP 0118 while keeping it in Review:

1. Add the same-file lexical-helper option.
2. Rebuild the option taxonomy around admission, transformation, identity, and runtime emission as separate axes.
3. Evaluate or explicitly defer hermetic package closures.
4. Analyze pure and context-bearing helpers separately.
5. Convert the untested scaling/tooling claims into empirical questions.
6. Correct the definitions-resolver description and stale LLP 0115 attribution.
7. Send the revision through another independent review round.

Final verdict: **NOT READY**.


## Round 2 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, round-2 delta, cross-family blind
**Target SHA-256:** `3d2ad2b7d7153eb90115d33508454bbe3adf0835101dc1aecf465365a4092e4e`
**Instruction SHA-256:** `33c3fd21fcc61f4ed59da1207ef188e75a1328149be03f08f57ca9141b06f7ce`
**Status:** completed

### Verbatim review

I could not append the Round 2 artifact because this workspace is read-only. Reviewed target SHA-256: `3d2ad2b7…4092e4e`; instruction SHA-256: `33c3fd21…6f7ce`.

## Resolution check

- **3.1 Same-file lexical closure — Resolved.** Option 1a addresses reachability, cycles/TDZ, initializer rules, type flow, source spans, identity, laundering, and CV-7. Both motivating cases are verified as same-file.
- **3.2 Resolver/bundler conflation — Resolved.** The revised description matches the esbuild-hosted, fail-closed resolver at [index.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6974), including relative, `file:`, absolute-local, and two allowlisted bare specifiers.
- **3.3 Hermetic packages — Resolved.** The lockfile-pinned variant is now analyzed without being prematurely selected or dismissed.
- **3.4 Pure versus capability-bearing helpers — Partially resolved.** The axis and relevant helper classes are present, but its proposed safety model contains a load-bearing error described below.
- **3.5 Hypotheses stated as findings — Resolved.** Scaling, diagnostic effort, and drift-detection claims are appropriately narrowed or labeled empirical.
- **3.6 Stale LLP 0115 attribution — Resolved.** The text correctly says LLP 0115 is fixed and LLP 0108 remains stale.
- **3.7 Convex/package provenance — Resolved.** Package demand and agent-behavior claims are explicitly labeled as background or hypotheses.

## New concerns

**BLOCKING-FOR-BAR — The helper authority analysis assumes protections that do not exist.**

At [LLP 0118 line 295](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:295), “pure-only” is defined as admitting no `ctx` parameter. That is not capability closure: `helper(ctx.db)`, `helper(ctx.db.query.bind(ctx.db))`, or another alias passes capability-bearing values without a parameter named `ctx`.

More importantly, the claimed caller-ceiling rule says helper accesses are checked against each consumer’s declared reads/writes “exactly as inline code is today.” The tree contradicts that:

- Opaque JS/Ibex ceilings merely restate declarations and explicitly claim no static proof in [effect-ceiling.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/effect-ceiling.mjs:235).
- Runtime ceiling validation returns without checking Ibex modules in [manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:2114).
- The host dispatcher accepts the handler-supplied query plan and enforces runtime-kind restrictions, but does not compare its table against the operation’s declared table set in [runtime.rs](/Users/ccheever/projects/snapback/src/runtime.rs:1149).

Thus table-level caller-ceiling enforcement would be a new mechanism, not preservation of today’s behavior.

**DETAIL — Package integrity is imprecisely equated with per-edge attestation.**

Lockfile integrity normally authenticates a package artifact, not each source import edge. Because the proposed variant also records the resolved graph and per-file digests, the broader conclusion survives; the parenthetical “integrity hashes are exactly that” should distinguish package-artifact integrity from resolved-edge/file attestation.

## Verdict

**NOT READY.**

The revision closes six concerns and substantially advances the seventh, but the remaining defect is on the load-bearing authority boundary.

## Recommended next step

Revise only the helper-class analysis:

1. Define purity by capability flow, not parameter naming.
2. Describe current enforcement accurately: runtime-kind capabilities plus declared-but-unproven read/write evidence for opaque handlers.
3. Cost table-level caller ceilings as new enforcement if desired.
4. Spell out mutation and action/egress helpers, including aliased capability arguments and declared grants/`uses`.

Then run a focused Round 3 delta review.


## Round 3 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, round-3 narrow delta (round-2 BLOCKING + DETAIL resolution check against the v0.3 fix pass, changed text only), cross-family blind
**Target SHA-256:** `925535603827afcc6510bcdd03be7c0448cb1189053a2f0e5fb72b1f69044c35`
**Instruction SHA-256:** `33c3fd21fcc61f4ed59da1207ef188e75a1328149be03f08f57ca9141b06f7ce`
**Status:** completed

### Verbatim review

## Per-item resolution check

- **Round-2 BLOCKING — Partially resolved.** The revision correctly rejects signature-based purity, includes the requested alias counterexamples, accurately describes current kind/`uses` enforcement, and correctly costs table-level caller ceilings as a **new mechanism**. However, the proposed capability-flow analysis still assumes an incomplete root set.
- **Round-2 DETAIL — Resolved.** The hermetic-package analysis now correctly distinguishes lockfile package-artifact integrity from resolved-graph/per-file attestation at [LLP 0118:638](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:638).

## New concern in the v0.3 delta

**BLOCKING-FOR-BAR — “Flow-pure” considers only context-derived capability roots, so it does not prove purity across action consumers.**

The revised axis says capabilities enter only through `ctx` and therefore proposes tainting only context-derived values at [LLP 0118:334](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:334). That is sufficient for the storage/config authority problem raised in Round 2, but not for the stronger “pure value transformation—no effects” class the document claims.

`Date` and `Math` are admitted globals, while `Date.now` and `Math.random` are denied only for the deterministic tier. Actions intentionally retain an ambient-powered, nondeterministic surface at [runtime.rs:2966](/Users/ccheever/projects/snapback/src/runtime.rs:2966). Consequently, a shared helper using `Date.now()` or `Math.random()` passes the described no-context-flow gate yet is not pure. The statement that the closed graph makes the taint roots complete is therefore too broad.

Resolve by either:

- defining the lane narrowly as **context-capability-free**, without claiming semantic purity; or
- adding runtime-profile-dependent ambient capability/effect roots to the analysis and explaining how action consumers are classified.

No other fresh defects found in the v0.3 delta.

## Verdict

**NOT READY.**

## Recommended next step

Make the narrow purity-root correction above, propagate it to Finding 11/open question 7 if needed, then run a focused Round 4 delta check.

## Round 4 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, round-4 focused delta (round-3 BLOCKING-FOR-BAR ambient-nondeterminism item resolution check against the v0.4 micro-fix, changed text only), cross-family blind
**Target SHA-256:** `4cef15838dd91c5bda7aa46b3fb4eb578582b0a270c9adc302471a9f3c3e63ea`
**Instruction SHA-256:** `e1a125a4878b8fd20e8ad809313d8faa7d4d2c3270887c0aaa80068367712a28`
**Status:** completed

### Verbatim review

## Resolution check

**Partially resolved.** The lane is correctly renamed **context-capability-free**, and the runtime-profile distinction matches the tree:

- `Date` and `Math` are admitted globals.
- Codegen rejects direct `Date.now()`, `Math.random()`, and `new Date(...)`, while aliases reach runtime.
- Queries/mutations deny ambient time and entropy; actions retain them.

## New v0.4 concerns

- **BLOCKING-FOR-BAR:** The new text still overclaims semantic purity. [LLP 0118:386](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:386) and especially [LLP 0118:443](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:443) imply that context-capability freedom becomes “pure in effect” for deterministic consumers. Denying ambient clock/entropy is necessary but insufficient: such a helper can still mutate arguments, captured state, or module state and therefore need not be a pure value transformation. Semantic purity requires a separate effect analysis, not merely a deterministic runtime profile.

- **DETAIL:** The delta omits direct `Date()` calls. Codegen does not reject that spelling, while the deterministic runtime explicitly denies both `Date()` and zero-argument `new Date()` at [runtime.rs:2895](/Users/ccheever/projects/snapback/src/runtime.rs:2895). Actions retain both.

## Verdict

**NOT READY.**

## Recommended next step

Claim only **context-capability freedom** plus the narrower fact that deterministic consumers deny ambient clock/entropy. State that semantic purity additionally requires an effect analysis, and add `Date()` to the ambient-clock accounting. Then run a focused round-5 delta check.

## Round 5 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, round-5 focused delta (resolution check of the round-4 BLOCKING semantic-purity-overclaim item and DETAIL bare-`Date()` accounting item against the v0.5 micro-fix, v0.5-changed text only), cross-family blind
**Target SHA-256:** `a9a883ac8d020578e8fe18d7dc50b4b643ad84e6923769d474a616028774f15d`
**Instruction SHA-256:** `e1fa54c763a85429ff98543f15b42eff1c2190d3f49a7a054911d4e133060084`
**Status:** completed

### Verbatim review

## Resolution check

1. **BLOCKING — semantic-purity overclaim: Resolved.**  
   The v0.5 text consistently distinguishes:

   - statically provable context-capability-freedom;
   - deterministic-tier runtime denial of ambient nondeterminism; and
   - separate side-effect-freedom requiring effect analysis before any purity label.

   Finding 11, OQ7, the helper-class restatement, and Confidence preserve that distinction.

2. **DETAIL — bare `Date()` accounting: Resolved.**  
   The text matches the tree: codegen rejects direct `Math.random()`, `Date.now()`, and any-arity `new Date(...)`; bare `Date()` and aliases reach the runtime boundary. `DATE_CONSTRUCTOR_DENY_SOURCE` denies any-arity `Date()` calls and zero-argument construction in deterministic consumers, while actions retain the ambient surface.

**New concerns:** None in the v0.5-changed text.

**Verdict: READY.**

**Recommended next step:** Record this focused round-5 resolution, then proceed to the author’s acceptance/status decision under LLP 0005.
