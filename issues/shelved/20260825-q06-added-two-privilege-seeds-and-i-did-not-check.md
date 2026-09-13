# Q06 landed two new privilege seeds, and the pre-landing check did not include the ratchet

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Systems:** Kernel, Process
**Date:** 2026-08-25
**Related:** `issues/shelved/20260824-privilege-surface-scanner-is-the-llp-0303-progress-metric.md`,
  LLP 0303

## What happened

Q06 (`837155513`, `fca304d78`) landed after a clean LAND verdict. The privilege-surface ratchet moved
**105 → 107**.

I verified compile, affected tests, `check-inventories`, `ref-check`, and a clean tree before
pushing. **I did not run the ratchet**, which is the objective metric this programme adopted for
exactly this purpose. The review did not run it either — it was checking binding provenance, which it
did thoroughly and correctly.

## The two new violations

Diffing the scanner output before and after shows most entries merely moved line numbers, because
Q06 added code above them (`17737 → 18007`, `6748 → 7018`, and so on). Exactly two are genuinely new:

```
crates/snapback-kernel/src/storage/pending_effects.rs:416
  seed-obtain new seed-type heuristic: private-field ApprovePendingEffectCommand
  leaves and re-enters LocalDatabase

crates/snapback-kernel/src/storage/pending_effects.rs:431
  seed-obtain new seed-type heuristic: private-field DenyPendingEffectCommand
  leaves and re-enters LocalDatabase
```

Q06 introduced `ApprovePendingEffectCommand` and `DenyPendingEffectCommand` as private-field types
that cross the `LocalDatabase` boundary and return.

## Assessment: fix forward, do not revert

These are flagged by a **heuristic** — the scanner's own wording — for a *shape*, not a demonstrated
hole. The mitigating facts:

- Both types have **private fields**, so a caller cannot construct one.
- The review verified database provenance by execution: a dependent crate copied identical durable
  facts into databases A and B, and **B refused A's session and service views twice**, and also
  refused A's cloned by-value approval carrier.
- Passing bound commands across the `LocalDatabase` boundary is the design; the binding is the
  protection.

So the likely correct disposition is that these two are acceptable and should be recorded as such,
rather than removed. But that is a judgement someone should make deliberately, with the artifact
questions from LLP 0303 applied to both types — which instance produced it, can a second produce an
equal one, can `test-support` staple it to an outcome it did not come from, is it `Clone`.

**What must not happen is the count drifting upward unremarked.** A ratchet that only ever gets
explained after the fact is not a ratchet.

## The process gap, which is the more important half

The pre-landing checklist was: pre-gate compile across touched crates, affected tests,
`check-inventories`, `ref-check`, clean tree. **The ratchet was not on it.** It should have been —
this programme adopted it as its objective progress metric and then landed three lanes without
consulting it.

Added to the landing sequence, before push:

```sh
node scripts/check-kernel-raw-sql-api.mjs   # compare against main; explain any increase
```

An increase is not automatically a blocker — line-number churn is expected and Q06's two additions
may well be fine — but it must be **diffed and explained in the landing**, not discovered afterwards
by someone reading the number.
