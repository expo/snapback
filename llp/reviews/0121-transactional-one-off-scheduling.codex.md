# LLP 0121 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind
**Target SHA-256:** `9dfa1164eafb71f49694e24629b34886f8cf48c4d6216ec48a5d8e6f0c3aa985`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## Verbatim review

## 1. Overall assessment

LLP 0121 is strong, well-sourced research, but it does not yet meet the stated “exhausted pre-empirical analysis” bar.

The current-main implementation claims are accurate: cron has an injected `now_ms`, the authenticated forced-tick route, and a disable switch that gates only autonomous claiming; no durable-jobs implementation appears in the searched source. The diary quotations are also substantially accurate.

The remaining problems are analytical rather than implementation-detail gaps. Most importantly, the document:

- conflates using cron as a wakeup mechanism with using the cron ledger as job evidence;
- conflates reactive domain-result composition with reactive scheduler-status inspection;
- does not compare Convex and LLP 0070’s materially different execution guarantees;
- asserts reproducible frozen-clock job rows even though LLP 0070 specifies random job and claim identities.

Those issues affect the option space and several headline findings.

## 2. Strengths

- The corrective identification of LLP 0070 as the existing owner is excellent. The Summary and “What Snapback does today” accurately connect transactional enqueue, rollback behavior, `availableAt`, idempotency, attempts, and receipts to [LLP 0070](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:91).

- The current-main cron account is precise. In particular:

  - `claim_due_runs` accepts `now_ms` at [src/cron.rs](/Users/ccheever/projects/snapback/src/cron.rs:614).
  - The forced-tick route is registered at [src/admin.rs](/Users/ccheever/projects/snapback/src/admin.rs:1995).
  - `SNAPBACK_CRON_DISABLED` is parsed fail-open at [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:174) and gates the autonomous loop at [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:15129).
  - The acceptance kit sets the switch as described.

- The document correctly preserves LLP 0115’s no-evidence-regression constraint and refuses to treat an app-authored loop as equivalent to proved durable background work.

- The callee-class issue is correctly identified as load-bearing. LLP 0070 admits generated host-plan actions first, while the measured Convex cases include both scheduled mutations and egress-performing actions.

- The diary handling is generally careful:

  - Diary 0030 supports durable ID/status inspection at [Diary 0030](/Users/ccheever/projects/snapback/diaries/0030-partiful-backend-bakeoff.diary.md:756).
  - Diary 0031 supports scheduler-authored progress becoming live application data at [Diary 0031](/Users/ccheever/projects/snapback/diaries/0031-research-room-backend-bakeoff.diary.md:726).
  - Diary 0038 directly supports the authoring/composition versus deterministic-proof split at [Diary 0038](/Users/ccheever/projects/snapback/diaries/0038-dispatch-main-rerun.diary.md:165).
  - Diary 0039 accurately records the near tie at [Diary 0039](/Users/ccheever/projects/snapback/diaries/0039-snapback-convex-main-rerun-report.diary.md:176).

- The document respects decision ownership: it leaves substantive changes to LLP 0070, LLP 0028, LLP 0115, or a new owning Spec.

## 3. Concerns

### A. BLOCKING-FOR-BAR — Option 2 conflates cron wakeup with cron evidence

Specific gap: Lines 191–207 argue that a cron-sweep platform primitive necessarily produces evidence only about the sweeper and therefore cannot provide per-job receipts, fencing, or terminal state.

That conclusion holds only if the cron ledger is treated as the sole evidence family. It does not hold if a source-authored cron/ticker is merely the wakeup source for an LLP 0070-owned queue. LLP 0070 already requires every job transition to update authoritative job/attempt rows and counters transactionally at [LLP 0070](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:274). Its claim boundary bars claiming durable work from an ad hoc loop or cron sweep while the RFC is Draft; it does not permanently prohibit a cron-driven worker that passes the 0070 conformance corpus.

The current text therefore collapses three distinct designs:

1. an app-authored outbox with no platform job receipts;
2. misuse of the cron run ledger as if it were a per-job ledger;
3. a 0070 queue and receipt family whose worker is awakened by the existing ticker or a source-authored cron.

What would resolve it: Separate these cases. Keep case 2 barred, treat case 1 as the interim app pattern, and assess case 3 as an implementation architecture under Option 1. Compare its latency, idle cost, manual-drive behavior, and coupling to cron without implying that its evidence must be cron-level.

### B. BLOCKING-FOR-BAR — Scheduler status and reactive domain composition are conflated

Specific gap: Lines 131–135 and Findings 5 say parity requires ordinary-query inspection of the job-status row. The diary evidence supports two different needs:

- Diary 0030 inspected `_scheduled_functions` to prove scheduler completion.
- Diaries 0031 and 0039 observed application progress or completion through ordinary live queries.

The latter does not require a live job-status system table. LLP 0070’s generated terminal-result mutation already applies the domain result and job outcome in one application-data transaction at [LLP 0070](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:147). Existing live queries can then observe domain completion just as the Dispatch and Research Room workloads require.

Consequently, “ordinary-query inspectability” is not one property. It contains at least:

- reactive domain result/progress;
- product-visible job lifecycle;
- operator/acceptance inspection of job attempts;
- evidence associating a producing mutation with the jobs it enqueued.

The generated live status query may still be valuable, but the current analysis overstates its necessity for diary parity and underexamines the already-available domain-result path.

What would resolve it: Split these four surfaces, map each diary requirement to the surface it actually exercised, and evaluate admin inspection, generated policy-gated status, app-domain projection, and receipt correlation independently.

### C. BLOCKING-FOR-BAR — Execution guarantees are missing from the comparison

Specific gap: The three-property decomposition focuses on transactionality, ceremony, and inspectability, but omits a fundamental semantic difference.

Convex documents scheduled mutations as automatically retried and guaranteed exactly-once, while scheduled actions are at-most-once and not automatically retried. LLP 0070 instead specifies at-least-once action execution, fenced leases, bounded retries, stable idempotency, and an explicit `ambiguous` terminal disposition. See Convex’s official [Scheduler API](https://docs.convex.dev/api/interfaces/server.Scheduler) and [Scheduled Functions guide](https://docs.convex.dev/scheduling/scheduled-functions), versus [LLP 0070’s execution policy](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:191).

Cancellation also differs materially: Convex distinguishes pending functions, in-progress actions, and atomic scheduled mutations; LLP 0070 uses pre-claim cancellation plus cooperative cancellation after claim.

These are not implementation details or empirical questions. They are documented pre-empirical semantics that determine whether “runAfter-class” means ergonomic resemblance or behavioral parity.

What would resolve it: Add a semantic comparison covering at least scheduled mutation delivery, scheduled action delivery, retry ownership, ambiguity, cancellation after start, authorization propagation, retention, and scheduling limits. Then qualify “property 1 fully” and “delay semantics fully” accordingly.

### D. BLOCKING-FOR-BAR — Frozen-clock reproducibility is asserted but not designed

Specific gap: Lines 296–298 and Finding 8 say that deterministic jitter plus a frozen clock yields identical rows. LLP 0070 specifies:

- an opaque trusted-source job ID at [LLP 0070](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:73);
- a random claim ID at [LLP 0070](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:166);
- retry jitter derived from the job ID.

A frozen clock does not by itself make those identities, resulting jitter, worker provenance, lease identities, or row bytes repeatable. Nor does deterministic jitter settle job-ordering and cascade behavior.

What would resolve it: Reclassify reproducibility as an unresolved design requirement. Define whether the bar is byte-identical rows, structurally equivalent normalized receipts, or deterministic externally observable outcomes. Name the required injected identity/randomness sources, stable ordering, cascade bound, and receipt normalization. Execution should later verify the design empirically.

### E. MATERIAL — “Any function reference” overstates Convex’s admission surface

Specific gap: Line 127 says Convex is callable on “any function reference.” Convex schedules public or internal mutations and actions, not queries or arbitrary function references. The document itself is more accurate elsewhere.

What would resolve it: Replace this with “any schedulable public or internal mutation/action reference,” and contrast that surface with LLP 0070’s generated host-plan-action admission.

### F. MATERIAL — The diary-wide proof claim exceeds the cited evidence

Specific gap: Lines 141–143 and Finding 1 say “every diary concedes the proof direction to Snapback.” Diaries 0038 and 0039 explicitly make that comparison. Diaries 0030 and 0031 support Convex scheduling, inspection, and reactive composition, but do not independently establish the specific Snapback-wins-recurring-proof comparison in their cited passages.

What would resolve it: Attribute the split verdict specifically to Diaries 0038/0039. Use Diary 0030 for scheduler-ID and custom effect-ledger evidence, and Diary 0031 for scheduled-progress and cancellation evidence.

### G. MATERIAL — Option 3 omits a simpler receipt-correlation shape

Specific gap: Option 3 considers embedding every enqueue directly into the producing mutation receipt. Current receipts already carry a mutation ID and committed `snapshotVersion`, not literally a field named `commitVersion`; see [src/live_wire.rs](/Users/ccheever/projects/snapback/src/live_wire.rs:536).

A distinct design is to retain the existing bounded mutation receipt and have job rows or enqueue receipts carry the producer mutation ID and commit version. That can prove the association without growing a potentially high-cardinality mutation receipt or changing its privacy and retention posture.

What would resolve it: Add this correlation design alongside direct receipt embedding and compare cardinality limits, retention, privacy, rollback receipts, and query ergonomics.

## 4. Suggestions

- Replace “commit version” with the actual current receipt field name, `snapshotVersion`, while explaining its committed-mutation meaning.

- Add a compact comparison table for Convex scheduled mutations, Convex scheduled actions, LLP 0070 jobs, and current Snapback cron.

- Cite the official Convex documentation and record the consulted version/date. The current “general background” label is honest but unnecessarily leaves readily verifiable claims at medium confidence.

- Separate statements into:

  - established repository fact;
  - analytical inference;
  - unresolved design question;
  - empirical validation question.

- Qualify “cost: highest.” The document correctly labels implementation-cost estimates low confidence, but the option text presents the ranking more strongly than the Confidence section warrants.

- Consider whether `runAt` deserves its own overflow, past-time, maximum-horizon, and clock-domain analysis rather than being treated as a trivial spelling of `availableAt = t`.

## 5. Open questions

1. Is the intended competitive target ergonomic `runAfter` similarity, equivalent lifecycle semantics, or an explicitly stronger Snapback primitive with different guarantees?

2. Which diary workloads require live job-status inspection, and which require only live observation of domain state written by the terminal mutation?

3. May the existing one-second scheduler loop be a wakeup source for the jobs worker while cron and jobs retain separate ledgers and ownership?

4. What deterministic-drive output is normative: identical persisted rows, normalized receipts, or identical externally observable outcomes?

5. How are job IDs, claim IDs, lease timing, worker identity, ordering, and cascades controlled or normalized under deterministic acceptance?

6. Should enqueue evidence be embedded in mutation receipts, linked through the producer mutation ID, returned only as mutation results, or some bounded combination?

7. Which Convex semantics are intentionally matched, rejected, or exceeded: scheduled-mutation exactly-once, scheduled-action at-most-once, cancellation, status retention, auth handling, and scheduling limits?

## 6. Verdict: NOT READY

The document is close and has unusually strong repository grounding, but it has not yet exhausted the available pre-empirical analysis. The cron-wakeup distinction, observability decomposition, delivery-semantics comparison, and deterministic-identity problem are all answerable or at least precisely designable without implementing the subsystem. They materially affect the headline findings and option assessment.

## 7. Recommended next step

Revise LLP 0121 while keeping it in Review:

1. correct and subdivide Option 2;
2. separate domain reactivity from job-status inspection;
3. add the Convex-versus-0070 execution-semantics comparison;
4. replace the frozen-clock reproducibility assertion with a fully specified design question;
5. add receipt correlation as an explicit sub-option;
6. tighten the diary attributions.

Then request a focused re-review of those changes before treating this family’s review as READY.
