# Cloudflare acceptance is blocked by stale deployment identities

**Status:** Open
**Impact:** 2
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Systems:** Cloudflare, Generated deployment identity, Acceptance proof
**Date:** 2026-08-15
**Governing:** LLP 0040, LLP 0049
**Related:** `issues/closed/20260802-deployment-identity-manifests-stale.md`
**Found while:** Whole-codebase correctness review (2026-08-15)

## Problem

On the repository-pinned Node 24.18.0 runtime, `bun run cf:accept` stops in its
first compatibility suite:

```text
STALE: cloudflare/generated/deployment-identity.notes.json
STALE: cloudflare/generated/deployment-identity.all-aboard.json
MISMATCH: Cloudflare deployment identities are stale
cf-check-compat: deploy config drifted from the single-sourced compat.json
```

This is the same drift class fixed earlier in August, now regressed after later
Cloudflare/config changes. Since compatibility aborts first, none of the real
coordinator/gateway acceptance suites run.

## Desired outcome

Regenerate and review both identity records from the current single-sourced
compatibility inputs, and ensure the change that rotated those inputs carries
the records in the same landing.

## Acceptance

- `volta run --node 24.18.0 bun run cf:accept` reaches and passes every suite.
- `scripts/cf-check-compat` reports no stale or mismatched identity.
- The regeneration check catches the same omission at the originating change.

