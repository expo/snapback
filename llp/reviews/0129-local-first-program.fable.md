# LLP 0129 super-refine review — Fable family

Loop: `/llp-super-refine` on LLP 0129, opened 2026-08-01 by the author.
Target document status at loop start: **Accepted** — this loop cannot
advance it; it exists to make the document correct.

## Round 1 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
general-purpose subagent (non-author context)
**Effort:** session-inherited
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author subagent; read the working tree at commit
`a9286aba` plus the uncommitted 2026-08-01 revision of the target;
blind to this loop's Codex artifact and to the prior, already-closed
`0115-0129-lockstep.*` artifacts (the instruction capsule barred both)
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `0bbc11efcb0fa0994bbc0d4791b14751a48def6bd118973e69237e2ab805ecca`
**Instruction capsule SHA-256:** `5698b78a576c15327758e6bdf9d9629b0b02fbdc1a8e0c436798ba3390a36713`
**Status:** completed
**Verdict:** NOT READY

**Orchestrator note (outside the verbatim body).** The orchestrating
session for this loop is Claude Opus 5, not Claude Fable 5 Max as the
`llp-super-refine` runtime contract pins. The reviewer-independence
invariants are intact — the orchestrating/editing session is neither
reviewer, and it belongs to neither reviewer family. Recorded here
rather than silently.

### Review (verbatim as received)

# Review: LLP 0129 "The local-first program" — super-refine round 1 (2026-08-01 revision)

**Target verified:** `llp/0129-local-first-program.plan.md` at SHA-256 `0bbc11ef…ecca`, working tree over commit `a9286aba`; the uncommitted diff is exactly the new Revised-header entry, `LLP 0138` appended to Related, and the new `## Option-C empirical decision protocol` section (confirmed via `git diff HEAD`). `./ref-check --verbose` passes (139 docs, 0 errors).

## 1. Overall assessment

The new section is a genuinely good piece of decision engineering. It takes a one-sentence trigger that was structurally vulnerable to motivated reading ("admit only if the IR rung proves insufficient…") and converts it into a pre-registered, falsifiable experiment with frozen workloads, an escalation ladder of candidates ordered by authority surface, explicit safety gates that faithfully restate the program's constraints, and a recommendation rule whose default under mixed evidence is the *less* powerful surface. It preserves LLP 0130 ER-1's detected-versus-admitted split in its body text, and it fixes the single largest evidentiary weakness of the bakeoff it cites — the fake-IndexedDB carrier — by hard-requiring a standards-real browser with durable IndexedDB.

I verified the section's characterization of the bakeoff evidence against the primary record, and it is **supported, not overstated**: Diary 0043 records that Snapback's Kanban arm "duplicated the move transformation in `update`" (diary lines 91–94, finding at line 115–117); Diary 0044 records that the branded `Id&lt;'reservations'&gt;` type "correctly forced" a "component-local pending presentation" / "app-local sidecar" for server-minted-ID create (lines 32–37, finding at 97–99); Diary 0046 records "Snapback does not reconstruct pending speculative UI after restart" and "exposes no semantic concurrent-text rebase/conflict hook" (findings, lines 141–142), with the summary report's improvement synthesis (rows 2, 3, 6 of `demos/zero-bakeoff/reports/summary.md`) matching all three. The section body's framing — "sufficient to run the decision lab, not sufficient to choose its outcome" — is the correct epistemic posture, and is even slightly more careful than the summary report's own "appears to satisfy LLP 0129's condition for reconsidering."

The defects are concentrated in one place: the **Revised header overstates what the body says**, and the section is silent on when and by whom the lab actually runs. The header asserts the bakeoff "detected the recorded expressiveness trigger" — but by the trigger's verbatim wording (OQ4: "the IR rung proves insufficient… after measurement"), by ER-1's restatement of it, and by the new section's *own* detection rule ("detected when Candidate A cannot express a frozen required fact"), the trigger cannot yet have been detected: the IR rung is unbuilt (Phase 1's gate is still the sizing spike; no evaluator exists in `packages/snapback-client`), so the bakeoff measured the current product surface, not the IR rung. Relatedly, "sufficient to run the decision lab" reads as runnable-now while Candidate A presupposes the Phase 1 evaluator. These are fixable with a few sentences, but as they stand they are exactly the kind of misreadable state this Plan's v0.3 round existed to eliminate.

On the placement question the brief poses (constraint 7): I judge the section defensibly placed. A decision protocol — trigger, outcome space, gates, admission custody — is program state, which this Plan owns; the section designs no product surface (Candidate B's examples are explicitly "not pre-decisions") and routes follow-up design to owners in its amendment contract. The execution-scale detail (fault matrix, measurement lists) would sit more comfortably in its own numbered lab Plan à la LLP 0138 once the lab has an owner, but that is polish, not a violation.

Everything else I spot-checked holds: commits `2a7bf058`/`e416fb89`/`b53c28fd` are ancestors of `main`; `demos/public-dashboard/tests/acceptance/offline-local-first.mjs` exists with exactly 9 checks; `guide/capabilities.md` rows 60–61 carry `sync.offline-js-arm` (shipped) and `sync.offline-js-arm-protected` (explicit GAP referencing the lease-custody ticket); `issues/20260731-js-arm-lease-custody-and-sessions-outbox.md` and both 2026-08-01 bakeoff tickets exist with the content the document implies; LLP 0133 exists at Status: Accepted; LLP 0130 SD-3/SD-5/ER-1 read as cited.

## 2. Strengths

- **Correct custody of the admission decision** (§Decision artifact and ownership): "The program may declare the trigger detected and recommend an outcome. Per LLP 0130 ER-1, only the author can record the admission decision." This matches ER-1 verbatim (`llp/0130-program-standing-decisions.decision.md` lines 88–91) and goes further than ER-1 requires by reserving adoption of *any* outcome, including Outcome 2, to the author ("Only the author can adopt the recommendation," §Candidate outcomes). The body cannot be read as pre-committing the author.
- **The least-power default** (§Trigger detection and recommendation rule): "uncertainty never defaults to the more powerful authority surface" and "Source brevity or lower local latency cannot promote a candidate past a safety gate" are excellent, quotable decision hygiene, directly aligned with governing constraint 1.
- **Carrier honesty closes the bakeoff's own gap** (§Required carrier and fault matrix): LLP 0138's Status section records "Browser IndexedDB restart remained an explicit carrier evidence GAP"; the lab responds by requiring "a standards-real browser with durable IndexedDB, not Node memory storage or `fake-indexeddb`," and by refusing to borrow the public-query result for the protected case. This is the protocol learning from its predecessor's weakest evidence class.
- **Safety gates restate, and do not weaken, the program's boundaries** (§Safety gates): gate 4 is LLP 0090's outbox rule (ledger row 7 verbatim: "a non-empty outbox never resumes"); gate 6 defers to the landed settlement Spec (LLP 0133, Accepted); gate 7 matches ledger row 6's lease contract. Nothing here erodes an evidence boundary (ER-2 satisfied).
- **Evidence claims are true to the diaries** (§Option-C empirical decision protocol, opening paragraph): all three cited pressure points verified against Diaries 0043/0044/0046 as quoted in the overall assessment. The three frozen workloads are recognizably derived from the three apps that produced the pressure, with the discriminator (Field Notebook restart/rebase) correctly barred from same-session memory-store shortcuts.
- **Anti-bias measures** (§Measurements and diaries): two independent builders blind to each other's first-attempt diaries, disclosed rather than normalized assistance, and no extra expert help for Candidate C — proportionate rigor for a decision this contested.
- **The workload-weakening bar** (§Frozen workloads): "A later implementation may not weaken a check because one candidate cannot pass it" is exactly the pre-registration discipline that makes the eventual recommendation trustworthy.

## 3. Concerns

**C1 — MATERIAL. The Revised header claims the trigger was detected; the document's own body, OQ4, ER-1, and the section's detection rule all say it was not.**
Evidence: header lines 8–14: "the Snapback/Zero/Replicache bakeoff detected the recorded expressiveness trigger without admitting Option C." OQ4's verbatim trigger (line 817–820): "admit option C only if the IR rung proves insufficient for browser-side write expressiveness after measurement." ER-1 (`llp/0130-program-standing-decisions.decision.md` lines 88–91) defines the trigger identically. The new section's own rule (line 715–717): "The recorded trigger is **detected** when Candidate A cannot express a frozen required fact…" — and Candidate A (the shared-IR evaluator) has never run, because no IR evaluator exists (Phase 1's evidence gate, the sizing spike, is unexecuted; LLP 0126 finding 11 "nothing is measured" is quoted at line 294–295 of this very Plan). The section body says only "detected credible browser-write expressiveness pressure… sufficient to run the decision lab" (lines 531–536), and LLP 0138's summary says only "appears to satisfy LLP 0129's condition for reconsidering." The header is the document's most-read line and, under OQ4's wording, trigger detection is the sole admission precondition — a later reader could take the header as establishing that only the signature remains. This is precisely the misreadable-summary-line defect class the v0.3 round fixed elsewhere.
Resolution criterion: reword the header so it matches the body and the detection rule — e.g., "detected credible browser-write expressiveness pressure (the OQ4 trigger itself remains undetected until Candidate A runs in the lab)" — or equivalent language making detection explicitly pending.

**C2 — MATERIAL. The lab's sequencing, feasibility, and ownership are unstated: Candidate A requires an evaluator that does not exist, and the section reads as if the lab is runnable now.**
Evidence: "That evidence is sufficient to run the decision lab" (line 535–536); Candidate A is "a browser-safe evaluator [that] derives the optimistic overlay from the content-addressed mutation IR" (lines 607–610) — this is Phase 1's deliverable (LLP 0051 D2), whose own gate ("the IR-evaluator sizing spike… nothing is measured," lines 294–295) has not run, and no evaluator exists in `packages/snapback-client`. The section never states whether the lab (a) waits for Phase 1's evaluator to pass the D5 corpus, (b) accepts a spike-grade evaluator as Candidate A, or (c) is itself Phase 1's measurement. It also names no owner, timebox, or evidence-directory home, while OQ5 establishes owner+timebox as a before-start requirement for phases — and the lab, though "not a phase," is scheduled work of comparable weight. Without this, the protocol's feasibility and its relation to the confirmed IR-rung-first resourcing (decision 2) are undefined, and manifest-freezing could start against a baseline that cannot yet be exercised.
Resolution criterion: add a short "when the lab runs" paragraph naming (i) the Candidate A prerequisite (Phase 1 evaluator at a named maturity — D5-passing, or an explicitly spike-grade build with the difference recorded in evidence), (ii) an owner/timebox disposition consistent with OQ5's pattern (revision here or a filesystem ticket), and (iii) where the immutable evidence directory lives.

**C3 — MATERIAL. The lab's baseline is not frozen against concurrent product work the same bakeoff commissioned.**
Evidence: the bakeoff synthesis (`demos/zero-bakeoff/reports/summary.md`, priorities 2–3 and 7) and the open ticket `issues/20260801-optimistic-create-and-app-error-guide-gap.md` propose near-term Snapback work — shared/generated optimistic transforms, a first-class typed optimistic create with intent-ID reconciliation, stable application-error payloads — that lands squarely in Candidate B's territory ("a typed `clientIntentId`/provisional reference that maps to a server-minted canonical ID at settlement," lines 617–618). The section says extensions are "proven necessary by the lab" (line 556) but does not say whether such surfaces may ship before the lab reports, and if they do, whether Candidate A's "shared IR only" boundary and the frozen workloads' baseline are re-frozen. A pre-registered experiment whose baseline can be silently moved by ordinary product work invites exactly the contamination pre-registration exists to prevent — or, read the other way, the section could be misread as serializing all typed-create/error-payload DX work behind a lab that itself waits on Phase 1.
Resolution criterion: one paragraph stating the interaction — which improvement-synthesis classes may proceed independently (e.g., guide patterns, error payloads), which are lab-gated (Outcome-2-shaped public surfaces), and that any pre-lab landing in gated territory updates the frozen manifests by dated note rather than silently.

**C4 — DETAIL. OQ4's residue is now stale.**
Evidence: OQ4 (lines 820–823) still reads "Residue, still open: who observes the measurement and where a dated admission decision would be recorded if the trigger ever fires" — both are now answered by the new section (the lab observes; a dated amendment to §Option-C empirical decision protocol records). Resolution: update OQ4 to point at the section and mark the residue answered (the who-owns-the-lab half can remain open per C2).

**C5 — DETAIL. "This Plan schedules nothing for it" (line 337) is now in tension with a section that conditionally schedules Candidate C prototype work.**
Evidence: §Phases' Option C paragraph versus §Candidate implementations ("Implement only for workloads still inexpressible after B"). The distinction intended — decision-grade lab work, not a shipping lane — is real but unstated. Resolution: reword to "schedules no product phase for it; the decision lab (§Option-C empirical decision protocol) is the only scheduled work, and it is decision-grade."

**C6 — DETAIL. The two-builder protocol is ambiguous.**
Evidence: "Use at least two independent builders… One builds A first and one reviews the frozen contract and result classification" (lines 710–712). If there are exactly two builders and one is the reviewer, the blinding claim ("do not see each other's diary") has no second diary to blind against; if the reviewer is a third party, say so. Resolution: state the minimum role assignment unambiguously (e.g., two builders plus one non-building reviewer, or builder/reviewer duties that don't collapse).

**C7 — DETAIL. "once that JS-arm capability is admitted" (line 653) overloads the section's own term of art.**
"Admitted" is this section's word for the author-reserved Option C decision; the JS-arm lease capability is a ticketed shipping remainder (`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`), not an admission. Resolution: "once that JS-arm capability ships."

## 4. Suggestions (non-blocking)

- When the lab gets an owner, consider extracting its execution detail (fault matrix, measurement lists, diary mechanics) into its own numbered lab Plan on the LLP 0138 pattern, leaving 0129 owning the trigger, outcome space, safety gates, and admission custody. The precedent is already in the corpus: the bakeoff itself got LLP 0138 rather than being inlined here.
- Add the decision lab to §Measurement's list of named empirical questions — it is now the program's largest planned measurement after the successor rerun.
- Name the browser-automation carrier question explicitly (Playwright/CDP, real process kill) in §Required carrier and fault matrix; the repo has never certified standards-real IndexedDB restart, so this is a new harness capability, and saying so keeps the carrier requirement honest about its cost.
- The frozen-workload names deliberately reuse the bakeoff app names. Consider one sentence noting that lab manifests get fresh check-ID namespaces so lab receipts can never be confused with the 0138 receipts they echo.
- In §Candidate outcomes, Outcome 3's contract list is strong; consider adding "bounded custody ceilings" (gate 8's vocabulary) to the admission-contract list so the contract enumeration and the gates use the same names.

## 5. Open questions

1. When does the lab run relative to Phase 1 — is Candidate A the D5-passing Phase 1 evaluator, or does a spike-grade evaluator count, with the difference recorded? (C2)
2. Who owns the lab and what is its timebox — revision here or a filesystem ticket, per OQ5's pattern? (C2)
3. Which improvement-synthesis work (summary.md priorities 1–5, 7; the two open guide-gap/product tickets) may proceed while the lab is pending, and what happens to the frozen baseline if it lands first? (C3)
4. Does Outcome 2 adoption route through LLP 0130 SD-4 (its extensions would need an owned Spec that could converge dual-family READY) or is it author-signature-only like Outcome 3? The section reserves adoption to the author but doesn't name the landing mechanics for the owned design that would follow.
5. Which carrier technology certifies full browser-process termination and offline restart, and is protected-lease coverage expected to be available by lab time given the ticketed JS-arm lease remainder?

## 6. Readiness verdict

NOT READY

The protocol itself is well-designed — evidence-true to the diaries I verified, faithful to ER-1's detected/admitted split, and equipped with the right anti-bias and least-power defaults — but the revision ships with a Revised-header line that asserts the OQ4 trigger was detected when the document's own body, ER-1, and the section's own detection rule say it was not (C1), and it presents as runnable a lab whose first candidate requires the unbuilt Phase 1 evaluator, with no stated sequencing, owner, or baseline-freeze against the product work the same bakeoff commissioned (C2, C3). All three are small in edit size — a header rewording and two short paragraphs — but each is a material misreadability or feasibility gap in a document whose prior round existed to remove exactly this defect class; once they land, I would expect this section to be READY without structural change.

## Round 2 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
general-purpose subagent (non-author context)
**Effort:** session-inherited
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed subagent; read the working tree at commit
`cfbee870` plus uncommitted changes; barred from `llp/reviews/` entirely
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `ea33e2e80433a42fd98f7849f48b0d0c587d8d509d45561c247400e014d2bd0d`
**Instruction capsule SHA-256:** `4653d1f07945f30fe31b1409fa6c01d0ce34fd6fd55bdf0d272e3a7bbc347f9e`
**Status:** completed
**Verdict:** NOT READY

**Orchestrator verification (outside the verbatim body).** Both material
findings are against edits this loop itself made in round 1, and both
are CONFIRMED:

- **C1.** `issues/20260801-fleet-burst-mutation-not-visible.md` does not
  exist in the tree. LLP 0138's own `**Revised:** 2026-08-01` header
  states the corrected diagnosis — "exact-fixture inspection proved all
  writes durable: an implicit 1,024-row query prefix was silently
  treated as complete before application-side ordering." The fix landed
  on `origin/main` as `b52e3b9c` ("fix(query): refuse implicit result
  truncation"), which carries
  `issues/closed/20260801-fleet-query-implicit-limit.md` and regression
  tests in `tests/local_v0.rs` / `tests/workerd_twin_v0.rs`. The
  orchestrator wrote the stale nonclaim in round 1 from the pre-revision
  snapshot of LLP 0138; the concurrent fleet corrected the underlying
  fact while this loop was running.
- **C2.** `guide/capabilities.md:60` records maturity `partial`; the
  round-1 exit-criterion-2 restatement (also this loop's edit) and the
  pre-existing Phase 0 status item (5) both say "shipped."

Reviewer's own concurrency note, recorded as received: the reviewer
observed that the Fleet ticket had vanished from the tree mid-loop and
that `b52e3b9c` is not an ancestor of this branch's HEAD.

### Review (verbatim as received)

# LLP 0129 super-refine round 2 — independent review

**Target:** `llp/0129-local-first-program.plan.md`, SHA-256 `ea33e2e80433a42fd98f7849f48b0d0c587d8d509d45561c247400e014d2bd0d` (verified at start and end of review; the document did not move under me). Repository working tree at HEAD `cfbee870` on `agent/eas-qualified-staging`. Note for the record: the working tree changed around the document during review — `issues/20260801-fleet-burst-mutation-not-visible.md`, listed as context in the brief, no longer exists anywhere in the tree, and its resolution landed on `origin/main` as `b52e3b9c` (not an ancestor of this branch's HEAD). Findings below account for that.

## 1. Overall assessment

This revision does what round 2 was supposed to test: the Phase 0 proof-scope correction is now accurate, complete, and — as far as I can determine by independently opening every cited file — neither over- nor under-corrects. Every tree fact the correction asserts checks out exactly. The acceptance at `demos/public-dashboard/tests/acceptance/offline-local-first.mjs` runs 9 checks (lines 109–294), forces the file carrier (`SNAPBACK_CLIENT_RQS_DIR` at line 55, `assertEqual(clientA.rqsStoreInfo.implementation, 'file', ...)` at line 111), exercises no React surface, and its single refusal check asserts `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` on a public non-eligible query (lines 128–143). `SNAPBACK_RETENTION_NOT_RETAINABLE` is produced at `packages/snapback-client/index.mjs:8056` and asserted by no test anywhere in the primary tree (repo-wide grep excluding node_modules/worktrees: only source, guide, and tickets match). No test in `packages/snapback-react` touches retention, `rqsStore`, or freshness. The fake-indexeddb coverage is confined to the three named client unit-test files. The guide row `sync.offline-js-arm` (`guide/capabilities.md:60`) and the prose in `guide/sync/offline-and-retention.md` are narrowed in the working tree to match, with the GAP ticket wired in. The landing commits `2a7bf058`/`e416fb89`/`b53c28fd` exist with matching subjects. This is the document doing constraint 2 correctly.

The new Option-C empirical decision protocol is a genuinely strong piece of decision engineering, and its evidentiary foundation is real. I verified all three motivating claims against the diaries: Kanban "duplicated the move transformation in `update`" (`diaries/0043-latency-kanban-zero-bakeoff.diary.md:91-93`); Calendar's branded `Id&lt;'reservations'&gt;` forced "component-local pending presentation" — the app-local sidecar (`diaries/0044-contention-calendar-zero-bakeoff.diary.md:32-39`, finding at 97–99); Notebook "intent survived but the pending row did not reappear speculatively after restart" and "exposes no semantic three-way text merge or conflict object" (`diaries/0046-field-notebook-zero-bakeoff.diary.md:41-46`, findings at 141–142). The section's characterization — credible pressure, not the recorded OQ4 trigger, and no proof of standards-real-browser restart failure — is *more* careful than the bakeoff's own summary (`demos/zero-bakeoff/reports/summary.md:45-48` says evidence "appears to satisfy LLP 0129's condition"; the Plan correctly holds that the trigger cannot be detected until Candidate A — the IR rung — exists and is measured). The section cannot be read as pre-committing the author: I checked it against `llp/0130-standing-decisions` ER-1 (lines 88–92) and admission is reserved to the author at every decision point ("Only the author can adopt the recommendation"; "only the author can record the admission decision"). Constraint 7 is respected: the section designs a measurement/decision procedure, and it explicitly bars candidate prototypes from defining public product contracts, routing any shippable mechanism to owner amendments or a new owned Spec.

What keeps this from READY is a narrow but real class of defect: two places where the document's stated facts have fallen out of agreement with the tree — including with evidence documents sitting in the same working tree. The gate-2 standing nonclaim cites a ticket as open that does not exist and characterizes the Fleet failure in a way the cited bakeoff Plan itself (LLP 0138, revised 2026-08-01 in this same tree) has since corrected; and the exit-criterion-2 restatement calls the `sync.offline-js-arm` row "shipped" when the row's recorded maturity is `partial`. In a revision whose entire purpose was word-level claim accuracy, and in a Plan whose house rule is "claims equal acceptance," these are material, though both are cheap, precisely-scoped fixes.

## 2. Strengths

- **The proof-scope correction is exactly right** (§Phases, Phase 0 status block). Every one of its tree assertions verified independently: the 9-check/file-carrier/public-refusal reach of the acceptance, the untested `SNAPBACK_RETENTION_NOT_RETAINABLE` refusal ("there is no Node result to borrow" is correct and well-put), the React-half gap, and the fake-indexeddb-only browser coverage. The ticket `issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md` carries all three halves, including the round-1-discovered third half, with a resolution witness that would genuinely close the gap.
- **Trigger discipline** (§Option-C empirical decision protocol, opening and §Trigger detection). The section resists the bakeoff summary's own overreach: pressure detected, trigger not detected, because the trigger's subject (the IR rung) does not exist yet. "A spike-only evaluator that has not passed D5 cannot stand in for Candidate A" closes the most likely way this experiment could have been quietly degraded.
- **Least-power and anti-fait-accompli rules** (§Candidate outcomes; §Interaction with intervening product work). "Uncertainty never defaults to the more powerful authority surface" and the freeze/re-freeze baseline rule are the two clauses that make this protocol trustworthy under the concurrent-fleet development style this repo actually has.
- **Carrier honesty as a designed requirement** (§Required carrier and fault matrix). Requiring a standards-real browser with real process kill directly answers the exact evidence GAP class LLP 0138 retained (fake-indexeddb could not certify cold restart for Zero or Replicache either — `diaries/0046` lines 69–75, 100–104). The protected-data conditional with "the public-query result may not stand in for protected evidence" correctly composes with the still-open `issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`.
- **Safety gates anchored to owned pins, with baselines stated** (§Safety gates). Gate 3's note matches LLP 0008 verbatim (field-level last-write-wins with delete-wins as the v1 default — `llp/0008` §conflict model, "Pin the v1 default to **last-write-wins per field, with delete-wins**"); gate 4 matches LLP 0090's D3 rule ("a non-empty outbox never resumes"), and the 2026-07-31 implementation amendment in 0090 confirms the every-fresh-subscribe enforcement the Phase 0 block claims.
- **Ledger row 1's lane scoping** verified against `llp/0008` §Replay environment contract (wire transmits `{generatedIds, now}`, accepted on replay) — the two-lane split with re-derivation stricter in lane L is accurately stated, and LLP 0133 exists and is `Accepted`.
- **Exit-criteria boundary work** (§Exit criteria, "Which criteria bind which phases"). The Phase-0-exit-is-not-program-completion boundary, the OQ-grade mobile disposition, and the abandoned-phase rule are clean. Criterion 2's "exact remaining closure" statement matches the tree: `auth.authorized-leases` is indeed still one arm-agnostic row (`guide/capabilities.md:66`).
- **Diary 0027 quote provenance** holds: the quoted GAP sentence exists verbatim in `diaries/0027-todo-backend-bakeoff.diary.md:332` and is carried in `llp/0126` (line 399).

## 3. Concerns

**C1 — MATERIAL. The gate-2 standing nonclaim is stale against the tree and against the evidence document it cites.**
Evidence: §Safety gates says "LLP 0138 retained one primary Snapback FAIL — a 1,000-row burst mutation returned success while neither a fresh authoritative query nor the active live result observed the changes (`issues/20260801-fleet-burst-mutation-not-visible.md`, open)... the lab records the open ticket as a named nonclaim rather than treating it as resolved by silence." Three facts have moved: (a) that ticket exists nowhere in the working tree; (b) LLP 0138 — in this same working tree — carries a 2026-08-01 revision correcting the diagnosis: all 1,000 writes were durable, and the failure was an implicit 1,024-row query prefix silently treated as complete before application-side ordering (`llp/0138` Revised header and §Status; `demos/zero-bakeoff/reports/summary.md:81-98`); (c) the fix landed on `origin/main` as `b52e3b9c` ("fix(query): refuse implicit result truncation," adding `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` plus regressions), with the resolution recorded in `issues/closed/20260801-fleet-query-implicit-limit.md` in that commit and a v2 remediation receipt of 7 PASS / 1 GAP / 0 FAIL. The Plan's description of the *symptom* matches the immutable v1 receipt, but it files the failure under gate 2 (atomicity/visibility) when the corrected root cause is false query completeness — gate 9's territory — cites a dead ticket as open, and says the ticket would otherwise be "resolved by silence" when it was in fact resolved with a root cause, a fail-closed refusal, and tests. A pre-registered protocol that instructs the lab to record a specific "open ticket" as a standing nonclaim must not encode a fact the tree has already falsified.
Resolution criterion: rewrite the paragraph against LLP 0138's corrected diagnosis — cite `issues/closed/20260801-fleet-query-implicit-limit.md` and `b52e3b9c`, reassign the failure class to false completion (gate 9) or state explicitly why it is kept under gate 2 as a historical-receipt fact, and restate what nonclaim (if any) survives the remediation (the immutable v1 receipt remains legitimate grounds for "per-workload evidence only, no general product visibility claim").

**C2 — MATERIAL (one-word scale, but in the exit arbiter). "Shipped" contradicts the guide row's recorded maturity.**
Evidence: exit criterion 2's v0.4 restatement says the tree "now carries the arm-scoped rows `sync.offline-js-arm` **(shipped**, at the narrowed reach recorded in the Phase 0 proof-scope correction)", and Phase 0 status item (5) says "`sync.offline-js-arm` (shipped, gated on the acceptance)". The row itself — `guide/capabilities.md:60`, in the same working-tree landing the proof-scope correction says narrowed it "to match" — records maturity **`partial`**, with the acceptance named "(Node/file only)" and a GAP pointer. The direction is safe (the guide is more conservative than the Plan), but criterion 2 is the program-exit arbiter and its restated deliverable misstates the row's status token; this is precisely the word-level claim/tree mismatch class that criterion 4 polices and that round 1 was convened over.
Resolution criterion: change both descriptors to match the row (e.g., "partial — Node/file slice proven; browser/React/protected reach GAP") or amend the row; either way the Plan and `guide/capabilities.md` must use the same maturity word for the same row.

**C3 — DETAIL. Lab timing is stated differently in two places.**
Evidence: §Measurement's bullet reads "the Option-C decision lab (§Option-C empirical decision protocol) — after the successor rerun, the program's largest planned measurement..." while §When the lab can run gates the lab only on the Phase 1 evaluator (sizing spike + D5 both-sides), owner, and timebox, and calls it "a conditional decision workstream after Phase 1." Whether "after the successor rerun" is a scheduling prerequisite or a size ranking relative to the rerun is ambiguous; the rerun's own timing (LLP 0130 SD-3) is not pinned relative to Phase 1.
Resolution criterion: one sentence in either section stating whether the successor rerun is a prerequisite for manifest freeze or merely the comparator the bullet ranks the lab against.

**C4 — DETAIL. Trigger detection should distinguish IR insufficiency from collision with an owned policy pin.**
Evidence: workload 3 requires rendering "retained and speculative state with distinct labels" after restart, but the current product's omission of that behavior is a *deliberate* policy — "LLP 0090's D3 policy deliberately refuses to reconstruct speculative render state while an outbox is pending" (`diaries/0046`, lines 41–43) — not an IR expressiveness fact. The disqualifying-workaround list includes "omitting durable restart/rebase behavior required by the workload," which as written could count a policy-pinned omission as trigger detection even if the IR could derive the overlay. The protocol's owner-amendment rule for shippable mechanisms already routes the eventual design change correctly, but the *detection* step doesn't require naming the colliding pin.
Resolution criterion: add a sentence to §Trigger detection requiring that when a Candidate A gap coincides with an owned pin (naming LLP 0090 D3 as the known instance), the evidence must state whether the IR itself can express the fact under a relaxed presentation policy — so the trigger measures the IR rung, not the pin.

## 4. Suggestions (non-blocking)

- **Fault matrix additions:** the browser carrier's two most product-realistic faults are absent — (a) origin storage eviction / quota pressure and the `navigator.storage.persist()` posture, and (b) two tabs on the same browser profile contending for the store (LLP 0090's web single-writer/Web Locks discipline exists precisely for this). Both are cheap rows and both are failure modes fake-indexeddb structurally cannot show.
- **Sample-size honesty:** nearest-rank p95 over "at least twenty retained samples" is the 19th-of-20 value — nearly the max. Either raise the floor for any p95 that appears in a cross-candidate comparison or label it "p95 (n≥20; indicative)."
- **Reconcile the 0138 summary phrasing:** `summary.md` says the evidence "appears to satisfy LLP 0129's condition"; this Plan correctly says it does not detect the trigger. The fix belongs in 0138/summary, but one cross-referencing clause here ("LLP 0138's synthesis requests the reconsideration; this section is that reconsideration's protocol, and the trigger remains undetected") would inoculate readers who arrive from the bakeoff side.
- **Baseline note for the lab:** the Fleet remediation (`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`, `b52e3b9c`) is exactly the kind of intervening authority-preserving fix §Interaction with intervening product work allows; when C1 is fixed, consider naming it as an example of a recorded dated baseline change so the freeze rule has one concrete instance.
- If this section keeps accreting amendments (the decision artifact is itself "a proposed dated amendment to this section"), consider graduating the protocol to its own numbered document at that point; today it sits within constraint 7's remit, and this is future-proofing only.

## 5. Open questions

1. Is the successor rerun a prerequisite for manifest freeze, or only the measurement the lab is ranked against (C3)?
2. Who besides the author can serve as the "named product authority" that approves must-have facts in §Frozen workloads, and does that designation itself need a dated record under §Open questions 5?
3. Does satisfying workload 3's speculative-restart-render fact require a dated LLP 0090 D3 amendment before any candidate's winning behavior ships (C4 implies yes; saying so would pre-route the follow-up)?
4. When the browser-carrier witness from `issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md` lands, is its harness (real browser process control, profile-preserving kill/restart) intended to be the same infrastructure the lab's carrier matrix reuses? Building it twice would be waste; sharing it should be stated.
5. What is the disposition of OQ4 at program completion if the lab's prerequisites are never all satisfied — does "program complete" require a dated statement that the trigger was never evaluated, parallel to the Option F disposition rule?

## 6. Readiness verdict

NOT READY

The document's hard parts are now right: the proof-scope correction survives full independent verification against the acceptance script, the client and React packages, the guide files, and the tickets; the Option-C protocol is faithful to the diaries it cites, compliant with LLP 0130 ER-1, well-gated, and more careful about trigger status than the bakeoff's own synthesis. But two material factual claims disagree with the tree at the reviewed snapshot: the gate-2 standing nonclaim cites a nonexistent "open" ticket and a failure diagnosis that the cited LLP 0138 — in the same working tree — has since corrected, remediated (`b52e3b9c`), and re-witnessed (C1); and the exit-criterion-2 restatement labels the `sync.offline-js-arm` row "shipped" where the row records `partial` (C2). In a Plan whose binding rule is that claims equal acceptance, and in the very revision convened to fix word-level overclaim, stale facts in the decision protocol's standing nonclaim and in the exit arbiter are material by the document's own standard. Both fixes are small and fully specified above; with C1 and C2 landed (C3/C4 are non-blocking details), this document is READY.

## Round 3 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
general-purpose subagent (non-author context)
**Effort:** session-inherited
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed subagent; read the working tree at commit
`1daf6aa4`; barred from `llp/reviews/`
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `ffb631508a063e33678de943d6a4c118b4eb12811063cfd515d5d50a3208e96f`
**Instruction capsule SHA-256:** `53bf0f6b7934cf764d2d74500fded1d4bcbf2d59bf7913662cddb8942543818d`
**Status:** completed
**Verdict:** READY

**Orchestrator note (outside the verbatim body).** The reviewer verified
`b52e3b9c`'s closed ticket via `git show` because that commit is not an
ancestor of this branch's HEAD, and independently re-derived the
acceptance's reach, the `fake-indexeddb` test set, the React test gap,
and the untested `SNAPBACK_RETENTION_NOT_RETAINABLE` refusal. Its C5
(landing order) is process guidance, not document text, and is carried
into the loop's closing report rather than the Plan.

### Review (verbatim as received)

# Review — LLP 0129 "The local-first program" (super-refine round 3)

**Reviewer:** independent LLP 0005 reviewer (Claude, Fable 5), 2026-08-01
**Target:** `llp/0129-local-first-program.plan.md` at SHA-256 `ffb631508a063e33678de943d6a4c118b4eb12811063cfd515d5d50a3208e96f`, working tree of `/Users/ccheever/projects/snapback` at HEAD `1daf6aa4` — hash verified before reading. One repository drift observed mid-review: `issues/20260801-fleet-burst-mutation-not-visible.md` was present in the session's opening git status and gone when I tried to read it; nothing in this review depends on it.

## 1. Overall assessment

This revision does what round 2 demanded, and — decisive for a round-3 verdict — every load-bearing factual claim I checked independently is true in the tree, at the stated reach, with no residual overclaim I could find. The Phase 0 proof-scope correction is accurate and complete in both directions: the acceptance at `demos/public-dashboard/tests/acceptance/offline-local-first.mjs` is exactly the headless Node/file carrier the Plan now says it is (line 55 sets `SNAPBACK_CLIENT_RQS_DIR`, line 111 asserts `implementation === 'file'`; nine `suite.check` calls; the sole refusal check at lines 128–144 asserts `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` on a public query), and it is also not *under*-credited — the exactly-once replay, duplicate-delivery ledger, D3 outbox rule, and offline cold-relaunch render the Plan still claims are all genuinely in the suite. The three "not proven" facts are each verifiable: `fake-indexeddb` appears in exactly the three named unit-test files; no test in `packages/snapback-react/` mentions retention, `rqsStore`, or freshness; `SNAPBACK_RETENTION_NOT_RETAINABLE` is produced at `packages/snapback-client/index.mjs:8056` and asserted by no test anywhere in the repository. The guide row (`guide/capabilities.md:60`, maturity `partial`, Node/file-only witness, the no-test-on-any-carrier caveat), the prose page (`guide/sync/offline-and-retention.md:39–41`), the ticket (`issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`, including the "third half" about the untested protected refusal), and the Plan now say the same thing at the same reach. This is what constraint 2 compliance looks like when it is actually done.

The new Option-C section is a well-built pre-registered experiment. Its characterization of the bakeoff is faithful and in one respect *more careful* than the bakeoff's own summary: I verified the three named pressure facts against `demos/zero-bakeoff/reports/summary.md` and diaries 0043/0044/0046 (Kanban's duplicated move transform in a projection reducer, diary 0043:91; Calendar's app-local pending sidecar forced by the branded server-minted ID, diary 0044:34–36; Notebook's deliberate no-speculative-restart-render and absent typed conflict surface, diary 0046:42–45), and the Plan's refusal to read them as OQ4 trigger detection is correct under the trigger's verbatim wording — the IR rung was never measured because it does not exist. The Fleet paragraph's re-diagnosis is precise: `b52e3b9c` exists on origin ("fix(query): refuse implicit result truncation", adding `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` with regressions in `tests/local_v0.rs` and `tests/workerd_twin_v0.rs` and the closed ticket), the v2 receipt at `demos/zero-bakeoff/apps/fleet-observatory/evidence/snapback.v2.json` reads 7 PASS / 1 GAP / 0 FAIL, and the reclassification from gate 2 to gate 9 matches the corrected root cause (false query completeness, not atomicity) in LLP 0138's Revised header and §Status. The round-2 contradiction is gone — one gate disposition stands, "NOT met," with SD-5 correctly read as not firing — and the three author-owned residues are routed as open questions 7–9 rather than silently decided, which is exactly what LLP 0130's division of authority requires. What remains is detail-grade: one attribution rule in §Trigger detection that should be extended, some wiring between OQ8 and the lab's prerequisite text, and landing-order housekeeping for the untracked evidence the section cites.

Is the proposal itself a good idea? Yes. The decision protocol converts a vague "if the IR rung proves insufficient" trigger into something that can actually be run, failed, and audited, with a least-power default, an uncertainty-never-escalates rule, and coherence ceilings that keep Outcome 2 from winning by definition. The alternative — adjudicating Option C from bakeoff anecdotes against an unbuilt Candidate A — would have been decision theater.

## 2. Strengths

- **The proof-scope correction is verified-accurate and bidirectionally honest** (§Phases, Phase 0 status block). Every one of its specific tree claims checked out (files and lines cited above), and it does not over-correct: the real strengths of the Node/file acceptance are still claimed. Exit criterion 4 is being applied to the Plan's own text.
- **The gate-9 reclassification of the Fleet nonclaim** (§Safety gates, final paragraphs) is exactly right on the evidence: the corrected diagnosis in LLP 0138 §Status and the closed ticket (via `git show b52e3b9c`) show durable writes plus an implicit 1,024-row prefix — false completion, gate 9's territory — and the Plan confines gate-9 passes to the three frozen workloads rather than minting a general query-completeness claim. Keeping the v1 receipt immutable while citing the v2 remediation witness is the right evidence discipline.
- **ER-1 hygiene is airtight** (§Candidate outcomes, §Decision artifact and ownership, OQ4). Outcome 3's heading names a recommendation; "only the author can adopt," "only the author can record the admission decision," and the dated-amendment requirement appear at every point where a reader could otherwise infer pre-commitment. I could not construct a reading of this section that commits the author.
- **The pin-versus-insufficiency attribution rule** (§Trigger detection) is a genuinely good methodological invention: the LLP 0090 D3 instance is real (diary 0046:42 records exactly this deliberate behavior), and without the rule workload 3 would have manufactured a false trigger out of a pinned presentation policy.
- **The carrier matrix answers LLP 0138's own recorded evidence gap** (§Required carrier and fault matrix): standards-real browser, process kill, same-profile offline restart, two-tab Web Locks contention — each item maps to a gap the bakeoff's fake-IndexedDB carrier structurally could not show (summary.md §Method and limits). The gate-7 four-way split matches LLP 0053 exactly (session revocation "not on this list, and deliberately so," 0053:412; the lease bound and undiscoverable-offline-revocation posture; ENG-24992 verification locus, 0053:1312).
- **Ledger row 1's lane scoping survives verification** — LLP 0008 does transmit only `{generatedIds, now}` and accept them on replay for the stated reason (0008:333–337), the LWW/delete-wins v1 default gate 3 leans on is real (0008:373), and LLP 0133 is Accepted, so "two lanes, two policies, both labeled" rests on real pins.
- **Exit criterion 2 finally has an executable terminal state** (§Exit criteria): the three named rows match the guide's current structure precisely — `sync.offline-js-arm` exists at `partial`, `sync.offline-js-arm-protected` exists as a GAP row, and `auth.authorized-leases` (`guide/capabilities.md:66`) is indeed still one arm-agnostic row.
- **§Interaction with intervening product work** plus its worked example (the Fleet fix) gives the freeze rule a demonstrated, non-hypothetical semantics — the section polices Candidate-B-by-fait-accompli without blocking correctness work, and the v0.4 carve-out for the Phase 1 IR evaluator removes the circularity round 2 found.

## 3. Concerns

**C1 — DETAIL. Trigger detection has an attribution rule for policy-pin collisions but not for unbuilt shared mechanisms.**
Evidence: §Trigger detection's third bullet (the sidecar workaround) would fire against a Candidate A whose lane-L settlement/id-mapping machinery (LLP 0133 is accepted design, not landed implementation) is merely unbuilt — and OQ8's own closing sentence names this exact hazard ("or the lab measures missing implementation instead of the IR rung's reach"), yet §Trigger detection operationalizes only the pin-collision case with a recorded test ("could Candidate A express the fact under a relaxed presentation policy"). Three things keep this at DETAIL rather than MATERIAL: the section's closing sentence pins intent ("the trigger is about the IR rung's expressive reach and nothing else"); §Candidate implementations defines Candidate A to include LLP 0133 settlement, so a settlement-less run is visibly not Candidate A; and the lab cannot start without a fresh dated author artifact (owner/timebox), by which point OQ8 is on the author's desk. Resolution criterion: add one sentence to §Trigger detection extending the attribution requirement — a Candidate A gap attributable to an unlanded shared mechanism (ledger rows 2–4, lane-L implementation) must be recorded as missing implementation, not trigger detection — or resolve OQ8 in a revision that does equivalent work.

**C2 — DETAIL. The lab's prerequisite text will not automatically track an OQ8 gate split.**
Evidence: §Measurement asserts "§When the lab can run states the prerequisites exhaustively," and that section fixes the prerequisites at sizing spike + D5; if the author resolves OQ8 by splitting Phase 1's gate into evaluator/conformance and end-to-end slices, nothing re-wires the lab's list. Resolution criterion: when OQ8 is adjudicated, the same dated revision updates §When the lab can run (or the "exhaustively" sentence gains "as of this revision; OQ8's resolution may extend them").

**C3 — DETAIL. The bakeoff summary's own trigger sentence is left standing uncorrected.**
Evidence: `demos/zero-bakeoff/reports/summary.md` §Executive answer says the evidence "appears to satisfy LLP 0129's condition for reconsidering constrained Replicache-class app-authored client mutators." The Plan's contrary (and correct) reading — pressure detected, trigger not detected — implicitly supersedes it, but a future reader of the summary alone can cite that sentence as trigger satisfaction. Resolution criterion: one clause in the Option-C intro naming and superseding the summary's phrasing ("LLP 0138's synthesis requested the decision; this section is the answer: the trigger is not detected"), or a dated note in LLP 0138. Non-blocking because LLP 0138 §Status makes no trigger claim and admission is ER-1-gated regardless.

**C4 — DETAIL. Gate 7's four cases under public-data-only mode are under-specified.**
Evidence: §Required carrier and fault matrix requires "each of safety gate 7's four authority cases run separately … while retained or pending state exists," but in the likely lab configuration (protected JS-arm capability unshipped; the matrix marks protected cases `N/A`) cases (a)–(c) operate on protected retained state that will not exist. The N/A rule ("only for a capability excluded from the recommendation boundary") resolves this in principle, but the text never says which gate-7 cases survive in public-only mode — case (d)'s resnapshot-on-reconnect plausibly does; (a)–(c) plausibly do not. Resolution criterion: one sentence stating the gate-7 case dispositions under the public-data-only branch.

**C5 — DETAIL. Landing-order dependency on untracked evidence and an origin-only commit.**
Evidence: the section's citations — `llp/0138-*.md`, `demos/zero-bakeoff/`, diaries 0042–0047 — are all untracked in this working tree, and `b52e3b9c` is not an ancestor of this branch's HEAD, so `issues/closed/20260801-fleet-query-implicit-limit.md` exists only via `git show b52e3b9c` (I verified its content that way). Every citation is true on origin/main plus the working tree, but if this Plan revision lands ahead of the bakeoff evidence the references dangle. Resolution criterion: land this revision with or after the bakeoff evidence, on a branch containing `b52e3b9c`. This is process, not document text.

**C6 — DETAIL. The 2026-07-31 Revised entry still reads "gate is recorded CLEARED under SD-5" with no superseded marker.**
Evidence: header lines around "wave-1 state refresh." The v0.4 entry above it narrates the correction, and revision logs are legitimately append-only, but a skimming reader who lands on the 07-31 entry can walk away with the withdrawn disposition. Resolution criterion: a parenthetical "(disposition superseded — see v0.4)" in the 07-31 entry, or accept the skim risk deliberately.

No BLOCKING or MATERIAL concerns. I looked specifically for the failure classes rounds 1–2 found — claim/proof mismatch, internal contradiction, silent adjudication of author-reserved decisions, stale evidence readings — and found none surviving in this text.

## 4. Suggestions (non-blocking)

- **Calibration pre-run against the Contract arm.** Before Candidate A is judged, run the three workloads' fact lists informally against the Contract arm's shipped local execution (`sync.offline`'s `Parity`-class surface). Facts the Contract arm can express bound what "IR-inherent inexpressibility" can even mean, and would give the misattribution rule in C1 a concrete comparator nearly for free.
- **Name who sets Candidate B's ceiling numbers.** §Measurements and diaries gives the reviewer contract-freezing power; saying explicitly that the ceiling numbers are frozen by the non-building reviewer (not a builder) closes a small conflict-of-interest hole.
- **Require a misattribution log.** One evidence file where every Candidate A gap is classified {IR-inherent | pin-collision | missing shared mechanism} with the recorded test applied — this turns the §Trigger detection attribution rules into an auditable artifact rather than reviewer discipline.
- **Record `navigator.storage.persist()` posture per browser/OS pair,** not just per harness — eviction behavior differs enough across Chromium/Firefox/WebKit that a single recorded posture may not describe the matrix actually run.
- **Interim Node-carrier assertion for `SNAPBACK_RETENTION_NOT_RETAINABLE`.** The ticket already poses the either/or; the ten-line Node assertion is cheap and would convert "implemented, asserted by no test on any carrier" into a bounded claim while the browser witness is built.

## 5. Open questions

The document's own OQ 7–9 are the right set and correctly author-routed: Phase 0's gate split-or-hold (OQ7), whether Phase 1's D5-only gate matches what Phase 1 promises (OQ8 — also the resolution vehicle for C1/C2), and Phase 2a's non-falsifiable exit (OQ9). Beyond those: (a) who freezes Candidate B's ceiling numbers and under what independence constraint; (b) which gate-7 cases apply in the public-data-only lab branch (C4); (c) whether the successor rerun's offline dimension (SD-3's fold) and the decision lab share any evidence or stay fully disjoint — the Plan says the rerun is not a prerequisite, but not whether lab workloads may reuse rerun fixtures; (d) whether LLP 0138's "appears to satisfy" sentence gets a superseding note (C3).

## 6. Readiness verdict

READY

Round 2's blocking defects are demonstrably repaired — one gate disposition stands and it is the honest one, the withdrawn `Parity` wording is gone, exit criterion 2 names an executable terminal row set, gate 7 matches LLP 0053's real case structure, and the Fleet nonclaim now states the corrected diagnosis with the remediation commit, regression tests, closed ticket, and v2 receipt all verified against the tree and origin. The new Option-C section is faithful to its bakeoff evidence (in one place more careful than the evidence's own summary), respects constraint 7 by designing an experiment rather than a product surface, and cannot be read as pre-committing the author past LLP 0130 ER-1. Every decisive factual claim I spot-checked — script carrier and check content, guide rows and prose, the untested protected refusal, the fake-indexeddb test set, the React test gap, the workout-inventory registration, the resolver's IndexedDB+Web Locks requirement, the 0008/0043/0053/0090/0133 pins, SD-3/SD-5/ER-1 — verified at exactly the stated reach. The six concerns above are all DETAIL-grade polish or landing-order process, individually cheap, and none impairs the document's correctness, coherence, feasibility, safety posture, or the quality of the decision the protocol will produce; the genuinely open matters are the three author-owned residues the document already routes as open questions, which is where a Plan of this kind is supposed to leave them.

## Round 4 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
general-purpose subagent (non-author context)
**Effort:** session-inherited
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed subagent; read the working tree at commit
`2506ed72`; barred from `llp/reviews/`
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `251ded42c41fcadd53cd343fbbd4bd572dcf29fea5919a35531b219138241989`
**Instruction capsule SHA-256:** `7f459f35f2ec635b25fa133f19358a04ad6bbc40f76b701f2bd659d64e1a6795`
**Status:** completed
**Verdict:** READY

**Orchestrator verification (outside the verbatim body).** C2 is a
correction of text **this loop wrote in round 2**, and it is CONFIRMED.
LLP 0090 §D3's "Outbox rule (LLP 0043)" pins a *resume* rule — "a
relaunching client with a non-empty mutation outbox does not send
`resumeFromToken`; it takes the 0043 path (full resync, then replay).
Composing resume with a pending outbox is milestone-3 work co-owned by
LLP 0043." No sentence in 0090 refuses speculative render
reconstruction; that consequence lives in the client implementation and
in Diary 0046's phrasing. The Plan's worked example therefore sat
between its own {pin-collision} and {missing shared mechanism} classes,
with the owner framing it as deferred composition work — the
missing-mechanism class. Fixed in v0.6.

### Review (verbatim as received)

# Review — LLP 0129 "The local-first program" (super-refine round 4)

**Reviewed artifact:** `llp/0129-local-first-program.plan.md`, SHA-256 `251ded42c41fcadd53cd343fbbd4bd572dcf29fea5919a35531b219138241989` (verified at start and end of review; unchanged). Working tree at `2506ed72`. I did not open anything under `llp/reviews/`.

## 1. Overall assessment

This revision does what the previous rounds demanded: it stops narrating and starts matching the tree and the owning documents. I spot-checked every load-bearing claim the round-4 brief flags, plus the Phase 0 tree facts, and the document now survives adversarial verification. The corrected gate 7 reproduces LLP 0053's actual dispositions — "Coarse events quarantine; only proof deletes" (0053 line 1218), the quarantine/delete producer table (0053 lines 1201–1202, including the exact delete-on-proof triple: typed `SNAPBACK_AUTH_PERMISSION_DENIED`, superseding snapshot, lease expiry without revalidation), the session-revocation exclusion ("Not on this list, and deliberately so", 0053 line 412), and the attempt-four history — essentially verbatim. Gate 6's denial-not-degradation posture is correctly grounded: LLP 0133 §Non-goals excludes action replay ("the action tier is nondeterministic and never auto-replayed", 0133 line 697) and LLP 0126's "What stays impossible" list (lines 648–654) pins actions and external effects as never auto-replayed. LLP 0043's proof rule is quoted verbatim (0043 lines 48–53). LLP 0133's §Status is now reconciled to its Accepted metadata (0133 lines 725–733), exactly as the v0.5 header claims. The v0.5 out-of-document corrections all landed: the acceptance script's header now explicitly disclaims React/IndexedDB/browser-restart reach and states SD-5 does not fire on it (`demos/public-dashboard/tests/acceptance/offline-local-first.mjs` lines 1–9), and `guide/sync/offline-and-retention.md` (lines 37–52) explicitly lists `SNAPBACK_RETENTION_NOT_RETAINABLE` as not proven by the witness.

The Phase 0 proof-scope correction is accurate and, as far as I can determine, complete — it neither over- nor under-corrects. The retained acceptance has exactly 9 checks, sets `SNAPBACK_CLIENT_RQS_DIR` (line 62), asserts `rqsStoreInfo.implementation === 'file'` (line 118), and its single refusal check is the public non-eligible case `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` (lines 135–142). `SNAPBACK_RETENTION_NOT_RETAINABLE` is produced at `packages/snapback-client/index.mjs:8056` and asserted by no test file anywhere in the repository (grep over test files returns nothing). No test in `packages/snapback-react` touches `rqsStore`, retention, or freshness (its five test files cover assets, lifecycle, optimistic, package, presence). The three fake-indexeddb unit-test files the Plan names exist. The guide row `sync.offline-js-arm` (guide/capabilities.md line 60) is `partial`, names the Node/file-only reach, and flags the untested refusal — Plan, guide row, prose, and code now say the same thing at the same reach. The script is registered in the workout inventory (`scripts/run-workout-apps.mjs:15`).

The new Option-C section rests on evidence it characterizes fairly. The bakeoff findings are real and stated at the right strength: Kanban "duplicated the move transform in a projection reducer", Calendar's server-minted ID "forced an app-local pending sidecar" (`demos/zero-bakeoff/reports/summary.md` lines 132–135), and the Notebook arm "deliberately does not render a speculative pending row after restart and does not expose a semantic three-way text-merge UI" (lines 36–38). The "appears to satisfy LLP 0129's condition for reconsidering" phrasing is really in the synthesis (summary.md lines 44–46), and the Plan's supersession of it — reconsideration met, trigger not detected, admission not implied — is the correct reading, since 0129's recorded OQ4 trigger requires IR-rung measurement that cannot yet exist. The Fleet nonclaim rewrite is verified end to end: LLP 0138's 2026-08-01 Revised header records the corrected diagnosis (implicit 1,024-row prefix, all writes durable), `b52e3b9c` lands `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` with regressions in `tests/local_v0.rs` and `tests/workerd_twin_v0.rs` and closes `issues/closed/20260801-fleet-query-implicit-limit.md` (verified via `git show` — the commit is not an ancestor of this branch's HEAD, as the brief anticipated), and the v2 receipt at `demos/zero-bakeoff/apps/fleet-observatory/evidence/snapback.v2.json` tallies exactly 7 pass / 1 gap / 0 fail. Re-filing it under gate 9 (false completion) rather than gate 2 is the correct taxonomy.

Is this a good plan? Yes — and the Option-C protocol specifically is unusually good experiment design: Outcome 0 restores totality, the proof-of-inexpressibility rule turns a universal claim into something two independent builders can actually establish or defeat, the misattribution log guards the exact failure mode (measuring absence) that OQ8's substrate gap creates, B's coherence ceilings prevent the automatic-Outcome-2 pathology, and ER-1's reservation is respected everywhere — the section cannot be read as pre-committing the author. The document also passes constraint 7: it designs a lab and a decision procedure, explicitly refuses to define product contracts, and routes any shippable mechanism to owning documents. My remaining findings are precision-grade.

## 2. Strengths

- **Owner-faithful safety gates** (§Safety gates). Gate 7's four cases and three 7(b) paths match LLP 0053's producer/obligation table and prose nearly word for word, including the delete-on-proof list and the attempt-four correction rationale; gate 7(a)'s LLP 0039 client-wide delete and LLP 0055 grant-scoping are both real (0053 line 1202; 0055 lines 408, 1245). Gate 3 correctly names LLP 0008's field-level LWW/delete-wins v1 default (0008 line 373) so the gate demands honesty, not universal opt-in conflict declaration.
- **The proof-scope correction is exactly true** (§Phases, Phase 0 status block). Every sub-claim — store carrier, refusal code, missing React coverage, untested protected refusal, fake-indexeddb-only IndexedDB coverage — checks against the tree, and all three gaps are ticketed in `issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`, which exists and says what the Plan says it says.
- **Decision-quality machinery** (§Trigger detection and recommendation rule). Outcome 0, the two-builder same-fact sealed-evidence standard, owner-validated primitive naming, symmetric standards for B, and descriptive-only authoring figures under the fixed A→B→C ordering collectively make the trigger hard to fire by accident — the right bias given "uncertainty never defaults to the more powerful authority surface."
- **Honest self-inflicted collisions stated rather than papered over** (§Exit criteria "Completion is currently unreachable"; §Measurement " 'Must answer' now binds"). Binding the four floating measurements to phases and the completion boundary closes a real hole where the program could have declared completion without answering its own mandatory questions.
- **The gate disposition is now one disposition** (Phase 0 status block): landed lane, gate NOT met, SD-5 not fired — consistent with LLP 0130 SD-5's actual wording ("gate failure or scope change escalates; gate success does not"), with the split-or-hold routed to the author as OQ7.
- **Correct supersession of LLP 0138's citable-out-of-context sentence** (§Option-C empirical decision protocol, opening paragraph), with the underlying synthesis sentence verified in `demos/zero-bakeoff/reports/summary.md` lines 44–48, which itself already reserved admission to the author.

## 3. Concerns

**C1 — DETAIL. §Candidate outcomes still opens "The lab can recommend exactly one of three outcomes" while Outcome 0 lives two sections away.**
Evidence: §Candidate outcomes lists outcomes 1–3 with no mention that a fourth recorded state exists; Outcome 0 is defined only inside §Trigger detection and recommendation rule. The sentence is technically defensible (Outcome 0 is defined as *no* recommendation, so the totality claim about recommendations holds), but the v0.5 header says Outcome 0 was added precisely because "exactly one of three outcomes" was not total, and a reader of §Candidate outcomes alone re-derives the round-3 defect.
Resolution criterion: one sentence in §Candidate outcomes noting that the lab may instead record Outcome 0 (no recommendation), with a pointer to its definition.

**C2 — DETAIL. The LLP 0090 D3 "pinned presentation choice" is stated more strongly than the owner's text.**
Evidence: the known-instance paragraph in §Separating IR insufficiency from collision with an owned pin says "LLP 0090's D3 policy *deliberately* refuses to reconstruct speculative render state while an outbox is pending — that is a pinned presentation choice." What 0090 D3 actually pins is an outbox/resume rule: "a relaunching client with a non-empty mutation outbox does not send `resumeFromToken`; it takes the 0043 path (full resync, then replay). Composing resume with a pending outbox is milestone-3 work co-owned by LLP 0043" (0090 §D3, lines 710–716). No sentence in 0090 refuses speculative render reconstruction; the render consequence lives in the implementation ("renders nothing ahead of the full resync", `packages/snapback-client/index.mjs` ~6840, citing "LLP 0090 D3 outbox rule (LLP 0043 milestone boundary)") and in Diary 0046's phrasing, which the Plan inherits. This matters because the Plan's own misattribution taxonomy distinguishes {pin-collision} from {missing shared mechanism}, and its sole worked example sits ambiguously between them — the owner frames it as *deferred composition work*, which is the missing-mechanism class. The routing consequence is identical either way (not trigger detection; a dated change lands in the owner), so this is precision, not correctness of outcome.
Resolution criterion: reword the known instance to attribute the render behavior to the implementation of 0090 D3's v1 milestone boundary (co-owned with LLP 0043), or explicitly note that its classification between pin-collision and missing-mechanism is itself a call the owner validates — either keeps the example from teaching the wrong classification test.

**C3 — DETAIL. Gate 7's public-data-only branch N/As case (a) on a rationale that does not cover pending outbox state.**
Evidence: the branch says "cases (a)–(c) operate on protected retained state that does not exist, so they are N/A," but the fault matrix requires the four cases to run "while retained or pending state exists," and pending intents exist in a public-data lab with an authenticated session regardless of protected retention (0053's delete table also assigns pending mutations a disposition on authority loss). The safety property survives anyway — gate 7(d)'s execution-time authorization check binds in the branch, 0043's descriptor comparison refuses cross-identity replay server-side, and gate 8 bounds custody; 0090 itself classifies the public-entry user-switch wipe as hygiene, "not a data-exposure gate" (`index.mjs` ~1817 comment; 0090 lines 750, 864). But as written, a candidate could cite the branch to skip the logout-with-pending-outbox run that the matrix separately demands.
Resolution criterion: one clause in the branch stating that case (a)'s pending-outbox half remains applicable (or is expressly covered by (d)'s execution-time check plus gate 8), so the matrix and the branch cannot be read against each other.

**C4 — DETAIL. Wording: "The least powerful outcome that passes every required workload becomes the program's recommendation" (§Candidate outcomes).**
Evidence: outcomes do not pass workloads; candidates do. The intended rule (recommend the least-powerful outcome whose corresponding candidate passes every required workload and gate) is recoverable but the sentence as written has no referent for "passes."
Resolution criterion: reword to name the candidate as the thing that passes.

No BLOCKING or MATERIAL concerns. I specifically verified and cleared the areas the brief flagged: the 0053 dispositions (accurate, including the three 7(b) paths and the public-data-only sub-branch), the 0043 Parity rule (verbatim), 0133 (status, action-replay exclusion, lane Q/L split, logical-mint id-map — all present at 0133 lines 24–27, 155–157, 697, 725–733), 0126 (impossibility list, five-element tuple at lines 512–524 matching constraint 5 exactly, findings 1/2/3/5/11, Diary 0027 quote at line 399), and 0090 (C2 above is the only residue).

## 4. Suggestions (non-blocking)

- Require the frozen manifests to pin the browser build/version and `navigator.storage.persist()` posture at freeze time (the carrier section records the posture per run and the decision artifact names "browser"; pinning at freeze prevents a mid-lab browser update from becoming an unrecorded baseline change under §Interaction with intervening product work's own rule).
- Preregister the misattribution log's classification *tests* — what concrete evidence distinguishes IR-inherent from missing-shared-mechanism — at manifest freeze, not at classification time, so the owner-validation step adjudicates against a frozen rubric.
- When this branch reconciles with `origin/main`, sweep the superseded Fleet ticket: the working tree still carries an untracked `issues/20260801-fleet-burst-mutation-not-visible.md` while the re-diagnosis closed the matter as `issues/closed/20260801-fleet-query-implicit-limit.md` on `b52e3b9c`; two live tickets for one defect would violate the repo's own single-tracker rule.
- §Measurement calls the lab "the only one whose output is a decision recommendation rather than a number" — with Outcome 0, its output may be a recorded non-recommendation; a two-word hedge would keep that sentence exact.

## 5. Open questions

- The document's own OQ7 (Phase 0 gate split-or-hold), OQ8 (Phase 1 gate sufficiency — which now also gates lab scheduling), and OQ9 (Phase 2a falsifiability, on which completion hangs) are the right three, correctly author-routed; nothing I found adds a fourth of that rank.
- Within the lab: who validates B's coherence-ceiling numbers before freeze? The reviewer freezes the contract, but the ceilings' *values* (mechanism count, app-specificity share, bundle delta) shape the B/C boundary and currently have no named adjudicator other than "freeze the exact numbers with the manifests."
- Does the public-data-only branch intend authenticated sessions with pending intents to be in scope (per C3), and should the recommendation-scope narrowing sentence say so explicitly?

## 6. Readiness verdict

READY

Every load-bearing claim I checked — the 0053 disposition split, the 0043 proof rule, 0133's status and exclusions, 0126's impossibility pins and tuple, the 0138/bakeoff evidence characterization, the Fleet re-diagnosis, and the full set of Phase 0 tree facts down to individual line numbers — is accurate against the owners and the code, and the prior rounds' overclaims are corrected at exactly the right reach without over-correction. The four concerns above are precision and cross-referencing defects whose worst-case misreading is already backstopped by other rules in the same document (owner validation in the misattribution log, gate 7(d) plus gate 8 in the fault matrix); none affects correctness of a decision the protocol could produce, none weakens an evidence boundary, and each has a one-sentence fix. Under the stated standard — no unresolved material correctness, coherence, feasibility, safety, or decision-quality concern, with clearly labeled non-blocking polish permitted — this document is ready.

## Round 5 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
general-purpose subagent (non-author context)
**Effort:** session-inherited
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed subagent; read the working tree at commit
`2506ed72`; barred from `llp/reviews/`
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `80397b59b3251bd9c639e85a34d7e27ade322017c88243fcffecac886ccfea3a`
**Instruction capsule SHA-256:** `bbfbbf45b1c5dee903057691a163948dc480f3531d63dff1ec95c14a8e6d7d7e`
**Status:** completed
**Verdict:** NOT READY

**Orchestrator verification (outside the verbatim body).** C1 is a
contradiction **this loop introduced in v0.6** while fixing a different
one, and it is CONFIRMED: the reworded least-power sentence selected on
workloads and gates only, while ceilings are defined separately and
Outcome 0's own case (ii) is exactly the state where B passes every
workload and gate but exceeds a ceiling. Repaired in v0.7. C6 (ledger
row 7's stale "unbuilt") was raised independently by Codex as its
material 7; Fable's framing — distinguishing the shipped RQS
token-resume ladder from LLP 0008's journal-delta consumer, and
declining to assert either way without verifying the wire path — is the
one the fix follows.

### Review (verbatim as received)

# Review — LLP 0129 "The local-first program" (super-refine round 5)

Reviewed against working tree at commit `2506ed72` (target SHA-256 `80397b59b3251bd9c639e85a34d7e27ade322017c88243fcffecac886ccfea3a`, verified identical at the start and end of this review). Per the brief, nothing under `llp/reviews/` was opened. All file citations below were checked directly; line numbers are from the working tree.

## 1. Overall assessment

This revision does what four rounds of split verdicts demanded: it stops narrating evidence it wishes it had. I verified the load-bearing claims independently, and the corrections are — with one class of exception described in Concerns — accurate, and in several places accurate to a degree that is genuinely unusual. The v0.6 "cold boot is the wrong word" correction matches the code exactly: `demos/public-dashboard/tests/acceptance/offline-local-first.mjs` disposes the handle, calls `closeClient(clientA)` (line 156), stops the server (line 157), and constructs `clientB` in the same Node process (lines 159–164); it sets `SNAPBACK_CLIENT_RQS_DIR` (line 62), asserts `rqsStoreInfo.implementation === 'file'` (line 118), runs exactly 9 checks (`expectedChecks: 9`; the retained report reads `passed 9, failed 0, ok true`), and its single refusal check asserts `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` on a public query (lines 135–151). No React import, no IndexedDB, no process termination. The Plan's Phase 0 proof-scope text now states precisely this and nothing more.

The round-4 evidence-strength corrections in the Revised header all check out. LLP 0090 D3 (lines 710–715) says exactly what the Plan now quotes — a resume rule ("a relaunching client with a non-empty mutation outbox does not send `resumeFromToken`; it takes the 0043 path"), with composition deferred to milestone 3 — and contains no prohibition on reconstructing labeled speculative state; the withdrawn "known pin" preclassification was indeed wrong, and its source is traceable: the bakeoff's own gap declaration (`demos/zero-bakeoff/apps/field-notebook/acceptance/snapback.mjs` lines 133–135) and Diary 0046 line 41 both misattribute a "deliberately refuses" policy to D3. The Notebook stretch findings are, as v0.6 now says, immediate `suite.gap(...)` declarations, never executed runs. The gate-7 safety narrowing is grounded: LLP 0039's clear barrier "removes optimistic overlays and pending queues, commits the durable delete" (llp/0039, lines 1044–1050), LLP 0053's connected-case rule is quarantine-on-coarse/delete-on-proof (lines 254–256, 287–293), session revocation is "Not on this list, and deliberately so" (line 412), and LLP 0055 defines grant-scoped delete (line 1245). The Fleet re-diagnosis matches LLP 0138's Revised header and §Status, `b52e3b9c` exists (not an ancestor of this branch's HEAD, as the brief anticipated), and the v2 receipt's counts are literally `{pass: 7, gap: 1, fail: 0}` in `demos/zero-bakeoff/apps/fleet-observatory/evidence/snapback.v2.json`. The guide corrections advertised in the header landed: the capability row is `partial`, states the resolver's real prerequisites (IndexedDB **and** Web Locks — `rqs-store-default.mjs` lines 62–63), and discloses that `SNAPBACK_RETENTION_NOT_RETAINABLE` (produced at `packages/snapback-client/index.mjs:8056`) is asserted by no test — which my repo-wide grep confirms. No file in `packages/snapback-react` so much as mentions `rqsStore`, `retention`, or `freshness`.

What keeps this from READY is one narrow but real defect in the Option-C section's own decision machinery: the least-power selection rule in §Candidate outcomes contradicts the coherence-ceiling bar in §Trigger detection in a reachable state the document itself enumerates (Outcome 0, case ii). This is exactly the class of totality/contradiction bug v0.5 and v0.6 were written to eliminate — v0.6 fixed the same shape in Outcome 3's "a concrete B attempt" — and by this loop's own standard it is material. It has a one-clause fix. Everything else I found is non-blocking detail.

## 2. Strengths

- **The proof-scope correction is exact, and neither over- nor under-corrects.** Every element of the §Phases "Proof-scope correction" block checked out against the tree: the file-store assertion, the public-only refusal check, the `fake-indexeddb` confinement of the browser store's coverage (`rqs-store.test.mjs`, `rqs-resume.test.mjs`, `outbox-store.test.mjs` all import it), the React half's total absence of coverage, and the untested `SNAPBACK_RETENTION_NOT_RETAINABLE` refusal. Nothing the suite actually proves was disowned — retained render with the backend down, durable queue, exactly-once replay, and the duplicate-delivery ledger check (script lines 162–273) are all real and still claimed.
- **The D3 withdrawal (§Trigger detection, "No gap is preclassified as a pin") is the round's best piece of work.** It corrects the Plan against the primary source rather than against the bakeoff's secondary narration, correctly identifies the bakeoff's own receipt as the misattribution vector, and converts the error into a standing rule ("a gap counts as a pin collision only if an owning document explicitly adopts the prohibition before the experiment freezes") that would have caught the same mistake next time.
- **Gate 7 now carries the owners' actual dispositions** (§Safety gates 7a–7d): the quarantine/delete split, the typed-denial proof, the lease-expiry fail-closed bound, and the v0.6 narrowing of the `N/A` branch to configurations with no authority-bound state at all — each verified against LLP 0053, 0039, and 0055. The observation that an authenticated client in a public-data lab still holds queues and overlays is correct and closes a genuinely unsafe branch.
- **Exit criterion 2's closure map is now honest about conjunction.** I verified the claim against both tickets: the browser ticket's resolution witness is public-query React/IndexedDB restart plus protected refusal (no authenticated rows), and the lease ticket's acceptance explicitly permits extending the headless suite. Neither forces authenticated shell + authorized rows + real process restart in one run, so the named integrated witness is a real requirement, not belt-and-suspenders.
- **The Option-C section cannot reasonably be read as pre-committing the author** (§Candidate outcomes, §Decision artifact and ownership): four separate statements reserve admission to the author, matching LLP 0130 ER-1's text (llp/0130, lines 88–91), and the supersession of LLP 0138's "appears to satisfy" phrasing accurately characterizes `reports/summary.md` lines 44–49, which itself only "requests that decision."
- **The bakeoff evidence is characterized at its true strength** (§Option-C protocol, opening): Kanban's duplicated projection reducer (Diary 0043 line 91), Calendar's app-local pending sidecar (Diary 0044 lines 32–36, 99), and Notebook's declared-GAP-not-executed-run status all verified. "Credible pressure, not the recorded trigger" is the right reading.
- **The completion-boundary honesty** (§Exit criteria, "Completion is currently unreachable"): stating the OQ9 collision rather than papering over it is the correct posture for an Accepted Plan whose loop cannot advance status.

## 3. Concerns

**C1 — MATERIAL. The least-power selection rule contradicts B's coherence ceilings in Outcome 0's own state (ii).**
Evidence: §Candidate outcomes ends: "The least powerful outcome **whose candidate** passes every required workload and every applicable gate becomes the program's recommendation." Ceilings are not gates — §Trigger detection defines them separately and says exceeding one "does bar a silent Outcome 2," and Outcome 0 case (ii) is precisely "Candidate B expresses every fact but exceeds its coherence ceilings, so Outcome 2 is barred." In that state, B passes every required workload and every applicable gate, so the §Candidate outcomes sentence recommends Outcome 2 while §Trigger detection mandates Outcome 0. Two normative sentences yield different recommendations for the same reachable evidence state, in the section whose entire purpose is decision quality; v0.6 treated the identical shape (Outcome 3's singular "concrete B attempt" vs. the proof rule) as a contradiction requiring repair, and the same standard applies here.
Resolution criterion: amend the least-power sentence so its selection condition includes every applicable condition of the outcome's recommendation rule — e.g. "passes every required workload, every applicable gate, **and (for Outcome 2) stays within B's preregistered coherence ceilings**" — or demote the sentence to an explicitly non-normative summary deferring to §Trigger detection's rules.

**C2 — DETAIL. Gate 7(b)'s delete-proof list still contains "lease expiry without revalidation" after the v0.6 exclusivity fix.**
Evidence: gate 7(b) lists delete "only on proof — typed `SNAPBACK_AUTH_PERMISSION_DENIED`, a superseding snapshot proving access is gone, or lease expiry without revalidation," while the same gate's public-branch paragraph rules "lease expiry without revalidation belongs to (c) … and is not also a (b) producer." The mechanism reading (a (b)-originated quarantine may later hit (c)'s lease bound) is reconcilable, but a lab operator scoring the matrix from (b)'s list could count a lease-expiry delete as a (b) pass, which is the double-counting the exclusivity sentence exists to prevent.
Resolution criterion: prune "lease expiry without revalidation" from (b)'s proof list, or annotate it in place as (c)'s mechanism reachable from a (b) episode and excluded from (b)'s case accounting.

**C3 — DETAIL. The Phase 1 SD-5 suspension is not mirrored where SD-5 lives, and 0130 now misstates the operative rule.**
Evidence: LLP 0130 SD-5 reads "Phases advance automatically when their gates pass … gate success does not [escalate]" (llp/0130, lines 74–77) with no note of the suspension; it also names Phase 1's gate as "determinism conformance corpus" alone, while this Plan names sizing + D5. The Plan's §Decision posture and §Phases intro also restate SD-5 unqualified, with the suspension carried only in the Phase 1 block. The direction is conservative (declining a delegated permission and waking the author is always safe under 0130's own ER preamble), and SD-5's phrasing forces a reader through this Plan's gates anyway, so I do not rate this material — but the standing-decisions registry should not read the opposite of the operative rule.
Resolution criterion: a dated one-line note at 0130 SD-5 recording the Phase 1 suspension pending OQ8 (author's to land), or a sentence in this Plan's Phase 1 block explicitly framing the suspension as the program declining its delegated auto-advance and proposing that 0130 note, plus a cross-reference from the two unqualified SD-5 restatements.

**C4 — DETAIL. The refused-replay reattribution covers the store contract, not the refusal wiring.**
Evidence: `guide/sync/offline-and-retention.md` (working tree) says the drop-and-mark-failed behavior "is covered by the package unit test `packages/snapback-client/outbox-store.test.mjs`"; that test covers `outboxMarkFailed`/`outboxRecords` store semantics (lines 58–68). The client wiring that maps a server refusal to that call (`index.mjs:5156`, emitting `SNAPBACK_OFFLINE_MUTATION_REPLAY_FAILED` at 5163) is asserted by no test in the repository — the diagnostic code appears only in `index.mjs` and built demo bundles. A regression in the wiring would fail nothing while the guide cites a covering test. This is a smaller instance of the same overclaim class the round-1 verification caught for `SNAPBACK_RETENTION_NOT_RETAINABLE`, one layer up; the Plan's header phrase "the package unit test that actually covers it" inherits the imprecision.
Resolution criterion: narrow the guide sentence to the store contract ("the store's drop-and-mark-failed contract is covered by …; the client's refusal-to-markFailed wiring is untested"), or add a client-level refused-replay test and cite it.

**C5 — DETAIL. Status-vocabulary residue: §Measurements and diaries allows `N/A` where §Safety gates does not.**
Evidence: the first §Measurements bullet records "frozen checks and safety rows as PASS/GAP/FAIL/N/A," while §Safety gates pins workload checks to "their own `PASS`/`GAP`/`FAIL` reporting" and reserves `N/A` for safety rows. The combined phrasing is readable as licensing `N/A` on checks.
Resolution criterion: split the bullet ("frozen checks as PASS/GAP/FAIL; safety rows as PASS/FAIL/GAP/N/A") so the v0.6 unified vocabulary is unambiguous.

**C6 — DETAIL. Ledger row 7's "no client caller" wording predates a landing that added client-side resume consumption, and needs a dated re-scope.**
Evidence: row 7 says the version-based delta-resume consumer is "unbuilt — the journal floor and `resume_requires_resnapshot` have no client caller." The client now sends `resumeFromToken` and consumes rung-1/2/3 answers (`packages/snapback-client/index.mjs` 5399–5410, 7799–8036). The row plausibly remains true for LLP 0008's journal-floor delta lane specifically — `resume_requires_resnapshot` appears only server-side (`src/local.rs`, `src/storage.rs`) and I found no client journal-delta consumer — but I could not conclusively establish whether the rung-2 witness path consumes the journal floor, and the row's flat "unbuilt" now needs qualification against the shipped token-resume ladder to stay within constraint 2.
Resolution criterion: a dated verification note on row 7 distinguishing the shipped RQS token-resume consumer from the still-unbuilt 0008 journal-delta consumer, confirmed against the wire path.

**C7 — DETAIL. Exit criterion 2's integrated witness has no owning ticket.**
Evidence: criterion 2 says the integrated authenticated React/browser/full-process-restart witness "needs its own named owning ticket or artifact"; no such ticket exists in `issues/` (only the browser-carrier and lease-custody tickets, which the criterion correctly says are insufficient in conjunction). The requirement is recorded in the criterion itself so it cannot be silently skipped, but it is currently a dangling deliverable with no owner, colliding with the pattern the Plan itself established for the other three gaps.
Resolution criterion: file the ticket (or name the artifact) and cite it from criterion 2, or fold its creation explicitly into OQ7's author disposition.

Non-blocking observations, not filed as concerns: the working-tree guide frontmatter carries `reviewed-commit: HEAD` placeholders that must resolve to a real SHA at landing; Phase 2a's "proven wa-sqlite/IndexedDB lane" borrows LLP 0008's upstream-ecosystem word "proven" (0008 line 437) for a lane with no in-repo browser acceptance — pre-existing text four prior rounds accepted, but worth tightening whenever Phase 2a's gate is next touched.

## 4. Suggestions

- Annotate the D3 misattribution at its source: `demos/zero-bakeoff/apps/field-notebook/acceptance/snapback.mjs` lines 133–135 still cite "LLP 0090 D3" for a refusing policy 0090 does not contain. The diary is immutable by design; the acceptance script is not, and it will seed the same error into the decision lab's manifests if reused verbatim.
- Make the interim Node-carrier `SNAPBACK_RETENTION_NOT_RETAINABLE` assertion mandatory rather than the ticket's either/or — it is an afternoon of work, gives the fact its first witness on any carrier, and removes the "browser witness is the first proof of a never-tested refusal" coupling.
- Schedule the cheap half of criterion 1's missing element now: a hard-terminated client subprocess against the file store (the Plan already names this as sufficient for the process-restart element) proves restart-survival on one carrier without waiting for the Playwright/CDP harness, and would de-risk the integrated witness.
- Consider a preregistered Candidate-A pilot on workload 1 only (Latency Kanban, the "common-path test"), run under the same gates once Phase 1's evaluator exists, before committing both builders to the full three-workload matrix — a Candidate A that cannot pass the common-path workload falsifies early and cheaply, and the protocol's re-freeze rule already handles the baseline change.
- When the author answers OQ8, land the SD-5 mirror note (C3) in the same dated change, since that answer restates Phase 1's gate anyway.

## 5. Open questions

1. OQ7 (Phase 0 gate split-or-hold), OQ8 (Phase 1 gate sufficiency; now also gating SD-5 auto-advance and the decision lab's schedulability), and OQ9 (Phase 2a falsifiability; now gating declarable completion) remain the three author-owned residues, and the document routes them correctly.
2. Does the integrated witness of exit criterion 2 get its ticket now, or only as part of OQ7's disposition? (C7.)
3. Who lands the 0130 SD-5 mirror note, and does the author's OQ8 answer also reconcile 0130's "determinism conformance corpus" gate naming with this Plan's "sizing + D5"? (C3.)
4. Is ledger row 7's journal-floor consumer still wholly unbuilt now that the client consumes the rung-1/2/3 token-resume ladder — i.e., does rung-2 witness resume touch the journal floor server-side? (C6.)
5. For the lab's minimum role assignment (two independent builders plus one non-building reviewer): are these humans, agents of distinct model families, or mixed — and does "independent" carry a shared-context prohibition analogous to the sealed-evidence rule? The protocol seals evidence but does not define builder independence.

## 6. Readiness verdict

NOT READY

One material defect stands: §Candidate outcomes' least-power selection rule and §Trigger detection's coherence-ceiling bar give contradictory recommendations in Outcome 0's own enumerated state (ii) (C1) — a reachable-state contradiction in the decision machinery this round exists to vet, of exactly the shape v0.6 repaired elsewhere, and blocking under the READY bar's "no unresolved material decision-quality concern." It is the only blocking item and has a one-clause fix. Every other finding is DETAIL and non-blocking; the round-4 corrections themselves — the same-process cold-boot restatement, the D3 withdrawal, the gate-7 narrowing, the exit-criterion-2 closure map, and the guide reattributions — verified accurate against the code, the acceptance scripts, the bakeoff evidence, and the owning documents, and the document is otherwise the strongest revision of this Plan I can evidence.

## Round 6 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
general-purpose subagent (non-author context)
**Effort:** session-inherited
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed subagent; read the working tree at commit
`449a43f7`; barred from `llp/reviews/`
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `5b04d52f0b908669a45226dba5d565d2f72641e7f6921cc9dbdb2ed15652474d`
**Instruction capsule SHA-256:** `2208029c14caa96ddd7e80e433ef816e39ac4023af0731bef0f0ca5b5131f992`
**Status:** completed
**Verdict:** READY

**Orchestrator note (outside the verbatim body).** Fable's third READY
(rounds 3, 4, 6). All four of its DETAIL concerns were applied in v0.8
alongside Codex's round-6 residue.

### Review (verbatim as received)

# Review — LLP 0129 "The local-first program" (super-refine round 6)

**Reviewer:** independent LLP 0005 reviewer (Fable family, Claude Fable 5)
**Target:** `llp/0129-local-first-program.plan.md`, SHA-256 `5b04d52f0b908669a45226dba5d565d2f72641e7f6921cc9dbdb2ed15652474d`, working tree at HEAD `449a43f7`. Hash verified before reading; the snapshot did not change under me during the review.
**Method:** every load-bearing claim named in the brief was checked against the repository rather than the document's narration — the acceptance script, the guide row and prose, the client and React package sources and tests, the bakeoff protocol/evidence/diaries, `git show b52e3b9c`, and the governing LLPs (0008, 0039, 0043, 0051, 0053, 0055, 0080, 0090, 0115, 0126, 0127, 0130, 0133, 0138). Nothing under `llp/reviews/` was opened.

---

## 1. Overall assessment

This revision is the first one I can describe as evidence-exact end to end. The document's distinguishing risk was never its plan shape — the staging, ledger, and exit criteria have been stable since v0.3 — but the accumulating layer of empirical assertions about what the tree proves, what the owners pin, and what the bakeoff executed. I checked those assertions one by one, and they now hold, including in the places where earlier rounds found them failing.

The Phase 0 proof-scope story is now a four-way agreement between the Plan, the guide row, the guide prose, and the code. The acceptance suite (`demos/public-dashboard/tests/acceptance/offline-local-first.mjs`) is exactly as characterized: 9 checks (`expectedChecks: 9`), the Node/durable-file carrier via `SNAPBACK_CLIENT_RQS_DIR` with `rqsStoreInfo.implementation === 'file'` asserted (lines 64, 120), one refusal check on a public non-eligible query (`SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE`, line 144), no React, no standards-real IndexedDB, and — decisively for the v0.6/v0.7 correction — `closeClient(clientA)` then a fresh `openClient()` in the same Node process with only the server stopped (lines 105–164). The v0.7 repair of the v0.6 self-contradiction is complete: the "Consequence for criterion 1" paragraph now says the cold-boot beat is not claimed at any reach, and I found no surviving re-assertion anywhere in the document. The suite header carries the same correction ("FRESH CLIENT INSTANCE IN THE SAME PROCESS — not a cold boot; this suite never restarts the client process"), and `guide/sync/offline-and-retention.md` lines 45–47 match. The correction neither over- nor under-corrects: what remains claimed (retained render from a durable file store by a fresh same-process client instance with the backend unreachable) is exactly what check 3 proves, and the three unproven facts the proof-scope correction names are each real — `SNAPBACK_RETENTION_NOT_RETAINABLE` is produced at `packages/snapback-client/index.mjs:8056` and asserted by no test in the repository; the fake-indexeddb unit coverage is exactly `rqs-store.test.mjs`, `rqs-resume.test.mjs`, `outbox-store.test.mjs`; and no test in `packages/snapback-react` touches retention, `rqsStore`, or freshness.

The owner-document assertions the brief flagged are all accurate. Gate 7(b)'s restored obligation machinery is LLP 0053's actual contract: "persistent until discharge within its scope, level-triggered, and discharged only when the client **acknowledges** a snapshot computed at or after the causing commit version" (0053 lines 267–269), with "Coarse events quarantine; only proof deletes" verbatim at line 1218, lease-expiry-without-revalidation in the `delete` producer row (line 1202, correctly relocated to case (c)), and session revocation deliberately excluded ("Not on this list, and deliberately so," lines 412–413). The auth-scoped-default narrowing is right: 0053 lines 298–299 ("Undeclared means auth-scoped") and LLP 0080 lines 334–335 ("all-`public-read` plans are **not** classified `authorityIndependent` in v1") jointly support the v0.7 claim that public data never licenses `N/A` on case (b). LLP 0039's transition table (lines 1076–1078) requires exactly the deletes gate 7's public-data narrowing relies on. The withdrawn LLP 0090 D3 pin preclassification is correctly withdrawn — D3 (0090 lines 713–715) pins a resume rule with milestone-3 composition, not a render prohibition, and LLP 0043 M2 does carry "local optimistic patch metadata" (0043 line 159). LLP 0130 SD-5, SD-3, and ER-1 read as the Plan quotes them; LLP 0133 is Accepted with the reconciled §Status, excludes action replay (lines 696–697), and treats elements 1/5 as claims with externally owned mismatch dispositions — supporting OQ11 exactly. LLP 0008's replay pin, LWW/delete-wins v1 default (line 373), and journal-floor material all check; ledger row 7's re-scope is right in both directions — the server caller exists (`src/local.rs:12736`), the client sends `resumeFromToken` (`index.mjs:5410`), and LLP 0127 does still carry the stale "unbuilt" wording (0127 lines 274, 513), so the reconciliation note is warranted. The rewritten Fleet paragraph matches LLP 0138's Revised header, `demos/zero-bakeoff/reports/summary.md`, and `git show b52e3b9c` (which contains the `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` refusal, regressions in `tests/local_v0.rs` and `tests/workerd_twin_v0.rs`, and the closed ticket; the commit is not an ancestor of this branch's HEAD, as the Plan's citation implicitly acknowledges by naming origin). The v2 receipt (`apps/fleet-observatory/evidence/snapback.v2.json`) counts 7 pass / 1 gap / 0 fail as stated.

What remains open in the document is genuinely author-owned — OQ7 (gate split), OQ8 (Phase 1 gate sufficiency), OQ9 (Phase 2a falsifiability), OQ10 (what Candidate B is), OQ11 (element 5's owner) — and the document consistently refuses to decide any of them for the author, which is the correct posture for an Accepted Plan whose loop cannot change status. My remaining findings are precision details, none of which changes a decision the document makes.

## 2. Strengths

- **The Phase 0 evidence block is now a model of claim-scope honesty** (§Phases, Phase 0 status + proof-scope correction). Every sentence I tested against the tree survived: store carrier, check count, refusal code, same-process re-instantiation, the three unproven facts, the workout-inventory registration (`scripts/run-workout-apps.mjs:15`), and the tickets' actual contents — including the lease ticket's blob-accumulation remainder and the browser ticket's "no Node result to borrow" third half.
- **Gate 7 is now a faithful compression of three owner documents** (§Safety gates). The four-case split, the disposition names, the restored ACK-discharge obligation, the (b)/(c) lease-expiry exclusivity, and the narrowed `N/A` licensing all match LLP 0053/0039/0080 at the quoted lines. The rationale sentences ("without the ACK-backed discharge a lost removal leaves forbidden rows visible indefinitely") state real security properties, not decoration.
- **The bakeoff evidence is characterized at its true strength, not its apparent strength** (§Option-C empirical decision protocol, opening). The Notebook findings are correctly demoted to declared-GAP-plus-source-audit: the Snapback arm's `fn.stretch-offline-restart`/`fn.stretch-concurrent-rebase` are immediate `suite.gap(...)` calls (`apps/field-notebook/acceptance/snapback.mjs:133–138`), and `SnapbackApp.tsx` genuinely contains no conflict/speculative/restart surface. The Kanban duplication and Calendar sidecar claims match diaries 0043/0044. The section's supersession of 0138's citable "appears to satisfy" sentence is exactly the right containment.
- **The recommendation machinery is now total and internally consistent** (§Candidate outcomes, §Trigger detection). The v0.7 least-power rule incorporates each outcome's own conditions, closing the Outcome-0(ii) contradiction; Outcome 3's two-independent-B-attempts requirement matches the proof-of-inexpressibility rule; gates 2 and 9 partition commit-versus-visibility so the Fleet result lands in exactly one; and the expanded misattribution taxonomy honestly names the failure modes this program has already produced (the bakeoff's misread Zero results, Fleet's reversed first diagnosis). Small verifiable touches hold too: nearest-rank p95 at n=20 is indeed the 19th value.
- **The v0.7 constraint-7 repairs are genuine, not cosmetic.** The Phase 1 block now invokes SD-5's own scope-change escalation rather than suspending a rule LLP 0130 owns, and ledger row 7 declines to mark itself landed on a reviewer's reading, demanding a dated wire-path verification instead — the document applying its own evidence standard to a correction that flattered it.

## 3. Concerns

**C1 — DETAIL. The Notebook parenthetical overstates at whole-bakeoff scope.** §Option-C empirical decision protocol says "the bakeoff never restarted the pending client or introduced a concurrent remote edit." True of the Snapback arm (the load-bearing subject), but the Replicache control *did* introduce a concurrent remote edit and executed the rebase as a PASS (`apps/field-notebook/acceptance/replicache.mjs:31` — `'Remote dispatcher edit'` asserted in the conflict record), and its offline-restart GAP retains executed restart-attempt evidence (`restartedRows`, `pendingAfterRestart`). A reader quoting the sentence at bakeoff scope would be wrong. *Resolution criterion:* scope the clause — "the Snapback arm's run never restarted the pending client or introduced a concurrent remote edit" — or add "(the Replicache control did exercise a concurrent rebase)".

**C2 — DETAIL. The SD-5 invocation phrasing can be quoted against SD-5's text.** The Phase 1 block ends "gate success escalates for adjudication instead," while LLP 0130 SD-5 says "gate success does not [escalate]." The mechanism is sound — the operative escalating event is the standing scope change, and the block says so — but the closing clause attributes the escalation to gate success, handing a hostile reader a literal contradiction with the rule being invoked. *Resolution criterion:* reword to make the scope change the subject, e.g. "while the scope-change escalation is pending, a passing gate is presented to the author rather than auto-advancing."

**C3 — DETAIL. §Open questions is misordered.** Questions 10 and 11 physically precede question 9 (file lines 1579–1613). Pure editing residue from the v0.7 insertion, but in a document whose OQ numbers are load-bearing cross-references (OQ8 gates the lab; OQ9 gates completion), a misordered list invites miscitation. *Resolution criterion:* reorder 9 before 10–11, or add a one-line note that ordering is by number, not position.

**C4 — DETAIL. One residual vocabulary-sentence tension in §Safety gates vs §Measurements and diaries.** §Safety gates opens "One status vocabulary governs both the safety matrix and the measurement record (unified in v0.6…)" while the v0.7 measurements bullet mandates "separate typed fields … the two vocabularies §Safety gates keeps distinct." These reconcile on careful reading (the *safety-row* vocabulary is uniform across artifacts; workload checks are a second vocabulary), but the v0.6 sentence's "one status vocabulary" invites exactly the conflation v0.7 fixed. *Resolution criterion:* reword the §Safety gates opener to "safety rows use one vocabulary wherever they appear; workload checks keep their own," matching the typed-field split.

I found no BLOCKING or MATERIAL concern. Specifically: I looked for a contradiction between the fault matrix's public-data-only `N/A` branch and gate 7's narrowed `N/A` licensing and found none — the matrix's `N/A` covers protected-*data* runs while its own case list still requires all four gate-7 authority cases, and gate 7(b) explicitly bars the public-data shortcut; the two texts compose correctly.

## 4. Suggestions (non-blocking)

- The acceptance suite's check *labels* at lines 164 and 281 still read "cold relaunch," and those strings flow into `offline-acceptance-report.json`. The Plan's block and the suite header are corrected, but a receipt-only reader sees the old vocabulary. Renaming the two check labels (e.g. "same-process relaunch…") in the next touch of that file would close the last place the withdrawn word survives.
- Ledger row 7 notes LLP 0127 "carries the same stale 'unbuilt' assertion and needs the same reconciliation" — consider filing that as a filesystem ticket so the reconciliation obligation doesn't live only inside this Plan's row text (0127 lines 274 and 513 both need the edit).
- Gate 7(b) now runs to ~40 dense lines restating LLP 0053. It is accurate today (I verified every clause), but it is the document's largest drift surface against a living owner. A one-line freshness anchor ("verified against 0053 as of 2026-08-01; re-verify at manifest freeze") would convert silent drift risk into a checkable obligation, consistent with the lab's own dated-baseline discipline.
- §Candidate outcomes' Outcome 2 mentions "provisional identity presentation, settlement mapping" as example extensions while the §Interaction carve-out classifies lane-L id-map delivery as substrate. The ownership-not-shape rule does disambiguate, but a forward pointer from the Outcome 2 examples to the carve-out would prevent the one plausible remaining misreading.

## 5. Open questions

The document's own OQ set is the right list; nothing I found adds a new author decision. In priority order for the program: OQ8 (Phase 1 gate split — it gates both SD-5 advancement and the lab's schedulability, so it is the critical path); OQ10 (Candidate B's frozen definition and owner — without it the lab's ceiling is Outcome 0/1, which the document already concedes); OQ7 (Phase 0 gate split or hold); OQ9 (Phase 2a falsifiability, which currently makes completion unreachable by the document's own honest admission); OQ11 (element 5's owner); OQ5/OQ6 (owners/timeboxes; the ephemeral-pin amendment). One genuinely open empirical question the lab design surfaces but does not yet assign: who writes the integrated authenticated React/browser/full-process-restart witness that exit criterion 2 now correctly says neither existing ticket forces into one run — the criterion demands "its own named owning ticket or artifact," and that ticket does not exist yet.

## 6. Readiness verdict

READY

Every decisive factual claim I tested — the acceptance script's exact reach, the guide row/prose agreement, the untested `SNAPBACK_RETENTION_NOT_RETAINABLE` refusal, LLP 0053's obligation and disposition machinery, the auth-scoped default and LLP 0080's public-read scoping, LLP 0039's transition deletes, LLP 0090 D3's actual pin, LLP 0130 SD-3/SD-5/ER-1, LLP 0133's status and exclusions, LLP 0008's replay pin and conflict default, ledger row 7's re-scope, and the Fleet re-diagnosis with its commit, ticket, and v2 receipt — checks out against the tree or the owning document, and the contradictions rounds 1–5 found are repaired without new ones appearing in their place. The four concerns above are precision details with stated fixes, none of which alters a claim boundary, a safety obligation, or a decision the document makes; the remaining open questions are correctly routed to the author rather than papered over. Under the READY standard — no unresolved material correctness, coherence, feasibility, safety, or decision-quality concern — this document is ready.
