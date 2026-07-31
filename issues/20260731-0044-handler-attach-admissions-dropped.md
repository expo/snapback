# ctx.assets.attach admissions do not reach the commit hook on the real mutation path

**Status:** OPEN — found by tests/acceptance/asset-conformance-v1.mjs
(Lane 1, 2026-07-31); owner: core lane

On a real sessions-mode server, a `defineJsMutation` handler calling
`ctx.assets.attach(assetId, { upload })` commits with outcome `rejected`,
rollbackReason `SNAPBACK_ASSET_REF_UNVERIFIED`: the attach host op records
the admission on `IbexHostContext.asset_admissions` (src/runtime.rs
"assets.attach" arm), and all three `BufferedCommitPayload` construction
sites in src/local.rs thread `executed.asset_admissions`, yet the commit
hook sees an empty admission list for the write. The L1-07 lib coverage
exercised the hook through a test helper, not the served mutation path —
the served path drops the admissions somewhere between execution and
`enforce_asset_reference_changes` (suspect: the record/replay ctx-ledger
seam or a fourth commit path).

Meanwhile host-plan attachment (schema-derived commit-boundary admission)
works end-to-end and carries the conformance suite's positive vectors.
The suite pins the current refusal as
`checks.handlerAttachDefectRecorded`; when this is fixed, flip that
vector into the positive handler-attach case and reconsider flipping the
guide's attach fragment to transcluded-verified.
