# Review artifact — LLP 0225 (core modularization) — gpt-5 family

Target: `llp/0225-core-modularization.decision.md`
Loop: llp-super-refine 2026-08-10, independent-loop topology, orchestrated by
Claude Fable 5 (session 0f56679e); reviser = orchestrator.

## Round 1 — 2026-08-10

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config (launch attempt 2; attempt 1 died
  mid-review with no output and is recorded as a void, never counted).
- Capsule: detached worktree at commit `1c19e047b` (structural exclusion of
  `llp/reviews/0225*` — none exist at that commit).
- Target revision: (b), sha256
  `321d122c527ef7ccc7034735b105e641314c499fc47456bde0cce941bea74942`.
- Instructions: sr-review-r1 template, sha256
  `bc91f1fe25bb0b0ee4e017ad90e7ea538274cc9b84a4d6e4f9417ede67f7b363`.
- Verdict: **NOT READY** (2 MATERIAL concerns; binds to the capsule/target
  hashes above).

### Verbatim review

## 1. Summary

LLP 0225 consolidates the accepted incremental-modularization direction into seven real owners, a strict downward dependency graph, kernel-owned commit boundaries, an incremental migration sequence, and a pre-push ownership ratchet.

The architectural direction is sound and addresses the actual coupling problem without sacrificing the accumulated runtime and conformance semantics. It is not ready as written because its central enforcement arm does not reliably observe Rust dependencies and explicitly permits baseline updates that can grandfather new forbidden edges.

## 2. Direction assessment

The whole idea is right. The repository evidence supports treating this as an ownership and transaction-boundary problem rather than a file-layout problem: LLP 0038 identified `local.rs` as a god object and recommended splitting natural seams ([LLP 0038, lines 542–548](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0038-snapback-system-review.research.md:542)), while the commissioned Decision explains that lifecycle, transaction, persistence, and transport responsibilities cross the large hubs without structural ownership ([commission, lines 18–28](/Users/ccheever/projects/snapback-worktrees/sr-r1/issues/20260808-core-modularization-decision.md:18)).

Incremental strangler-style extraction is preferable to a rewrite because the existing server-authoritative model, SQLite semantics, wire contracts, and proof corpus are precisely the assets that need preservation. That conclusion is already author-ratified in LLP 0199 ([LLP 0199, lines 65–83](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0199-core-modularization.decision.md:65)) and in the commission’s 2026-08-10 ruling ([commission, lines 93–104](/Users/ccheever/projects/snapback-worktrees/sr-r1/issues/20260808-core-modularization-decision.md:93)).

The seven-owner refinement is coherent: separating inert contract/types from activation behavior gives Rust owners a real downward leaf while allowing target-local implementations to consume generated artifacts. The storage kernel, activation coordinator, sync engine, background services, adapters, and embed façade correspond to observable repository seams. The first generation-activation slice also demonstrates that this can be done incrementally without a second implementation.

The defect is not the direction; it is that the proposed mechanism for keeping the direction true is weaker than the document says.

## 3. Concerns

1. **The dependency graph omits valid Rust dependency forms — MATERIAL**

   **Text at issue:** §5 says the gate “blocks … a new dependency edge that violates §2,” while §2 prohibits sideways dependencies between domain services ([LLP 0225, lines 129–148](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:129), [lines 276–290](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:276)).

   **Evidence:** The checker expressly performs a textual `crate::` scan rather than Rust module resolution ([checker, lines 163–165](/Users/ccheever/projects/snapback-worktrees/sr-r1/scripts/check-module-ownership.mjs:163)). Its use matcher begins only at `use crate::`, and its direct matcher likewise recognizes only `crate::` paths ([checker, lines 302–327](/Users/ccheever/projects/snapback-worktrees/sr-r1/scripts/check-module-ownership.mjs:302)).

   Current code proves the consequence. `src/auth/provider.rs` imports `super::lifecycle` and `super::mailbox` ([provider, lines 29–40](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/auth/provider.rs:29)). The manifest assigns `provider.rs` to `sync-realtime-engine`, but `lifecycle.rs` and `mailbox.rs` to `background-services` ([manifest, lines 238–273](/Users/ccheever/projects/snapback-worktrees/sr-r1/ownership.manifest.json:238)). Those are forbidden sideways domain-service edges. Yet the baseline’s complete `provider.rs` block contains neither dependency ([baseline, lines 1034–1091](/Users/ccheever/projects/snapback-worktrees/sr-r1/ownership.baseline.json:1034)), and invoking `extractCratePaths` on that file returned no lifecycle or mailbox path. The ordinary gate still passed with `225 modules … 0 unresolved inline/root references`.

   This means a newly added forbidden `super::`, `self::`, re-exported, or locally imported dependency can pass the claimed blocking gate. The tests I found exercise gate selection and invocation, not the path analyzer’s Rust forms ([selection test, lines 224–246](/Users/ccheever/projects/snapback-worktrees/sr-r1/tests/local_proof_selection_v0.mjs:224), [pre-push smoke test, lines 417–424](/Users/ccheever/projects/snapback-worktrees/sr-r1/tests/drift_prone_gates_v0.mjs:417)).

   **Fix:** Make the Decision require a dependency extractor that resolves at least `crate`, `super`, `self`, grouped imports, aliases, and re-exports relative to each module—preferably using a Rust parser/HIR rather than regex. Add adversarial checker fixtures for every supported form, then rederive the baseline and worklist from the complete graph before acceptance.

2. **Routine baseline re-freezing can launder new forbidden edges — MATERIAL**

   **Text at issue:** The Decision says pre-existing violations are frozen and the gate blocks new forbidden edges, but it also directs every slice to rebaseline and record “newly-frozen edges,” and declares baseline re-freezes operational changes requiring no amendment ([LLP 0225, lines 146–151](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:146), [lines 271–274](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:271), [lines 294–302](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:294)).

   **Evidence:** `findNewViolations` exempts every edge already present in the checked-in baseline, regardless of direction ([checker, lines 423–431](/Users/ccheever/projects/snapback-worktrees/sr-r1/scripts/check-module-ownership.mjs:423)). `--update-baseline` then overwrites the record with the complete current graph without checking whether forbidden-edge exceptions grew ([checker, lines 439–466](/Users/ccheever/projects/snapback-worktrees/sr-r1/scripts/check-module-ownership.mjs:439)). Therefore a landing containing both a new forbidden edge and the regenerated baseline passes its own pre-push check.

   This is not merely hypothetical misuse: the ratchet worklist records multiple landings in which newly added or newly exposed upward edges were frozen into the baseline ([worklist, lines 48–63](/Users/ccheever/projects/snapback-worktrees/sr-r1/issues/20260809-0199-ownership-ratchet-worklist.md:48), [lines 84–95](/Users/ccheever/projects/snapback-worktrees/sr-r1/issues/20260809-0199-ownership-ratchet-worklist.md:84)). That contradicts LLP 0199’s accepted requirement for a blocking gate that prevents direction from silently collapsing ([LLP 0199, lines 229–241](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0199-core-modularization.decision.md:229)).

   **Fix:** Define a monotonic baseline policy. Ordinary baseline updates may remove forbidden exceptions or mechanically re-key a proven pre-existing semantic edge during relocation; they may not add a new forbidden dependency. The gate must compare forbidden exceptions with the protected predecessor baseline and reject growth unless an explicit, author-ratified exception or Decision amendment accompanies it. Replace the unconditional per-slice “records any newly-frozen edges” instruction with that rule.

3. **“Composition below the services” is too ambiguous — implementation-phase**

   **Text at issue:** §2 says cross-service composition can happen “below them (as a typed kernel operation or a leaf shape)” ([LLP 0225, lines 133–141](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:133)).

   **Evidence:** Elsewhere the Decision correctly defines the leaf as dependency-free contract vocabulary and the kernel as transaction/durability authority, while the activation coordinator owns composition rather than the commit primitive ([LLP 0225, lines 82–96](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:82), [lines 153–176](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:153)). A leaf shape cannot perform composition, and moving domain orchestration into the kernel would turn the kernel into a lower-layer god service.

   **Fix:** State that actual cross-service orchestration occurs above the services. The leaf may hold inert shared inputs/events, and a kernel operation may atomically persist already-composed typed intent, but neither owns domain policy or invokes service behavior. If a coordinator must directly invoke another service, require an explicit higher-layer coordinator or a documented owner/layer amendment.

4. **The god-file no-growth rule is not operationally defined — implementation-phase**

   **Text at issue:** “New code must not grow” `local.rs`, `server.rs`, or `storage.rs`; “§5’s per-domain rule applies” ([LLP 0225, lines 113–115](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:113)).

   **Evidence:** §5 contains no per-domain rule beyond module assignment and dependency edges. The checker analyzes file-level assignments and cross-file references; adding methods, branches, or feature logic inside an existing god file creates neither a new module nor necessarily a new edge ([checker, lines 349–382](/Users/ccheever/projects/snapback-worktrees/sr-r1/scripts/check-module-ownership.mjs:349), [lines 409–431](/Users/ccheever/projects/snapback-worktrees/sr-r1/scripts/check-module-ownership.mjs:409)). The commission’s acceptance criterion is stronger: new features in a chosen domain should land behind that owner rather than in the hubs ([commission, lines 74–84](/Users/ccheever/projects/snapback-worktrees/sr-r1/issues/20260808-core-modularization-decision.md:74)).

   **Fix:** Define when a domain becomes “chosen,” what minimal adapter/composition glue may remain in a god file, how test relocation is treated, and how the rule is reviewed or checked. A lightweight diff-aware exception mechanism would avoid leaving each implementer to decide what “growth” means.

5. **The governance handoff remains internally stale — implementation-phase**

   **Text at issue:** The document is `Status: Review` but says “While this document is Draft” LLP 0199 governs; OQ-A and OQ-B still leave the governing-document disposition and amendment timing unresolved ([LLP 0225, lines 4–14](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:4), [lines 56–60](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:56), [lines 346–355](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0225-core-modularization.decision.md:346)).

   **Evidence:** The manifest still names only LLP 0199 as its governing authority ([manifest, lines 1–6](/Users/ccheever/projects/snapback-worktrees/sr-r1/ownership.manifest.json:1)). Its `local.rs` mixed-scope text still says generation activation is “targeted” for extraction even though LLP 0225 says it has landed ([manifest, lines 348–367](/Users/ccheever/projects/snapback-worktrees/sr-r1/ownership.manifest.json:348)); the ratchet worklist already calls for refreshing this prose ([worklist, lines 43–46](/Users/ccheever/projects/snapback-worktrees/sr-r1/issues/20260809-0199-ownership-ratchet-worklist.md:43)).

   **Fix:** Before acceptance, answer OQ-A/OQ-B, correct the Draft/Review wording, and specify a same-landing handoff updating `governedBy`, stale mixed scopes, and relevant LLP 0199 `@ref`s.

## 4. Verifications performed

- **Commission and predecessor Decision:** Verified that LLP 0199 is Accepted, chooses incremental extraction/no rewrite, defines the same owner seams and atomic activation set, and author-ratifies the blocking ownership manifest gate ([LLP 0199, lines 65–155](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0199-core-modularization.decision.md:65), [lines 243–269](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0199-core-modularization.decision.md:243)). LLP 0225’s overall direction is faithful to it.

- **Ownership manifest:** Verified seven real owners plus `unassigned`, strictly decreasing allowed ranks, all 225 Rust modules assigned to a bucket, and four current `unassigned` modules ([manifest, lines 27–104](/Users/ccheever/projects/snapback-worktrees/sr-r1/ownership.manifest.json:27), [lines 337–346](/Users/ccheever/projects/snapback-worktrees/sr-r1/ownership.manifest.json:337)). Running `node scripts/check-module-ownership.mjs` passed with 221 assigned, four unassigned, and 1,338 detected edges—but Concerns 1–2 explain why that pass is insufficient.

- **Pre-push placement:** Verified `module-ownership` is both always-run and fail-closed-core ([selection policy, lines 55–69](/Users/ccheever/projects/snapback-worktrees/sr-r1/scripts/local-proof-selection-policy.v1.json:55)); selection begins with the always-run set ([selector, lines 291–319](/Users/ccheever/projects/snapback-worktrees/sr-r1/scripts/select-local-proof.mjs:291)); and the tracked hook invokes the drift runner ([pre-push hook, lines 1–34](/Users/ccheever/projects/snapback-worktrees/sr-r1/.githooks/pre-push:1)). Thus the scheduling claim checks out; the problem is what the gate enforces.

- **Generation-activation slice:** Verified the coordinator owns materialize → kernel commit → post-commit process publication, and installs the process generation only after a classified commit ([generation activation, lines 73–139](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/generation_activation.rs:73), [lines 145–224](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/generation_activation.rs:145)). Raw-dev projection pins, sequence enrollment/validation, and the durable generation record share one SQLite transaction ([storage, lines 2590–2691](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage.rs:2590)). Repository search found `clear_projection_plan_digests` only at its retained definition and commentary, with no activation caller ([projection rebuild, line 591](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/projection_rebuild.rs:591)).

- **Activation tests:** Inspected the raw-dev rollback/crash tests, complete-pair rollback/lost-ack/uncertain tests, and crash-between-materialization-and-composite test ([storage tests, line 3332](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/tests.rs:3332), [auth-mode tests, line 3131](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/auth_mode.rs:3131), [local tests, line 17115](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/local/tests.rs:17115)). I did not run Cargo tests because that would write build artifacts; therefore I verified their presence and logic, not a current green execution.

- **Migration P0:** Verified new admission persists `predecessor_schema_json`, rollback reads those bytes and validates their identity, and the predecessor publication is atomic with restored generation/version state ([migration executor, lines 1683–1795](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/migration_executor.rs:1683), [lines 2470–2574](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/migration_executor.rs:2470)). Reopen rollback and fail-closed missing-byte tests are present ([tests, lines 6330–6426](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/migration_executor.rs:6330)). The identity-checked legacy fallback does not reproduce the original successor-republication defect.

- **Embed and Cloudflare seams:** Verified `snapback::embed` remains the documented supported façade ([embed source, lines 1–21](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/embed.rs:1), [lib source, lines 1–26](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/lib.rs:1)). Verified the historical Cloudflare “three doors” defect is now represented by one `servablePrecondition` used by `alarm()` and `webSocketMessage()` ([coordinator, lines 394–399](/Users/ccheever/projects/snapback-worktrees/sr-r1/cloudflare/src/coordinator.js:394), [line 3367](/Users/ccheever/projects/snapback-worktrees/sr-r1/cloudflare/src/coordinator.js:3367), [line 5309](/Users/ccheever/projects/snapback-worktrees/sr-r1/cloudflare/src/coordinator.js:5309)).

- **Verification cadence and cosmetic-split claims:** LLP 0225 correctly reflects LLP 0189’s fast/affected landing and scheduled-complete-proof posture ([LLP 0189, lines 82–105](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0189-verification-cadence-and-claim-gating.decision.md:82)). The cited path-sensitive generators really do read `src/server.rs` and `src/manifest.rs` directly ([guide generator, lines 617–648](/Users/ccheever/projects/snapback-worktrees/sr-r1/scripts/guide-lib.mjs:617), [maturity checker, lines 902–913](/Users/ccheever/projects/snapback-worktrees/sr-r1/scripts/capability-maturity.mjs:902)).

- **Reference integrity:** `./ref-check --verbose` passed: 228 LLP documents, 4,772 references, zero errors, zero unchecked. I did not read anything under `llp/reviews/`.

VERDICT: NOT READY
## Round 2 — 2026-08-10 (delta round)

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config.
- Capsule: detached worktree at commit `0eac1d309`.
- Target revision: (c), sha256 prefix `c6a373ebe1cae922`.
- Instructions: sr-review-r2 delta template.
- Verdict: **NOT READY** (4 MATERIAL: 2 IN-DELTA, 2 PRE-EXISTING; binds to
  the capsule/target hashes above).
- Orchestrator note: with this verdict the sustained-asymmetry bound is met
  for 0225 (claude READY on revisions (b) and (c); gpt-5 NOT READY on both).
  Disclosed to the author in-session; round 3 proceeds within the authorized
  budget because every finding carries a concrete fix.

### Verbatim review

## 1. Summary

The incremental, no-rewrite direction and layered ownership map are sound. The document is not ready, however: revision (c) weakens the accepted dependency ratchet, the executed first slice conflicts with the new cross-service rule, and the raw-dev atomicity/recovery claims do not match the implementation.

## 2. Direction assessment

The core direction is right: strangler-style extraction, a dependency-free contract leaf, kernel-owned durability, domain services above it, and adapters above those are appropriate boundaries. Splitting generation types from activation behavior and retaining one SQLite transaction authority are particularly strong decisions.

The blockers concern enforcement integrity and whether the first slice actually satisfies the contract claimed for it—not the overall modularization strategy.

## 3. Concerns

1. **MATERIAL — IN-DELTA: the “monotonic” baseline rule permits genuine architectural regression.**

   Exact text: “it may **add** a forbidden edge only when the landing carries an explicit reviewed frozen-edge record” ([LLP 0225 §2](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0225-core-modularization.decision.md:166)).

   That is not monotonic in the architectural sense: a new forbidden dependency becomes acceptable merely by adding a worklist entry. It contradicts LLP 0199’s accepted OQ5 ruling that the gate “blocks new cross-owner edges that violate the downward direction” ([LLP 0199](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0199-core-modularization.decision.md:265)). The worklist already records “genuinely upward” growth from feature landings rather than only rediscovered or relocated pre-existing coupling ([worklist](/Users/ccheever/projects/snapback-worktrees/sr-r2/issues/20260809-0199-ownership-ratchet-worklist.md:48), [later growth](/Users/ccheever/projects/snapback-worktrees/sr-r2/issues/20260809-0199-ownership-ratchet-worklist.md:84)). This is distinct from the disclosed tooling defect: the normative policy itself authorizes growth.

   The current arm also overwrites the whole baseline unconditionally ([check-module-ownership.mjs](/Users/ccheever/projects/snapback-worktrees/sr-r2/scripts/check-module-ownership.mjs:455)), and the pre-push runner permits a red that was already red at its comparison revision ([drift-prone-gates.mjs](/Users/ccheever/projects/snapback-worktrees/sr-r2/scripts/drift-prone-gates.mjs:288)). On this exact revision, the standalone gate reports two committed new forbidden edges, so “fixed forward at the next landing” is not an enforced property.

   Fix shape: distinguish strictly between:

   - proven pre-existing edges newly observed because of analyzer improvement or path relocation, which may be re-keyed with provenance; and
   - genuinely new forbidden coupling, which must be fixed before baseline refresh or receive an explicit, time-bounded Decision amendment/waiver—not merely a worklist note.

2. **MATERIAL — IN-DELTA: the executed first slice violates revision (c)’s cross-service rule without a disposition.**

   Exact text: domain services “may depend only on the kernel and the leaf — **not on each other**,” with orchestration above them ([LLP 0225 §2](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0225-core-modularization.decision.md:142)); the first slice is nevertheless described as executed ([§4](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0225-core-modularization.decision.md:229)).

   The coordinator imports `ModeCommitFailure` from `auth::admission`, owned by `sync-realtime-engine`, and imports/holds the unassigned `LocalSnapback` directly ([generation_activation.rs](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/generation_activation.rs:8)). Both forbidden edges are frozen in the baseline ([ownership.baseline.json](/Users/ccheever/projects/snapback-worktrees/sr-r2/ownership.baseline.json:2455)), but neither receives a concrete inversion disposition in the standing worklist.

   An implementer must guess whether to move the failure classification into the leaf/coordinator, introduce a coordinator-owned port implemented by `LocalSnapback`, elevate this coordinator above the domain layer, or treat the rule as aspirational.

   Fix shape: state that this was behavior extraction but not yet a direction-clean boundary; record both edges with provenance and required inversion. Prefer a coordinator-owned narrow port implemented above the service, and place the commit-verdict type in a permitted owner.

3. **MATERIAL — PRE-EXISTING: raw-dev transcript activation is a generation-coupled durable commit outside the declared atomic cut.**

   Exact text: the coordinator owns “manifest + projections + sequences + auth/capability side effects” as one atomic transition ([ownership charter](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0225-core-modularization.decision.md:88)), while §3 says the listed post-commit effects are the recorded exceptions and future exceptions must be recorded ([§3](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0225-core-modularization.decision.md:189)).

   In raw-dev activation, `commit_function_generation` commits first; afterward `activate_stream_transcript_manifest` opens and commits a separate SQLite transaction, and failure returns before installing the in-memory successor ([generation_activation.rs](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/generation_activation.rs:92), [stream_transcripts.rs](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage/stream_transcripts.rs:151)). The transcript table is explicitly activated by the exact function manifest’s streaming capability ([LLP 0204](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0204-app-external-surfaces.rfc.md:745)). The complete-pair path already performs this activation inside its composite transaction ([auth_mode.rs](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage/auth_mode.rs:1357)).

   Thus raw-dev can durably publish its generation record, pins, and enrollments while transcript capability activation fails separately.

   Fix shape: include transcript catalog activation in `CommitFunctionGeneration`, matching the complete-pair lane. If it truly cannot share the transaction, amend the exception list and specify recovery, retry, and injected-failure tests for the split cut.

4. **MATERIAL — PRE-EXISTING: the raw-dev crash/reopen acceptance claim overstates what production recovery does.**

   Exact text: “recovery reads only the persisted generation record — for both complete-pair and raw-dev paths” ([LLP 0225 §4](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0225-core-modularization.decision.md:256)).

   `LocalSnapback::from_database` reads the durable auth-mode record but initializes functions to `FunctionManifest::default()` and `functions_loaded` to false; it does not consume `FunctionGenerationRecord` ([local.rs](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/local.rs:19887), [initialization](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/local.rs:19950)). The record accessor is marked dead-code and its reopen proof operates directly on `LocalDatabase`, followed by another explicit commit—not production `LocalSnapback` recovery ([storage.rs](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage.rs:2694), [test](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage/tests.rs:3332)).

   Fix shape: decide and document one contract. Either raw-dev reopen starts inert and requires explicit artifact reload verified against the durable record, with a full `LocalSnapback::open` test, or reopen must persist/load enough artifact state to reconstruct the generation. “Recovery reads the record” is not currently accurate.

5. **implementation-phase — IN-DELTA: the analyzer-gap description overstates the missing syntax.**

   Exact text says grouped imports, aliases, and re-exports are invisible ([LLP 0225 §5](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0225-core-modularization.decision.md:320)).

   The current extractor already parses grouped `crate::` use trees and aliases; `pub use crate::…` also matches its `use` scan ([check-module-ownership.mjs](/Users/ccheever/projects/snapback-worktrees/sr-r2/scripts/check-module-ownership.mjs:242)). Live examples include grouped re-exports in [manifest.rs](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/manifest.rs:14) and façade re-exports in [embed.rs](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/embed.rs:18). A direct probe confirmed those forms are extracted, while `super::` and `self::` are not.

   Fix shape: narrow the disclosure to non-`crate` roots and any indirect forms actually unsupported; retain adversarial fixtures for every claimed form.

## 4. Verifications performed

- Read revision (c)’s authoritative delta enumeration first, then the complete LLP.
- Read LLP 0199 completely and inspected the commission, manifest, baseline, worklist, gate policy, pre-push runner, activation coordinator, kernel commits, reopen path, and characterization tests.
- Did not open anything under `llp/reviews/`, inspect other worktrees, or modify files.
- `./ref-check --verbose`: 228 LLP documents, 4,785 refs, zero errors.
- `node scripts/check-module-ownership.mjs`: red on two committed forbidden edges: `auth/rehearsal → secure_file` and `storage/auth_rehearsal → admin`.
- Local-proof selection tests passed. Five drift-runner integration tests could not execute because the read-only sandbox rejected temporary-directory creation; no product assertion was reached.
- Directly probed `extractCratePaths` for grouped imports, aliases, re-exports, `super`, and `self`.

## 5. Verdict

VERDICT: NOT READY
## Round 3 — 2026-08-10 (delta round; final budgeted round)

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config.
- Capsule: detached worktree at commit `ceb7803c4`.
- Target revision: (d), sha256 prefix `d613322dc4e25fa4`.
- Instructions: sr-review-r3 delta template.
- Verdict: **NOT READY** (4 MATERIAL: 2 IN-DELTA, 2 PRE-EXISTING).

### Verbatim review

## Summary

The architectural direction is sound, but revision (d) is not ready. Three material problems remain: the claimed enforcement arm was red at the revision-(d) commit, the new merge-base/waiver protocol does not fully specify a blocking implementation, and the connected-clients “waiver” fails its own requirements. I also could not verify the asserted injected-failure characterization envelope.

## Direction assessment

The whole idea is right. Incremental strangler-style extraction preserves accumulated semantics; the seven-owner layering is coherent; one storage kernel owning SQLite transactions is the correct authority boundary; the contract leaf and adapter-above-service orchestration avoid sideways service coupling; and a ratcheted ownership graph is appropriate for a fast-moving repository. These concerns require tightening enforcement and shipped-state claims, not changing that direction.

## Concerns

1. **MATERIAL — PRE-EXISTING: the document calls the ownership gate blocking and current, but it was red at the exact revision-(d) commit.**

   Exact text at issue: “it runs on every push with commits, unconditionally,” “It blocks … a new dependency edge that violates §2,” and gate reds were “fixed forward at the next landing, as the four recorded occurrences were” ([LLP 0225:46–56](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0225-core-modularization.decision.md:46), [338–355](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0225-core-modularization.decision.md:338), [387–390](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0225-core-modularization.decision.md:387)).

   Reconstructing the exported analyzer over Git blobs showed zero forbidden violations at `4e3b066e5`, then two at `fe2568996`, still present at revision (c) and the exact revision-(d) commit `1754970cb`:

   - `src/auth/rehearsal.rs` (`shared-contract-types-leaf`) → `src/secure_file.rs` (`storage-migration-kernel`), from direct calls at [src/auth/rehearsal.rs:1170–1189](/Users/ccheever/projects/snapback-worktrees/sr-r3/src/auth/rehearsal.rs:1170).
   - `src/storage/auth_rehearsal.rs` (`storage-migration-kernel`) → `src/admin.rs` (`transport-adapters`), from the `ServerProfile` dependency at [src/storage/auth_rehearsal.rs:852–868](/Users/ccheever/projects/snapback-worktrees/sr-r3/src/storage/auth_rehearsal.rs:852).

   The owner assignments are explicit in [ownership.manifest.json:106–177](/Users/ccheever/projects/snapback-worktrees/sr-r3/ownership.manifest.json:106), [188–195](/Users/ccheever/projects/snapback-worktrees/sr-r3/ownership.manifest.json:188), and [290–299](/Users/ccheever/projects/snapback-worktrees/sr-r3/ownership.manifest.json:290). Direct invocation of the gate fails on those edges today. Thus there is at least a fifth occurrence after the always-run promotion, and it was not fixed by the next landing.

   Fix shape: resolve these edges without widening direction—likely split file-I/O behavior out of the leaf and move `ServerProfile` or an equivalent shape down—or give them valid §2 waivers. Record the occurrence and qualify the “blocking enforcement arm”/“four occurrences” claims until the gate is green.

2. **MATERIAL — IN-DELTA: the new merge-base rule does not close the pre-existing-staleness masking path.**

   Exact text at issue: “The gate is required to enforce the comparison against the predecessor baseline at the push’s merge-base and refuse silent growth” ([LLP 0225:167–184](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0225-core-modularization.decision.md:167)).

   The checker only compares the current graph with the committed baseline, while `--update-baseline` replaces that baseline wholesale ([scripts/check-module-ownership.mjs:423–446](/Users/ccheever/projects/snapback-worktrees/sr-r3/scripts/check-module-ownership.mjs:423), [449–470](/Users/ccheever/projects/snapback-worktrees/sr-r3/scripts/check-module-ownership.mjs:449)). More importantly, the pre-push runner treats the gate as one Boolean: if both HEAD and the merge-base fail, it declares the entire HEAD failure pre-existing without comparing violation sets ([scripts/drift-prone-gates.mjs:277–348](/Users/ccheever/projects/snapback-worktrees/sr-r3/scripts/drift-prone-gates.mjs:277)). Therefore an existing red edge A can mask a newly introduced edge B.

   The linked tracker covers unconditional baseline overwrite but not this outer-runner masking problem ([issues/20260810-ownership-gate-analyzer-gaps.md:21–35](/Users/ccheever/projects/snapback-worktrees/sr-r3/issues/20260810-ownership-gate-analyzer-gaps.md:21)). An implementer could fix `--update-baseline` exactly as requested and still leave pushes non-blocking while main is stale.

   Fix shape: define and compare forbidden-edge sets at merge-base and candidate HEAD, independent of either revision’s exit status. Add an adversarial fixture where merge-base contains A and HEAD contains A+B; B must block. Also specify how relocation provenance and approved waivers are supplied to that comparison.

3. **MATERIAL — IN-DELTA: the connected-clients waiver is not a valid waiver under the rule revision (d) introduces.**

   Exact text at issue requires “a worklist entry naming the edge, the inversion owner, and a deadline,” then says `src/local.rs → src/connected_clients.rs` “is hereby reclassified as such a waiver” ([LLP 0225:167–178](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0225-core-modularization.decision.md:167)).

   The edge exists in [ownership.baseline.json:3013–3018](/Users/ccheever/projects/snapback-worktrees/sr-r3/ownership.baseline.json:3013), but the ratchet worklist contains no connected-clients entry, inversion owner, or deadline ([issues/20260809-0199-ownership-ratchet-worklist.md:1–95](/Users/ccheever/projects/snapback-worktrees/sr-r3/issues/20260809-0199-ownership-ratchet-worklist.md:1)). “At the `local.rs` drainage slices” is neither a named owner nor a time bound. The revision-history claim that this is now time-bounded is consequently false.

   Fix shape: add the required worklist record with the exact edge, responsible owner, concrete date or bounded slice, resolution shape, and revision-(d) amendment pointer—or remove/fix the edge before acceptance.

4. **MATERIAL — PRE-EXISTING: the asserted failed-activation characterization envelope is not verified by the cited tests.**

   Exact text at issue says the slice’s acceptance is “held in the local proof’s activation/storage tests,” including: “after an injected commit failure, the live manifest, projection pins/digests, and sequence state agree exactly with what physically committed, and a retry converges” ([LLP 0225:290–306](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0225-core-modularization.decision.md:290)).

   I could not locate a test that exercises that complete envelope:

   - [src/local/tests.rs:16830–16989](/Users/ccheever/projects/snapback-worktrees/sr-r3/src/local/tests.rs:16830) tests retry after projection fan-out refusal before the commit.
   - [src/storage/tests.rs:3412–3451](/Users/ccheever/projects/snapback-worktrees/sr-r3/src/storage/tests.rs:3412) tests transaction rollback caused by sequence validation, without process state or retry.
   - [src/storage/auth_mode.rs:3131–3264](/Users/ccheever/projects/snapback-worktrees/sr-r3/src/storage/auth_mode.rs:3131) injects before/after-commit failures and checks durable pins/deployment state, but does not traverse `GenerationActivation`, assert process sequence/function state, and retry.

   Fix shape: add a coordinator-level injected before/after-commit test covering all named state and retry, or narrow “held” to the properties actually proved and record the remainder as an obligation.

5. **implementation-phase — IN-DELTA: the two first-slice inversion dispositions assign the `LocalSnapback` edge to the wrong slice.**

   The delta says the `→ src/local.rs` inversion is “a coordinator-owned narrow port implemented above the service,” but immediately says both frozen edges are owed at “the kernel/leaf slices” ([LLP 0225:264–272](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0225-core-modularization.decision.md:264)). The current coordinator directly imports and stores `LocalSnapback` ([src/generation_activation.rs:8–15](/Users/ccheever/projects/snapback-worktrees/sr-r3/src/generation_activation.rs:8), [39–52](/Users/ccheever/projects/snapback-worktrees/sr-r3/src/generation_activation.rs:39)).

   Fix shape: separate the dispositions: move `ModeCommitFailure` to the leaf; replace the `LocalSnapback` handle with a coordinator-owned port implemented by the adapter/local-composition layer. Do not schedule that port into the inert kernel or leaf.

6. **implementation-phase — IN-DELTA: the linked analyzer tracker still contradicts revision (d).**

   Revision (d) correctly says grouped `crate::` use trees, aliases, and `pub use crate::…` are parsed, while `super::`, `self::`, and chained re-exports remain gaps ([LLP 0225:356–370](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0225-core-modularization.decision.md:356)). The linked issue still says grouped imports, aliases, and all re-exports are invisible and requests their implementation ([issues/20260810-ownership-gate-analyzer-gaps.md:13–29](/Users/ccheever/projects/snapback-worktrees/sr-r3/issues/20260810-ownership-gate-analyzer-gaps.md:13)). The parser confirms revision (d)’s account at [scripts/check-module-ownership.mjs:242–327](/Users/ccheever/projects/snapback-worktrees/sr-r3/scripts/check-module-ownership.mjs:242).

   Fix shape: update the tracker to distinguish already-supported crate-rooted forms from unresolved relative roots and transitive re-export resolution.

## Verifications performed

- Read revision (d)’s enumerated delta first, then the complete LLP and the revision-(c)→(d) diff.
- Checked LLP 0199, the commission/ruling, the ratchet worklist, and both revision-(d) issue trackers.
- Validated the manifest over all 225 Rust modules and inspected the 1,343-edge graph and frozen forbidden edges.
- Ran `node scripts/check-module-ownership.mjs`; it failed on the two edges above.
- Reconstructed the analyzer at `4e3b066e5`, `fe2568996`, revision (c), and revision (d) directly from Git blobs.
- Probed grouped imports, aliases, crate-rooted re-exports, `super::`, and `self::` against the exported parser.
- Traced both activation paths, their kernel transactions, the separate transcript transaction, reopen construction, and relevant tests.
- Ran `./ref-check --verbose`: 228 LLP documents, 4,791 refs, zero errors.
- Did not read `llp/reviews/`, did not inspect another worktree, and made no file changes. I did not execute Rust tests because this checkout is read-only and a build would create artifacts.

VERDICT: NOT READY
## Round 6 — 2026-08-10 (delta round; final extension round)

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config.
- Capsule: bare `git archive` export of commit `570d833ca` (sr-r6).
- Target revision: (h), sha256 prefix `38a0b422715c568d`.
- Verdict: **NOT READY** (3 MATERIAL, all IN-DELTA). Loop terminal at
  budget exhaustion; sustained asymmetry stands (claude READY at revisions
  b, c, f, g; gpt-5 NOT READY at all six rounds, concerns narrowing each
  round into gate-implementation protocol spec).

### Verbatim review

## 1. Summary

The core direction is right: incremental semantic extraction, a strict ownership graph, kernel-owned commits, and no rewrite fit both the repository’s architecture and its operating constraints. Revision (h), however, leaves three material defects in the new enforcement and reopen rules. An implementer could still build an enforcement arm that launders new forbidden edges, and the proposed reopen state machine lacks both an intent discriminator and an honest closure condition.

## 2. Direction assessment

The seven-owner model is a sound decomposition of the current system. The checked-in manifest implements the stated layers and dependencies ([ownership.manifest.json](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/ownership.manifest.json:27), lines 27–99), while the four remaining `unassigned` files accurately expose rather than disguise the god-file residue (lines 341–346).

The first slice also validates the approach: `GenerationActivation` coordinates ordering while delegating durable state to kernel operations ([src/generation_activation.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/src/generation_activation.rs:39), lines 39–59 and 92–138), and `commit_function_generation` owns the SQLite transaction and durable record ([src/storage.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/src/storage.rs:2590), lines 2590–2691). This is preferable to either cosmetic splitting or a rewrite, and it preserves the root LLP’s agent-feedback and accumulated-contract priorities ([LLP 0000](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/llp/0000-snapback.explainer.md:734), lines 734–755).

I would retain the overall architecture and migration direction. The blockers are in revision (h)’s enforcement and recovery mechanics, not in the ownership model.

## 3. Concerns

1. **MATERIAL — IN-DELTA: the new `V(R)` definition still permits baseline laundering.**

   Exact text at issue: “the *outstanding set* `V(R)` is … forbidden edges present at R **and not admitted by R’s committed baseline or waivers**,” followed by “The gate blocks `V(P) − V(B)`” ([LLP 0225 §5](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/llp/0225-core-modularization.decision.md:385), lines 385–395).

   If a push introduces forbidden edge `e` and regenerates the pushed baseline to contain `e`, then `e ∉ V(P)` by definition. It can never appear in `V(P) − V(B)`, so the specified comparison does not block it. That is exactly the existing defect: `--update-baseline` serializes the complete current edge graph without predecessor validation ([check-module-ownership.mjs](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/scripts/check-module-ownership.mjs:439), lines 439–446 and 461–463), and the repository ticket explicitly demonstrates that a new forbidden edge plus regenerated baseline passes ([analyzer-gap ticket](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/issues/20260810-ownership-gate-analyzer-gaps.md:22), lines 22–25). This contradicts §2’s monotonic-baseline rule ([LLP 0225](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/llp/0225-core-modularization.decision.md:173), lines 173–192).

   The waiver clause is also internally dead: because `V` already excludes waived edges, “unless each member carries an exact approved waiver” cannot apply to a member of `V(P) − V(B)`.

   Fix shape: define the raw forbidden set separately from admitted exceptions, and validate the baseline-exception delta before calculating outstanding reds. Any addition to the pushed baseline must either map, with machine-checkable provenance, to a forbidden edge already present at the merge-base—relocation/analyzer re-key—or carry an exact approved waiver. Only after that validation should baseline and waiver sets be subtracted for inherited-red attribution.

2. **MATERIAL — IN-DELTA: digest equality cannot distinguish recovery intent from successor-deployment intent.**

   Exact text at issue: “the first artifact load after reopen verifies against the persisted record’s digests and refuses on mismatch,” while “recovery reload is distinguished from intentional successor deployment by that digest match” and a successor is a new commit ([LLP 0225 OQ-C](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/llp/0225-core-modularization.decision.md:491), lines 491–502).

   A mismatching first load can mean either an invalid recovery attempt—which must refuse—or an intentional successor—which must be allowed to perform a new composite commit. Digest comparison reveals content, not caller intent. Conversely, an intentional same-content deployment is indistinguishable from recovery.

   The current surface supplies no discriminator: `LocalSnapback::load_functions` is one operation and always enters generation activation ([src/local.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/src/local.rs:4414), lines 4414–4494), and the dev server exposes that same `functions.load` path ([src/server.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/src/server.rs:19774), lines 19774–19797). The kernel currently advances the durable high-water even when the manifest digest is unchanged ([src/storage/tests.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/src/storage/tests.rs:3398), lines 3398–3409).

   Fix shape: pin an explicit recovery-versus-successor input—separate operations, an intent field, or an equivalently unambiguous state transition. Recovery must exact-match the durable record and not advance its high-water; successor deployment must be explicitly selected and use the normal commit path, including when its content happens to match.

3. **MATERIAL — IN-DELTA: acceptance is said to end the reopen exception without requiring its implementation.**

   Exact text at issue: “Whichever arm is ruled, the ruling lands at or before this document’s acceptance — the recorded-exception status ends there” ([LLP 0225 OQ-C](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/llp/0225-core-modularization.decision.md:502), lines 502–504). Yet the preceding text says the owning slice “must then pin” the state machine and makes full-process tests that slice’s acceptance, rather than this Decision’s acceptance.

   Production reopen still installs `FunctionManifest::default()` and `functions_loaded: false` without consuming the durable generation record ([src/local.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/src/local.rs:19913), lines 19913–19919 and 19950–19962). The record accessor remains dead-code-allowed ([src/storage.rs](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/src/storage.rs:2694), lines 2694–2717), and the implementation ticket is still open ([raw-dev/reopen ticket](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/issues/20260810-raw-dev-activation-split-cut-and-reopen-inertness.md:23), lines 23–34).

   A product ruling resolves the open question but does not make the current code satisfy the chosen contract. Fix shape: either require implementation and the full-process acceptance tests in the Decision-acceptance landing, or state that acceptance closes OQ-C while converting it into a normative implementation exception that remains open until the owning slice and proof land.

4. **implementation-phase — IN-DELTA: the named implementation ticket does not track revision (h)’s protocol.**

   Exact text at issue: the analyzer-gap ticket “tracks both” new enforcement requirements ([LLP 0225 §5](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/llp/0225-core-modularization.decision.md:395), lines 395–402).

   The ticket still calls for comparison against the “last GREEN baseline” and for backstop ticket filing or refresh on allowed pushes ([analyzer-gap ticket](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/issues/20260810-ownership-gate-analyzer-gaps.md:38), lines 38–49). It does not record revision (h)’s same-analyzer snapshot semantics, canonical fingerprints, pushed-tree ticket requirement, observation revision, or baseline re-key treatment.

   Fix shape: update the ticket with explicit acceptance items matching the final set and ticket protocol.

5. **implementation-phase — PRE-EXISTING: several governing references are wrong.**

   The document identifies “LLP 0059” as the single-writer locking/linearization authority in its header and invariant/transaction sections ([LLP 0225](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/llp/0225-core-modularization.decision.md:23), lines 23–29, 79–84, and 199–205). The repository’s LLP 0059 is actually “Session projection and client authority barrier protocol” ([LLP 0059](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/llp/0059-session-projection-and-client-barrier.spec.md:1), lines 1–5). The canonical local single-writer rule is stated in LLP 0003 ([LLP 0003](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/llp/0003-local-code-hosting-and-storage-core.rfc.md:422), lines 422–449).

   Likewise, “single amendment point for the ownership map and dependency direction (§6)” points to the cosmetic-versus-semantic section; the actual amendment rule is in §5, and the map/direction are §§1–2 ([LLP 0225](/Users/ccheever/projects/snapback-worktrees/sr-r6-capsule/llp/0225-core-modularization.decision.md:64), lines 64–70 and 419–430).

   Fix shape: replace the LLP 0059 citations with the actual single-writer authority and correct the section pointer.

## 4. Verifications performed

- Read revision (h)’s authoritative enumeration first, then all 587 lines of the target.
- Compared the complete accepted LLP 0199, the commissioning issue, and relevant root-LLP invariants.
- Inspected the ownership manifest, baseline schema, analyzer, selection policy, pre-push attribution runner, and both implementation tickets.
- Ran `node scripts/check-module-ownership.mjs`; it currently reports two unbaselined forbidden edges: `src/auth/rehearsal.rs → src/secure_file.rs` and `src/storage/auth_rehearsal.rs → src/admin.rs`.
- Inspected generation activation, durable record/high-water handling, production reopen construction, the server load surface, and relevant kernel/full-process tests.
- Did not run the Rust proof suite in the read-only checkout, so I did not independently re-establish the document’s broader “affected proof green” or exact legacy-ordering claims.
- No files were modified.
- A broad search whose exclusion pattern was incorrect surfaced snippets from unrelated `llp/reviews/` files. No LLP 0225 review content surfaced, and none of those snippets was used as evidence or reasoning here.

## 5. Verdict

VERDICT: NOT READY