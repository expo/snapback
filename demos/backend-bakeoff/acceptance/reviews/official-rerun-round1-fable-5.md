# Backend bakeoff official rerun, round 1 — Fable 5

**Reviewer:** Claude Fable 5
**Model selector:** `claude-fable-5`
**Effort:** max
**Date:** 2026-07-28
**Reviewed revision:** `c10315b5`
**Reviewed receipt:** `backend-bakeoff-run.87f231220e684164ec23a3d48a8b646cc141483205dc52d23597f2fd33f5d557.v2.json`
**Method:** fresh read-only review in an isolated detached checkout; no web search
**CLI session:** `d5fdce6c-0aa0-4af2-b9a2-794a098c18cc`
**Disposition:** complete plan-file review and terminal response retained verbatim

## Verbatim retained reviewer response

# Independent review — backend-bakeoff first official rerun (c10315b5)

## Context

Charlie asked for an independent product/evidence review of the first official rerun of the
Snapback backend-bakeoff improvement program, retained at immutable commit `c10315b5`
("test(demo): retain first full bakeoff feedback"). The run to judge is
`demos/backend-bakeoff/acceptance/results/backend-bakeoff-run.87f231220e684164ec23a3d48a8b646cc141483205dc52d23597f2fd33f5d557.v2.json`
(7 of 8 required commands passed; the Supabase arm failed on a Realtime timeout). The review
must judge fairness, evidence integrity, the meaning of 7/8, whether the Supabase failure is
product feedback or harness flakiness, and what must change before the second run and
publication — split into release-blocking, high-value, and documentation items, with a final
READY AFTER FIXES / NOT READY verdict. No files may be modified.

## Verdict

**READY AFTER FIXES.** The evidence infrastructure is sound (all 18 bound log/evidence hashes,
the content digest, runner/schema identities, and the fresh revision-bound receipts all
reverify), the receipt honestly records itself as `status: "failed"`, and the four mandatory
security-correction classes from the first rerun are closed per two retained independent
reviews plus fresh behavioral receipts. What blocks publication is a short concrete list:
two competitor-arm harness defects (a vacuous-pass hole in the Convex live check; a
shared-deadline timer bug plus no-retry policy in the Supabase check), one green retained
matrix at one revision, the missing browser/nonclaim row, and the unlanded diary/COMPARISON
narration of the rerun outcome.

## Key findings (full detail in the delivered review)

1. Evidence chain independently verified end-to-end: filenames = SHA-256 of contents for all
   15 logs + 3 evidence projections; `contentSha256` recomputes over canonical JSON;
   `runner.sha256`/`schemaSha256` match the tree; `react-presence.v1.json` current bytes =
   the receipt's `sourceSha256` (fresh, not stale); comparator runtime `gitCommit` =
   `source.revision` (3540549b), `gitDirty: false` — the first-rerun stale-binary class is now
   structurally enforced (`scripts/bakeoff-runner-lib.mjs:686-693`).
2. "7 of 8" = 7 of 8 required commands passed; by the runner's own `summarize()` this is a
   **failed** matrix, not a partial success. It is not a dimension score or ranking input.
3. Supabase timeout: predominantly harness/environment flakiness. `tests/supabase.mjs:41-48`
   starts both 8s timers at channel setup (shared deadline → post-insert delivery window is
   8s minus subscribe+RPC time, unmeasured); single-shot event-stream check against a remote
   hosted project; same check passed 2026-07-27 and passed-after-retry at the green checkpoint
   (`bakeoff-green-local-checkpoint.v1.json:22`). Residual legitimate product kernel: Postgres
   Changes is an unrecoverable event stream — already documented in COMPARISON.md.
4. New fairness defect: the Convex live check (`tests/convex.mjs:17-26`) resolves on any
   comment with the witness body, seed no-ops when data exists (`convex/incidents.ts:257`),
   and cleanup never deletes the witness — so on a reused local deployment the initial
   snapshot satisfies the predicate and the check passes vacuously (141ms run corroborates).
   The arm that failed had the strictest check; the arm that passed had a vacuous one.
5. Governance: no LLP governs publication of the *comparison/ranking* — LLP 0113 covers only
   target capability publication. The operative gate is the corrections ticket's acceptance
   (green retained matrix + independent final review), currently unmet. All seven governing
   LLPs are Status: Review, several with explicitly unreviewed terminal content; the receipts
   correctly do not claim otherwise.
6. Program state: 5 of 13 improvement-program rows still open (hosted + packaged lanes);
   comparator kit ticket is "Reopened — packaged revalidation"; corrections-ticket checklist
   was never updated despite items landing elsewhere; diary 0022 and COMPARISON.md have no
   entry for the v2 outcome (retention commit changed only acceptance files).

## Ordered actions (as delivered in the review)

Before the second run: fix Convex witness vacuity (nonce + cleanup/reset); restructure
Supabase timers (delivery budget starts after insert; await pg_changes readiness; one
recorded retry with fresh channel; timestamps in output); equalize/document per-arm patience.
Before publication: green retained v2 matrix at one clean revision; land diary/COMPARISON
rerun narration with it; add the browser-posture nonclaim (schema allows free-form strings);
reconcile the corrections ticket and obtain the independent final review on the green run.
High-value: record arm environment class in the receipt; codify retry policy in the runner
schema; rename/document `unchangedAfterCommands`; bind retained receipts to HEAD-reachable
revisions (cold-install cites unreachable e9eb17f2); pin extras binary identity like the
comparator. Documentation: LLP 0102 Draft/Review conflict; LLP 0110 vs 0113
proposed-vs-experimental maturity; superseded-but-unstruck normative text in 0108/0109;
ticket hygiene (llp0077 closed/Open contradiction, dangling vendor-ibex pointer, todo-react
naming drift).

## Verification

Read-only review; no repository changes. All hash verification commands used were
non-mutating (`shasum`, `git`, `node -e`, `python3 -c`). To re-verify the receipt after any
future run: `bun run bakeoff:verify -- acceptance/results/backend-bakeoff-run.<sha>.v2.json`
from `demos/backend-bakeoff/`.

---

The review is complete (ExitPlanMode isn't available in this session, and no execution is needed — this was a read-only review, delivered above and retained in the plan file).

**TL;DR — Verdict: READY AFTER FIXES.** The v2 receipt's evidence chain is cryptographically sound and self-honest (`status: "failed"`, 7/8). The Supabase Realtime timeout is predominantly harness/environment flakiness — a shared-deadline timer that can compress the delivery window to near zero, single-shot with no retry against a remote hosted project, with a same-day `passed-after-transient-realtime-retry` precedent — carrying only the already-documented product kernel that Postgres Changes needs missed-event recovery. The sharpest new finding is the inverse fairness defect: the Convex live check can pass vacuously on a reused deployment (stale witness comment satisfies the initial snapshot), so the strictest check failed while a vacuous one passed. Fix the two competitor-arm checks, rerun to a green retained matrix, land the diary/COMPARISON narration with it, restore the browser nonclaim, and close the corrections ticket with an independent review of the green run — then publish.
