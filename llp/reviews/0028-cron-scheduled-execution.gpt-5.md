# Review: LLP 0028 - Cron scheduled execution

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-06-30
**Redacted:** No - reviewed local repository files and the in-repo LLP corpus; no separate external reviewer or provider was invoked.
**Method:** Same-session critical review requested as `$llp-review 0028 revise if you see things that need to be changed`. Read the full LLP 0028 draft, LLP 0005 review guidance, LLP 0000, and the relevant cron/action/realtime/security/Cloudflare/admin sections of LLP 0003, 0004, 0008, 0009, 0010, 0014, 0017, and 0027, plus current manifest/runtime/local/server evidence for cron capability flags, ambient `fetch` denial, runtime time injection, and live-subscription fan-out.

> **Independence note.** LLP 0028's author line names Claude, not Codex/GPT-5, so this is a real GPT-family review artifact for LLP 0005 purposes. This pass also applied revisions, so future readers should treat it as the review that produced the current GPT-5 edits, not as an independent review of the final revised text.

## Overall assessment

The proposal is directionally right. The most important architectural choice is the action -> mutation path: cron can perform external or scheduled work without letting network I/O enter the transactional mutation path, and durable writes still reuse the existing commit/version/realtime fan-out machinery.

The draft was strongest as a product contract, but it was light at the implementation seams that would make or break consistency: durable scheduler state, single-run ownership, action transaction boundaries, codegen diagnostics, and target-specific scheduling gaps. I revised the RFC to make those constraints explicit while keeping it in `Draft`.

## Strengths

- **Correct write boundary.** Durable cron writes go through mutations, preserving the LLP 0003/0004 commit model and the LLP 0008 realtime path.
- **Good sandbox posture.** Egress and secrets are scoped to actions and defer the ambient-capability policy to LLP 0009 rather than redefining it here.
- **Honest target framing.** The draft treats cron as a scheduler seam across local and Cloudflare, not as a local timer loop that all targets must imitate.
- **Good forcing function.** All Aboard is a concrete enough consumer to keep the contract from becoming abstract platform design.

## Concerns

- **C1 - Action semantics were under-specified. [High] [Applied]** Saying actions run outside the transactional snapshot path is right, but the draft did not say whether actions receive writable `ctx.db`, whether action reads participate in read-set validation, or what happens when an action invokes multiple mutations and then fails. I revised the RFC to say actions do not receive the mutation `ctx.db` surface, action-level reads are not transactions, correctness-sensitive reads must be revalidated inside the committing mutation, and each `ctx.runMutation(...)` commits independently.

- **C2 - Scheduler state and run ownership needed to be durable and inspectable. [High] [Applied]** At-least-once delivery, no-overlap defaults, missed-tick recovery, and observability cannot be reliably implemented as only an in-memory timer loop. I added a scheduler state/run-ledger section with job state, recent run history, atomic due-run claiming, in-flight tokens, recovery semantics, and idempotency keys.

- **C3 - Codegen/manifest failure modes needed the no-silent-drops rule. [Medium] [Applied]** LLP 0010 makes silent omission the worst agent failure mode, and cron definitions are exactly the kind of source-authored manifest input that can disappear accidentally. I added manifest fields and diagnostics for invalid schedules, missing actions, unsupported cadence/policy knobs, and target-incompatible jobs.

- **C4 - Cloudflare phrasing overclaimed portability. [Medium] [Applied]** The draft said a job must be expressible on both Cron Triggers and Durable Object alarms. LLP 0014 instead calls for a profile-specific split. I revised the wording so each target profile names which primitive owns each job and reports capability gaps when the requested cadence or ownership does not fit.

- **C5 - The RFC needed implementation and validation gates. [Medium] [Applied]** The design was plausible but not yet hard enough to implement from. I added an implementation plan and validation requirements covering local codegen, cron-scoped actions, the SQLite run ledger, recorded-feed proof, egress/secrets as a later capability rider, and Cloudflare adapters after the LLP 0014 profile decision.

- **C6 - Test determinism needed scheduler metadata, not just a frozen clock. [Low-Medium] [Applied]** A cron action needs stable `jobName`, `runId`, `scheduledAt`, `attempt`, and trigger metadata for idempotency, diagnostics, and reproducible tests. I added that as an action-context requirement without pinning exact API spelling.

## Suggestions

- Keep the first implementation cron-scoped. General actions are likely useful, but making cron prove the invocation path first will reduce design surface area.
- Make All Aboard Phase 2 use recorded feed advancement before enabling egress/secrets. That validates scheduler -> action -> mutation -> realtime without coupling it to the network policy seam.
- Treat the run ledger as part of inspect/admin from day one; otherwise cron failures will regress into log scraping.

## Open questions

- What exact cron expression grammar and timezone rule should Snapback support first?
- Should the first local implementation accept calendar schedules, or report them as an explicit missing capability until interval jobs are solid?
- How much retry policy surface is worth exposing before the first real consumer shows a need?
- Should per-host egress enforcement be solved in Ibex before real Caltrain polling, or is an app-level URL check acceptable for the first trusted local demo?

## Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0028 in `Draft` until a local proof validates the run ledger, manual tick, no-overlap behavior, deterministic recorded-feed cron run, and action -> mutation -> realtime path. If the author wants a fuller formal loop before implementation, the next useful review should be from a fresh Claude or another non-GPT family after these revisions.

## Re-review (2026-06-30): GPT-5 same-session pass after Claude Cloudflare revisions

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-06-30
**Redacted:** No - reviewed local repository files and the current LLP 0028 after the Claude Cloudflare-focused review pass; used official Cloudflare documentation for limit sanity checks.
**Method:** Same-session re-review requested as `$llp-review 0028 one more time revise as you see fit`. Read the current RFC, the Claude review artifact, the earlier GPT-5 artifact, and governing inspect/admin/Cloudflare LLP sections.

> **Independence note.** This is not a fresh independent review of the revised text. This same GPT/Codex session has already revised LLP 0028, so this section records an honest same-session re-review and edit pass only. Do not count it as an additional independent model-family review.

### Overall assessment

The Claude Cloudflare pass materially improved 0028: demand-gated polling, wakeup-source-vs-runner separation, DO-owned claim semantics, and the stable scheduled-slot idempotency key are the right direction. The remaining issues were mostly precision problems that could confuse implementation: demand-gating needed to be explicit per job, jitter needed to describe the Cloudflare handoff path, idempotency needed to cover manual/catch-up runs, and validation should gate `Active`/implemented status rather than acceptance of the RFC.

### Concerns

- **R1 - Demand-gating needed to be a declared activation policy, not implied by cadence. [Medium] [Applied]** Frequent train polling should be demand-gated, but nightly refreshes, contest locks, and maintenance jobs should not be silently tied to subscriber presence. I added an `activation` policy, made `always` the default, and required inspect/admin to expose `armed`, `inactive:no-demand`, and `catching-up` state for demand-gated jobs.

- **R2 - Jitter on Cloudflare needed a handoff rule. [Medium] [Applied]** A Cron Trigger can wake at a nominal minute, but a jittered due time may be later. The Worker should not sleep until the jittered time. I added a rule that the durable runner records the due slot and uses a Durable Object alarm or equivalent runner state to execute later.

- **R3 - Idempotency needed an explicit stable slot key. [Medium] [Applied]** `(jobName, scheduledAt)` works for ordinary scheduled retries, but manual runs and demand catch-ups may need to be distinct from a scheduled slot. I added an explicit `idempotencyKey`/`slotKey`: scheduled runs default to `(jobName, scheduledAt)`, while manual/catch-up runs include trigger/requested-at identity when they should not dedupe against the scheduled slot. `runId` and `attempt` remain observability only.

- **R4 - Cloudflare Cron Trigger limit wording should avoid stale exact numbers. [Low-Medium] [Applied]** Official docs currently describe the limit in more than one way: the Durable Object alarms docs say Workers can have up to three Cron Triggers configured at once, while the Workers limits table presents account-level Free/Paid limits. I revised the RFC to treat the exact number as a target capability fact to verify at implementation, while preserving the design conclusion that arbitrary app jobs should consolidate behind a small dispatcher and hand off to a Durable Object runner.

- **R5 - Validation gates were placed too early in the lifecycle. [Low] [Applied]** The RFC said the implementation should prove the validation list before moving beyond `Draft`, but RFC acceptance can happen before implementation. I changed the gate to before the RFC moves to `Active` or Cron is reported implemented.

### Suggestions

- Keep the first concrete implementation focused on local interval jobs plus one demand-gated All Aboard poll. Calendar extraction, Cloudflare trigger generation, and retry/backoff can follow once the ledger/activation/idempotency core is proven.
- When implementing inspect output, prefer a single `cron` block under `runtimeState` plus generated definition facts rather than separate admin-only endpoints.

### Open questions

- Exact shape of the activation policy: query ids, room ids, subscription classes, or a broader demand-signal abstraction?
- Whether manual `run now` should default to a fresh idempotency slot or optionally target/retry a scheduled slot.
- Whether calendar jobs with default jitter should always flow through a DO alarm after a Cron Trigger wakeup, or whether coarse minute-level jitter is acceptable on some profiles.

### Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0028 in `Draft` unless the author is ready to accept the design as an implementation target. It is now precise enough for a local implementation spike; the next useful evidence is a prototype of the ledger, activation-state inspection, manual tick, no-overlap, and one scheduled action committing through a mutation.
