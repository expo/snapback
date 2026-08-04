# bootstrap: fresh-worktree ibex bootstrap fails on hermes-profile-provenance identity

**Status:** Resolved
**Opened:** 2026-08-03
**Resolved:** 2026-08-03

`scripts/bootstrap-ibex-runtime` in a fresh worktree failed with
`SNAPBACK_IBEX_CARGO_BUILD_FAILED`: Ibex rejected
`hermes-profile-provenance.json` because `reviewedProfileIdentity` did
not match the checked-in profile authorities.

## Root cause

Snapback pins `vendor/ibex` at `2afa439b`, whose reviewed Apple builder
authority digest is `sha256-45d927…`. The default sibling `../ibex` checkout
was 278 commits ahead and carried a self-consistent newer prepared artifact set
whose receipt binds `sha256-60b2b6…`, introduced by Ibex commit `3085ae57`
(`Make standalone release inputs reproducible and portable`). The Hermes
framework binary digest was unchanged, but the reviewed build authority was
not. Snapback checked only artifact presence before copying the sibling set, so
Ibex's exact build-time provenance validator correctly rejected the
cross-authority receipt.

The pinned Ibex revision and its checked-in authorities were internally
consistent; the sibling artifacts were merely incompatible with that pinned
consumer. The main Snapback checkout's installed receipt matched the pinned
`45d927…` authority exactly.

## Resolution

The bootstrap now reconstructs the authority-bound source-cache keys from the
vendored Ibex revision and requires a prepared receipt to match before using or
copying the artifact set. A structurally complete but incompatible sibling is
skipped for the existing vendored download/build fallback. Ibex `build.rs`
remains the authoritative full-digest validator; the bootstrap check is an
early compatibility prefilter, not a second trust authority.

The regression fixture covers an incompatible installed set plus an
incompatible peer and proves that the vendored fallback repairs it. The actual
worktree was repaired through the documented `SNAPBACK_IBEX_CHECKOUT` path
using the compatible artifacts in the read-only main checkout, then proved by:

- `scripts/bootstrap-ibex-runtime` (no override): exact link, scrubbed-loader
  launch, and restricted no-eval handler-VM qualification passed;
- `cargo build --locked --bin snapback`: passed;
- `cargo test --locked --test runtime_qualify_posture_v0`: 1 passed;
- `node tests/ibex_bootstrap_v0.mjs`: passed;
- `node scripts/check-guide.mjs`: passed after regenerating the fresh-worktree
  ignored snippet sources and tracked guide projections;
- `./ref-check --verbose`: zero errors and zero unchecked references.

No sibling or main checkout files were modified.
