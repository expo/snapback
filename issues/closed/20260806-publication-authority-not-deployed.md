# Leased promotion requires a publication authority that is deployed nowhere

**Status:** Resolved (2026-08-07)
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 5
**Systems:** Packaging, Deployment, Security
**Date:** 2026-08-06
**Related:** LLP 0041 (lease and rollback design),
`packages/snapback-publication-authority/`,
`issues/20260803-first-npm-latest-promotion.md` (the promotion this blocks)

## Summary

Found by today's promotion-machinery audit: the leased-promotion machinery
requires a deployed `@expo/snapback-publication-authority` service, and no
deployment exists.

- The service is fully implemented in-tree
  (`packages/snapback-publication-authority/`: `server.mjs`, `Dockerfile`),
  and `scripts/snapback-promote.mjs:125-134` requires `--authority-url` to
  be a bare HTTPS origin — no path, credentials, query, or hash. The
  promoter and lease request both require a mounted bearer-token file named
  by `SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE`.
- No deployment exists anywhere: no `fly.toml`, no wrangler binding, no
  deploy script references the authority (the only `fly.toml` files in the
  repo belong to unrelated `demos/competitive-checkpoint` acceptance
  fixtures). LLP 0041:836-838 records deploying the authority as a separate
  operator act — one that has never happened.

Two adjacent operator-input gaps compound this under the 900-second lease
ceiling (`scripts/snapback-request-publication-lease.mjs` caps
`--lifetime-seconds` at 900):

- The `latest-proof-plan.json` input to `scripts/snapback-promote.mjs
  --latest-proof-plan` has no generator and no in-tree example beyond a test
  fixture (`scripts/snapback-promotion-core.test.mjs:1649`).
- The observed-prior-latest-vector file consumed by
  `scripts/snapback-request-publication-lease.mjs --prior-vector` is
  hand-assembled: `validateObservedPriorVector` demands the exact
  nine-package inventory, which in practice means nine separate `npm view`
  observations transcribed by hand. Both are error-prone inside a
  900-second window.

## Ask

As a prerequisite ticket for the first ceremony promotion: deploy the
authority behind real HTTPS and mint the operator bearer token. Also add
small generators for the latest proof plan and the observed prior vector so
the lease window is not spent hand-assembling JSON.

## Resolution (2026-08-07)

Both halves of the ask are done.

- **Deployment** (a concurrent lane, not this note's author): the authority
  is live at `https://snapback-publication-authority.fly.dev`
  (`/healthz` reports `ready:true`; bearer-token auth verified). Operator
  credentials are in `~/Dropbox/APIKeys/snapback-publication-authority/`.
- **Generators** (this lane): two new freestanding CLI scripts remove the
  hand-assembly step for both operator inputs inside the 900-second lease
  window.
  - `scripts/snapback-generate-latest-proof-plan.mjs --lease
    <authorized-lease.json> --ledger <candidate-ledger.json> --out
    <latest-proof-plan.json>` builds the plan `scripts/snapback-promote.mjs
    --latest-proof-plan` consumes, deriving every field
    (`authorizedLeaseSha256`, `operationId`, `publicationEpoch`,
    `expectedPriorRootVersion`, `helperSha256`, `ledgerPath`,
    `expectedHeadSha`) the same way `snapback-promote.mjs`'s own
    `loadLatestProofPlan()` recomputes them, and self-validates the result
    through `validateClosedLatestProofPlan` before writing — a drifted
    lease, dirty checkout, or out-of-tree ledger refuses loudly instead of
    producing a file that only fails later.
  - `scripts/snapback-observe-prior-vector.mjs --out
    <observed-prior-latest-vector.json> [--ledger <candidate-ledger.json>]`
    runs the real `npm view <name> dist-tags --json` observation for every
    name in the promotion package inventory — sourced from
    `PROMOTION_PACKAGE_NAMES`/`promotionNamesForScopePreset` in
    `scripts/snapback-publish-core.mjs`, never a hardcoded literal list, so
    the generator does not need code changes if the inventory grows past
    nine (e.g. to include `@expo/snapback-expo`) — and writes the file
    `scripts/snapback-request-publication-lease.mjs --prior-vector`
    consumes. The npm-view runner is dependency-injected, so tests exercise
    it without touching the network; a missing/failed package observation
    or a non-semver `latest` tag both refuse before any output is written
    (partial vectors are never persisted).
  - Both generators write atomically (temp file + fsync + rename).
  - Test coverage: `scripts/snapback-generate-latest-proof-plan.test.mjs`
    and `scripts/snapback-observe-prior-vector.test.mjs` (12 cases total),
    plus regression runs of `scripts/snapback-promotion-core.test.mjs` (38
    cases) and `scripts/snapback-prior-default-closure.test.mjs` (5 cases).
    All green. Both new suites are wired into `scripts/verify-local-proof`
    next to `promotion-fixtures`.
  - Neither generator is wired into `snapback-promote.mjs` or
    `snapback-request-publication-lease.mjs` argument parsing — they stay
    freestanding pre-ceremony steps, so nothing about the ceremony itself
    changed.

Nothing else on the original ask remains open. Moving to `issues/closed/`.
