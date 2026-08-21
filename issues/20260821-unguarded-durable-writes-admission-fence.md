# 18 durable writes commit with no admission fence live

**Status:** Open — product finding, not a test gap
**Filed:** 2026-08-21
**Found by:** sink-first audit in `lane/fenceproof` (`d291f4b89`)
**Governing:** LLP 0058 gate algorithm

## What was found

`AdmissionEffectGuard` holds the admission mutex across a durable commit so that
durable generation and admission epoch are checked **atomically at commit**. That
is what stops a write from landing after its admission epoch was retired.

An audit starting from durable write SINKS — 144 explicit commit occurrences
across 115 functions, 62 bare-connection write expressions, 181 shared-helper
call sites — found **18 durable operations that are downstream of a live
admitted authority or admission lease but have NO guard live at their durable
cut.**

## Why it was invisible until now

Every previous audit started from the ~152 EXISTING `effect_guard` acquisitions
and classified them. **That direction cannot discover an unguarded write.** It
can only tell you about guards that already exist. The earlier coverage document
nonetheless described itself as a "complete durable-write inventory"; it was
complete over guards, not over durable writes.

Inverting the search — enumerate commits, then ask which have a guard — is what
surfaced this set.

## The 18

Grouped by subsystem; each is individually assessed in
`issues/20260821-complete-admission-effect-guard-commit-proof-coverage.md`.

- **Ask spend** — reservation (server drops `PreparedAuthority` before the budget
  reservation commits) and settlement (finalizes the same admitted API effect
  after provider work without reacquiring the fence).
- **Assets** — upload-attempt creation, cancellation, TUS patch/ingest state,
  explicit delete, and signed-URL issuance / strict-delivery receipts. Several
  accept `PreparedAuthority` and then commit without guarding it. A retired epoch
  must not accept late durable upload progress.
- **Jobs** — initial one-off claim: `claim_due_jobs` obtains `first_admission`
  before the durable claim but never turns it into an effect guard.
- **Watches** — evaluation begin (implicit-autocommit write before any guard),
  dead-state transition, decision/enqueue, retry/failure record, firing
  settlement, webhook reservation, webhook attempt settlement, and
  invalidation-driven scheduling. This is the largest cluster: the watch
  evaluation and webhook delivery path is admitted work whose durable results
  commit outside any fence.

## Severity

Each is a durable effect that can land for an authority whose admission epoch
was retired between validation and commit — precisely the window LLP 0058's
fence exists to close, and precisely the property five recent deadlock fixes
worked to preserve elsewhere.

Reachability has NOT been demonstrated per operation. The finding is structural:
the guard is absent where the argument for requiring it is the same as for the
paths that have it. Treat "is it exploitable" as the next question, not as a
reason to defer.

## Next

1. Assess each of the 18 for actual reachability, hardest first — the watch
   cluster is the largest and most autonomous.
2. Add the fence engine-side, following the pattern established for
   capability-link mint/revoke/consume/settle and the push sites. Do NOT add it
   at the transport: that caused three separate re-entrant-mutex deadlocks.
3. Prove each with a removal mutation, per
   `issues/closed/20260821-admission-fences-unproven-by-mutation.md`.
