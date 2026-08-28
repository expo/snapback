# guide-gap: show scheduled expiry and status-flip workflows

**Status:** Resolved
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, Cron, Durable jobs, Mutations, Recipes
**Date:** 2026-08-21
**Governing:** LLP 0028; LLP 0070; LLP 0061
**Evidence:** Messtimate published-0.1.24 diary

## Problem

The Guide accurately documents cron and one-off durable jobs, but an author
searching for product intents such as “expire stale rows,” “flip a link to
expired,” or “send a daily digest” must translate the scheduler mechanics into
an action -> mutation design without a complete recipe. The diary recorded this
as a missing workflow and proposed helpers such as `expireStaleRows`.

The likely fix is a recipe and standard pattern, not three new privileged
functions. Scheduled writes must retain system-authority, deterministic-time,
bounded-scan, idempotency, retry, overlap, and test-tick semantics.

## Required change

- Add one executable expiry/status-flip recipe using a cron action plus a
  bounded idempotent mutation.
- Contrast recurring sweeps with one-off `ctx.jobs.enqueue` and explain when
  request-time expiry checks are still required.
- Include a daily-digest variant that separates row selection from LLP 0045's
  currently target-limited external delivery.
- Add retrieval aliases for the observed product vocabulary.
- Consider a generated standard pattern only if repeated app code remains
  after the recipe; do not hide authority or scan ceilings behind a helper.

## Acceptance

- A cold agent implements and deterministically tests a link-expiry sweep from
  the Guide without sleeping or reading scheduler source.
- The recipe proves idempotency, retry, overlap policy, bounded work, and live
  delivery of the status change.
- Notification wording does not claim unshipped production delivery adapters.

## Resolution

Added `guide/recipes/scheduled-expiry.md`, backed by the executable
`tests/fixtures/guide-scheduled-expiry` example and the cron acceptance suite.
The recipe shows a cron action calling a bounded, idempotent mutation; pins
system authority, `NoOverlap`, `NextTick`, and request-time expiry semantics;
and verifies test-tick execution plus stream delivery without sleeping. It also
contrasts transactional one-off jobs and separates daily-digest selection from
app-owned external delivery without claiming generic production email/SMS
adapters. The capability aliases and retrieval eval now cover the three product
phrases recorded by the diary.
