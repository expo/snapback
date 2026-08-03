# LLP 0160 ideal migration experience review — Fable family

## Round 1 — 2026-08-03 (target v0.1, SHA-256 72d903fb8d673a0b77d3b64ee3eb5ea8d07cd4c1ba567af8e8967c5b4abf0a28)

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (general-purpose), fresh non-author context
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh subagent over the working tree at 50ff432a; instruction capsule pinned the target SHA, named LLP 0081, diaries 0029/0050, LLP 0037 CC-8.7, LLP 0158 and spot-check targets in src/cli.rs, src/storage/migration_executor.rs, issues/, guide/, and barred reading llp/reviews/. Orchestrated by the Fable session that authored the draft, which therefore does not count as a reviewer; the review is recorded verbatim below.

---

## 1. Overall assessment (one paragraph)

LLP 0160 is a well-conceived experience RFC with an unusually disciplined semantics fence: its rendering rules map exactly onto real artifacts (`MigrationPlanBody`'s canonical ceilings/posture/proof fields and `MigrationPreviewObservationV1.preconditionRows` keyed by step ID, src/migration.rs:1191–1215), its Moment 6 narration uses the executor's actual closed state vocabulary verbatim (src/storage/migration_executor.rs:60, 119), and most of its gap ledger survives spot-checking against the tree — G1 (JSON-only preview, src/cli.rs:8003–8015 via `migrate_emit`), G5 (no `Status` verb in `MigrateCommand`, src/cli.rs:917–1032), G8 (2-row `seeded_db`, `BACKFILL_BATCH_ROWS: usize = 512`, panic-based `kill_point_check`, src/storage/migration_executor.rs:333–374, 825, 4066), and G4 (the "JS client quarantine UX" residual named in issues/closed/20260724-step5-impl-0081-acceptance-corpus.md:86,104) are all accurate. The prior-art quotes from diaries 0029/0050 are real and mostly verbatim. But the document has three problems that keep it short of READY: its top-priority gap row G3 cites a defect that was found *and fixed* two days before this RFC's date (the ticket sits Resolved in issues/closed/ with regression tests and an acceptance witness); Moment 5's fork-powered rehearsal, as worded, silently substitutes for LLP 0081 §7's restore-derived rehearsal binding while the RFC claims to add no semantics; and the framing sentence "the schema edit itself is the only authoring act" is false for exactly the non-additive cases this RFC exists for — today's preview requires hand-authored intents and explicit timestamp constants, an experience gap no moment or ledger row prices.

## 2. Verdict — NOT READY

The gap ledger is declared "the actionable output" and its first-priority row is stale against the tree; Moment 5 as written is a semantics change under a no-semantics banner. Both are cleanly fixable in one revision.

## 3. Strengths (cite sections)

- **The semantics fence is real, not decorative (header note, §3.4).** Every rendered fact in the Moment 3 example is derivable from canonical `body` fields per 0081 §2 (steps, ceilings, posture, proof method, `planId` format `migration-v1:&lt;digest&gt;`) plus the observation's `preconditionRows` — the attribution of row estimates to the separately-digested observation is exactly right against src/migration.rs:1200–1207.
- **§1 prior art is honestly represented with provenance.** "Not a first-class reviewed migration plan with built-in rollback evidence" (diary 0029:477), "the burden is orchestration" (0029:376), "index/query-plan inspection and before/after migration invariants one command" (0029:428), "operational code rather than a first-class migration workflow" (0029:210), PocketBase's 41%/four-failures figures (diary 0050:59, 186–187), and PlanetScale's "reviewable deploy requests" (llp/0001:216–221) all check out verbatim. Papercuts are cited for balance — rare in advocacy sections.
- **§1's Triplit row and OQ3 are precisely faithful to LLP 0037 CC-8.7**, including the detail that the owner was left unnamed ("noting the gap for whichever document owns deployed-client schema evolution," llp/0037:194–195).
- **§2 Moment 2's premise verified and actually understated:** the applier's refusal text today says "explicit drop/backfill migrations are not supported" (src/storage.rs:10628) — it doesn't merely omit the next command, it actively denies that the shipped `snapback migrate` workflow exists. G2 is, if anything, conservative.
- **§4's calibration list is defensible** — deterministic preview, sealed approve/apply split, rehearse verb, canonical ceilings, and receipt-as-journal-projection all exist in the tree; no bakeoff system in diary 0029 has more than one.
- **§5 G8 is a genuinely good find**: the entire migration test corpus (executor module and tests/migration_corpus_v0.rs) seeds 1–2 rows against a 512-row batch size, so the batch loop's second iteration and multi-batch crash recovery are provably unexercised, and crash injection is an unwinding panic, not a process kill.

## 4. Concerns

**C1 — MAJOR. G3 is stale: the cited defect was fixed and closed before this RFC was written.**
Claim: "G3 | Live-subscriber schema evolution wedges the dev loop (`0137-a3-f5`: watch-reload lands `generated-but-not-loaded`, admission never reopens) | … | M — filed defect, worst current experience," reinforced by "Suggested order: G3 (a defect, and the moment most users will actually hit)."
Evidence: issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md — **Status: Resolved, 2026-08-01** (between-arms fix lane), with root cause (`projection_in_flight` misread in src/auth/admission.rs), three regression tests proven to fail pre-fix, and an acceptance witness: "with the live handle attached, the source swap reloads `generated-and-loaded` … and admission stays open." The companion guide-gap ticket (issues/closed/20260801-0137-a3-guide-gap-sessions-schema-evolution-path.md) confirms "The live-subscriber caveat is gone." The RFC is dated 2026-08-03; its top execution priority points at work that finished two days earlier.
Resolution: delete or rewrite G3 (nothing in the tree suggests a surviving wedge), re-derive the suggested order, and re-verify every ledger row's tense at revision time.

**C2 — MAJOR. Moment 5 silently changes LLP 0081 §7 semantics while §3.4 claims none are added.**
Claim: "`preview --rehearse` forks the target (O(1) on SQLite), executes the plan against the fork … Rehearsal stops being a separate discipline and becomes a property of preview. (Absent forking, the current `rehearse` verb remains; the experience is the same shape, slower.)"
Evidence: 0081 §7 defines rehearsal as executing the **approved** production plan under a sealed `MigrationRehearsalPlanV1` whose digest binds the source **backup identity, isolated target, restore epoch**, and whose receipt production admission consumes under a freshness policy (llp/0081:653–664; enforced surface at src/cli.rs:985–1008, including `SNAPBACK_MIGRATION_REHEARSAL_INVALID`). A preview-time fork rehearsal executes a **pre-approval** plan against a target that is not restore-derived and has no backup identity or restore epoch. Either its receipt satisfies `apply --rehearsal-receipt` / `SNAPBACK_MIGRATION_REHEARSAL_REQUIRED` — a change to §7's binding, contradicting "LLP 0081's artifacts, states, and proofs are untouched" — or it is informational only, in which case "same shape, slower" and "stops being a separate discipline" oversell, because the §7-required rehearsal still needs the restore-derived path. Additionally, "(O(1) on SQLite)" contradicts LLP 0158's own hard-won scoping: O(1) `clonefile` holds only for a **cold** parent; a live parent is a full copy via the backup primitive with latency explicitly unclaimed (llp/0158 §The copy, per target) — and a migration target under preview is typically live. The *posture* fit with 0158 is fine (throwaway-first, motivation item 1 is literally migration rehearsal); the binding and cost claims are not.
Resolution: state explicitly which of the two readings is intended. If informational, say the §7 binding is untouched and the fork rehearsal never satisfies `--rehearsal-receipt`; if substitutive, name it as a future dated 0081 §7 amendment and drop the "no new semantics" absolutism for this moment. Scope the O(1) claim to cold parents.

**C3 — MAJOR. The intent/constants authoring ceremony is missing from the ideal — and it falsifies §2's framing sentence.**
Claim: "The schema edit itself is the only authoring act" and Moment 2's refusal ends with "the exact next command."
Evidence: `migrate preview` requires `--publication-timestamp-ms` (explicit constant), a staged `--schema` manifest, and `--intents` for anything non-derivable — "renames, conversions, and required-field backfills must be declared explicitly and refuse derivation" (src/cli.rs:920–950). So for the paradigm non-additive change (add a required field with a backfill), there is a second authoring act — hand-writing a `MigrationIntent` JSON file — and Moment 2's "exact next command" is not constructible without tooling that scaffolds it. No moment covers intent authoring and no ledger row prices it; this is arguably the largest ceremony in today's flow, bigger than the rendering gaps the ledger does carry.
Resolution: add a moment (or extend Moment 2) for intent derivation/scaffolding — e.g., the refusal emits a candidate intents file for the operator to complete — and add the corresponding ledger row, or explicitly expand G2's scope to include it.

**C4 — MATERIAL. The Moment 3 example violates its own labeling rule, and understates the outage.**
Claim: observation-derived facts are "labeled as such … so the rendering cannot drift from what approval covers"; but the example prints "preflight over ~1,204 rows" and "Data: … 1,204 rows re-stamped" with no observation label, and the Data line drops even the tilde — presenting an unapproved, drift-prone estimate as fact on the line an approver reads most. Separately, "Downtime: writes fenced during apply" understates `exclusive-single-writer.v1`, under which reads are also "unavailable or explicitly maintenance-mode" (llp/0081:132–135) — the one fact an operator most needs stated fully.
Resolution: label estimate lines in the example itself (e.g., `~1,204 rows (preview estimate — not approval-covered)`) and render the fence as full unavailability.

**C5 — MATERIAL. Moment 2's mini-plan is unreconciled with Design principle 1.**
Claim: principle 1 — "Render, never re-derive… No rendering-only computation that could disagree with what was approved" — versus Moment 2, which renders a mini-plan at applier-refusal time, when no digested plan exists; OQ2's "cheaper intent-level summary" option is precisely re-derived rendering-only computation.
Resolution: either require the refusal path to run the real planner and emit a genuine (unapproved, so-labeled) artifact, or carve refusal-time output out of principle 1 explicitly as a labeled pre-plan summary. Decide in the doc, not in OQ limbo, since G2's sizing ("S–M") depends on it.

**C6 — MATERIAL. Moments 3 and 7 assume machinery §5's ledger doesn't price.**
Evidence: the `Verify` verb's committed contract says "The §5 data proof (expected values, content digests) lands with the verification wave and refuses honestly until then" (src/cli.rs:1016–1018), so Moment 7's "expected vs. actual digests" rendering is not "pure rendering over existing fields" (G1's sizing) for the verify surface. And the `Rollback` enum doc says "not yet available on this profile; refuses with SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE" (src/cli.rs:1025–1026) while the handler calls a real `migrate_rollback` (src/cli.rs:8252–8266, src/local.rs:18850) — one of the two is stale, and Moment 3 renders "Rollback: fast republish available until release" as a plan-face fact.
Resolution: verify the current maturity of `migrate verify`'s proof half and the rollback verb, and either add a ledger row for the residue or footnote G1 with what rendering alone cannot deliver yet.

**C7 — MATERIAL. Fork-rehearsal fidelity caveat missing.**
Claim: Moment 5 "folds *measured* facts into the rendering: actual duration vs. ceiling, actual row counts."
Evidence: 0158's scrub-and-mint terminates sessions, revokes credentials, and sweeps "non-credential operational residue — search journal leases and generations, claimed job rows, stream attempts, cron claim state" under the custody manifest (llp/0158 §Design sketch). A scrubbed fork can therefore prove `retainedWorkPosture: empty` where production would refuse with `SNAPBACK_MIGRATION_RETAINED_WORK_INCOMPATIBLE` (llp/0081 §6). Measured facts from a fork are not automatically transferable; the rendering must say which facts survive the mint.

**C8 — MINOR. Provenance embellishments in the SpacetimeDB section.**
"The CLI **printed a concrete plan** before applying: the fields and indexes being changed, **named specifically**" and "the plan said so up front, rather than the operator discovering it after" — diary 0029:586 says only "The CLI printed a concrete plan, added a defaulted indexed column in place, retained all 500 issues, and made the client-disconnect consequence explicit"; "named specifically" and "said so up front" back-project the *lesson line's aspiration* (0029:653–654) onto the observation. Also "unstable CLI syntax" vs. the diary's "unstable SQL syntax" (0029:604), and PocketBase's "rollback behavior was excellent" drops the same sentence's caveats (two automation stumbles; seeded users left behind, diary 0050:75–77). Soften or tag `[inferred]` — this document is otherwise fastidious about provenance.

**C9 — MINOR. G6 slightly overstates and under-specifies.**
"the bakeoff-praised workflow is undiscoverable from `guide/`" — guide/getting-started/the-authoring-loop.md §"Evolve a table that already has data" (landed 2026-08-01) now routes destructive changes to LLP 0081 by link, so discovery exists; what's missing is the workflow *page* and — worth naming explicitly in G6 — any reviewed-migration row in guide/capabilities.md at all (grep "migrate" returns zero hits there), which LLP 0061 requires at least as a GAP row.

## 5. Suggestions (non-blocking)

- Add a one-line S-sized row (or fold into G2) for fixing the refusal *message text* itself: "explicit drop/backfill migrations are not supported" (src/storage.rs:10628) should say "…not supported by the startup applier; use the reviewed migration workflow (`snapback migrate preview`)" — a string change deliverable independently of the applier→planner handoff.
- Moment 3's rendering should also state the *fence scope* (which lanes close — jobs, cron, egress) since 0081 §4's capability-derived lane registry is canonical and it is exactly the "what stops during this" fact an operator wants.
- Note in G6 that the guide page should carry a retrieval-eval row ("change a field's type on a table with data") per LLP 0061 conventions, so the on-ramp is testably discoverable.
- Consider a Moment for *multi-environment ordering* (rehearse on staging, apply on prod, deploy ordering per §6 postures) — §6's compatibility declaration is the one 0081 §2/§6 surface no moment currently renders.
- §1's Firebase row could cite the diary's own softener — the arm made no hosted claim — to keep "no workflow at all" airtight.

## 6. Open questions for the author

1. Does `preview --rehearse`'s output ever satisfy `apply --rehearsal-receipt` / `SNAPBACK_MIGRATION_REHEARSAL_REQUIRED`, or is it strictly informational? (C2 — this single answer determines whether the RFC keeps its no-semantics claim.)
2. With G3 dead, what is the first executable item — G1+G2 as "the SpacetimeDB moment, cheap"?
3. Where should intent authoring live in the ideal: refusal-time scaffolding of a candidate intents file, an interactive `preview` mode, or codegen-derived intents from the schema diff plus declared annotations? (C3)
4. Which measured facts from a scrubbed fork are admissible in the Moment 5 rendering, given the custody manifest changes retained-work and auth state? (C7)
5. Is the rendered vocabulary intended to bind hosted profiles from day one (per principle 3), or is Moment 3 local-profile-first with hosted renderings following their conformance profiles?

## 7. Recommended next step

One revision pass, then a single re-review round: (1) replace or delete G3 and re-derive the suggested order against the tree as of the revision date; (2) answer question 1 in the document body and rescope Moment 5's O(1) and "same shape" claims; (3) add the intent-authoring moment/ledger row; (4) fix the Moment 3 example to obey its own labeling rule and the fence-scope wording; (5) reconcile Moment 2 with principle 1; (6) apply the provenance softenings. None of this threatens the thesis — the SpacetimeDB-legibility-around-0081-rigor frame is sound and the tree supports it — so this should converge in one round.


---

## Round 2 — 2026-08-03 (target v0.2, SHA-256 db7cfdf4bf9d0ff6e9aa4d93dc81f86fc02ea9926718d74dd60b31f6b94e816d)

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (general-purpose), fresh non-author context, blind to prior rounds and to llp/reviews/
**Date:** 2026-08-03
**Redacted:** no
**Method:** same capsule shape as round 1, retargeted at the v0.2 bytes. Recorded verbatim below (the reviewer's own header lines are preserved).

---

# Review: LLP 0160 — The ideal migration experience (v0.2)

**Reviewer:** Claude (Fable 5), independent non-author context, LLP 0005 super-refine round 2
**Target verified:** SHA-256 `db7cfdf4…816d` matches the reviewed bytes.

## 1. Overall assessment (one paragraph)

This is a disciplined north-star RFC that mostly earns its central boast: it renders LLP 0081's machinery without re-deriving or amending it, and where the ideal exceeds the artifacts it says so by name (G7′, the Moment 5 fork-image question). I verified the gap ledger row by row against the tree and every row I could check is accurate — G1 (JSON-only envelopes, `src/cli.rs` `migrate_emit`), G2 ("explicit drop/backfill migrations are not supported", `src/storage.rs:10628`), G5 (no `Status` variant in `MigrateCommand`, `src/cli.rs:917–1032`), G6 (no operator-journey guide page; no reviewed-migration row in `guide/capabilities.md`), G8 (2-row `seeded_db` fixture at `src/storage/migration_executor.rs:4066` against a 512-row batch constant at line 825; in-process `panic!`/`catch_unwind` kill points at lines 340–374), and G9 (the `Rollback` doc comment at `src/cli.rs:1025–1026` claims unavailability while a real handler calls `migrate_rollback_artifact` at line 8252). The v0.1→v0.2 G3 removal is legitimate (`issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md`, resolved 2026-08-01 with regression tests and an acceptance witness). The prior-art quotes check out against diaries 0029/0050 nearly verbatim. Two things keep it short of READY: the flagship Moment 8 end-user copy promises a post-upgrade sync behavior the shipped client custody contract deliberately forbids — exactly the "experience silently changes semantics" failure the RFC's own preamble forswears — and the "rest of the field, compressed" survey silently drops two of the seven bakeoff arms, including the one (InstantDB) whose schema-diff experience is the most relevant prior art for Moments 2b/3.

## 2. Verdict

**NOT READY** — one MAJOR and one MATERIAL, plus minors. All are small, localized edits; I would expect the next round to converge.

## 3. Strengths (cite sections)

- **The no-new-semantics discipline is real, not decorative.** Moment 3's traceability rule (every rendered phrase maps to a digested body pointer, the estimate-labeled observation, or a fixed §4/§6 rule) is the strongest single idea in the document, and the example obeys it: plan id format, step types, ceilings-as-admission-preconditions vs downtime-as-safe-abort, published-held-only fast republish, and the posture line all check against LLP 0081 §§2, 4, 6 exactly. G7′ correctly refuses to render an impact summary the plan body does not contain (`MigrationPlanBody` in `src/cli.rs:8036–8090` confirms the field inventory).
- **Moment 5 handles the 0158 seam honestly.** The accelerator-vs-informational-what-if split preserves §7's sealed rehearsal binding; the fork-image/backup-identity question is flagged to 0158's program plus a dated §7 amendment rather than assumed; the O(1) claim is correctly scoped to cold parents, matching 0158's own copy-path text; the informational fork's fidelity caveat matches 0158's scrub-and-mint. This fits 0158's throwaway-first posture cleanly.
- **The gap ledger is verifiably true** (§5) — every checkable row held up, including the subtle G9 doc-comment-vs-handler drift, and the resolved-G3 paragraph accurately reports the closed ticket's fix, regression tests, and acceptance witness.
- **Moment 6 is exactly right about narration honesty**: the rendered states match §4's closed vocabulary, the "no invented totals" rule matches the journal actually holding a cursor rather than a batch count, and keeping the ambiguous-publication posture verbatim respects the one place §4 forbids reassurance.
- **Moment 2's diagnosis is confirmed and damning in a useful way**: the applier refusal text at `src/storage.rs:10575/10628/10796` really does deny the shipped workflow exists, and the guide's authoring-loop page (line 177) links LLP 0081 without teaching it — the "refusal is the front door" principle is well aimed.
- **Prior-art provenance tagging** (`[observed — diary 0029]` etc.) is a good convention and the tagged claims I checked are faithful, including the softened SpacetimeDB trust-model contrast ("the diary records none").

## 4. Concerns

**C1 — MAJOR — Moment 8's end-user copy promises replay the shipped custody contract forbids.**
Claim: "an end user sees 'update required — your 3 offline changes are saved and will sync after updating'" (§2 Moment 8).
Evidence: the shipped surface preserves the quarantined queue *before* the upgrade, but across the artifact upgrade itself payload custody discards arguments: "a write authored under predecessor artifacts is never blindly replayed under successor artifacts — the successor surface receives an explicit redacted `SNAPBACK_CLIENT_ARTIFACT_STALE` entry in `failedMutations()` (identity preserved, args discarded) for the app to re-enter" (`guide/sync/offline-and-retention.md:408–414`). LLP 0081 §4 likewise says quarantined mutations are "rather than silently replayed or dropped." "Will sync after updating" asserts automatic post-upgrade settlement — a semantics change smuggled in as copy, in the document whose preamble promises never to do that. (The resync-required kind *does* auto-settle; the upgrade-required kind — the one the quoted copy is about — does not.)
Resolution: rewrite the example copy to what the contract delivers, e.g. "your 3 offline changes are saved; after updating you'll be asked to confirm them," or explicitly name the blind-replay-across-artifacts change as a dated amendment row (it would be a real contract change, and probably an undesirable one).

**C2 — MATERIAL — "The rest of the field, compressed" omits two of the seven bakeoff arms.**
Claim: §1 presents Convex/Supabase/PocketBase/Firebase/Triplit/PlanetScale as the field beside SpacetimeDB, under a Summary that opens "The seven-backend bakeoff (diary 0029) produced a clear result."
Evidence: diary 0029 also ran Appwrite (asynchronous attribute/index lifecycle; "the successful `customer_impact` backfill and compound index were not one atomic migration," lines 707–709) and InstantDB (indexed schema evolution PASS; "compact typed links/indexes and schema diffs" named as a lesson to match, lines 765–850). InstantDB's schema-diff experience is directly relevant prior art for Moment 2b/Moment 3, and Appwrite's async-poll index lifecycle is a legibility anti-pattern worth citing.
Resolution: add both rows (two sentences each suffices), or narrow the Summary's framing so the compression doesn't claim field coverage it doesn't have.

**C3 — MINOR — Truncated quote presented as the diary's words.**
Claim: the lesson line the diary drew: provide an "inspectable migration preflight that names fields, indexes, data preservation." (§1 SpacetimeDB).
Evidence: `diaries/0029-linear-backend-bakeoff.diary.md:653–655` reads "…names fields, indexes, data preservation, **and client impact**." The terminal period inside the quotation marks conceals the truncation — ironically dropping the clause that motivates Moment 8.
Resolution: restore the full quote or add an ellipsis; the full version strengthens the document.

**C4 — MINOR — The estimate label "not approval-covered" contradicts §2's actual split.**
Claim: "(preview estimate — not approval-covered)" (Moment 3 example).
Evidence: LLP 0081 §2: approval "binds the exact plan digest, **the observation digest it reviewed**…"; what the observation lacks is *authority* ("apply does not mistake a changing observation for plan authority"), not approval coverage — the approver literally signs its digest.
Resolution: relabel as "estimate — informational, not plan authority" (or similar §2-faithful wording); principle 3 demands the exact vocabulary here.

**C5 — MINOR — Moment 7 asserts a verify proof surface the CLI's own doc comment says has not landed.**
Claim: "`snapback migrate verify` renders what verify actually does — re-prove the receipt against the journal projection and re-present the at-publication proof (expected vs. actual digests, counts, postures, rollback-window status)."
Evidence: `src/cli.rs:1016–1018`: "migrate.verify — the receipt-vs-journal projection check. The §5 data proof (expected values, content digests) lands with the verification wave and refuses honestly until then." The projection check exists (`src/storage/migration_executor.rs:3786`); the digest re-presentation half is asserted as current fact while G9 simultaneously says verify's proof surface "should be checked the same way."
Resolution: either verify which of the two texts is stale and state it, or soften Moment 7 to "renders what verify does — today the receipt-vs-journal proof; the §5 re-presentation when its wave lands."

**C6 — MINOR — G3′ overstates the absence of scaffolding.**
Claim: "Intent authoring is from-scratch JSON with no scaffold" (G3′).
Evidence: `src/cli.rs:920–927`: when `--intents` is omitted, "preview derives the intent set from the schema diff (unambiguous, semantics-free changes only — renames, conversions, and required-field backfills must be declared explicitly and refuse derivation)" — `migration::derive_intents` exists. Moment 2b's prose gets this right; the ledger row reads as if all derivation is absent.
Resolution: reword G3′ to "no scaffold for the ambiguous classes; unambiguous intents already derive."

**C7 — MINOR — The example's fence lane list is an unlabeled abbreviation.**
Claim: "fence closes every registered lane (queries, mutations, jobs, cron, egress)" (Moment 3).
Evidence: LLP 0081 §4's registry is "queries, mutations, subscriptions, jobs, workers, actions, cron wakeups, and every external-effect egress lane." Principle 3 ("same words everywhere") is violated by the document's own exemplar.
Resolution: render the full registry or mark the example's list as elided.

## 5. Suggestions (non-blocking)

- **Add a stale-plan diff moment.** The drift path (`SNAPBACK_MIGRATION_PLAN_STALE` after schema/declaration/constant edits, §2) is a guaranteed operator experience that only principle 2 touches generically. Rendering *what changed since the reviewed plan* on re-preview would be the same genre of legibility as Moment 3 and is derivable from two sealed plan bodies — no amendment needed.
- **Surface `apply --dry-run` as an experience asset.** 0081 §2 requires a machine-readable dry run; "what would admission say right now, without writing" is a cheap Moment 6 companion and belongs in the G6 guide journey.
- **Absorb the publication-timestamp ceremony.** Moment 2b names it in passing ("plus an explicit publication timestamp") but no ledger row paves it; the Moment 2 scaffold could emit a proposed timestamp alongside the candidate intents file.
- The traceability rule deserves a named artifact (a committed rendering→source table) so G1's implementation can be gated on it rather than on prose.
- Consider citing Appwrite's async index polling (C2) as the named anti-pattern Moment 6's journaled-state narration is designed against.

## 6. Open questions for the author

1. Moment 8 / C1: is blind replay of predecessor-authored payloads across an artifact upgrade something you would *ever* want (it would need a dated contract amendment and has real integrity risk), or should the ideal copy embrace the re-entry flow the custody rule ships?
2. Which of the two verify texts is stale — the CLI doc comment or the assumption in Moment 7 (C5)? G9's audit should name verify explicitly in its resolution criteria.
3. OQ3 (Triplit verdict ownership): given LLP 0037 CC-8.7 verifiably left the owner unnamed, does *this* RFC's acceptance claim ownership of the presentation half while assigning the protocol fact to LLP 0093, or does it stay unowned until someone else claims it? The current text says "someone must claim it" without claiming.
4. G8: is the ≥1M-row figure a real target or a placeholder? The honest minimum for the stated defects is "> 512 rows so the batch loop runs a second batch, plus a real process kill" — orders of magnitude cheaper than 1M and possibly a separate rung.
5. Should the ledger record that the *guide* (authoring-loop page, line 177) already routes destructive changes to LLP 0081 — i.e., G2's harm is specifically that the runtime contradicts the documentation, not that the workflow is unnamed everywhere?

## 7. Recommended next step

One more revision pass, not a redesign: fix C1 (a two-line copy change or an explicit amendment row), add the two missing bakeoff arms (C2), and sweep the minors (C3–C7 are all one-line edits). The ledger and moment structure are sound and tree-verified; after those fixes I would expect to be READY, and G1+G2's message-text slice is safe to start implementing in parallel since no concern above touches those rows.


---

## Round 3 — 2026-08-03 (target v0.3, SHA-256 f742be9db524514d4092217bb370b51b34c675fa03252d12381d337e9022e69f)

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (general-purpose), fresh non-author context, blind to prior rounds and to llp/reviews/
**Date:** 2026-08-03
**Redacted:** no
**Method:** same capsule shape as prior rounds, retargeted at the v0.3 bytes. Recorded verbatim below.

---

## 1. Overall assessment (one paragraph)

This is an unusually well-grounded experience RFC. I verified every quoted prior-art fact against the diaries (the SpacetimeDB plan-printing quote, the `--yes` bypass in the retained publish log at `demos/backend-bakeoff/arms/linear/spacetimedb/evidence/migration-publish.log:54`, the restored "…and client impact" lesson line, the PocketBase 41%/four-failures/rollback-caveat cluster, the Supabase "one command" lesson, Firebase's "operational code", Appwrite's "not one atomic migration", InstantDB's push diffs in diary 0030:626, and the Triplit unnamed-owner gap in LLP 0037:194-195), and every ledger spot-check against the tree came back accurate: preview at `src/cli.rs:8005` emits the JSON envelope only, the `MigrateCommand` enum (`src/cli.rs:917-1032`) has no `status` verb, the refusal text is verbatim at `src/storage.rs:10628`, the `0137-a3-f5` wedge is resolved with regression tests in `issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md`, no guide page walks the operator journey and `guide/capabilities.md` has no reviewed-migration row, the G8 characterization of `seeded_db` (2 rows), the 512-row batch constant, and the in-process `panic!` kill points all check out, G9's Rollback doc-comment/handler drift is real (`src/cli.rs:1025` vs `:8252`), G10's receipt shortfall is real (`src/storage/migration_executor.rs:218-248`), and G11's empty `preconditionRows` is real (`src/cli.rs:8089`). Every Moment I checked against LLP 0081's text renders digested facts, journal states, or fixed §4/§6/§7 rules — where the ideal exceeds the contract, the document flags an amendment instead of smuggling it. The residual concerns below are refinements of accuracy and completeness, not misrepresentations.

## 2. Verdict — READY

READY. The three-lane governance discipline holds under adversarial checking, the prior art is honestly provenance-tagged (including the v0.3 narrowings, which I confirmed were warranted and correctly executed), and the ledger is accurate against the tree as of today. The MATERIAL items below should be fixed, but none of them is a semantic smuggle or a misrepresented source — they are under-enumeration and two experience blind spots.

## 3. Strengths (cite sections)

- **§2 Moment 3's traceability rule** is the document's best idea and is exactly right against LLP 0081 §2: the plan-body/observation split ("review context that approval binds by digest but that carries no plan authority") matches 0081's own language ("Approval and the final receipt retain its digest for review context, but apply does not mistake a changing observation for plan authority"), and the rule that unsourced facts are *not rendered* (with G7′ as the named escape) is the mechanism that keeps the whole RFC semantics-free.
- **§1 prior-art provenance discipline.** Every entry carries an evidence tag, the tags are correct (I checked the [inferred] on Convex's online strength, the [observed] scopes, and the LLP 0084/0037 chain for Triplit), and the v0.3 narrowing of SpacetimeDB's trust-model contrast to "no authenticated, digest-bound approval artifact" is verified by the retained log — the confirmation prompt did exist and was `--yes`-bypassed.
- **§5's three-way classification** (R/D/A) with G10/G11 as *drift* rather than rendering or amendment is exactly the honest move: the receipt struct's own doc comment (`migration_executor.rs:213-215`, "gain their full §5/§6 faces in Wave 3") corroborates that the code knows it is short of §8.
- **§2 Moment 8** is nearly a verbatim faithful rendering of the shipped contract — the guide text at `guide/sync/offline-and-retention.md:408-415` says precisely "identity preserved, args discarded" for the redacted `SNAPBACK_CLIENT_ARTIFACT_STALE` re-entry, and the v0.3 end-user copy correction matches it.
- **§5's resolved-G3 note** converts a removed gap into an argument for Moment 8 rather than silently deleting it — and the underlying ticket confirms the fix, tests, and witness as claimed.
- **Moment 2b** correctly states today's derivation split — confirmed against the `Preview` verb's own doc comment (`src/cli.rs:924-927`: unambiguous intents derive; renames/conversions/required-backfills refuse derivation) — and keeps the genuinely ambiguous declaration act rather than papering over it.

## 4. Concerns

**C1 — MATERIAL — G10 under-enumerates the §8 drift.** Claim: "the shipped `MigrationReceiptV1` does not bind plan bytes, backup/checkpoint, or compatibility/rollback postures, and the stored proof retains only post-comparison actual digests". All true (`src/storage/migration_executor.rs:218-248`; the proof stores only `logicalDigest`/`systemDigest` actuals at `:3307-3315` after the compare at `:3296`). But LLP 0081 §8 also requires the receipt to bind **source revision, package/runtime identities, and cleanup state** (0081:686-693) — none present, and verify's terminal-cut logic (`migration_executor.rs:3795-3813`) explicitly places the cleanup tail *outside* the seal. Since G10 is the scoping statement for a conform-the-code ticket, the incomplete enumeration will under-scope the work. Resolution: complete the list or mark it explicitly non-exhaustive ("among them…") with a pointer to a full §8 field-by-field audit as the ticket's first step.

**C2 — MATERIAL — Moments 3/9 render a fast-republish choice the shipped profile's operator never gets.** Claim (Moment 9): "`published-held` fast republish (confirm → journaled transition → rollback receipt rendered like Moment 7)". LLP 0081 §2 as amended 2026-07-26 records that "There is deliberately no `release` verb on the local profile: `released` is the journaled tail of `apply` … a distinct verb would imply an operator hold point the local single-writer profile does not have" (0081:280-285), and the corpus proves rollback refuses after release (`tests/migration_corpus_v0.rs:249-263`). On the only shipped profile, `published-held` is reachable only via crash-resume — there is no interactive "confirm" moment in the normal flow. The rendering is semantically faithful but experientially misleading: an operator reading Moment 3's "available only while published-held (fence unreleased)" will look for a window that apply's tail closes before they see it. Resolution: one sentence in Moment 9 (and ideally the Moment 3 rollback line) stating the local-profile reality — the fast-republish branch surfaces during crash-resume from `published-held`; the interactive hold-then-open experience belongs to hosted profiles that define a release operation.

**C3 — MATERIAL — Moment 5's fidelity caveat is attached to the wrong half only.** Claim: the custody-manifest fidelity caveat ("a scrubbed fork's custody manifest changes retained-work and auth state") is stated *only* for the informational what-if, while the accelerator bullet flags only "whether a fork image can carry the binding's backup identity/restore epoch." But LLP 0158's scrub-and-mint sweeps exactly the state a §7 rehearsal of the production plan would exercise — "search journal leases and generations, claimed job rows, stream attempts, cron claim state" (0158 §Design sketch) — which is the substrate of §6's `retainedWorkPosture` proofs. If the fork-image question is ever answered yes, the dated 0081 §7 amendment must decide retained-work fidelity too, or a fork-derived rehearsal could prove `empty` where a restore-derived one would not. Resolution: extend the accelerator's flagged question to name custody/retained-work fidelity alongside backup identity/restore epoch. (Otherwise Moment 5 fits 0158 well: throwaway-first is respected, the what-if is correctly denied receipt status, and the cold-clonefile/live-backup scoping matches 0158's own.)

**C4 — MATERIAL — the deployment-ordering handoff has no Moment.** The default posture is `successor-only`: after publication, "maintenance mode remains until the new application artifact is deployed" and "Deploy and rollback tooling consumes the declaration and refuses an ordering it does not admit" (0081 §6). The stretch between a released migration and a serving app with successor artifacts — including the ordering *refusal* an operator hits deploying the wrong way around — is a first-class migration-experience moment on the default posture, and it is the one part of the operator journey (§5 G6's preview→approve→rehearse→apply→verify→rollback) the Moments never render. Principle 2 covers it only generically. Resolution: either a short Moment (or an explicit statement that the activation-ordering experience is LLP 0072's to own, with a pointer), so the guide page G6 commissions doesn't inherit the gap.

**C5 — MINOR — Moment 2 generalizes from one refusal message.** The quoted text at `src/storage.rs:10628` is the `SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED` message specifically; the applier has other non-additive refusal messages that may not read as workflow denial. G2's message-text slice should enumerate the applier's refusal family rather than fixing only the quoted instance.

**C6 — MINOR — Moment 3's fence-lane list reads as a constant.** 0081 §4 makes the lane registry "capability-derived" and "enumerated in the target's migration capability" — per-target, bound via the static capability digest. The traceability rule technically covers this (the capability digest is a digested field), but the rendered example presents a fixed list; a sentence stating the lane list is derived from the plan's bound capability would prevent a future target's rendering from drifting from its actual registry.

**C7 — MINOR — InstantDB "diffs visible before deploy" slightly over-reads the observed arm.** Diary 0030:626 says `instant-cli push all --yes` "made schema and permission diffs visible and deployed quickly" — with `--yes`, the diff was not a gate the operator sat at; display and apply were one uninterrupted command. Given v0.3 narrowed a SpacetimeDB claim on exactly this distinction, say "at deploy time" or note the interactive default separately.

**C8 — MINOR — G4′b strains the three-lane taxonomy.** The north-star note defines lane three as "a named, dated **LLP 0081 amendment**", but G4′b's class-A row is a protocol successor whose proposed owner is LLP 0093 (OQ3), not 0081. Widen lane three's definition to "a named, dated amendment to the owning contract document" or the classification header contradicts its own row.

## 5. Suggestions (non-blocking)

- Moment 4 lists "whether generator and approver are distinct" in the approval-time block; per 0081 §2 that fact is *recorded by the receipt*. The rendering can compute it at approval time, but a one-word sourcing note would keep the traceability rule airtight.
- G9's second half is confirmed and worth making vivid in the ticket: both the CLI doc comment (`src/cli.rs:1016-1018`) *and* the executor's own doc comment (`migration_executor.rs:3782-3785`) still say the §5 data proof "refuses honestly until it lands," while the code four lines later re-presents the recorded `§5-data-proof` — a nice concrete example of doc-comment drift for the audit.
- Consider a downtime-estimate line in Moment 3's ideal (labeled like the row estimate): the ceiling is an approved fact, but "expected barrier duration" is the number operators actually plan maintenance windows around, and it would ride the same G11/G7′ observation-vs-amendment machinery.
- The suggested order at the end of §5 is good; consider noting that G1's *receipt* rendering (Moment 7) should trail or co-land with G10's conformance work, so the first shipped rendering doesn't canonicalize copy for a receipt shape about to change.

## 6. Open questions for the author

1. OQ1: given the stream discipline is already normative in §2's preamble, is there any remaining argument for `--explain` over default-on? The SpacetimeDB evidence and the machine-safety argument both point one way; if so, close it rather than carry it.
2. Should G10's conformance work explicitly gate Moment 7's rendering scope (per the suggestion above), and does the "tracks whichever of the two the tree currently provides" sentence mean the rendering ships twice?
3. For C2: is the local-profile fast-republish reality (crash-resume-only) worth a G-row of its own for the `migrate status`/recovery surface (G5) to render, since that is the only context a local operator will ever meet `published-held`?
4. Is the deployment-ordering handoff (C4) this RFC's to render, or LLP 0072's — and if the latter, where does the guide page G6 commissions draw that boundary?

## 7. Recommended next step

Apply the four MATERIAL fixes in place (complete or hedge G10's enumeration; the Moment 9/3 local-profile sentence; symmetrize Moment 5's fidelity caveat; render or explicitly delegate the deployment-ordering moment) plus the minors as taste dictates — none requires re-research, and none touches the prior-art or ledger substance, which held up under full verification. Then the document is fit for the author to move toward Review/Accepted under LLP 0005 and to start executing the ledger in the suggested order (G1+G2 first, G2's message-text slice immediately).


---

## Round 4 — 2026-08-03 (target v0.4, SHA-256 8485a2155eb59c32171b393db1a60de7369f43f5bb9e67db6b07fccd8bfba311)

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (general-purpose), fresh non-author context, blind to prior rounds and to llp/reviews/
**Date:** 2026-08-03
**Redacted:** no
**Method:** same capsule shape as prior rounds, retargeted at the v0.4 bytes. Recorded verbatim below.

---

## 1. Overall assessment (one paragraph)

This is an unusually honest north-star document, and — rare for a v0.4 under review pressure — essentially every checkable claim in it survives contact with the tree. I verified the target hash, re-read LLP 0081 end to end against every semantic assertion, re-read both diaries against every quote, and ran all six spot-checks: the Moment 3 example rendering is derivable from `MigrationPlanBody` fields and matches the shipped four-step `AddRequiredField` expansion (`src/migration.rs:712-738`); all migrate verbs emit the JSON envelope only (`migrate_emit`, `src/cli.rs:7938-7956`); there is no `status` verb (`src/cli.rs:917-1156`); the resolved-G3 claim checks out (`issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md`, regression tests + acceptance witness, 2026-08-01); the guide has no migrations page and `guide/capabilities.md` has no reviewed-migration row; and G8's scale claims are exact (2-row `seeded_db`, `BACKFILL_BATCH_ROWS = 512` never looping twice, `kill_point_check` is an in-process panic — the 1,023/1,100-row fixtures in `tests/relational_migration_coupled_suite_v0.rs` are LLP 0080 projection witnesses, not migration runs). The D-class drift rows (G9-G13) are all real: `Verify { operation_id }` vs §2's `verify migration.json`, `Rollback` deserializing `MigrateApprovedFile` from an arg named `receipt`, stale doc comments on both, `precondition_rows`/`capability_health` emitted empty, no capability digest in the plan body, dry-run checking plan-vs-schema plus approval shape only, and `MigrationReceiptV1` missing exactly the §8 fields G10 lists. The document does what it says: it adds no semantics, routes every ideal-exceeds-contract residue to a named lane, and surfaces the one genuinely ambiguous case (Moment 8's tombstone-vs-resync-before-replay) as an author ruling rather than deciding it. Remaining concerns are about completeness of the ledger and one unexamined feasibility seam, not accuracy.

## 2. Verdict — READY

READY. No claim I checked was wrong, no Moment silently changes LLP 0081 behavior, the prior art is honestly represented with working provenance (including the `--yes` bypass, which I confirmed in the retained evidence log `demos/backend-bakeoff/arms/linear/spacetimedb/evidence/migration-publish.log:54`), and the gap ledger is accurate against the tree as of today. The concerns below are MATERIAL at most and are ledger-completeness items an author pass can absorb without another full round.

## 3. Strengths (cite sections)

- **The gap ledger (§5) is genuinely verified, not decorative.** Every row I audited is true in the code today, including subtle ones: G12's "preview emits empty capability health" is literally `capability_health: Default::default()` (`src/cli.rs:8091`), and G10's known-missing receipt fields match `MigrationReceiptV1` (`src/storage/migration_executor.rs:218-248`) against 0081 §8 field-for-field. The R/D/A classification with an explicit "corpus is ambiguous → author ruling" escape (OQ6) is the right governance shape for a no-new-semantics RFC.
- **Moment 3's traceability rule** — every rendered phrase maps to a JSON pointer into the digested body, the separately-digested observation (estimate-labeled per 0081 §2's exact authority split), or a fixed 0081 rule, with normative *omission* behavior — is the load-bearing idea that keeps the whole rendering layer from becoming a second, unreviewed source of truth. The G7′ routing (impact summaries need a dated §2 amendment, never rendered from nowhere) is exactly right.
- **Moment 8 / OQ6** is the most honest passage in the document: it quotes 0081's acceptance text ("settles through resync-before-replay", llp/0081 line 762-763) against the shipped tombstone-and-re-entry path (`packages/snapback-contract/index.mjs:1160-1175`, guide `sync/offline-and-retention.md:407-412`, landed d3425ea7 on 2026-07-26 as claimed) and refuses to classify it. The end-user copy disclosing the discard is the right instinct.
- **Prior art (§1) is quote-accurate with balancing papercuts.** The SpacetimeDB plan-print quote, the "inspectable migration preflight" lesson line, the Supabase "burden is orchestration" and one-command-invariants recommendation, Convex's "not a first-class reviewed migration plan," Firebase's "operational code," Appwrite's "not one atomic migration," PocketBase's 41% (3,532/2,499 words, diary 0050) and four runtime failures with both rollback caveats, InstantDB's `push all --yes` diff behavior (diary 0030:626), Triplit's CC-8 row 7 with the exact "whichever document owns deployed-client schema evolution" quote (llp/0037:194-195), and PlanetScale's "deploy requests" (llp/0001-prior-art.research.md:220) all check out verbatim or as fair paraphrase.
- **Moment 9 and the local-profile hold-point reality** correctly render 0081's 2026-07-26 amendment (no `release` verb, `released` as apply's tail) instead of inventing an interactive hold the profile doesn't have.
- **Moment 5** keeps §7's sealed rehearsal binding untouched and flags both fork questions (backup identity/restore epoch; custody-manifest fidelity for retained-work proofs) to 0158's program as amendment candidates rather than assuming them — and the custody-manifest concern is real: 0158 sweeps exactly the claimed-job/stream/cron residue (llp/0158:405-412) that §6's `empty` proof would read. The informational what-if fits 0158's throwaway-first posture cleanly.

## 4. Concerns

**MATERIAL — Moment 6's progress transport is asserted feasible without examining the single-writer seam.**
Claim: "Local apply is synchronous today; narration needs a progress-transport seam — an observer callback or the G5 status surface polling the journal."
Evidence: on the local profile, apply runs inside the exclusive single-writer barrier (`llp/0081` §1, §4), and journal batch commits are target transactions in the same SQLite database a second `migrate status` process would have to read mid-operation. Whether a concurrent reader can see committed journal cursors during execution (WAL readers vs. the write lane, lock contention during long batch transactions) is precisely the kind of constraint this RFC's own principle 1 would demand be named, and G5's "M" sizing hides it.
Resolution: one sentence in Moment 6 or the G5 row acknowledging the two transport options have different feasibility on the single-writer profile (in-process observer is safe; cross-process journal polling needs a named read-lane story), so G5's implementer doesn't discover the seam late.

**MATERIAL — the ledger's completeness claim has two uncovered surfaces it itself names.**
Claim: "The gap ledger in §5 is the actionable output" and principle 3: "CLI rendering, structured envelope, admin inspection, and guide use one vocabulary."
Evidence: admin inspection is named as a same-vocabulary surface but has no G-row (nothing in §5 covers whether/what the admin console shows for an in-flight or completed migration), and 0081 §7's backup/recoverability-preflight journey (`SNAPBACK_MIGRATION_BACKUP_REQUIRED`, the seven-day preflight age, the checkpoint-with-live-secrets disclosure) is narrated by no Moment — it is only implicitly absorbed as one row of G14's code matrix, though it is a first-class step of the production operator journey the RFC claims to walk end to end.
Resolution: either an explicit G-row for the admin-inspection surface plus a sentence placing the §7 backup/preflight step in Moment 4 or 6's journey, or an explicit statement that both are out of scope for this document and why.

**MINOR — G2 overstates the family's uniformity.**
Claim: "The applier's non-additive refusal *family* reads as workflow denial and names no next step."
Evidence: `src/storage.rs:10575` — "retyping stored data is not supported — add a new field instead" *does* name a next step (just not the reviewed-migration one); `src/storage.rs:10628` (the quoted drop/backfill refusal) names none. The enumerated-slice framing already accommodates this, but "names no next step" as a family-wide fact is not literally true.
Resolution: soften to "names no migration-workflow next step" or "mostly names no next step."

**MINOR — the SpacetimeDB `--yes` fact's provenance tag is one hop off.**
Claim: "(the retained publish log shows it bypassed with `--yes`)" under the section tag `[observed — diary 0029, 2026-07-28 deep round]`.
Evidence: the fact is true (`demos/backend-bakeoff/arms/linear/spacetimedb/evidence/migration-publish.log:54`, "Skipping confirmation due to --yes") but appears nowhere in diary 0029's text; the diary-level tag covers the arm's retained evidence only by generosity.
Resolution: cite the evidence log path inline, matching the document's own traceability standard.

**MINOR — Moment 2b's timestamp scaffold omits the monotonicity trap.**
Claim: the refusal emits "a proposed publication timestamp" the operator completes.
Evidence: 0081 §4 requires `publicationTimestamp` ≥ the maximum `_updatedAt` among rows the plan changes, checked at admission — a scaffolded timestamp that ages between scaffold and apply refuses at admission. The experience the scaffold paves should anticipate its own refusal mode.
Resolution: a clause noting the scaffold's proposed timestamp is admission-checked against row-timestamp monotonicity and how the refusal renders (it lands in G14's matrix anyway).

**MINOR — "that state is reached via crash-resume" (Moment 3's rollback line) is loose.**
Claim: "on the local profile that state is reached via crash-resume, not an operator hold."
Evidence: `published-held` is entered transiently in every successful apply (0081 §4: publication enters `published-held`; release is apply's tail). What is true — and what Moment 9 says correctly ("met only during crash-resume") — is that it is *actionable* only via crash-resume.
Resolution: align Moment 3's parenthetical with Moment 9's phrasing.

## 5. Suggestions (non-blocking)

- **Use the shipped `"wouldApply": true` key as G13's exhibit.** The dry-run handler literally returns `"wouldApply": true` after checking only plan-vs-schema validity and approval shape (`src/cli.rs:8171-8184`) — the exact "must not say admission would succeed" copy Moment 6 forbids is already in the shipped envelope key name. Citing it would make G13 concrete and imply the envelope-key rename belongs in that row's scope.
- G9 could note that the rollback handler's in-code comment (`src/cli.rs:8253-8259`) *defends* the approved-file input as deliberate — evidence that this particular drift row may well resolve as a dated 0081 §2 amendment rather than a code conform, which slightly strengthens the "audit, then conform or amend" framing.
- The suggested order paragraph could state explicitly that G2's S-slice is shippable with zero rendering infrastructure (it is pure message text), since that is the cheapest possible "SpacetimeDB moment" down payment.
- Moment 4 says "every approval-bound fact of LLP 0081 §2" and then lists body facts (backup posture, rehearsal requirement) that approval binds only transitively via the plan digest; a parenthetical "(directly, or via the bound plan digest)" would keep the rendering's own traceability vocabulary exact.
- The shipped `MigrationApprovalV1` already carries `generator_is_approver` (`src/cli.rs:8140`), which exceeds 0081's "receipt records it" — worth a half-sentence in Moment 4 since it makes that rendering line free.

## 6. Open questions for the author

1. OQ6 is correctly framed, but a decision input worth recording: the shipped tombstone path arguably satisfies 0081 §4's "rather than silently replayed or dropped" (the discard is explicit and redacted, not silent) while failing the acceptance line's "settles through resync-before-replay" for content. Does the author read those two 0081 passages as already in tension with *each other*, which would strengthen the amendment lane?
2. For G5/Moment 6: is the intended v1 transport in-process (observer inside apply, rendering to the same stderr) or cross-process (`migrate status` against the journal)? The answer changes G5's size and whether the single-writer read seam must be designed first.
3. Should the admin console's migration inspection (principle 3's fourth surface) get a ledger row now, or is it deliberately deferred to the hosted-profile era?
4. G14 covers §8's fifteen codes — should the applier-family refusals from Moment 2/G2 (which are schema-apply codes, not §8 migration codes) be explicitly declared in or out of the matrix's scope, so "total over §8" isn't misread as total over the whole schema-evolution path?

## 7. Recommended next step

Accept-track. Apply the §4-listed fixes as a v0.5 author pass (the two MATERIAL ledger-completeness items plus the wording nits — none require re-review of substance), leave OQ2-OQ6 open as author decisions, and promote per the LLP 0005 loop's stopping rule; the document is already doing its north-star job. Independently of status, G2's message-text slice and G1's golden-fixture rendering are immediately actionable and should be ticketed under `issues/` so the SpacetimeDB moment stops being aspirational — the drift-audit block (G9+G10+G12+G13) should ride one conformance pass as §5 suggests, with the G9 rollback-input question routed to the author alongside OQ6 since both are conform-or-amend rulings on 0081.


---

## Round 5 — 2026-08-03 (target v0.5, SHA-256 877d0b8581041847fd70daf62b7882d515f23448a135b51bf32a0c324924b4cb)

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (general-purpose), fresh non-author context, blind to prior rounds and to llp/reviews/
**Date:** 2026-08-03
**Redacted:** no
**Method:** same capsule shape as prior rounds, retargeted at the v0.5 bytes. Recorded verbatim below.

---

## 1. Overall assessment (one paragraph)

This is an unusually well-grounded north-star RFC. I verified every diary quotation I could locate (SpacetimeDB plan/500-rows/client-disconnect line, the preflight lesson, the `--yes` evidence log, Convex's "not a first-class reviewed migration plan," Supabase's "the burden is orchestration" and the invariants lesson, Firebase's "operational code," Appwrite's "not one atomic migration," InstantDB's push-diff line in diary 0030, PocketBase's 41%/four-failures/rollback-caveats) and they are all accurate, with hedges that faithfully track the evidence boundaries. The semantic-neutrality claim holds under a moment-by-moment check against LLP 0081 — Moments 1, 3, 4, 6, 9, and 10 restate §2/§4/§6/§7 semantics correctly (including the subtle published-held/release-as-apply's-tail and staged-publication/0072-activation split), and everything that would exceed the contract is correctly routed to A-lanes or author rulings (OQ6, OQ7). The gap ledger is largely accurate against the tree: G1/G5/G9/G11/G12/G13 verified exactly (JSON-only verbs, no `status` verb, the rollback `receipt`-arg comment at src/cli.rs:8255-8260, `"wouldApply": true` at src/cli.rs:8182, empty `precondition_rows`/`capability_health` at src/cli.rs:8089-8090, no capability digest in `MigrationPlanBody`), G8's fixtures verified (2-row `seeded_db`, `BACKFILL_BATCH_ROWS: usize = 512`, in-process `panic!` kill points), G3's resolved claim verified against the closed ticket, and G6 verified against `guide/` and `guide/capabilities.md`. What keeps this from being clean: the new redaction contract creates an unresolved tension with Moment 4's "shows what approval binds — exhaustively" thesis on the review surfaces themselves; G14's matrix is scoped to §8's non-exhaustive code list and would miss roughly six shipped migration codes; and Moment 6 narrates a §7 backup preflight whose refusal code appears nowhere in the tree, with no ledger row owning that absence.

## 2. Verdict — READY

READY. No finding is blocking or semantics-changing; the concerns below are copy- and ledger-level repairs (each S-sized), not structural ones. But the document's own preamble says the §5 ledger is "the actionable output" and stamps it "verified against the tree 2026-08-03," so concerns 2 and 3 should be applied before this ledger is treated as an execution plan.

## 3. Strengths (cite sections)

- **The three-lane governance discipline (§ preamble, principle 4) is real, not decorative.** Every place the ideal exceeds the tree is classified, and the two places the corpus is genuinely ambiguous (OQ6's resync-vs-tombstone tension, OQ7's rollback-input ruling) are surfaced as author decisions rather than resolved by fiat. I confirmed both ambiguities are genuine: LLP 0081's acceptance text (line 762-763) vs. §4 (line 446-448) do pull in different directions on quarantined-mutation settlement, and the shipped tombstone path (packages/snapback-contract/migration-quarantine.test.mjs:302-316 — identity kept, `args` redacted) sits exactly in that crack. The rollback comment defending its input as deliberate exists verbatim (src/cli.rs:8255-8259).
- **Prior art with honest provenance (§1).** Quotes check out against diaries 0029/0050 and 0030; the SpacetimeDB trust-model contrast is stated precisely and the `--yes` bypass is cited to a real evidence log containing "Skipping confirmation due to --yes" (demos/backend-bakeoff/arms/linear/spacetimedb/evidence/migration-publish.log:54). The Convex online-posture claim is correctly downgraded to `[inferred]` and matches LLP 0159 F1's own tagging. The 0037 CC-8.7 description ("for whichever document owns deployed-client schema evolution", llp/0037:194-195 — owner left unnamed) is exact.
- **Moment 3's traceability rule with omission and redaction behavior (§2)** is the strongest single idea: it makes the renderer falsifiable. The example rendering is shape-accurate to the shipped `AddRequiredField` expansion (src/migration.rs:712-738: AddField-optional → BackfillField → ValidateRequired → MakeRequired), and the row estimate is attributed to the observation with the honest admission (G11) that the carrier is empty today.
- **The fork accelerator (Moment 5, G7) is correctly amendment-blocked**, and the custody-manifest fidelity caveat is a sharp, correct reading of LLP 0158 (lines 405-408: the manifest sweeps job/cron/stream residue — exactly what §6 retained-work proofs read), fitting 0158's throwaway-first posture rather than overreaching it.
- **Moment 10 gets the hardest 0081 fact right**: publication publishes the *staged* artifact set and LLP 0072's activation consumes the receipt (0081 lines 425-428) — the v0.4 invented state is genuinely gone.
- **The resolved-G3 claim is true**: issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md — Resolved 2026-08-01, three named regression tests proven to fail pre-fix, acceptance witness — and the lesson drawn from it (live clients are where migration-experience defects concentrate) is fair.

## 4. Concerns

**C1 — MATERIAL. The redaction contract collides with Moment 4's exhaustiveness thesis on the review surfaces.**
Claim at issue: "the default rendering redacts literal constant values and anything row-derived; an explicit reveal flag (never default) shows them" (§2 intro), against "**Moment 4 — approval shows what approval binds — exhaustively.**"
Evidence: LLP 0081 §2 makes "the complete constants object" canonical, approval-relevant, and inside the digest (0081 lines 213-215); §7's redaction rule the RFC cites is scoped to *migration logs* (0081 lines 650-652), not review renderings. Under the current text, an approver running `approve` sees `constant [redacted]` by default and approves a digest binding a value they never saw — the exact SpacetimeDB failure mode (consequence hidden at the decision point) this RFC exists to prevent, and CI-log safety does not require redacting the interactive review surface.
Resolution: rule explicitly on where reveal is the default (or required) — e.g., preview/approve render constants revealed on a TTY (or approve refuses without reveal-or-acknowledge), while apply/verify narration and CI-context rendering redact per §7. One paragraph plus a G1 fixture case.

**C2 — MATERIAL. G14's matrix scope misses shipped diagnostic codes operators actually hit.**
Claim at issue: "Diagnostic→recovery matrix covering every §8 stable code plus the applier refusal family" (G14).
Evidence: 0081 §8's list is explicitly non-exhaustive ("Required stable codes **include**"), and the tree ships at least six migration codes outside it: `SNAPBACK_MIGRATION_CANCELLED`, `EXECUTOR_STALE`, `FENCE_CLOSED`, `JOURNAL_CORRUPT`, `REHEARSAL_INVALID`, `RESYNC_REQUIRED`/`UPGRADE_REQUIRED` (grep over src/). `FENCE_CLOSED` and `JOURNAL_CORRUPT` are precisely "what do I do now" moments; a matrix scoped to §8's fifteen would silently omit them, violating principle 2's totality claim.
Resolution: scope G14 to the shipped `SNAPBACK_MIGRATION_*` family (enumerated mechanically) plus the applier family, with §8 as the normative floor.

**C3 — MATERIAL. Moment 6 narrates a preflight the tree cannot produce, and no ledger row owns that.**
Claim at issue: "Admission narrates its own preflights first — including the §7 backup/recoverability preflight, whose refusal (`SNAPBACK_MIGRATION_BACKUP_REQUIRED`, or a preflight older than the profile's maximum age) renders…"
Evidence: `SNAPBACK_MIGRATION_BACKUP_REQUIRED` appears nowhere in src/, packages/, or cloudflare/ — only in LLP text. Preview hardcodes `backup: { required: false, …, rehearsal_required: false }` (src/cli.rs:8063-8067), so no path can even declare the requirement the moment renders. This may be conformant for the local-dev profile (§7 binds *production* apply), but the ledger — "verified against the tree 2026-08-03" — has no row classifying it (R-blocked-on-implementation, or D against §2's backup-requirements plan bullet being vestigial).
Resolution: add a ledger row (or fold into G9/G10's conformance pass) naming the backup-requirement/preflight seam as unimplemented, so Moment 6's narration scope honestly tracks the tree the way Moment 7's does.

**C4 — MATERIAL (low). Moment 4 lists an apply-time fact under "every approval-bound fact of LLP 0081 §2."**
Claim at issue: approval rendering shows "…backup/checkpoint posture, including the §7 recoverability-preflight **status** and its maximum age…" — "each with its JSON pointer."
Evidence: the backup/checkpoint *requirement* is a canonical plan field (0081 §2), but preflight *status* is a §7 apply-time observation with no pointer into plan, observation, or approval. By the RFC's own traceability rule that fact must name its source or render explicitly unavailable; the text doesn't say which.
Resolution: split the line — requirement/max-age render from the plan; status renders as "not yet executed / receipt at apply time" per the omission rule.

**C5 — MINOR. PlanetScale provenance tag overstates.**
Claim at issue: "**PlanetScale** `[observed — LLP 0001, primary-sourced 2026-07-23]`".
Evidence: LLP 0001's 2026-07-23 revision names six primary-source-verified sections (TanStack DB, PocketBase, Encore, DBOS, Evolu, Nakama/Colyseus) — PlanetScale is not among them, and its section carries "Confidence: medium-high (product details have changed; verify)" (llp/0001:216-234). The deploy-request fact itself is `[observed]` in 0001, so the substance stands; the date-stamped freshness claim does not.
Resolution: drop "primary-sourced 2026-07-23" or re-verify and cite that act.

**C6 — MINOR. G15 under-credits what 0081 already requires of admin inspection.**
Claim at issue: "nothing defines what admin inspection shows for an in-flight or completed migration."
Evidence: 0081's Acceptance already requires "generated artifacts, admin inspection, CLI, and Agent surfaces show the same plan/step/result identities and stable diagnostics" (0081 lines 774-775) — a thin but normative floor. G15's work is real (content is undefined), but the row should cite the existing floor rather than claim a void.

## 5. Suggestions (non-blocking)

- **Decide the `approve` verb's own interaction shape.** The RFC's centerpiece contrast is SpacetimeDB's confirmation-bypassed-with-`--yes`; today's `approve` is a one-shot writer with no gate (src/cli.rs:8106-8155). The stream-discipline decision covers *display*; a sentence on whether approve is display-then-commit in one act (InstantDB-style, shown-not-gated) or ever gated would complete the loop the prior-art section opens.
- G9's audit should also note the stale `verify` doc comment's claim that the §5 proof "lands with the verification wave and refuses honestly until then" (src/cli.rs:1016-1018) — the corpus test shows the released receipt already carries the full proof, so both rollback and verify comments mislead in the same direction.
- The Moment 3 example's ceilings ("≤10,000 affected rows") differ from preview's shipped defaults (1,000,000 / 60s, src/cli.rs:945-948); a footnote that the example's ceilings are authored, not defaults, would prevent a fixture author from canonicalizing the wrong numbers.
- Consider a short "second operator" beat in G5: 0081's "only one migration may own an app at a time" means operation *discovery* is also the collision experience; G5's "operation discovery" phrase covers it, but naming the collision case would make it explicit.

## 6. Open questions for the author

1. (C1) On the interactive review surfaces, is reveal the default — and if not, what does an approver's acknowledgement of a digest-bound-but-unseen constant mean for the "approval shows what approval binds" thesis?
2. (C3) Is the local profile's inability to declare a backup requirement (hardcoded `required: false` at preview) conformant §7 behavior for the dev profile, or a D-row against §2's backup-requirements plan bullet?
3. Should G14's matrix be generated mechanically from the shipped diagnostic registry (so a new `SNAPBACK_MIGRATION_*` code cannot land without a recovery row), mirroring 0158's custody-manifest completeness-enforcement pattern?
4. Moment 4 renders "whether generator and approver are distinct" — given the local profile's `approver` defaults to `$USER` and `generatedBy` to the same (src/cli.rs:8137), should the rendering carry explicit copy for the same-human case 0081 §2 admits ("explicit, never inferred"), so it reads as a disclosed exception rather than a silent fact?

## 7. Recommended next step

Apply C1–C6 as a v0.6 editorial pass (all are copy or ledger-row changes; no moment needs restructuring), then close the loop — the asymmetric stopping rule has been honored and the residual findings here are of the same narrowing character the header describes. After that, start execution at the ledger's own suggested head: G2's message-text slice plus G1's renderer-with-fixtures, folding the C1 redaction ruling into G1's fixture set and the C2/C3 scope corrections into G14 and the G9/G10 conformance pass before those audits begin.
