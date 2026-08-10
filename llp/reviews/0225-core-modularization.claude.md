# Review artifact — LLP 0225 (core modularization) — claude family

Target: `llp/0225-core-modularization.decision.md`
Loop: llp-super-refine 2026-08-10, independent-loop topology, orchestrated by
Claude Fable 5 (session 0f56679e); reviser = orchestrator.

## Round 1 — 2026-08-10

- Reviewer: claude family — fresh general-purpose subagent, model
  claude-fable-5 (session model), no shared context with the orchestrator's
  revisions or the other family.
- Capsule: detached worktree at commit `1c19e047b` (structural exclusion of
  `llp/reviews/0225*` — none exist at that commit; no-reviews/no-worktree
  instruction residue self-attested).
- Target revision: (b), sha256
  `321d122c527ef7ccc7034735b105e641314c499fc47456bde0cce941bea74942`.
- Instructions: sr-review-r1 template, sha256
  `bc91f1fe25bb0b0ee4e017ad90e7ea538274cc9b84a4d6e4f9417ede67f7b363`.
- Verdict: **READY** (binds to the capsule/target hashes above).

### Verbatim review

**1. Summary**

LLP 0225 consolidates the already-Accepted LLP 0199 core-modularization Decision with the machine state that has since shipped — the seven-owner `ownership.manifest.json`, the ratcheted `ownership.baseline.json`, the always-run pre-push `check-module-ownership.mjs` gate, and the landed generation-activation first slice — into one governing record with an amendment rule for dependency direction. I verified the document's factual claims against the manifest, the gate script, the selection policy, the tickets, LLP 0199, and the extracted code; essentially everything checks out. The direction is right, the consolidation is faithful, and the two genuinely open governance questions (0199's disposition, amendment timing) are correctly surfaced to the author rather than decided unilaterally. Remaining concerns are accuracy/editorial nits, none material.

**2. Direction assessment**

The central decision — incremental owner extraction under a seven-owner map with strictly-downward dependencies, enforced by an unconditional pre-push ratchet gate, no rewrite — is not newly invented here; it was Accepted in LLP 0199 (`llp/0199-core-modularization.decision.md`, Status: Accepted, OQ1–OQ5 ruled) and commissioned for consolidation by the author ruling of 2026-08-10 in `issues/20260808-core-modularization-decision.md` ("Next action: author the Decision LLP recording the ownership map, dependency direction, transaction boundaries, and migration sequence"). The document does exactly that job, and the job is worth doing: the normative content genuinely had fragmented across 0199's prose, the manifest JSON, and two issue rulings, and a single amendment point for direction changes is the right governance shape for a fast-moving multi-agent `main`.

Two design choices deserve explicit endorsement. First, promoting the commission's six owners to seven by splitting the contract-leaf out of owner #1 follows a seam 0199's Sequencing already identified ("Shared contract/types leaf"), and the shipped manifest already encodes it — so the document describes reality rather than legislating a divergence. Second, the distinction between amendment-gated content (owner set, ranks, `allowedDependencies`) and operational content (assignments, `mixedModuleScopes`, baseline re-freezes) matches how the ratchet has actually been operated per `issues/20260809-0199-ownership-ratchet-worklist.md`, and keeps the amendment rule from becoming a landing bottleneck. The direction is sound.

**3. Concerns**

1. **"The four recorded occurrences" are mischaracterized as bypassed reds** — *implementation-phase*. §5 says: "Bypass is exceptional and loud (`SNAPBACK_DRIFT_GATES_BYPASS=1` …); a bypassed red is fixed forward at the next landing, as the four recorded occurrences were." The source record, `issues/closed/20260809-ownership-gate-prepush-tier.md` (lines 18–28 and 12–16), shows only occurrence #1 was a bypassed push; occurrences #2–#4 (spike_trace, the S1/S2 five-module wave, the S5 five-module wave) were pushes where the gate simply was not in the selected set before the always-run promotion — the exact selection gap the ticket existed to close. Fix: reword to something like "as the four recorded gate-red-on-main occurrences were (one deliberate bypass, three selection gaps predating the always-run promotion)". As written it slightly overstates how often deliberate bypass has occurred and understates the promotion's own rationale.

2. **Stale "while this document is Draft" wording after the Draft→Review flip** — *implementation-phase*. The header records "Revised: 2026-08-10 (b — Draft → Review …)" and Status: Review, but the Context section ("While this document is Draft, LLP 0199 remains the governing record") and §5 ("while this document is Draft, an amendment to LLP 0199") still say "Draft". Read literally, a Review-status document is governed by neither clause. The surrounding text ("On acceptance, this Decision becomes the single amendment point") makes the intent unambiguous — 0199 governs until acceptance — so this is editorial, but since these clauses carry the amendment-authority rule, fix them to "until this document is Accepted". Relatedly, the Revision history section lists only entry (a) while the header lists (a) and (b).

3. **"Blocks exactly two failure shapes" is a fair summary but slightly under-describes the gate** — *implementation-phase*. `scripts/check-module-ownership.mjs` also hard-fails on manifest self-consistency defects (a manifest naming absent modules, unsorted buckets, ordinal drift, invalid baseline — `validateManifest`/`validateBaseline`, lines 62–137, 385–407), which is what makes §6's "a naive rename is itself a gate red" true. The two-shape phrasing (borrowed from the ticket) is accurate for the *edge-analysis* semantics, but an implementer reading §5 alone might be surprised that a rename with no new edges also reds the gate. A one-clause acknowledgment ("plus manifest/baseline self-consistency, which is what catches renames") would close the gap; §6 already implies it.

4. **Assignment moves are amendment-free, which can relocate a module across layers without a prose record** — *implementation-phase* (observation, not a defect). §5 protects the owner set, ranks, and `allowedDependencies` behind amendment but leaves per-module re-assignment operational. Re-assigning a module to a higher-rank owner can convert a formerly-forbidden edge into a legal one with no amendment. In practice the re-baseline requirement plus the worklist-recording convention (every growth event is in fact recorded in `issues/20260809-0199-ownership-ratchet-worklist.md`) covers this, and `uncertainAssignments` is explicitly designed for re-deciding placements at the owning slice — so I judge the ruling defensible as made. The implementer should just understand that the recording convention, not the gate, is what keeps assignment moves honest.

**4. Verifications performed**

- **Commission and ruling** (`issues/20260808-core-modularization-decision.md`): six named owners, no-rewrite non-decision, generation-activation first-slice suggestion, 2026-08-10 author ruling approving all three parts with the "structural check lands with the first slice" addition — all as the document states. Checked out.
- **LLP 0199** (`llp/0199-core-modularization.decision.md`): Status Accepted, OQ1–OQ5 rulings (including OQ3's minimum atomic set + persisted-generation-record recovery authority + composite-commit-first mechanism, OQ4's co-migration condition, OQ5's blocking manifest gate), the 2026-08-09 OQ3 follow-up revision, and the Sequencing contract-leaf item §0225 cites for the six→seven split. 0225's §§1–4 restate these faithfully; nothing overturns 0199.
- **Ownership manifest** (`ownership.manifest.json`): exactly the seven owner ids plus `unassigned`; ranks/layers as tabulated in §1; `allowedDependencies` exactly as §2 states (services→kernel+leaf only, kernel→leaf only, leaf→nothing, adapters→everything below, `unassigned` grants and receives nothing); `godFiles` = `src/local.rs`, `src/server.rs`, `src/storage.rs`; `mixedModuleScopes` for `local.rs` and `manifest.rs` matching §1's description; `uncertainAssignments` includes the cited `src/auth/lifecycle.rs` and `src/runtime.rs` notes verbatim in substance. Checked out.
- **Gate script** (`scripts/check-module-ownership.mjs`): validates every allowed edge strictly decreases rank (lines 82–88); refuses unassigned Rust modules (line 109); blocks only *new* edges against the baseline (`findNewViolations`, lines 423–432); flags unassigned→god-file same-owner edges (lines 409–421); forbids naming `unassigned` as a dependency (line 81). Ran it live in the checkout: `PASS: 225 modules (221 assigned, 4 unassigned)` — "62+ at seeding, grown since" is consistent with the worklist's "62-module ownership assignment (49c2ad3a8)". Checked out (with the nuance in concern 3).
- **Policy tier** (`scripts/local-proof-selection-policy.v1.json` + `scripts/select-local-proof.mjs` lines 291–319): `driftAlwaysRunGates: ["module-ownership"]`; `driftFailClosedCoreGates` includes `module-ownership`; `selectDriftProneGates` seeds every selection from the always-run set; `.githooks/pre-push` execs `drift-prone-gates.mjs pre-push`, which carries `SNAPBACK_DRIFT_GATES_BYPASS`. The closed ticket `issues/closed/20260809-ownership-gate-prepush-tier.md` records the ruling text §5 cites, including the "enforcement arm" designation. Checked out.
- **First slice** (`src/generation_activation.rs`, 263 lines): `GenerationActivation::activate_functions` composing `commit_function_generation(CommitFunctionGeneration …)` (kernel op at `src/storage.rs:1176,2597`), `activate_same_mode_network_generation` via `apply_same_mode_network_deployment_with_functions_classified` (`src/storage/auth_mode.rs:1287`); `clear_projection_plan_digests` has no non-test callers outside its `src/storage/projection_rebuild.rs:591` definition (only a comment in the coordinator references it) — "no activation callers" confirmed; `src/local.rs` calls `generation_activation::` 8 times (composition calls). Checked out.
- **Characterization envelope**: found `generation_activation_failed_then_retry_rebuilds_and_matches_materialization` (`src/local/tests.rs:16834`), `oq3_crash_after_projection_materialization_reopens_unpinned_and_retry_converges` (`src/local/tests.rs:17116`), `oq3_raw_dev_crash_cuts_use_durable_function_generation_record` (`src/storage/tests.rs:3336`), `oq3_failed_function_generation_composite_rolls_back_pins_enrollments_and_record` (`src/storage/tests.rs:3413`). The four envelope clauses in §4 map onto these. I did not independently re-verify at the code level that auth publication is inside the owning transaction on every path (the atomicity clause); it is consistent with 0199's OQ3 follow-up record and the rollback test.
- **Ratchet worklist** (`issues/20260809-0199-ownership-ratchet-worklist.md`): items 1–7 match §2's "kernel→background job helpers, kernel→sync auth call-ups, leaf residues" characterization and §4's worklist-item citations; growth events recorded at each landing as §5 asserts. Checked out.
- **§6 generator claims**: `scripts/guide-lib.mjs` reads `src/server.rs` (lines 620, 647); `scripts/capability-maturity.mjs` reads `src/manifest.rs` (lines 902, 943). Checked out.
- **Cited LLPs exist**: 0000, 0038, 0059, 0080, 0081, 0141, 0175, 0189, 0218 all present under `llp/`.

**5. Verdict**

VERDICT: READY

## Round 2 — 2026-08-10 (delta round)

- Reviewer: claude family — fresh general-purpose subagent (not the round-1
  reviewer, not the reviser), model claude-fable-5.
- Capsule: detached worktree at commit `0eac1d309` (0 target review
  artifacts present, verified).
- Target revision: (c), sha256 prefix `c6a373ebe1cae922`.
- Instructions: sr-review-r2 delta template (IN-DELTA vs PRE-EXISTING
  classification mandatory).
- Verdict: **READY** (binds to the capsule/target hashes above).

### Verbatim review

**1. Summary**

Revision (c) is a tightening round: it adds the monotonic-baseline rule, discloses the analyzer's `crate::`-only blindness with a binding extractor requirement, operationalizes the god-file no-growth rule, and corrects several factual details (three gate failure shapes; one-bypass/three-selection-gaps history). I verified every load-bearing (c) claim against the checkout — the gate script, manifest, baseline, policy tiers, the tracked gap issue, the live `super::` counterexample, and the corrected bypass history — and all of them hold. The document accurately describes the shipped state, and the delta closes the round-1 laundering/blindness gap honestly (interim rule: review carries the difference). I found no defective decision; the concerns below are worklist/wording completeness and enforcement-detail items.

**2. Direction assessment**

The direction is right. Consolidating LLP 0199's prose, the machine state (`ownership.manifest.json` / `ownership.baseline.json`), and the issue rulings into one governing record with a single amendment point is the correct move now that the abstractions are concrete repository objects; the seven-owner map matches the manifest exactly (owners, ordinals, ranks, `allowedDependencies` all verified, and the script enforces strictly-downward edges at `scripts/check-module-ownership.mjs:82-87`). The two delta decisions are both sound: (a) the monotonic-baseline rule is the right answer to the `--update-baseline`-overwrites-unconditionally laundering defect (verified: the script's update path at lines 461-467 writes the full current graph with no predecessor comparison), and stating that an unrecorded baseline growth violates the Decision even where tooling misses it correctly separates the norm from the arm; (b) disclosing the `crate::`-only extractor (verified: `extractCratePaths` at lines 302-328 anchors on `use crate ::` and `crate::` only) rather than letting the "blocking" claim stand unqualified, with a with-attribution re-derivation rule for newly visible edges, is exactly right. An implementer following §§1-5 plus the two tracked issues is not forced into a wrong guess anywhere I could find.

**3. Concerns**

1. **implementation-phase, PRE-EXISTING — the flagship coordinator's own frozen forbidden edges are outside the named burn-down.** §2 presents `issues/20260809-0199-ownership-ratchet-worklist.md` as "the standing burn-down of the grandfathered upward edges," and §4's first-slice account describes the extraction boundary without noting that `src/generation_activation.rs` itself carries two frozen forbidden edges: `-> src/auth/admission.rs` (coordinator→sync, sideways) and `-> src/local.rs` (→unassigned), both present in `ownership.baseline.json` (verified) and neither named anywhere in the 95-line worklist (verified by grep). These were evidently absorbed in the pre-monotonic era (the bypassed-push occurrence absorbed at the slice-2 re-baseline, per `issues/closed/20260809-ownership-gate-prepush-tier.md:21-22`). No decision is defective — they are frozen, not blessed, and §5's post-upgrade re-derivation would sweep them in — but the exemplar slice quietly violating its own declared dependencies deserves a worklist entry (or a one-line note in §4). Not a delta regression.

2. **implementation-phase, IN-DELTA — "every baseline growth event is recorded in the ratchet worklist, as is current practice" (§5) overstates the history.** The worklist's growth records begin at the slice-4 landing; the bypassed-push edges absorbed at the slice-2 re-baseline (including concern 1's coordinator edges) have no growth record. "Current practice" is accurate from slice-4 onward only. Fix shape: qualify the claim ("as has been practice since the slice-4 landing") or backfill the two missing records.

3. **implementation-phase, IN-DELTA — the monotonic-rule comparison base is unspecified.** §2 requires the gate to compare "the candidate baseline's forbidden-exception set against its predecessor," but with a fast-moving `main` and concurrent re-baselines, "predecessor" (parent commit's baseline? merge-base with the remote?) matters, as does how forbidden-ness is classified when the same landing amends `allowedDependencies` (§5 requires the prose amendment *first*, which mostly resolves it, pending OQ-B). The plausible implementer guess — merge-base attribution, matching the hook's existing detached-baseline machinery described in the closed pre-push-tier ticket — is right, and `issues/20260810-ownership-gate-analyzer-gaps.md` carries the fix direction, so no wrong-guess trap; one sentence in §5 or the issue would close it.

4. **implementation-phase, IN-DELTA — re-export resolution is the hard tail of the extractor requirement.** §5 requires resolving "re-exports relative to each module"; unlike `super`/`self`/grouped/alias forms, chained `pub use` re-export resolution is transitive name resolution, materially harder than the rest of the list. The requirement is still the right bar ("at least" + adversarial fixtures), but the implementer should know the last item may warrant its own sub-slice. No fix required in the document.

**4. Verifications performed**

- `ownership.manifest.json`: seven owner ids + `unassigned`, ordinals, layers/ranks, and `allowedDependencies` match §§1-2 exactly; `godFiles` = `local.rs`/`server.rs`/`storage.rs`; `mixedModuleScopes` for `local.rs`/`manifest.rs` and `uncertainAssignments` notes for `src/auth/lifecycle.rs` (background-services) and `src/runtime.rs` (transport-adapters) match §1, including the stale "targeted" prose §OQ's handoff note promises to refresh.
- `scripts/check-module-ownership.mjs` (496 lines, read in full): confirms the three failure shapes (§5) — unassigned/absent modules (lines 105-110), new forbidden edges incl. unassigned→god-file (409-431, 471-478), manifest/baseline self-consistency incl. sorted buckets and ordinal pins (75-134, 385-407); a naive god-file rename reds via lines 109-110; `crate::`-only extraction (302-328); unconditional `--update-baseline` overwrite (461-467).
- Analyzer-gap counterexample: `src/auth/provider.rs:38-39` imports `super::lifecycle`/`super::mailbox`; `ownership.baseline.json` contains neither edge (verified programmatically); `issues/20260810-ownership-gate-analyzer-gaps.md` exists and matches §2/§5's rule and re-derivation semantics.
- Gate tier: `module-ownership` is the sole member of `driftAlwaysRunGates` and first member of `driftFailClosedCoreGates` in `scripts/local-proof-selection-policy.v1.json` (lines 55-68), with `src/` prefix triggers; the closed ticket `issues/closed/20260809-ownership-gate-prepush-tier.md` records the 2026-08-10 ruling, the enforcement-arm designation, and the four occurrences (one bypass, three selection gaps) matching §5's corrected wording.
- First slice: `src/generation_activation.rs` is 263 lines, owned by `generation-activation-coordinator`, with `activate_functions` (line 56), `activate_same_mode_network_generation` (145), `commit_function_generation` (95), `apply_same_mode_network_deployment_with_functions_classified` (180); the clear-digest compensation has no activation callers (`clear_projection_plan_digests` defined at `src/storage/projection_rebuild.rs:591`, referenced only in `generation_activation.rs`'s escape-hatch comment, lines 242-246). Injected-crash and reopen characterization tests exist in `src/local/tests.rs` (e.g. lines 7458-8704, `same_mode_sessions_activation_projects_live_successor_before_reopening` at 10416); I spot-checked rather than exhaustively mapped all four envelope bullets to named tests.
- §6 generator claims: `scripts/guide-lib.mjs` reads `src/server.rs` (line 647); `scripts/capability-maturity.mjs` reads `src/manifest.rs` (lines 902, 943).
- §3's `with_auth_*` escape-hatch shape exists (`src/storage/pending_effects.rs`); worklist item 3 names it. LLP 0199 (`llp/0199-core-modularization.decision.md`) is Accepted with OQ1-OQ5 ruled and the 2026-08-09 OQ3 composite-commit follow-up in its revision history. LLP 0218 exists. Baseline: 223 modules / 1322 edges vs. 225 current `src/**/*.rs` files (consistent with edge-keyed, not count-keyed, checking).

**5. Verdict**

VERDICT: READY

## Round 3 — 2026-08-10 (delta round; final budgeted round)

- Reviewer: claude family — fresh general-purpose subagent, model
  claude-fable-5.
- Capsule: detached worktree at commit `ceb7803c4` (0 target review
  artifacts present, verified).
- Target revision: (d), sha256 prefix `d613322dc4e25fa4`.
- Instructions: sr-review-r3 delta template.
- Verdict: **NOT READY** (1 MATERIAL, IN-DELTA; binds to the capsule/target
  hashes above).

### Verbatim review

**Summary**

Revision (d) is a disciplined tightening: the monotonic-baseline rule now has a real provenance test, the first slice's two frozen forbidden edges are named and match `ownership.baseline.json` exactly, the raw-dev split-cut and reopen-inertness findings are honestly recorded with a tracking ticket that matches the code, and the analyzer-gap disclosure now matches what `scripts/check-module-ownership.mjs` actually does. I verified essentially every load-bearing repository claim in the delta and found them accurate. One self-consistency defect remains in the delta's normative text: the document's first application of its own waiver rule does not satisfy that rule — the reclassified `local.rs → connected_clients.rs` waiver exists nowhere but as a parenthetical note, with no worklist entry and no deadline, immediately after the text declares a bare note is never sufficient.

**Direction assessment**

The direction is right. Incremental owner extraction under a seven-owner map with strictly rank-decreasing dependencies, a single kernel commit primitive, and an unconditional pre-push structural gate is the correct consolidation of LLP 0199, and the shipped state matches the prose: the manifest carries exactly the seven owner ids plus `unassigned` with `allowedDependencies` exactly as §2 states (`ownership.manifest.json`, owners block); the gate is in both `driftAlwaysRunGates` and `driftFailClosedCoreGates` (`scripts/local-proof-selection-policy.v1.json:56,59`); the first slice exists as a 263-line coordinator (`src/generation_activation.rs`) whose seven baseline out-edges include precisely the two forbidden ones the document names (`ownership.baseline.json` edges 408, 411). The (d) decision to narrow the crash/reopen claim to what the landed tests prove, rather than paper over the reopen-inertness finding, is the right call and is corroborated by the code (`function_generation_record` is `#[allow(dead_code)]` at `src/storage.rs:2694`; reopen proofs run against `LocalDatabase` in `src/storage/tests.rs:3376-3404`).

**Concerns**

1. **MATERIAL, IN-DELTA — the connected-clients waiver reclassification violates the waiver rule it instantiates.** §2 (d) text: a genuinely new forbidden coupling "carries an explicit **time-bounded waiver** — a worklist entry naming the edge, the inversion owner, and a deadline, referenced from this Decision's amendment record … never freezable by note," followed by "(The 2026-08-10 `src/local.rs → src/connected_clients.rs` freeze predates this rule and is hereby reclassified as such a waiver…)". Repo evidence: the edge is frozen in `ownership.baseline.json` (edge 501), but `grep -rn connected_clients issues/` returns nothing — there is no worklist entry in `issues/20260809-0199-ownership-ratchet-worklist.md` or anywhere else, and no deadline exists (§4 is explicitly "order of intent, not a schedule," so "at the local.rs drainage slices" is a milestone, not a deadline). The rule's canonical first instance is therefore exactly the "bare note" the rule forbids, and the next agent granting a waiver will plausibly — and wrongly — follow that precedent. Fix shape (small): either add the worklist entry for this edge (naming inversion owner and a bound) in the acceptance-handoff list alongside the other same-landing items, or amend the rule to admit named-slice milestone bounds and state explicitly that this paragraph plus a worklist entry constitutes the record.

2. **implementation-phase, IN-DELTA — the cited tracking ticket now contradicts the corrected disclosure.** §5 (d) correctly states grouped use-trees, aliases, and `pub use crate::` re-exports **are** parsed (verified: `useTreePaths` handles `{}`/`as`/`*` and `\buse\s+crate\s*::` matches `pub use`, `scripts/check-module-ownership.mjs:242-317`) and only `super::`/`self::` roots and chained re-exports are invisible (verified: line 274 discards `super`, and both extraction patterns require a `crate::` root; `src/auth/provider.rs:29-42` carries the live `super::lifecycle`/`super::mailbox` counterexample). But `issues/20260810-ownership-gate-analyzer-gaps.md` still says "grouped imports, aliases, and re-exports are invisible." The document is right and the ticket is stale; refresh the ticket wording at the next landing so the requirement's tracking record matches the requirement.

3. **implementation-phase, IN-DELTA — revision-history ordering.** The Revision history lists (a), (b), (d), (c) — neither chronological nor reverse-chronological (lines 454-483). Cosmetic; reorder.

No PRE-EXISTING MATERIAL concerns found: §3's commit-authority claims verified against the kernel (durable sequence enrollment happens inside the `commit_function_generation` transaction, `src/storage.rs:2627-2690`; `install_committed_sequence_declarations` is in-memory only, so the transcript catalog at `src/generation_activation.rs:119` is the *only* durable split cut, exactly as (d) records); §6's generator claims verified (`scripts/guide-lib.mjs:620,647` reads `src/server.rs`; `scripts/capability-maturity.mjs:902,943` reads `src/manifest.rs`).

**Verifications performed**

- `ownership.manifest.json`: seven owners + `unassigned`, ranks/layers, per-owner `allowedDependencies` (all strictly rank-decreasing, matching §2's rules verbatim), `godFiles`, `mixedModuleScopes` for `local.rs`/`manifest.rs` (the "targeted" staleness the OQ handoff acknowledges is real), `uncertainAssignments` notes for `src/auth/lifecycle.rs` and `src/runtime.rs` (match §1's paraphrases), `governedBy` still pointing only at LLP 0199 (consistent with the handoff obligation).
- `ownership.baseline.json`: coordinator out-edges 408-414 (two forbidden: `→ src/auth/admission.rs` [sync-realtime-engine], `→ src/local.rs` [unassigned]; five allowed), edge 501 `src/local.rs → src/connected_clients.rs`.
- `scripts/check-module-ownership.mjs` (all 496 lines): comment/literal masking, grouped/alias/`pub use crate::` parsing, `super`/`self` invisibility, longest-prefix module resolution (no chained re-export following), the three failure shapes (unassigned module via `validateManifest`, new forbidden edge via `findNewViolations`, manifest/baseline self-consistency asserts), and the unconditional `--update-baseline` overwrite (lines 461-467) — matching §2's "defect of the arm" admission.
- `src/generation_activation.rs`: imports at lines 8-14 (the two named forbidden edges), raw-dev ordering at lines 95-130 (`commit_function_generation` then separate `activate_stream_transcript_manifest` — the recorded split cut).
- `issues/20260810-raw-dev-activation-split-cut-and-reopen-inertness.md`, `issues/20260810-ownership-gate-analyzer-gaps.md`, `issues/closed/20260809-ownership-gate-prepush-tier.md` (records the bypassed push and fixed-forward occurrences), `issues/20260809-0199-ownership-ratchet-worklist.md` (items 1-7 match §4's worklist references; no connected-clients entry), `issues/20260808-core-modularization-decision.md` — all exist.
- LLP 0199 exists at `llp/0199-core-modularization.decision.md`, Status Accepted.
- `scripts/local-proof-selection-policy.v1.json`: `driftAlwaysRunGates: ["module-ownership"]`, `driftFailClosedCoreGates` membership, gate registration.
- `src/storage/tests.rs`: kernel-level reopen and injected-failure tests supporting the narrowed envelope claims.
- Not verified: git-history dating of the connected-clients freeze (took the document's 2026-08-10 date on trust) and the "62+ modules at seeding" count (current manifest holds 225 module entries, consistent with "grown since").

VERDICT: NOT READY
