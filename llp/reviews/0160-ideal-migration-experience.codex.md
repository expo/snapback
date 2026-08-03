# LLP 0160 ideal migration experience review — Codex family

## Round 1 — 2026-08-03 (target v0.1, SHA-256 72d903fb8d673a0b77d3b64ee3eb5ea8d07cd4c1ba567af8e8967c5b4abf0a28)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context over the working tree at 50ff432a; instruction capsule at review time pinned the target SHA, named the governing corpus docs to read, and barred reading llp/reviews/. Orchestrated by the Fable session that authored the draft, which therefore does not count as a reviewer; the review is recorded verbatim below.

---

## 1. Overall assessment

LLP 0160 has a strong experience thesis and useful moment-by-moment structure, but it is not yet an honest zero-semantics-change RFC. Moment 5 conflicts directly with LLP 0081’s approval and restore-derived rehearsal protocol; Moments 3 and 6 render facts the existing artifacts or journal do not contain and misstate rollback/safety boundaries; and the actionable gap ledger contains two already-resolved gaps. The prior-art core is sound, but several claims exceed their cited diary evidence. These are substantive defects in the RFC’s central contract, not editorial polish.

## 2. Verdict — READY or NOT READY

**NOT READY**

## 3. Strengths

- The ownership boundary is unusually clear: “LLP 0081 owns migration semantics” and LLP 0160 owns presentation and sequencing (`llp/0160-ideal-migration-experience.rfc.md:10-15`).

- The progression from refusal through preview, approval, progress, receipt, and client impact is the right structure for an experience-layer RFC (§2). “The refusal is the front door” is particularly strong agent-first guidance (§3.2).

- The central SpacetimeDB lesson is supported: the diary records a concrete plan, named additive indexed-field migration, retained rows, and explicit disconnect consequence (`diaries/0029-linear-backend-bakeoff.diary.md:580-583,615-617,649-659`).

- The Convex, Supabase, Firebase, and PocketBase summaries are mostly faithful. The quoted Convex and Supabase conclusions appear verbatim or nearly verbatim (`diaries/0029-linear-backend-bakeoff.diary.md:473-476,375-378,427-428`); PocketBase’s 41% word delta, four runtime-discovered mistakes, and excellent rollback are supported (`diaries/0050-pocketbase-snapback-npm-bakeoff.diary.md:55-77,179-192`).

- The Triplit absorption is accurately characterized, including that LLP 0037 deliberately left ownership to “whichever document owns deployed-client schema evolution” (`llp/0037-schema-source-of-truth.decision.md:180-195`).

- G1 and G5 are real: all migration commands pass through a JSON-only emitter (`src/cli.rs:7938-7956`), and `MigrateCommand` has no `Status` variant (`src/cli.rs:917-1032`).

- G8 is accurate and important. The executor fixture has two rows (`src/storage/migration_executor.rs:4066-4079`), the batch size is 512 (`src/storage/migration_executor.rs:824-825`), the acceptance corpus also uses two rows (`tests/migration_corpus_v0.rs:177-190`), and fault injection is a test-thread panic caught in-process (`src/storage/migration_executor.rs:330-374,5184-5212`).

- LLP 0158’s throwaway-first posture is conceptually compatible with migration rehearsal: disposable, quarantined forks with diff receipts are explicitly its design center (`llp/0158-instance-forking.rfc.md:151-154,201-211,643-683`).

## 4. Concerns

- **BLOCKING — Moment 5 changes LLP 0081’s rehearsal semantics.**

  Claim: “`preview --rehearse` forks the target … [and] executes the plan.”

  Evidence: LLP 0081 requires rehearsal to execute an **approved production plan** against the one restore-derived database named by a sealed `MigrationRehearsalPlanV1`; production later consumes that marked receipt (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:259-280,653-664`). The implementation enforces approval, isolated-target identity, freshness, and receipt consumption (`src/local.rs:33377-33479`). `preview` currently generates an unapproved artifact. LLP 0158 also leaves identity OQ9, the safety corpus, and the migration-rehearsal value comparison unresolved (`llp/0158-instance-forking.rfc.md:953-968,986-1013`).

  Resolution: keep approval before execution and make forking a quality-of-implementation accelerator behind `migrate rehearse`, for example `rehearse --fork`. The fork must still satisfy the existing sealed restore-derived binding. If direct fork snapshots are to replace that binding, LLP 0081 needs a semantic amendment and LLP 0160 must withdraw its zero-semantics claim.

- **MAJOR — The RFC silently removes required migration-intent authoring.**

  Claim: “The schema edit itself is the only authoring act.”

  Evidence: LLP 0081 includes “declared migration intents supplied by the author” among canonical planning inputs (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:121-129`). The CLI derives only unambiguous, semantics-free changes; renames, conversions, and required-field backfills require explicit intents (`src/cli.rs:923-932,8027-8034`).

  Resolution: add an explicit intent-authoring moment and define how the refusal helps create or locate that intent. A refusal cannot safely print a full plan for an ambiguous rename or conversion before the intent exists.

- **MAJOR — Moment 3 is not renderable solely from the claimed existing fields.**

  Claim: “Every line derives only from fields inside the digested body … plus the separately-digested preview observation.”

  Evidence: `MigrationPlanBody` has steps, proof, ceilings, postures, backup, expected output, constants, and boundaries, but no canonical “all rows retained,” expected restamped-row count, total batch count, or after-release rollback verdict (`src/migration.rs:481-514`). `planId` is outside the body (`src/migration.rs:518-527`). Row estimates can live in `preconditionRows` (`src/migration.rs:1191-1215`), but current preview always emits that map empty (`src/cli.rs:8083-8090`). Thus G1 is not “pure rendering over existing fields” for the shown example. “All rows retained” and “1,204 rows re-stamped” require semantic interpretation of steps plus an observation that does not currently exist.

  Resolution: add a normative mapping from every rendered phrase to a concrete JSON pointer. Remove facts that are not present, or separately amend LLP 0081 to add canonical impact-summary fields and populate the observation. The latter is not a zero-semantics/artifact change.

- **MAJOR — The rollback rendering is semantically wrong.**

  Claim: “Rollback: fast republish available until release; irreversible after.”

  Evidence: fast predecessor republish is available only while still fenced before release, but after release the valid paths are a separately approved reverse plan or restore. Irreversibility applies only when neither exists (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:579-630`). The local profile has no operator-controlled release verb or deliberate hold point (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:281-285`).

  Resolution: render separate facts: “fast republish window,” “reverse-plan availability,” “restore requirement/availability,” and “declared irreversible boundary.” Do not equate closure of fast republish with generic irreversibility.

- **MAJOR — Moment 6 promises journal facts and safety certainty the journal does not provide.**

  Claim: “`executing 3/12 batches` … because the journal already contains exactly this” and “their data is safe (it always is; say so).”

  Evidence: journal state contains `step` and current `batch`, not a total batch count (`src/storage/migration_executor.rs:51-81,181-211`). LLP 0081 also reserves ambiguous publication for corruption or target atomicity violations and requires inspection rather than guessing (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:392-399,452-458`).

  Resolution: show only observed journal facts, such as `executing step X, batch 3`; label any estimated total separately. Use state-specific safety language and preserve an explicit “publication ambiguous—inspection required” posture.

- **MAJOR — G3 is a resolved historical defect, not a current gap.**

  Claim: “Live-subscriber schema evolution wedges the dev loop … worst current experience.”

  Evidence: the ticket is marked resolved and records a passing live-subscriber acceptance witness (`issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md:1-9,42-67`). LLP 0058 records the fix (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:13-18,987-1003`).

  Resolution: remove G3 from the current ledger. Retain it only as a historical lesson about why live-client migration evidence belongs in the ideal experience.

- **MAJOR — G4 is already implemented.**

  Claim: “Client SDK upgrade-required/quarantine UX unbuilt.”

  Evidence: the cited acceptance ticket says the residual landed on 2026-07-26 and exposes typed `surface.migrationBoundary()` state while preserving queued mutations (`issues/closed/20260724-step5-impl-0081-journal-events.md:95-132`). The TypeScript surface declares it (`packages/snapback-contract/index.d.mts:405-408`), implementation and tests exist, and the guide teaches it (`guide/sync/offline-and-retention.md:381-413`).

  Resolution: remove G4 or narrow it to an actually missing layer, such as first-party React/Expo presentation components or richer copy including pending-count details. Do not describe the SDK state itself as unbuilt.

- **MATERIAL — Moment 1 misstates today’s sessions-mode developer loop.**

  Claim: “the LLP 0007 applier applies [additive changes] at startup, silently.”

  Evidence: for sessions-mode apps, the documented working path is running `snapback dev` watch reload. Stop/regenerate/restart refuses with `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` (`guide/getting-started/the-authoring-loop.md:158-180`).

  Resolution: distinguish dev-mode startup application from sessions-mode live reload and cold-start refusal. The ideal may remain low-ceremony, but it is not uniformly “silent at startup.”

- **MATERIAL — Several prior-art claims exceed the cited provenance.**

  Claim: Firebase “has no workflow at all”; SpacetimeDB’s plan said “all 500 issues were retained” up front; and “there is no approval artifact, no receipt, no independent proof.”

  Evidence: the Firebase diary says its migration was operational code rather than a **first-class** workflow, not that no workflow existed (`diaries/0029-linear-backend-bakeoff.diary.md:207-209`). The SpacetimeDB diary establishes a concrete plan and the eventual 500-row preservation, but does not unambiguously attribute the exact retained-row count to preflight or establish the three negative artifact claims (`diaries/0029-linear-backend-bakeoff.diary.md:580-606,615-617`). It says “unstable SQL syntax,” not broadly “unstable CLI syntax.”

  Resolution: qualify these as observed-arm conclusions, cite retained raw CLI evidence, or weaken them. Replace “no workflow at all” with “no first-class migration workflow in the observed arm.”

- **MATERIAL — The ideal approval rendering omits safety-critical authority and target facts.**

  Claim: “approval is one legible act” showing “the same rendering.”

  Evidence: LLP 0081 makes exact audience identity, approver principal, expiry, policy digest, operation ID, generator/approver relationship, backup/checkpoint, and rehearsal policy approval-critical (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:221-257,640-664`). None appears in Moment 3’s rendering.

  Resolution: require an approval block showing resolved target/audience, predecessor and successor identities, approver and expiry, backup/rehearsal status, retained-work posture, and whether generator and approver are distinct. Define separate local and hosted renderings.

- **MINOR — G6’s core is right, but “undiscoverable” is overstated.**

  Claim: “the bakeoff-praised workflow is undiscoverable from `guide/`.”

  Evidence: there is no dedicated end-to-end migration workflow page, but the authoring-loop guide directs destructive changes to LLP 0081 (`guide/getting-started/the-authoring-loop.md:173-180`), and client migration boundaries are documented in the offline guide.

  Resolution: state the precise gap: no guide page teaches the operator CLI journey from preview through rollback.

## 5. Suggestions

- Add a rendering traceability table: rendered phrase, authoritative JSON pointer, observation/journal source, and when it is valid.

- Divide the gap ledger into `verified current gap`, `resolved historical lesson`, and `blocked future enhancement`, with the verification date or source revision.

- Specify stdout/stderr behavior. Human text mixed with the existing JSON envelope would break machine consumers; define default, `--json`, file output, and terminal-detection behavior explicitly.

- Add golden rendering fixtures for successor-only, dual-compatible, predeploy-compatible, sampled rehearsal, failed precondition, cancelled, ambiguous publication, and rollback receipts.

- Clarify that `verify` re-proves receipt-to-journal identity and re-presents the at-publication proof; it does not re-digest a post-release live database (`src/storage/migration_executor.rs:3782-3847`).

- Expand the recovery experience beyond `status`: operation discovery, resume/re-invocation, cancellation, abandoned state, cleanup-pending, and how an operator recovers the operation ID after a terminal dies.

## 6. Open questions for the author

1. Is “zero LLP 0081 semantic or artifact changes” absolute? If so, should fork-based rehearsal be only an implementation accelerator behind the existing `rehearse` verb?

2. What is the intended authoring experience for explicit rename, conversion, and backfill intents?

3. Is the remaining client gap actually prebuilt framework UI over the shipped `migrationBoundary()` state, rather than SDK protocol/state?

4. Is this north star local-profile-only, or must its renderings cover hosted control-plane approval, backup custody, and target audience?

5. Is there retained raw SpacetimeDB output proving that the preflight itself printed the 500-row preservation claim and supporting the negative artifact claims?

## 7. Recommended next step

Revise and remain **Draft**: remove or narrow G3 and G4; restore explicit intent authoring; correct Moments 1, 3, 5, and 6 against LLP 0081; add target/approval/backup rendering; and tighten the SpacetimeDB/Firebase provenance. Then rerun an independent semantic review against a new pinned hash before moving toward Review.


---

## Round 2 — 2026-08-03 (target v0.2, SHA-256 db7cfdf4bf9d0ff6e9aa4d93dc81f86fc02ea9926718d74dd60b31f6b94e816d)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context, blind to prior rounds and to llp/reviews/; same capsule shape as round 1, retargeted at the v0.2 bytes. Recorded verbatim below.

---

## 1. Overall assessment

LLP 0160 is a strong north-star with unusually good traceability discipline, and most gap-ledger claims survive inspection. It is nevertheless not ready: Moment 3 misstates what approval binds, Moments 7 and 8 treat unimplemented LLP 0081 obligations as presentation-only work, the SpacetimeDB comparison overstates the absence of an operator gate, and the promised rollback experience is not actually designed.

## 2. Verdict — NOT READY

## 3. Strengths

- The semantic ownership boundary is explicit and generally respected (§2, §3). Fork rehearsal is correctly framed as an accelerator behind the existing `rehearse` verb, with informational forks explicitly unable to satisfy §7. That matches LLP 0081’s sealed restore-derived binding and LLP 0158’s throwaway-first posture (`llp/0160-ideal-migration-experience.rfc.md:201`, `llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:653`, `llp/0158-instance-forking.rfc.md:176`, `llp/0158-instance-forking.rfc.md:226`).

- Moment 3’s source taxonomy is sound in structure: plan facts come from the digested body, row observations have a separately digested carrier, and journal facts remain distinct (`llp/0160-ideal-migration-experience.rfc.md:180`; `src/migration.rs:486`, `src/migration.rs:1191`). The example’s steps, ceilings, posture, proof method, and target profile are representable by existing fields.

- The revised G3 disposition is accurate. The defect, root cause, regression tests, acceptance witness, and packaged re-verification all exist (`issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md:1`, `issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md:42`, `issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md:54`, `issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md:62`).

- G1, G5, G6, G8, and G9 correctly identify real tree conditions:

  - Every migration handler goes through JSON-only `migrate_emit` (`src/cli.rs:7938`, `src/cli.rs:8005`).
  - `MigrateCommand` has no `Status` variant (`src/cli.rs:917`).
  - The guide has only a short LLP 0081 pointer and no capability-index row (`guide/getting-started/the-authoring-loop.md:158`, `guide/capabilities.md:31`).
  - The executor fixture contains two rows, the batch size is 512, and kill injection is an in-process panic caught by `catch_unwind` (`src/storage/migration_executor.rs:825`, `src/storage/migration_executor.rs:4066`, `src/storage/migration_executor.rs:5184`).
  - The rollback and verify CLI comments are stale relative to their handlers (`src/cli.rs:1016`, `src/cli.rs:1025`, `src/cli.rs:8245`, `src/cli.rs:8252`).

- The diary-derived Firebase, Supabase, Convex workflow, SpacetimeDB plan rendering, and PocketBase measurements are otherwise accurately quoted or paraphrased (`diaries/0029-linear-backend-bakeoff.diary.md:207`, `diaries/0029-linear-backend-bakeoff.diary.md:375`, `diaries/0029-linear-backend-bakeoff.diary.md:473`, `diaries/0029-linear-backend-bakeoff.diary.md:580`, `diaries/0050-pocketbase-snapback-npm-bakeoff.diary.md:55`, `diaries/0050-pocketbase-snapback-npm-bakeoff.diary.md:173`).

- The statement that LLP 0037 left the deployed-client evolution owner unnamed is correct (`llp/0037-schema-source-of-truth.decision.md:180`, `llp/0037-schema-source-of-truth.decision.md:194`).

## 4. Concerns — each with severity BLOCKING / MAJOR / MATERIAL / MINOR, the exact claim at issue (quote it), the evidence (file:line where applicable), and what would resolve it

1. **MAJOR — Moment 3 misstates the approval binding.**

   - Claim: `"(preview estimate — not approval-covered)"` (`llp/0160-ideal-migration-experience.rfc.md:163`).
   - Evidence: LLP 0081 says the observation is not execution authority, but approval binds “the observation digest it reviewed” and the receipt retains it as review context (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:199`, `llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:221`). The implementation does exactly that through `observation_digest` (`src/migration.rs:1393`, `src/cli.rs:8120`).
   - Resolution: label it “approval-bound review context; not plan authority or an admission precondition.” Moment 4 should explicitly include the observation digest and distinguish review binding from execution authority.

2. **MAJOR — Moment 7 is not renderable from today’s receipt, contrary to the gap ledger’s rendering-only framing.**

   - Claim: verify will present `"expected vs. actual digests, counts, postures, rollback-window status"` (`llp/0160-ideal-migration-experience.rfc.md:235`), while G1 calls the work `"rendering over existing fields"` (`llp/0160-ideal-migration-experience.rfc.md:287`).
   - Evidence: LLP 0081 requires the receipt to bind plan bytes, backup/checkpoint, verification proof, compatibility posture, and rollback posture (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:686`). The current `MigrationReceiptV1` lacks plan bytes, backup/checkpoint, and both postures (`src/storage/migration_executor.rs:218`). Its proof stores only the successful actual digests after comparison, not expected and actual values (`src/storage/migration_executor.rs:3292`). Verify returns state, the recorded proof, and an optional rollback receipt (`src/storage/migration_executor.rs:3782`).
   - Resolution: record this as LLP 0081 implementation drift, not an 0081 amendment and not mere rendering. Either first bring the receipt/verify implementation into conformance and name that work in the ledger, or narrow Moment 7 to the fields verify currently returns.

3. **MAJOR — Moment 8 and G4′ incorrectly reduce the remaining client work to presentation.**

   - Claims: `"the remaining ideal is presentation"` and `"your 3 offline changes are saved and will sync after updating"` (`llp/0160-ideal-migration-experience.rfc.md:247`); G4′ similarly says only `"Client presentation over shipped migrationBoundary() state"` remains (`llp/0160-ideal-migration-experience.rfc.md:290`).
   - Evidence: the shipped vocabulary is `resync-required | upgrade-required`, not “resnapshot” (`packages/snapback-contract/index.d.mts:405`). More importantly, after an artifact upgrade the successor surface receives a redacted `SNAPBACK_CLIENT_ARTIFACT_STALE` tombstone, discards the arguments, and requires the application to re-enter the mutation; the test explicitly says automatic cross-artifact settlement still needs a protocol successor (`packages/snapback-contract/migration-quarantine.test.mjs:267`, `packages/snapback-contract/migration-quarantine.test.mjs:298`, `packages/snapback-contract/migration-quarantine.test.mjs:318`). The guide describes the same boundary (`guide/sync/offline-and-retention.md:393`, `guide/sync/offline-and-retention.md:408`). The RFC’s own open question admits the non-JS protocol owner is unresolved (`llp/0160-ideal-migration-experience.rfc.md:318`).
   - Resolution: split G4′ into presentation work and a separate LLP 0081 conformance/protocol gap for cross-artifact payload custody, automatic settlement, and non-JS carriers. Until that lands, use honest copy such as “your changes need review and re-entry after updating.”

4. **MATERIAL — G1 omits the observation-population work needed by its own example.**

   - Claim: G1 is `"rendering over existing fields"` and Moment 3 shows `"preflight: ~1,204 rows"` (`llp/0160-ideal-migration-experience.rfc.md:163`, `llp/0160-ideal-migration-experience.rfc.md:287`).
   - Evidence: `MigrationPreviewObservationV1.precondition_rows` is the correct separately digested carrier (`src/migration.rs:1191`), but the actual preview handler always initializes it empty (`src/cli.rs:8083`). Thus the attribution is correct, but today’s command cannot produce the displayed fact.
   - Resolution: add observation/preflight population to G1 or create a separate gap row; retain omission as the required rendering when no estimate was observed.

5. **MATERIAL — two prior-art statements exceed their provenance.**

   - Claim: SpacetimeDB’s `"plan-then-apply flow has no operator gate"` (`llp/0160-ideal-migration-experience.rfc.md:77`).
   - Evidence: the diary does not establish that absence, and the retained publish log says `"Skipping confirmation due to --yes"`, demonstrating an ordinary confirmation gate was bypassed (`demos/backend-bakeoff/arms/linear/spacetimedb/evidence/migration-publish.log:52`). What the evidence supports is the absence of an authenticated, digest-bound approval artifact and receipt.
   - Claim: under the `[observed — diary 0029]` Convex label, `"Online-with-connected-clients is its genuine strength"` (`llp/0160-ideal-migration-experience.rfc.md:82`).
   - Evidence: the diary observed an application-authored rollout but not a migration conducted across connected clients (`diaries/0029-linear-backend-bakeoff.diary.md:473`). LLP 0159 labels the connected-client conclusion as inferred architecture reading (`llp/0159-universal-table-storage-layout.research.md:105`).
   - Resolution: narrow the SpacetimeDB sentence to “no authenticated approval artifact was observed,” and tag the Convex connected-client conclusion as inferred rather than observed.

6. **MATERIAL — the promised rollback experience is missing from the moment sequence.**

   - Claim: the RFC owns what the operator sees when a migration is `"rolled back"` (`llp/0160-ideal-migration-experience.rfc.md:54`).
   - Evidence: Moment 3 summarizes rollback boundaries and Moment 7 mentions status, but no moment specifies invoking rollback, confirmation, progress, refusal recovery, reverse-plan handoff, restore handoff, or rollback-receipt rendering. LLP 0081 distinguishes pre-publication discard, `published-held` fast republish, post-release reverse plan or restore, and explicit irreversibility (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:579`). Current CLI comment/handler drift makes this especially non-theoretical (`src/cli.rs:1025`, `src/cli.rs:8252`).
   - Resolution: add a rollback moment covering each §6 branch and extend the ledger beyond G9’s documentation audit.

7. **MINOR — the claimed full fence rendering is not actually a full enumeration.**

   - Claim: `"fence closes every registered lane (queries, mutations, jobs, cron, egress)"` (`llp/0160-ideal-migration-experience.rfc.md:170`).
   - Evidence: LLP 0081 also explicitly names subscriptions, workers, and actions (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:371`).
   - Resolution: include the full closed set or introduce the parenthetical with “including” so it cannot be mistaken for the complete registry.

## 5. Suggestions (non-blocking improvements)

- Replace the truncated applier characterization `"explicit migrations are not supported"` with the actual class-specific wording; the source says `"explicit drop/backfill migrations are not supported"` (`src/storage.rs:10624`).

- Qualify `"the 80% case"` unless there is telemetry supporting that percentage (`llp/0160-ideal-migration-experience.rfc.md:131`).

- Recast `"No system in the bakeoff has more than one of these"` as an evidence-bounded statement. The bakeoff did not systematically test every listed approval, rehearsal, receipt, and proof property for every provider (`llp/0160-ideal-migration-experience.rfc.md:275`).

- Add a plan-to-plan review experience for stale previews: show what changed since the previously reviewed plan and which approval facts caused reapproval, rather than merely naming the next command.

- Separate “current shipped gaps,” “implementation drift from LLP 0081,” and “new ideal requiring an LLP 0081 amendment” in the ledger. They currently have materially different governance implications.

## 6. Open questions for the author

1. Is Moment 7 intended to describe LLP 0081’s normative receipt or the artifact the current CLI actually returns? The text currently moves between those two without naming the implementation drift.

2. Does Moment 8 intend automatic cross-artifact replay, or app-mediated re-entry after a redacted tombstone? Only the former supports the proposed end-user copy.

3. By “operator gate” in the SpacetimeDB comparison, do you specifically mean authenticated, digest-bound approval authority rather than ordinary interactive confirmation?

4. Should rollback become Moment 9, or is rollback experience intentionally outside this RFC despite the ownership claim in the introduction?

5. Should observation population and receipt/client conformance get their own G-rows before G1 and G4′ are sized?

## 7. Recommended next step

Revise and remain Draft. Correct the approval-binding language, split presentation work from LLP 0081 implementation-conformance work in Moments 7–8 and the ledger, repair the prior-art provenance, and add the missing rollback moment. Then run another independent super-refine review on frozen revised bytes.


---

## Round 3 — 2026-08-03 (target v0.3, SHA-256 f742be9db524514d4092217bb370b51b34c675fa03252d12381d337e9022e69f)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context, blind to prior rounds and to llp/reviews/; same capsule shape, retargeted at the v0.3 bytes. Recorded verbatim below.

---

## 1. Overall assessment

The reviewed SHA matches the requested `f742be…e69f`. The RFC is unusually strong on provenance, plan-versus-observation authority, and honest labeling of future amendments; most prior-art claims and requested ledger checks are accurate. It is not yet semantically clean, however: Moment 8 misclassifies a likely LLP 0081 implementation drift as a future protocol amendment, Moment 9 promises shadow disposal that §4 does not guarantee, and the “verified” drift ledger misses material CLI, dry-run, capability-binding, and receipt discrepancies.

## 2. Verdict — NOT READY

The RFC needs another revision before it can credibly claim “zero LLP 0081 semantic changes” or a tree-verified gap ledger.

## 3. Strengths

- **Moment 3 gets the authority split right.** Plan fields, fixed LLP 0081 rules, and separately digested observations are clearly distinguished, and the estimate is correctly labeled as review context bound by approval but lacking plan authority ([0160:171](</Users/ccheever/projects/snapback/llp/0160-ideal-migration-experience.rfc.md:171>), [0081:175](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:175>), [migration.rs:1184](</Users/ccheever/projects/snapback/src/migration.rs:1184>)).
- **Prior art is balanced and well-provenanced.** The Firebase, Supabase, Convex, SpacetimeDB, Appwrite, InstantDB, and PocketBase quotations or paraphrases are supported by the diaries. The SpacetimeDB log does show a concrete migration plan, client-disconnection warning, and `--yes`-bypassed confirmation ([migration-publish.log:5](</Users/ccheever/projects/snapback/demos/backend-bakeoff/arms/linear/spacetimedb/evidence/migration-publish.log:5>)).
- **Moment 5 fits LLP 0158’s throwaway-first posture.** It correctly separates an informational fork experiment from a receipt-bearing rehearsal and flags the fork-image binding as a possible dated §7 amendment rather than assuming equivalence ([0158:176](</Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:176>), [0158:226](</Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:226>)).
- **The Triplit ownership description is accurate.** LLP 0037 explicitly left the runtime compatibility verdict to “whichever document owns deployed-client schema evolution” ([0037:180](</Users/ccheever/projects/snapback/llp/0037-schema-source-of-truth.decision.md:180>)).
- **Most requested ledger spot-checks pass.** G1, G3’s resolution, G5, G6, G8, and G11 are supported by the tree. In particular, preview emits only the JSON envelope, no `status` variant exists, `preconditionRows` is empty, and the migration fixture has two rows with panic-based—not process-kill—fault injection ([cli.rs:7938](</Users/ccheever/projects/snapback/src/cli.rs:7938>), [cli.rs:917](</Users/ccheever/projects/snapback/src/cli.rs:917>), [cli.rs:8083](</Users/ccheever/projects/snapback/src/cli.rs:8083>), [migration_executor.rs:4066](</Users/ccheever/projects/snapback/src/storage/migration_executor.rs:4066>), [migration_executor.rs:330](</Users/ccheever/projects/snapback/src/storage/migration_executor.rs:330>)).

## 4. Concerns

1. **MAJOR — Moment 8 and G4′b misclassify the client-custody discrepancy.**

   **Claim:** “automatic cross-artifact settlement is an explicitly named protocol successor, not shipped behavior,” and G4′b classifies it as amendment-required.

   **Evidence:** LLP 0081 says incompatible-client mutations are quarantined for resync-before-replay rather than replayed or dropped, and its acceptance requires the quarantined mutation to “settle[] through resync-before-replay” ([0081:442](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:442>), [0081:758](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:758>)). Shipped behavior instead removes the pending record, discards its arguments, emits a failed tombstone, and requires application re-entry ([offline-and-retention.md:408](</Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:408>), [migration-quarantine.test.mjs:298](</Users/ccheever/projects/snapback/packages/snapback-contract/migration-quarantine.test.mjs:298>)). The proposed copy—“your 3 offline changes are saved; after updating you'll be asked to confirm them”—also overstates custody because the successor no longer has the arguments needed to show or confirm those changes.

   **Resolution:** Decide explicitly whether LLP 0081 already requires cross-artifact settlement. If yes, classify shipped tombstone behavior as **D** and conform it. If no, land a dated LLP 0081 amendment defining tombstone-and-re-entry semantics, then retain class **A**. In either case, change the copy to disclose that change details will be discarded and must be re-entered.

2. **MAJOR — G9 is not merely doc-comment drift; the shipped CLI contract differs from LLP 0081.**

   **Claim:** “Verb-maturity drift: the `Rollback` verb's doc comment claims unavailability while a real handler exists; verify's doc comment likewise predates its handler.”

   **Evidence:** LLP 0081 specifies `verify migration.json`, `rollback migration-receipt.json`, and dry-run support for every command ([0081:259](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:259>)). The tree’s `verify` accepts `--operation-id`; `rollback` calls its argument `receipt` but deserializes it as `MigrateApprovedFile`, not `MigrationReceiptV1`; and only `Apply` has a `dry_run` flag ([cli.rs:1016](</Users/ccheever/projects/snapback/src/cli.rs:1016>), [cli.rs:8245](</Users/ccheever/projects/snapback/src/cli.rs:8245>), [cli.rs:8252](</Users/ccheever/projects/snapback/src/cli.rs:8252>), [cli.rs:969](</Users/ccheever/projects/snapback/src/cli.rs:969>)).

   **Resolution:** Expand G9 or add separate D rows for verify input, rollback input, and per-command dry-run conformance. Either conform the CLI or propose explicit dated §2 amendments.

3. **MAJOR — Moment 6 overstates what `apply --dry-run` means.**

   **Claim:** It answers “what would admission say right now, without writing.”

   **Evidence:** The implementation validates the plan against the schema and checks only approval structure before returning `"wouldApply": true` ([cli.rs:8170](</Users/ccheever/projects/snapback/src/cli.rs:8170>)). It does not check resolved-audience equality, current expiry, rehearsal or backup requirements, resource/data preconditions, or the under-fence predecessor state required by LLP 0081 admission ([0081:221](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:221>)).

   **Resolution:** Define dry-run as a non-authoritative pre-admission estimate that actual admission re-proves under the fence, or implement a shared read-only admission evaluator with explicit uncheckable-under-concurrency fields. Add the implementation gap to the ledger.

4. **MAJOR — Moment 9 changes §4’s pre-publication disposition.**

   **Claim:** “shadow work discarded, predecessor authoritative.”

   **Evidence:** LLP 0081 permits unpublished shadow state to be resumed or discarded, and safe abort may “discard or park” it according to the journal ([0081:452](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:452>), [0081:476](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:476>)). The executor’s cancellation path journals terminal state and clears the fence but performs no universal shadow deletion ([migration_executor.rs:1524](</Users/ccheever/projects/snapback/src/storage/migration_executor.rs:1524>)).

   **Resolution:** Render “unpublished work remains unobservable and is discarded or parked according to the journal; predecessor authoritative,” plus the actual disposition when recorded.

5. **MATERIAL — The plan’s capability binding is missing from the drift ledger and weakens Moment 3’s barrier rendering.**

   **Claim:** The barrier line can be rendered as a fixed LLP 0081 rule, and the ledger is “verified against the tree.”

   **Evidence:** LLP 0081 says the static capability digest is plan-bound, capability drift invalidates approval, and the fence registry is capability-derived ([0081:199](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:199>), [0081:244](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:244>), [0081:371](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:371>)). `MigrationPlanBody` contains no capability digest, while preview emits empty capability health ([migration.rs:486](</Users/ccheever/projects/snapback/src/migration.rs:486>), [cli.rs:8083](</Users/ccheever/projects/snapback/src/cli.rs:8083>)).

   **Resolution:** Add a D row for capability-binding conformance. Until fixed, distinguish “LLP 0081 requires every registered lane to be fenced” from an observed, plan-bound assertion that this target’s registry was validated.

6. **MATERIAL — Moment 4 does not actually show everything approval binds.**

   **Claim:** “the approval-critical block LLP 0081 §2 makes load-bearing” is then enumerated.

   **Evidence:** The enumeration omits the approval-policy digest, issue timestamp, and migration `operationId`, although LLP 0081 explicitly binds all three and uses `operationId` plus audience for lookup, replay, cancellation, and recovery ([0081:221](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:221>)). The local approval also has an operation ID; it is not solely a hosted addition ([migration.rs:1393](</Users/ccheever/projects/snapback/src/migration.rs:1393>)).

   **Resolution:** Make Moment 4’s field list exhaustive, with JSON pointers, including plan digest, observation digest, policy digest, audience, principal, issue/expiry times, operation ID, and generator distinction.

7. **MATERIAL — G10 understates receipt-conformance drift.**

   **Claim:** The shipped receipt “does not yet bind plan bytes, backup/checkpoint, or the two postures” and stores only post-comparison actual digests.

   **Evidence:** Those claims are true, but LLP 0081 also requires source revision, package/runtime identities, the approval, cleanup state, and the full verification proof ([0081:686](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:686>)). The current receipt additionally lacks source/runtime identities and the full approval record, and it seals before the cleanup tail ([migration_executor.rs:218](</Users/ccheever/projects/snapback/src/storage/migration_executor.rs:218>), [migration_executor.rs:1478](</Users/ccheever/projects/snapback/src/storage/migration_executor.rs:1478>)).

   **Resolution:** Replace G10’s prose with a field-by-field §8 conformance table and resize the work accordingly.

8. **MATERIAL — The ideal lacks a complete refusal-to-recovery experience.**

   **Claim:** The thesis covers “every point where today the operator gets a refusal code,” and Principle 2 says “Any refusal … names its next command.”

   **Evidence:** Moments and ledger concretely cover applier, stale-plan, and precondition refusals, but LLP 0081 defines additional target mismatch, approval, retained-work, rehearsal, backup, executor, barrier, step, verification, ambiguous-publication, and rollback-unavailable states ([0081:666](</Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:666>)). Several require inspection or remediation rather than a simple next command.

   **Resolution:** Add a diagnostic/state/recovery matrix covering every §8 code, including cases where “no safe automatic next command” is the correct answer.

9. **MINOR — Moment 3’s sample is representable but not produced by the current planner.**

   **Claim:** The sample shows three steps with `AddField … backfill: constant`, `ValidateRequired`, and `MakeRequired`.

   **Evidence:** The plan type can represent that `AddField`, so its facts are derivable. However, the shipped `AddRequiredField` intent expands to four steps: `AddField` without backfill, `BackfillField`, `ValidateRequired`, and `MakeRequired` ([migration.rs:712](</Users/ccheever/projects/snapback/src/migration.rs:712>)).

   **Resolution:** Use a real current preview fixture or label the rendering explicitly hypothetical.

## 5. Suggestions

- Commit a golden sample plan, observation, approval, journal, receipt, and rendered output so every phrase can be tested against its JSON pointer or named LLP rule.
- In the SpacetimeDB comparison, say “no provider-issued receipt” to distinguish that claim from the bakeoff-authored file named `migration-receipt.json`.
- Add omission behavior to the traceability contract: absent estimate, posture, or proof fields should have explicit render/omit rules rather than relying on prose.
- Separate progress transport from rendering work: local synchronous apply needs an observer/callback or status-polling seam before it can narrate intermediate states.

## 6. Open questions for the author

1. Is LLP 0081’s incompatible-client settlement requirement still normative, or is tombstone-plus-re-entry intended to amend it?
2. Is LLP 0081 §2’s CLI syntax still authoritative for `verify`, `rollback`, and dry-run support?
3. What must dry-run guarantee when authoritative admission requires a closed fence?
4. May the renderer state a normative barrier guarantee when the current plan does not bind the capability registry?
5. Does “any refusal names its next command” allow an inspection-only or human-decision outcome?

## 7. Recommended next step

Revise to v0.4 and remain Draft: reconcile Moment 8 with LLP 0081, correct Moment 9, expand the implementation-drift ledger for CLI/dry-run/capability/receipt conformance, and add exhaustive approval and refusal-recovery field matrices. Then freeze new bytes and run another independent review.


---

## Round 4 — 2026-08-03 (target v0.4, SHA-256 8485a2155eb59c32171b393db1a60de7369f43f5bb9e67db6b07fccd8bfba311)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context, blind to prior rounds and to llp/reviews/; same capsule shape, retargeted at the v0.4 bytes. Recorded verbatim below.

---

## 1. Overall assessment

LLP 0160 is a strong, unusually well-sourced experience RFC: its rendering model is largely derivable from LLP 0081 artifacts, its prior-art summaries are faithful, and most gap-ledger claims survive inspection. It is nevertheless not ready because Moments 3, 9, and 10 misstate LLP 0081’s `published-held` and `released` semantics, while G9 materially understates current CLI drift despite claiming full conformance coverage. The fork accelerator is also described too affirmatively before its required semantic amendment, and the ideal experience lacks an explicit redaction contract.

## 2. Verdict — NOT READY

The state-transition errors are MAJOR because they silently change the semantics LLP 0160 claims to preserve.

## 3. Strengths

- Moment 3’s plan rendering is well grounded. The four-step required-field expansion matches the compiler, and the target profile, proof mode, ceilings, postures, and expected digests are all plan-body facts. The row estimate is correctly labeled as observation-derived rather than plan authority. See [LLP 0160:184](/Users/ccheever/projects/snapback/llp/0160-ideal-migration-experience.rfc.md:184), [migration.rs:486](/Users/ccheever/projects/snapback/src/migration.rs:486), and [migration.rs:1191](/Users/ccheever/projects/snapback/src/migration.rs:1191).

- The prior-art account is generally honest and traceable. The SpacetimeDB plan output, disconnect warning, retained 500-line migration, and absence of Snapback-style proof artifacts are supported by [diary 0029:557](/Users/ccheever/projects/snapback/diaries/0029-linear-backend-bakeoff.diary.md:557) and the captured [migration log:5](/Users/ccheever/projects/snapback/demos/backend-bakeoff/arms/linear/spacetimedb/evidence/migration-publish.log:5). The Firebase, Convex, Appwrite, Instant, and PocketBase paraphrases are likewise supported by their cited diary rounds.

- The resolved G3 claim is substantiated. The defect, root cause, regression coverage, and acceptance witness exist in [the closed issue:1](/Users/ccheever/projects/snapback/issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md:1), [LLP 0137:787](/Users/ccheever/projects/snapback/llp/0137-acceptance-testing-protocols.spec.md:787), and [local.rs:34264](/Users/ccheever/projects/snapback/src/local.rs:34264).

- G1, G5, and G8 are accurate. Migration commands currently emit JSON envelopes only; there is no `migrate status`; `seeded_db` contains two rows against a 512-row batch size; and crash tests use an in-process thread-local panic hook rather than a process kill. See [cli.rs:917](/Users/ccheever/projects/snapback/src/cli.rs:917), [cli.rs:7955](/Users/ccheever/projects/snapback/src/cli.rs:7955), [migration_executor.rs:330](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:330), [migration_executor.rs:825](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:825), and [migration_executor.rs:4066](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:4066).

- G10–G13 correctly expose consequential proof and implementation gaps: incomplete receipts, empty preview observations, missing plan-bound capability-contract digest, and a dry run that validates shape rather than proving admission.

- LLP 0160 accurately reports that LLP 0037 left the deployed-client evolution owner unnamed. See [LLP 0037:180](/Users/ccheever/projects/snapback/llp/0037-schema-source-of-truth.decision.md:180).

- Moment 8 does not conceal the predecessor/successor client discrepancy. It properly routes the stronger seamless-upgrade story through OQ6 rather than presenting it as settled LLP 0081 behavior.

## 4. Concerns

1. **MAJOR — Moment 10 invents a released-but-maintenance state.**

   Exact claim:

   > “On the default `successor-only` posture, a released migration leaves the target in maintenance mode until the successor application artifact deploys”

   Evidence: LLP 0081 says publication enters `published-held`, while the distinct `released` transition opens traffic and workers; rollback remains fast specifically while the migration is still held. See [LLP 0081:379](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:379) and [LLP 0081:541](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:541). The implementation likewise records `PublishedHeld` before calling release, and release deletes the fence: [migration_executor.rs:1406](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:1406) and [migration_executor.rs:1473](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:1473). LLP 0072 stages inactive artifacts before migration and activates them afterward; it does not deploy a successor after release: [LLP 0072:552](/Users/ccheever/projects/snapback/llp/0072-cloud-deployment-and-operations.rfc.md:552).

   Resolution: describe the handoff as occurring while `published-held`, with the successor already staged and activated compatibly before release. If a distinct released-but-maintenance interval is desired, make it an explicit amendment to LLPs 0081 and 0072.

2. **MAJOR — Moments 3 and 9 falsely restrict `published-held` to crash recovery.**

   Exact claims:

   > “on the local profile that state is reached via crash-resume, not an operator hold”

   > “`published-held` is met only during crash-resume”

   Evidence: every successful publication enters `published-held`; the local profile normally releases immediately afterward. A crash merely makes that otherwise brief state persist and become operator-actionable. See [LLP 0081:379](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:379) and [migration_executor.rs:1406](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:1406).

   Resolution: state that every apply reaches `published-held`, but the local profile exposes a durable hold decision only when crash recovery resumes from that state.

3. **MAJOR — G9 is not “full CLI-surface conformance.”**

   Exact claim:

   > “CLI-surface conformance vs. 0081 §2: `verify` takes `--operation-id` rather than `migration.json`; `rollback` names an operation id `receipt`; only `apply` has `--dry-run`”

   Evidence: LLP 0081 specifies artifact-oriented shapes for every verb and machine-readable dry run for every command: [LLP 0081:259](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:259). The actual enum also diverges on most other commands: `preview` takes database/schema/publication inputs instead of `--app --target --profile`; `approve`, `apply`, `rehearse`, and `cancel` add database or schema operands; and only `apply` exposes dry run. See [cli.rs:917](/Users/ccheever/projects/snapback/src/cli.rs:917). The revision note’s assertion that G9 was expanded to full conformance therefore overstates the audit.

   Resolution: replace G9 with a verb-by-verb matrix covering required inputs, output artifact, dry-run support, and current implementation divergence for all seven LLP 0081 commands.

4. **MATERIAL — Fork rehearsal is described as receipt-qualifying before the required semantic work.**

   Exact claim:

   > “`rehearse --fork` can satisfy the same sealed binding faster where the profile’s backup policy admits a fork-derived restore image”

   Evidence: LLP 0081 currently requires a restore-derived target binding containing source backup identity and restore epoch; only that receipt satisfies apply admission. See [LLP 0081:653](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:653). LLP 0158’s throwaway-first, scrubbed, quarantined fork posture is compatible with an informational rehearsal, but it does not establish backup identity, custody, or receipt equivalence: [LLP 0158:176](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:176), [LLP 0158:383](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:383), and [LLP 0158:1082](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:1082). LLP 0160 later acknowledges the needed amendment, but the initial statement reads as present compatibility.

   Resolution: say it “could satisfy” the binding only after LLP 0158 proves custody/fidelity and LLP 0081 receives a dated amendment. Class G7 as amendment-blocked for receipt qualification; retain class R only for informational what-if use.

5. **MATERIAL — The RFC says it adopts the Supabase lesson while omitting its query-plan half.**

   Exact claims:

   > “make index/query-plan inspection and before/after migration invariants one command”

   > “Diary 0029’s Supabase lesson lands here: before/after invariants, one command.”

   Evidence: the source lesson includes both index/query-plan inspection and before/after invariants: [diary 0029:414](/Users/ccheever/projects/snapback/diaries/0029-linear-backend-bakeoff.diary.md:414). Moment 7 renders digest, posture, and rollback verification, but nothing about index or query-plan inspection: [LLP 0160:293](/Users/ccheever/projects/snapback/llp/0160-ideal-migration-experience.rfc.md:293).

   Resolution: either add canonical query/index-plan inspection to the ideal and classify any new approval-bound semantics, or narrow the provenance claim to the before/after invariant portion.

6. **MATERIAL — The ideal renderer has no redaction contract.**

   Exact claims:

   > “constant `provider` = `\"openai\"`”

   > “Approval shows all approval-bound facts exhaustively”

   Evidence: LLP 0081 requires migration logs to redact row values and secret material while retaining stable identifiers and reason codes: [LLP 0081:640](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:640). Migration constants can contain arbitrary literal values: [migration.rs:435](/Users/ccheever/projects/snapback/src/migration.rs:435). A default-on stderr renderer that exhaustively prints constants could disclose credentials or sensitive values.

   Resolution: specify which plan and observation fields are safe to render, how literal constants are redacted, whether secret-bearing constants are prohibited, and how an explicit secure-reveal path works. Add golden fixtures for redaction.

7. **MINOR — G6 overstates LLP 0061’s retrieval-evaluation requirement.**

   Exact claim:

   > “LLP 0061 requires at least a GAP row plus a retrieval-eval row”

   Evidence: LLP 0061 requires a guide page or an explicit capability-index GAP row for a new capability program: [LLP 0061:365](/Users/ccheever/projects/snapback/llp/0061-authoritative-agent-guide.rfc.md:365) and [LLP 0061:577](/Users/ccheever/projects/snapback/llp/0061-authoritative-agent-guide.rfc.md:577). It separately defines a small corpus-level retrieval evaluation, but does not require a per-capability “retrieval-eval row”: [LLP 0061:560](/Users/ccheever/projects/snapback/llp/0061-authoritative-agent-guide.rfc.md:560).

   Resolution: attribute only the page-or-GAP-row obligation to LLP 0061, then make a migration retrieval-eval case an LLP 0160 acceptance recommendation.

## 5. Suggestions

- Tighten G2 from “names no next step” to “does not route the user into the reviewed-migration command or scaffold”; some refusals do suggest adding a new field.

- Date or version-label prior-art observations, particularly PlanetScale, so historical product behavior is not read as a current competitive claim.

- Extend rendering fixtures to cover unavailable estimates, unavailable capability observations, narrow terminals, non-color output, redaction, and explicit machine-readable mode.

- Include cancellation, cleanup progress, and interrupted successor activation in the ideal dev-loop transcript; the current moments emphasize the happy handoff.

- Preserve the distinction between a provider operation record and a provider-issued cryptographic receipt when discussing the SpacetimeDB harness evidence.

## 6. Open questions for the author

- Is Moment 10 intended to stage and activate the successor while the migration remains `published-held`, or is it deliberately proposing a new released-but-maintenance state?

- Should fork rehearsal remain informational until LLP 0158 proves custody and restore fidelity, or is G7 intended to initiate an LLP 0081 amendment now?

- Is query/index-plan inspection part of the north-star migration experience? If so, which LLP owns its canonical semantics and approval binding?

- What values may the human renderer display by default, and what is the redaction policy for constants, predicates, row examples, and capability diagnostics?

- Should “full CLI conformance” include only command names and primary operands, or the complete LLP 0081 contract including artifact outputs, dry runs, admission behavior, and recovery surfaces?

## 7. Recommended next step

Keep LLP 0160 in Draft and prepare v0.5 that corrects the `published-held`/`released` ordering, replaces G9 with an exhaustive CLI matrix, makes fork qualification explicitly amendment-dependent, adds a rendering redaction contract, and either incorporates or narrows the Supabase query-plan lesson. Then run another independent super-refine review before advancing status.


---

## Round 5 — 2026-08-03 (target v0.5, SHA-256 877d0b8581041847fd70daf62b7882d515f23448a135b51bf32a0c324924b4cb)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context, blind to prior rounds and to llp/reviews/; same capsule shape, retargeted at the v0.5 bytes. Recorded verbatim below.

---

## 1. Overall assessment

At the verified SHA-256 `877d0b8581041847fd70daf62b7882d515f23448a135b51bf32a0c324924b4cb`, this is a strong, unusually well-sourced north-star RFC. Its prior-art descriptions, example plan rendering, tree-gap claims, Triplit history, and cautious use of instance forks all withstand scrutiny. It is not ready, however: the approval and rehearsal journeys omit key transitions, one approval rendering blurs dynamic preflight evidence with approval-bound authority, the redaction policy overstates LLP 0081, and three gap-ledger rows use governance lanes inconsistent with 0081.

## 2. Verdict — NOT READY

The necessary corrections are bounded, but they affect the RFC’s central promise that experience work will not silently change LLP 0081 semantics.

## 3. Strengths

- The governing boundary is explicit and disciplined: the RFC distinguishes rendering defects, implementation drift, and genuine amendments, and states that `0160` cannot amend `0081` ([0160 §1](/Users/ccheever/projects/snapback/llp/0160-ideal-migration-experience.rfc.md:39)).

- The Moment 3 example is substantially honest. Its four-step `AddRequiredField` chain matches the planner implementation (`src/migration.rs:712`), while plan identity, proof obligations, ceilings, and posture are derivable from `MigrationPlanBodyV1` (`src/migration.rs:481`). The row estimate is correctly labeled review context derived from the separately digested observation rather than plan authority ([0160 Moment 3](/Users/ccheever/projects/snapback/llp/0160-ideal-migration-experience.rfc.md:197); `src/migration.rs:1182`).

- The prior art is accurately and fairly represented. The SpacetimeDB plan output, retained indexes, default behavior, confirmation suppression, and client-disconnect limitation are present in `diaries/0029-linear-backend-bakeoff.diary.md:580-659` and `demos/competitive-checkpoint/evidence/migration-publish.log:1-56`. The Supabase, Convex, Firebase, Appwrite, InstantDB, and PocketBase summaries likewise match their diary evidence.

- The RFC correctly describes LLP 0037’s Triplit conclusion as an unnamed-owner gap: that decision assigns the problem to “whichever document owns deployed-client schema evolution” without naming one (`llp/0037-schema-source-of-truth.decision.md:180-195`).

- Moment 5 respects LLP 0158’s throwaway-first posture and does not prematurely make fork rehearsal authoritative. Its requirement for an 0081 amendment and fidelity/custody evidence before qualification is the right boundary ([0160 Moment 5](/Users/ccheever/projects/snapback/llp/0160-ideal-migration-experience.rfc.md:269); `llp/0158-instance-forking.rfc.md:176-179,226-236`).

- Moment 8 exposes the real client-contract tension instead of inventing a resolution. The JS carrier preserves mutation identity while discarding stale arguments, and non-JS parity is absent (`packages/snapback-contract/client-store.mjs:2165-2203`; `packages/snapback-contract/migration-quarantine.test.mjs:267-325`).

- Most tree claims in the ledger are correct:

  - All native migration commands currently emit JSON envelopes only (`src/cli.rs:7908-7962`).
  - There is no `migrate status` variant (`src/cli.rs:917-1032`).
  - The former A3 subscriber-wedge defect is genuinely resolved (`issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md:1-67`).
  - There is no migration workflow guide page.
  - The executor fixture has two rows and kill points use in-process panic injection (`src/storage/migration_executor.rs:330-374,4066-4079`).
  - The receipt, empty preview observation, empty capability health, and `"wouldApply": true` limitations in G10–G13 are accurately reported.

## 4. Concerns

1. **MAJOR — Dynamic recoverability state is presented as an approval-bound fact without a source or freshness rule.**

   Exact claim: “Approval is not ‘yes.’ It shows exactly what the operator binds,” including “backup/checkpoint posture, including recoverability-preflight status and maximum allowed age.” ([0160 Moment 4](/Users/ccheever/projects/snapback/llp/0160-ideal-migration-experience.rfc.md:252))

   Evidence: LLP 0081 binds the plan and review observation into approval (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:221-249`), but requires live backup recoverability preflight again as apply admission (`:632-664`). The plan’s current backup requirement contains only `required`, `checkpointLabel`, and `rehearsalRequired` (`src/migration.rs:397-418`); neither a preflight result nor its maximum age is a plan-body field.

   What would resolve it: specify the exact carrier and authority class. Render preflight results as timestamped, non-authoritative observation context, state that apply rechecks them, and identify where maximum age comes from. If approval is intended to authorize or freeze that status, classify it as an LLP 0081 amendment.

2. **MAJOR — The RFC does not ensure that approval rendering occurs before approval is minted.**

   Exact claim: “Approval is not ‘yes.’ It shows exactly what the operator binds.” ([0160 Moment 4](/Users/ccheever/projects/snapback/llp/0160-ideal-migration-experience.rfc.md:252))

   Evidence: the current approve handler constructs and writes the approved artifact before `migrate_emit` prints the response (`src/cli.rs:8115-8154`; emission at `:7938-7956`). Merely adding a renderer at the existing emission point would produce an excellent description of an action already completed.

   What would resolve it: define the interaction explicitly: render first, obtain an affirmative authorization tied to the displayed plan/observation digests, then mint and persist approval. Also specify the noninteractive CI/agent equivalent, such as exact-digest acknowledgement, without weakening 0081’s authenticated-principal rules.

3. **MAJOR — The ideal rehearsal journey has no way to produce its required rehearsal binding.**

   Exact claim: “End-to-end operator journey (`preview -> approve -> rehearse -> apply -> status`).” ([0160 G6](/Users/ccheever/projects/snapback/llp/0160-ideal-migration-experience.rfc.md:448))

   Evidence: `snapback migrate rehearse` requires an already sealed `MigrationRehearsalPlanV1` through `--rehearsal-plan` (`src/cli.rs:985-1007`). LLP 0081 says the recommended preflight derives this binding from the isolated restore (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:653-664`), but neither the CLI nor this north-star journey explains how an operator selects/restores a backup and obtains that artifact.

   What would resolve it: add a Moment and ledger row covering backup selection, isolated restoration, rehearsal-binding creation, execution, and evidence return. Identify which parts are existing 0081 obligations, implementation drift, or new amendment proposals.

4. **MAJOR — Three gap-ledger classifications conflict with the RFC’s own governance rules.**

   Exact claims:

   - G8 is classified `R`: “Executor tests use two-row fixtures and in-process panic injection...”
   - G15 is classified `R`: “No first-class migration inspection surface...”
   - G9 is classified wholly `D`, including the rollback-input divergence.

   Evidence:

   - LLP 0081 already requires fault injection at every step, batch boundary, and selected batch interiors (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:721-738`). With a batch size of 512 and a two-row fixture (`src/storage/migration_executor.rs:824-825,4066-4079`), the absent second-batch coverage is implementation drift, even if real process termination is an additional experience/test-strengthening proposal.
   - LLP 0081 already requires admin inspection to expose the same operation, plan, receipt, and error identities as CLI/Agent surfaces (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:774-775`). G15 is therefore at least partly `D`.
   - G9’s `verify` discrepancy is drift, but rollback input is explicitly left to OQ7’s conform-or-amend decision. That portion is `D or A`, not settled `D`.

   What would resolve it: split mixed rows. Classify G8’s missing multi-batch acceptance proof and G15’s identity-bearing inspection surface as `D`; retain separate `R` rows for stronger real-process testing or enhanced presentation. Split G9 into verify drift and rollback `D/A`.

5. **MATERIAL — The default constant-redaction rule is broader than LLP 0081 and conflicts with exhaustive approval review.**

   Exact claim: “The default human rendering redacts literal constants ... This is ... LLP 0081 §7.” ([0160 §4.4](/Users/ccheever/projects/snapback/llp/0160-ideal-migration-experience.rfc.md:150))

   Evidence: LLP 0081 requires migration logs to redact row values and secret material (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:649-651`); it does not classify every plan constant as secret or require all human renderings to hide them. Constants are part of the authoritative plan (`:211-215`). Moment 4 then reuses the Moment 3 rendering while promising to show exactly what approval binds.

   What would resolve it: distinguish log-safe rendering from secure approval review. Define how constants are classified as sensitive, ensure an approver can inspect all authorization-relevant values securely, and stop attributing blanket constant redaction to LLP 0081 unless 0081 is amended.

## 5. Suggestions

- Correct “approval was `issue`” to “approval was `issued`” in Moment 4.

- Give the renderer a deterministic presentation contract: stable ordering, terminal-width behavior, paging/truncation rules, color policy, exit codes, and separation between stdout machine output and stderr human guidance.

- Add direct artifact-field paths beside the Moment 3 traceability table, including `body.steps`, `body.proofObligations`, `body.resourceCeilings`, and `observation.preconditionRows[stepId]`.

- Clarify that the Spacetime `migration-receipt.json` in the evidence directory is bakeoff-authored evidence, not a provider-issued receipt. The RFC’s substantive claim is correct, but the filename could confuse later reviewers.

- Make G6 explicitly require both a migration guide page and a capability-index row, matching LLP 0061’s documented coverage rules.

## 6. Open questions for the author

- Is recoverability-preflight status intended only as observation context, or as part of approval authority?

- What exact operator or machine action authorizes approval after reviewing the rendered facts?

- Which command or workflow creates `MigrationRehearsalPlanV1` from a restored backup?

- Do you agree that G8 and G15 contain 0081 conformance drift, and that G9 must be split into drift and amendment-dependent portions?

- Should non-secret constants be visible by default in the secure approval face, even if log and transcript renderings remain redacted?

## 7. Recommended next step

Revise to v0.6 with an explicit pre-issuance approval protocol, a complete rehearsal-binding journey, corrected authority/freshness language for recoverability preflight, and split/reclassified G8, G9, and G15 rows. Then run another independent LLP 0005 review focused narrowly on the zero-semantics claim and the revised end-to-end operator journey.
