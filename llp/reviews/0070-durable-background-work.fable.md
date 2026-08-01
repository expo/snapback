# LLP 0070 durable background work review — Fable family

## Round 1 — 2026-08-01 (post-absorption)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, non-author
agent (this reviewer authored none of LLP 0070, its amendment, or the
absorption commit; it did run the LLP 0137 G1 qualification and brings that
external-consumer lens as commissioned)
**Date:** 2026-08-01
**Method:** LLP 0005 full review at the "thought through as much as we can
without running code" bar, scoped per commission to the post-absorption
state: verify §First slice as shipped against the shipped tree at the pinned
revision, the A6/0.1.8 evidence, the claim boundary, the a4-f4 open
question, body-vs-absorbed consistency, and the Dynamic Workflows staleness
note. Read-only against a branch created from the pinned revision. Blind to
every other 0070 review artifact: no codex artifact exists for 0070 and the
existing `0070-durable-background-work.gpt.md` was deliberately not opened.
**Target:** `llp/0070-durable-background-work.rfc.md` (813 lines, Draft)
**Target SHA-256:**
`caa83b1694d9ec1ad236d25f6edf6258c4c2feaf8c9d4c9ec4d41b5f33968048`
(computed from `origin/main:llp/0070-durable-background-work.rfc.md`;
matches the commissioned pin exactly)
**Repo revision at review start:** origin/main `a8dcb148`
**Tool uses:** ~30
**Status:** completed
**Verdict:** READY

## Verbatim review

## Overall assessment

**Verdict: READY** at the round-1 thought-through-without-running-code bar.

The absorption did what it claimed. I verified roughly thirty load-bearing
as-shipped claims in §First slice as shipped against the tree at `a8dcb148`
and found **zero false claims**. The section is true to `src/jobs.rs` and
its wiring, true to the A6 arm and 0.1.8 re-verification capsules, and true
to the two post-amendment fixes it absorbs (01ddd8e2, bdf4763c). The claim
boundary is honest and stated consistently in three places. The RFC-only
remainder is clearly fenced as future. The document as a whole is coherent:
a design RFC with one normative shipped-slice section carved out of it, and
italic as-shipped reconciliation notes at exactly the two places where body
text and shipped behavior diverge. The findings below are precision polish;
none blocks READY, and none requires running code to fix.

## What I verified as true (spot-check ledger)

- **The slice exists as described.** `src/jobs.rs` (1,150 lines) with
  transactional buffered enqueue inserted "inside its own open transaction"
  (jobs.rs:440ff); commits `e25ab2a3`, `01ddd8e2`, `bdf4763c` all exist
  with subjects matching the doc's characterization.
- **Every paved default-queue limit matches a shipped constant** —
  16 enqueues/mutation, 64 KiB args, 30-day delay, attempts 1..=8 default 1,
  30 s lease, claim batch 64, wave cap 16, backoff 1 s capped 60 s, jitter
  ceiling 1000 ms, and the jitter domain string `snapback-job-jitter-v1`
  with the exact framing (jobs.rs:29-50, 373-388).
- **The drain seam is real and registered as described:**
  `POST /_snapback/api/jobs/drain` (admin.rs:2027) with System invocation
  authority, `{ nowMs?, maxWaves? }`, set-based single-transaction claim
  ("a concurrent drain cannot double-claim"), claim order pinned
  `ORDER BY available_at_ms ASC, job_id ASC` — exactly "availableAt
  ascending, then canonical job-id bytes". Eligibility includes
  expired-lease claimed jobs (the successor-claim path), matching the state
  machine.
- **`SNAPBACK_JOBS_DISABLED` and the ~1 s worker** are exactly as written:
  `spawn_jobs_worker` runs `interval(Duration::from_secs(1))` with a
  first-tick recovery sweep, and the flag idles autonomy while the forced
  drain keeps working (server.rs:2905ff, cli.rs:2860ff) — the
  ticker-as-wakeup posture, verbatim in the shipped comments.
- **All named diagnostics ship:** `SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED`,
  `…_RACED`, `SNAPBACK_JOB_CALLEE_NOT_ADMITTED`,
  `SNAPBACK_JOB_ACTION_UNKNOWN`, `SNAPBACK_ADMIN_SECRET_READ_REQUIRED`.
- **The receipt claim is exact.** `Receipt::Mutation` gains `enqueues:
  Vec<JobEnqueueFact>` with `skip_serializing_if = "Vec::is_empty"`, a
  doc comment stating the rejected-receipt absence is the inspectable
  rollback-schedules-nothing evidence, and a pinned wire-shape regression
  test asserting the pre-jobs shape is unchanged when nothing was scheduled
  (live_wire.rs:578-592, 940ff). `schemas/receipt.schema.json` carries the
  field. Facts are bounded to jobId/action/availableAtMs as claimed.
- **The producer association is durable, all four fields**, including
  nullable `producer_principal` (jobs.rs:290-293, 476, 494). Job ids ride
  the ctx-answer ledger (jobs.rs:61), as the determinism bar requires.
- **The 01ddd8e2 boot-admission fix is as narrow as claimed**, and the
  narrowness is pinned by a dedicated regression test
  (`reserved_job_projection_admission_stays_narrow`, local.rs:40320ff):
  only a JobStatusQuery-runtime read may name `_snapback_jobs`; an opaque
  handler read and any write keep `SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID`.
  `HandlerPlan::JobStatusQuery` implies `jobs_one_off_v1` (plus
  `live_subscriptions` when live), with the manifest.rs comment matching
  the doc's "experimental for as long as LLP 0070 is Draft" posture, and
  `defineSchema(..., { requiredCapabilities })` refuses the id (unknown to
  `TARGET_CAPABILITIES`; define.mjs:851ff, 1170-1172).
- **The admin custody is as described:** both jobs reads carry
  `SessionModeOverlay::secret_read()` (admin.rs:2035-2048) — sessions mode
  requires the `x-snapback-secret-read-lease` on top of the admin token;
  dev mode takes the ordinary credential; the drain is a System-authority
  write, which the doc does not claim needs the lease.
- **The evidence citations resolve.** A6 capsule:
  `demos/improvement-sweep/arms/a6-snapback-web/run-capsule.json`, result
  complete, 10/10 pass on the 0.1.7 closure, including `A6-04-SCHEDULING`.
  Re-verification: `arms/reverify-0.1.8/run-capsule.json` on 0.1.8 with
  RV-A6-F1/F2/F3 all pass. The closed ticket
  `20260801-0137-reverify-jobstatus-declaration-degraded-advisory.md`
  exists in `issues/closed/`. The tombstone pointer exists and points back
  correctly.
- **The a4-f4 cross-reference is faithful and well-posed.** LLP 0028's
  §Inspection amendment (2026-08-01) matches the doc's summary precisely —
  epoch-aligned seeding decided at source, and "whether that recovery run
  should also clamp its trusted clock is an open design question, not
  covered by this amendment" verbatim in 0028. 0070's framing cleanly
  splits the decided half from the open half, assigns ownership to 0028,
  and correctly argues the jobs drain is unaffected (injected clocks)
  while requiring any future jobs downtime-recovery policy to answer the
  question explicitly rather than inherit an implicit one. Well-posed.
- **The Dynamic Workflows partial-staleness note is right.** It updates
  only blocking fact 1 (executable evidence now exists), states the
  corpus is still uncovered and the tuple unclaimed, and leaves the
  blocked-on verdict standing — which facts 2-5 independently support.
  The alarms-are-lossy cross-reference remains consistent with LLP 0028.
- **The guide page exists and covers the authoring surface**
  (`guide/backend/jobs.md`, reviewed 2026-08-01): enqueue vocabulary,
  callee admission in both runtime forms, the drain seam, the secret-read
  mint flow, and "declaring it is the whole authoring step" for the
  job-status query — consistent with the absorbed text throughout.
- **Claim-boundary consistency, three ways:** §First slice preamble,
  §Capability posture, and the updated §Non-goals paragraph all say the
  same thing — experimental id, current-contract compatibility only, no
  capability class, no tuple, LLP 0063 Step 6 stands. The "Decisions
  still requiring ratification" italic note correctly distinguishes
  changed evidence from unchanged ratification requirements, and the two
  2026-07-30 additions are accurately marked resolved with details that
  match the shipped code.

## Findings

- **F-1 (minor, precision — the one sentence stronger than the code).**
  §Deterministic drain seam says a drain "claims every job with
  `availableAt <= nowMs`"; the shipped claim is bounded — "up to the batch
  bound" of 64 per wave (`claim_due_jobs_in_tx`, `LIMIT ?2` with
  `JOBS_CLAIM_BATCH`). With >64 due jobs and the default single wave, one
  drain call does not claim them all. The paved-queue section publishes
  "claim batch 64", so the document contains both facts but the normative
  drain sentence should say "every due job, in pinned order, up to the
  claim batch per wave."
- **F-2 (minor, contract fidelity).** The shipped platform-owned
  lifecycle-state union is `pending | claimed | succeeded | dead |
  cancelled` (result-contracts.mjs:559, pinned by jobs-authoring.test.mjs)
  — it includes `cancelled`, which no shipped path can reach (cancellation
  is on the honest-gaps list, both cases), and excludes `ambiguous`, which
  will widen the union later under the experimental acknowledgment. Since
  §First slice declares itself "normative for the implemented surface" and
  touts "a literal lifecycle-state union in the emitted types", it should
  state the shipped union explicitly and name the unreachable member and
  the planned widening.
- **F-3 (minor, precision).** The job-status projection ships three of the
  four producer-association fields (`producerMutationId`,
  `producerSnapshotVersion`, `producerFunction`); `producerPrincipal` is
  durable on the row but deliberately not projected (the guide's row list
  confirms). The inspection bullet's unqualified "producer association"
  should carry the parenthetical — principal is durable provenance,
  privacy-excluded from the projection — so the projected subset is
  explicit in the normative text.
- **F-4 (cosmetic).** The receipt example `"availableAtMs": 1753` is a
  1970-epoch value; use a plausible millisecond timestamp so no reader
  pattern-matches a truncated-clock bug into the example.
- **F-5 (observation, cross-lane; external-consumer lens).** The
  secret-read custody chain §Inspection surfaces depends on is anchored in
  `<ready>.secret-read-root` — and the G1 qualification observed that this
  proof root survives a clean `snapback dev` shutdown as an orphan after
  its parent ready file is deleted (filed as
  `issues/20260801-0137-g1-orphaned-secret-read-root-sidecar.md` with
  finding record 0137-g1-f5). Not a 0070 text defect and not blocking,
  but when that ticket resolves, the custody prose here or in the guide
  should state the root file's lifecycle expectation so the fix has a
  documented contract to land against.

## Whole-document coherence

Coherent. The two-layer structure — full design RFC plus one normative
shipped-slice section — reads cleanly because the divergence points carry
explicit reconciliation: the §Job identity and enqueue admission note
(host-plan-only broadened to both runtime forms) and the ratification-
section evidence note. The honest-gaps list is comprehensive and, where I
spot-checked (cancellation unreachable, only the `default` queue, no
capacity admission constants), matches the code's actual absence of those
mechanisms. §Semantics still describes v1 design machinery the slice does
not implement, which is correct for a Draft RFC — a one-line pointer at the
top of §Semantics ("the implemented subset is §First slice as shipped")
would be a courtesy, not a requirement. Ratification remains genuinely
open: the document nowhere claims acceptance, and Status/Draft posture,
capability posture, and LLP 0063 Step 6 alignment are mutually consistent.
