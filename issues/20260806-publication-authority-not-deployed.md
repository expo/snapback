# Leased promotion requires a publication authority that is deployed nowhere

**Status:** Open
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
