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

## Resolution (2026-08-15)

Regenerated both source-derived records:

- `cloudflare/generated/deployment-identity.notes.json`
- `cloudflare/generated/deployment-identity.all-aboard.json`

Both records now include the newly bundled
`cloudflare/src/outbound-destination.js` and
`cloudflare/src/rate-windows.js` inputs and carry the resulting schema, bundle,
and complete-input hashes.

The originating Cloudflare landing was `91e1570e0`. It did not include either
identity record, but both omission checks already existed at that exact commit:
`scripts/verify-local-proof` ran the generator with `--check`, and
`.github/workflows/deployment-identity.yml` ran the same command on pushes and
pull requests. No wiring change was needed; the already-wired verdict was not
obtained/enforced for the originating landing.

Evidence:

```text
$ scripts/cf-check-compat
deployment identities match bundled sources and normalized deploy configs
cf-check-compat: compat pins match (2026-07-01 flags=[]), no nodejs_compat flags
```

The pinned acceptance run cleared identity compatibility and reached suite
24/29, where an unrelated ignored codegen-cache precondition stopped the deploy
script suite:

```text
$ volta run --node 24.18.0 bun run cf:accept
ok 1/29 - compatibility
ok 23/29 - target-admission
not ok 24 - deploy-script
missing completion evidence: ["cloudflare deploy-script acceptance: mixed bootstrap, rollback, and admin-secret states passed"]
Error: SNAPBACK_CODEGEN_CACHE_INVALID: generated cache is missing or tampered; regenerate before consuming it: ENOENT: no such file or directory, lstat '/Users/ccheever/projects/snapback-worktrees/tix-tool/demos/all-aboard/.snapback/codegen-cache/8224b877a918f270c2fdb37eea3305e2017164a0234568a14e6a158bce3399bb/artifacts.json'
Error: deploy-script failed with status 1
error: script "cf:accept" exited with code 1
```

Per the ticket instructions, this unrelated later-suite failure was recorded
but not pursued.
