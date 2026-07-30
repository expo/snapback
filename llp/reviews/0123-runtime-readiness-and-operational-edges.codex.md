# LLP 0123 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind
**Target SHA-256:** `b5cde08b1a1a33551c5f2d6f2bfde7624b824b88c134938cc6efa793730213e5`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## Verbatim review

## 1. Overall assessment

LLP 0123 has a strong, well-evidenced incident reconstruction and correctly identifies the central readiness gap: linkability, launchability, and source identity do not establish that the real handler VM can be created.

It is not yet at the stated READY bar. The principal gaps are:

- a factual overstatement about live-query execution;
- an omitted, materially distinct dynamic-linking option already present in vendored Ibex;
- unsupported claims that packaged distribution or static linking make all relevant incoherence unrepresentable;
- insufficient preservation analysis for LLP 0115’s no-evidence-regression constraint;
- a substantially understated account of Hermes captivity and engine-replacement scope.

These are pre-empirical analysis gaps, not requests for implementation evidence.

## 2. Strengths

- The incident chain is reconstructed accurately and concretely. The target correctly distinguishes the existing smoke from actual VM creation ([LLP 0123 §Summary](/Users/ccheever/projects/snapback/llp/0123-runtime-readiness-and-operational-edges.research.md:26)). The issue confirms that the smoke ends at `build-identity` and that `RuntimeGuard::create()` is first exercised per invocation ([issue](/Users/ccheever/projects/snapback/issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md:70)); the implementation calls `ex_hermes_create_no_eval()` there ([runtime.rs](/Users/ccheever/projects/snapback/src/runtime.rs:607)).

- The doctor/bootstrap distinction is correct and important. Doctor uses a disposable target ([ibex-doctor](/Users/ccheever/projects/snapback/scripts/ibex-doctor:266)), while bootstrap retains the target ([bootstrap-ibex-runtime](/Users/ccheever/projects/snapback/scripts/bootstrap-ibex-runtime:266)). The document accurately explains why doctor can prove that a coherent build is possible while missing incoherence in the served binary.

- The document handles the candidate `rsync -a` cause honestly. The script does preserve source metadata ([bootstrap-ibex-runtime](/Users/ccheever/projects/snapback/scripts/bootstrap-ibex-runtime:29)), while LLP 0123 consistently labels the missed-relink mechanism as unconfirmed rather than established.

- The rejection-shaped false positive is a valuable finding. Diary 0032 records that VM-creation failure satisfied the broad rejection predicate before application validation ([Diary 0032](/Users/ccheever/projects/snapback/diaries/0032-streak-lab-main-rerun.diary.md:148)). Requiring readiness before negative predicates count as evidence is a sound extension of the no-evidence-regression constraint.

- The document credits rather than redescribes CV-2/CV-3 and assigns substantive decisions back to owning documents ([LLP 0123 §Relationship](/Users/ccheever/projects/snapback/llp/0123-runtime-readiness-and-operational-edges.research.md:426)). That is good decision hygiene.

- Convex claims are at least explicitly separated into diary evidence and general background. The observed portion is supported by Diary 0039: no native framework link step, all final Convex arms clean, with beta port coordination as the recorded operational friction ([Diary 0039](/Users/ccheever/projects/snapback/diaries/0039-snapback-convex-main-rerun-report.diary.md:220)).

## 3. Concerns

### A. BLOCKING-FOR-BAR — The document incorrectly says live-query paths never touch the VM

The target first says “declarative query, live-query, and ephemeral paths are pure Rust” ([LLP 0123](/Users/ccheever/projects/snapback/llp/0123-runtime-readiness-and-operational-edges.research.md:99)), and later concludes that “the declarative/live/ephemeral lanes never touch the VM” ([LLP 0123 Finding 8](/Users/ccheever/projects/snapback/llp/0123-runtime-readiness-and-operational-edges.research.md:379)).

Snapback supports JavaScript live queries: `defineJsLiveQuery` produces a `LiveQuery` JS handler ([define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:1728)). Runtime execution explicitly handles `FunctionKind::LiveQuery` as an Ibex query ([runtime.rs](/Users/ccheever/projects/snapback/src/runtime.rs:393)), and that path reaches `RuntimeGuard::create()` ([runtime.rs](/Users/ccheever/projects/snapback/src/runtime.rs:2129)).

The incident evidence supports a narrower statement: declarative Rust-backed query/live-query paths and ephemeral operations continued working; the JavaScript-handler lane, including JS live queries, did not.

Resolution: correct every blast-radius statement and Finding 8 to distinguish declarative live queries from JavaScript live queries.

### B. BLOCKING-FOR-BAR — A distinct dynamic-link option is missing despite existing Ibex machinery

The option space jumps from mutable copied frameworks and receipts to packaged pairs and static linking. It omits content-addressed, immutable dynamic-engine selection: retain dynamic linking, but select an exact engine artifact by digest from an immutable/versioned location and bind the build and loader path to it.

This is not merely hypothetical. Vendored Ibex already has portable-engine selection with:

- exact artifact and archive-digest selectors ([vendor build.rs](/Users/ccheever/projects/snapback/vendor/ibex/build.rs:704));
- a checkout-local content-addressed store and non-redirected artifact root ([portable engine consumption](/Users/ccheever/projects/snapback/vendor/ibex/build_support/portable_engine_build_consumption.rs:1978));
- manifest/header/runtime validation and exact framework resolution ([portable engine consumption](/Users/ccheever/projects/snapback/vendor/ibex/build_support/portable_engine_build_consumption.rs:2190));
- all selected payload entries added to Cargo’s watch set ([portable engine consumption](/Users/ccheever/projects/snapback/vendor/ibex/build_support/portable_engine_build_consumption.rs:2380)).

This option occupies a genuine middle point: it can preserve dynamic iteration and shared engine artifacts while removing the mutable well-known framework path that caused the incident. It has different costs and residual risks from receipts, npm co-packaging, and static linking.

Resolution: add and assess this option, including immutability enforcement, post-link mutation/TOCTOU, loader-path binding, contributor ergonomics, and how its existing Ibex machinery could or could not be adopted by Snapback.

### C. BLOCKING-FOR-BAR — Options 2 and 3 overclaim “unrepresentable” incoherence and under-analyze no-evidence-regression

The target states that options 2 and 3 make the incident unrepresentable ([LLP 0123](/Users/ccheever/projects/snapback/llp/0123-runtime-readiness-and-operational-edges.research.md:249)). That conclusion is not established.

The current runtime packages are assembly closures, not behavioral-coherence proofs:

- macOS runs `build-identity` and then independently copies the binary and framework ([prepare-runtime.mjs](/Users/ccheever/projects/snapback/packages/snapback-runtime-darwin-arm64/prepare-runtime.mjs:48));
- its package test checks only build identity ([package.test.mjs](/Users/ccheever/projects/snapback/packages/snapback-runtime-darwin-arm64/package.test.mjs:14));
- Linux attests the two file digests, but its packaged-runtime test still proves only launch and build identity, not VM creation ([Linux package test](/Users/ccheever/projects/snapback/packages/snapback-runtime-linux-x64/package.test.mjs:116)).

A package can therefore seal and faithfully distribute an already incompatible pair. Its extracted files may also be altered after installation. Packaging removes the sibling-refresh workflow; it does not by itself prove behavioral compatibility or eliminate every post-install drift state.

Static linking removes post-link engine replacement and loader-path failure, but it does not guarantee that compiled glue and a static archive share the expected behavioral contract. A semantically incompatible library can still compile and link. The statement that remaining header drift necessarily fails loudly at compile/link time ([LLP 0123 Option 3](/Users/ccheever/projects/snapback/llp/0123-runtime-readiness-and-operational-edges.research.md:274)) is therefore too strong.

The cost claim that “Hermes rebuilds ride every runtime-package build” is also overstated. The build consumes pre-existing static archives; they can be built and cached separately. Every final binary must relink, but Hermes itself need not be rebuilt for every package assembly ([vendor build.rs](/Users/ccheever/projects/snapback/vendor/ibex/build.rs:1072)).

Resolution:

- distinguish “removes post-link swap/loader drift” from “proves behavioral compatibility”;
- require CV-2-style VM qualification at package-production and/or package-consumption boundaries;
- analyze package mutation, exact loader resolution, attestation custody, and TOCTOU;
- correct the static-build cost model;
- evaluate each option explicitly against LLP 0115’s no-evidence-regression constraint.

### D. MATERIAL — The engine-portability conclusion understates Hermes captivity

Option 4 concludes that the C ABI is narrow enough that Snapback is “not deeply Hermes-captive, except at the checkpoint semantics” ([LLP 0123](/Users/ccheever/projects/snapback/llp/0123-runtime-readiness-and-operational-edges.research.md:292)). Reading only `src/runtime.rs` is insufficient to support that conclusion.

The replacement boundary includes the Ibex engine adapter and its native host surface. Vendored Ibex watches and compiles a large Hermes-specific body spanning module execution, bootstrap, timers, networking, crypto, filesystem, debugger, fetch, WebSocket, extensions, ABI checks, and platform code ([vendor build.rs](/Users/ccheever/projects/snapback/vendor/ibex/build.rs:1219)). Snapback also already contains a Workerd/V8 execution twin for non-action handlers ([runtime.rs](/Users/ccheever/projects/snapback/src/runtime.rs:2135)), which is directly relevant prior art that Option 4 does not discuss.

“Checkpoint semantics are the captivity point” is consequently too narrow. No-eval enforcement, host-call behavior, interruption, value/error representation, async settlement, module/bundle semantics, platform capabilities, and action support are all potential captivity points.

Resolution: replace the conclusion with a contract inventory across Snapback, Ibex, and the existing Workerd twin; separate source-level ABI size from semantic and implementation migration cost; classify performance and compatibility claims as empirical questions.

### E. MATERIAL — The load-bearing Convex architecture claim exceeds its stated provenance

The document correctly labels Convex internals as general background and Low confidence, but then uses the assertion that engine and server are one embedded sealed artifact as the load-bearing basis for Findings 1 and 5 ([LLP 0123 Findings](/Users/ccheever/projects/snapback/llp/0123-runtime-readiness-and-operational-edges.research.md:347)).

The diaries establish:

- a downloaded precompiled local backend;
- no user-visible native framework link step;
- clean final starts in the seven-app rerun.

They do not establish the exact internal engine embedding, absence of every separately refreshable support artifact, or impossibility of server/engine disagreement. The target itself admits those internals are not diary-verified ([LLP 0123 Confidence](/Users/ccheever/projects/snapback/llp/0123-runtime-readiness-and-operational-edges.research.md:390)).

Resolution: either verify the distribution closure from an authoritative Convex source or inspected downloaded artifact, or narrow the finding to what the diaries establish: the tested Convex workflow did not expose a user-managed native engine/server coherence boundary.

### F. DETAIL — “Limit discoverability” combines different problem classes and calls the option “cheap” without support

The 1,024-write ceiling is quantitative; one membership command per mutation is a capability/shape restriction; `SNAPBACK_OUTBOUND_ACTIONS` at codegen is phase-specific configuration. Treating all three as quantitative envelopes obscures different ownership and remediation paths.

Likewise, “cheap” is an implementation-cost judgment without analysis of canonical ownership, generated introspection compatibility, documentation freshness, or drift enforcement—the very matters left open later.

Resolution: split quantitative limits, unsupported operation shapes, and phase/configuration prerequisites; describe “cheap” as a hypothesis or provide a bounded cost argument.

## 4. Suggestions

- Replace “sealed” with more precise terms such as “co-packaged,” “digest-bound,” “behaviorally qualified,” or “single-file,” depending on what each option actually guarantees.

- Add a compact threat/failure matrix for each option covering:

  - stale-at-build inputs;
  - post-link engine replacement;
  - package assembled from an incompatible pair;
  - post-install mutation;
  - loader resolving an unintended artifact;
  - missing behavioral qualification;
  - receipt tampering and qualification-to-use races.

- Cite LLP 0032’s actual VM-cost evidence rather than only the benchmark function. LLP 0032 records the measured create/eval decomposition ([LLP 0032](/Users/ccheever/projects/snapback/llp/0032-decision-and-implementation-hardening.plan.md:1060)).

- Clarify that an “armed readiness” probe should prove the particular prerequisites needed at startup. Executing a trivial function is useful, but it should not be described as comprehensive proof of all handler semantics.

- Add Diaries 0029–0031 to `Related`, since Option 5 and Finding 9 depend on them.

## 5. Open questions

1. Can Snapback adopt Ibex’s existing content-addressed portable-engine selector directly, or is that selector bound to upstream promotion/preflight infrastructure unsuitable for the ordinary contributor lane?

2. What exact boundary issues the authoritative readiness evidence: engine production, Snapback binary link, runtime-package assembly, installation, first launch, or some composition of these?

3. How is qualification bound to the exact mapped engine object, rather than merely to bytes read from a pathname immediately before launch?

4. Does the packaged binary expose a self-contained `runtime-qualify` command that creates the same VM as `RuntimeGuard::create()`, allowing every delivery form to use one behavioral probe?

5. Which semantics are already proven by the Workerd/V8 twin, which are absent—especially actions—and what does that evidence say about actual Hermes captivity?

6. Is the strategic target “make incoherence impossible,” “make it fail before serving,” or a layered combination? The option assessments currently move between these standards.

## 6. Verdict: NOT READY

The incident diagnosis is strong, but the document has not exhausted pre-empirical analysis. The false live-query boundary, omitted content-addressed dynamic option, overclaims about packaged/static coherence, and incomplete engine-portability analysis are substantive flaws under the stated bar.

## 7. Recommended next step

Revise LLP 0123 while keeping it in Review:

1. correct the JS live-query blast radius;
2. add the content-addressed immutable-dynamic option already suggested by vendored Ibex;
3. rework Options 2–3 around precise guarantees and explicit no-evidence-regression checks;
4. expand Option 4 using the Ibex native surface and existing Workerd twin;
5. narrow or independently verify the Convex distribution-internals claim.

Then run a focused re-review of the revised option space and findings.


## Round 2 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, round-2 delta, cross-family blind
**Target SHA-256:** `5724a474fcc22586eca5d16dda3a68340394a78a4d38bcb19236725c687a7192`
**Instruction SHA-256:** `33c3fd21fcc61f4ed59da1207ef188e75a1328149be03f08f57ca9141b06f7ce`
**Status:** completed

### Verbatim review

Review completed. Verdict: **NOT READY**.

The required artifact append was blocked by the read-only sandbox, so `llp/reviews/0123-runtime-readiness-and-operational-edges.codex.md` remains unchanged.

## 1. Round-1 resolution check

- **A — JS live-query blast radius: resolved.** The document now correctly distinguishes declarative Rust live queries from JS live queries, which reach `RuntimeGuard::create()`.
- **B — Content-addressed dynamic-link option: partially resolved.** Option 4 now exists and covers the requested risks, but overstates immutability and Cargo rerun guarantees.
- **C — Packaged/static guarantees and evidence regression: resolved.** The revised options accurately distinguish assembly/link closure from behavioral qualification, correct static-build costs, and preserve qualification.
- **D — Hermes captivity and Workerd prior art: resolved.** The wider Ibex surface and Workerd/V8 non-action twin are accurately incorporated.
- **E — Convex provenance: resolved.** The sealed-artifact account is labeled inference; findings are narrowed to diary evidence.
- **F — Limit categories and “cheap” claim: resolved.** The three problem classes are separated and cost is labeled hypothetical.

## 2. New concerns

### BLOCKING-FOR-BAR — Boot qualification can consume the strict Host handoff

Option 2 proposes calling `RuntimeGuard::create()` at boot and destroying that VM. Today:

- [`ensure_host_installed()`](/Users/ccheever/projects/snapback/src/runtime.rs:592) installs `Host::strict()` only once.
- [`install_host()`](/Users/ccheever/projects/snapback/vendor/ibex/src/host/abi.rs:1311) creates a thread-bound, one-shot pending context.
- `ex_hermes_create_no_eval()` consumes that context.
- Subsequent diagnostic construction without a pending context falls back to [`SecurityMode::Audit`](/Users/ccheever/projects/snapback/vendor/ibex/src/host/abi.rs:1940).

Thus the proposed probe can consume the strict handoff intended for a real invocation, while the `Once` prevents restoring it. Readiness evidence could weaken the security posture it supposedly verifies, contradicting Option 2’s no-evidence-regression classification.

The option must require a non-consuming auxiliary probe or safe re-arming of the exact strict Host policy, with a post-probe test proving real invocations retain the same fail-closed posture.

### MATERIAL — Option 4 overstates content-addressing guarantees

The Ibex machinery validates digests when its build script executes and adds selected inputs to Cargo’s `rerun-if-changed` set. That is not “digest-anchored rerun detection instead of the mtime heuristic”: Cargo still decides whether to rerun through its normal change detection.

Likewise, a digest-named directory does not alone make in-place mutation unreachable. The option later acknowledges that immutability still needs enforcement, contradicting its earlier guarantee.

### DETAIL — Native refusal-reason transport is not demonstrably “cheap”

Rust receives only a null pointer from `ex_hermes_create_no_eval()`. The detailed refusal is emitted through `ex_host_console_log`; there is no constructor error-result ABI. Propagating it into `SNAPBACK_RUNTIME_CREATE_FAILED` requires native error transport, ownership, concurrency, sanitization, and compatibility design.

### DETAIL — Incorrect Workerd open-question pointer

The unperformed Workerd semantic inventory is routed to OQ8, but OQ8 concerns readiness boundaries and mapped-object TOCTOU. It needs a dedicated question or a direct LLP 0048 reference.

## 3. Verdict

**NOT READY.**

Most Round-1 defects are genuinely resolved, but the new server-side option contains a tree-demonstrable security/evidence regression that must be analyzed before meeting the stated bar.

## 4. Recommended next step

Make a focused v0.3 revision:

1. Preserve or safely re-arm the strict Host context around boot qualification.
2. Narrow Option 4 to the validation and invalidation guarantees actually provided.
3. Accurately cost native refusal-reason propagation.
4. Repair the Workerd inventory pointer.

Then run a narrow same-family delta review of those changes.
