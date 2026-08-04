# bootstrap: fresh-worktree ibex bootstrap fails on hermes-profile-provenance identity

**Status:** Open
**Opened:** 2026-08-03

`scripts/bootstrap-ibex-runtime` in a fresh worktree fails with
`SNAPBACK_IBEX_CARGO_BUILD_FAILED`: Ibex rejects
`hermes-profile-provenance.json` because `reviewedProfileIdentity` does
not match the checked-in profile authorities (vendor/ibex at 2afa439b;
Hermes artifacts copied from the sibling checkout). `scripts/ibex-doctor`
reports the same single error. Likely the framework-drift family (the
prebuilt main-checkout binary also reports
`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` as stamp-mismatch). Blocks cargo
work in fresh worktrees; needs the ibex/Hermes owner to reconcile the
provenance identity or the bootstrap to accept the current reviewed
profile.
