# Freeze provider subscription budgets after the six-subscription investigation

**Status:** Open — provisional bounds implemented; conformance freeze pending
**Opened:** 2026-08-22
**Systems:** React provider, live-query scheduler, conformance, diagnostics
**Governing:** LLP 0200; LLP 0278 D0.5; LLP 0295 W4 risk 7
**Related:** `issues/20260820-familiar-live-subscription-contention.md`;
`issues/closed/20260822-provider-subscription-budget-enforcement.md`

## Problem

The shipped 16-per-view warning and 64-per-connection hard ceiling are explicit
provisional bounds. The minimized six-subscription fixture classifies the
observed delay as scheduler-capacity pressure, but it has not established that
16 is the durable warning threshold across supported evaluation costs or that
the pre-inconsistency diagnostic should be client-side count based.

## Wanted

1. Complete the remaining diagnostic work in the six-subscription ticket and
   retain both independent and relational arms.
2. Measure the warning lead time across representative query-cost classes,
   auth replacement, and reconnect.
3. Decide whether to confirm or revise 16, without changing the 64 correctness
   envelope or making relational-singleton composition the only correct form.
4. Freeze fixtures for the accepted warning boundary, hard ceiling, lifecycle
   deduplication, and owner-labelled diagnostic payload.

## Exit

The owning LLP records a non-provisional warning threshold justified by the 1D
evidence, and conformance fixtures prove the accepted boundary while all
independent subscriptions through the hard ceiling remain supported.
