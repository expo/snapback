# Release ceremony store-qualification runs template-portfolio against the receiptless runtime

**Status:** Open
**Systems:** Packaging, Distribution, Release ceremony
**Date:** 2026-08-27
**Related:** LLP 0041, LLP 0110, LLP 0196, `scripts/qualified-staging-store-qualification.mjs`,
`issues/20260827-fastpath-release-isolate-not-buildable.md`

## Symptom

`snapback-fastpath-release.mjs stage` fails at
`SNAPBACK_FASTPATH_STORE_QUALIFICATION_FAILED: host store qualification failed`
with the template-portfolio reporting 4/5 templates `npm run prove failed`
(`single_table_v1` unsupported). Only `todo-contract` (no live dev server) passes.
This blocks the ceremony for any single-table app — i.e. every release.

## Root cause

`scripts/qualified-staging-store-qualification.mjs` mints the packaged-store
qualification receipt into an EXTRACTED copy of the runtime tarball
(`dirname(runtimeBinary)/packaged-store-qualification.receipt.json`), then runs
`template-staged-qualification.mjs --staged-dir <filtered>` against the ORIGINAL
staged `.tgz` closure — which is still receiptless. So the runtime the
template-portfolio cold-installs does NOT advertise `single_table_v1`, and every
live-dev-server template fails. The minted receipt is never propagated into the
staged closure that template-portfolio consumes.

## Verified working direct path (used to cut 0.1.29)

Mint the receipts directly (`packaged-store-qualification.mjs --runtime-binary <bin>
--staged-dir <platform-filtered pass1>`, per platform), assemble with
`release --receipt <platform>=<receipt>`, then run
`template-staged-qualification.mjs --staged-dir <receipt-bearing pass2>` — which
passes 5/5. So the fix is to have store-qualification re-stage the runtime tarball
with the minted receipt (or point template-portfolio at the receipt-bearing pass2)
before the template gate, instead of qualifying the receiptless pass1.

## Wanted

Re-order/propagate so template-portfolio qualifies the receipt-bearing runtime; add a
regression check that the template-portfolio stage installs a runtime advertising
`single_table_v1`.
