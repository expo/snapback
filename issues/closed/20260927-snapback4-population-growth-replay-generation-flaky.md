# Snapback 4: `wasm: population growth cannot mint new IDs during prediction replay` is intermittent under the full suite

Status: Closed. Opened 2026-09-27 at lane CQ's landing. Resolved 2026-09-30 by lane SL; fixture premise confirmed.

In one `scripts/test.sh` run (CQ landing merge on origin/main 5cb94a8a0), the
wasm variant of `client-lifecycle.test.mjs:1072` failed its assertion
"withdrawing an expanded replay still commits the authoritative stream
transaction": the device recorded
`{op: "observe_store", denied: {code: "E_GENERATION", message: "another owner advanced acquisition during sync; retry sync"}}`
where none was expected. The native variant passed in the same run. Six
isolated runs of the test pass both variants
(`node --test --test-name-pattern="population growth cannot mint" packages/snapback4/test/client-lifecycle.test.mjs`).

Suspected: a sync started by the fixture overlaps the replay's acquisition
under load, so the second observer sees the generation advance. Reproduce by
holding the second sync response behind the replay, and decide whether the
test should await the first sync or the product should retry the observation
silently. Not caused by CQ (cursorless completeness), which does not touch
acquisition or generations.

## Resolution — 2026-09-30

The loaded trace confirms that a background probe carries an obsolete acquisition
capture while the fixture's explicit replay advances the device. Its E_GENERATION
is the intended stale-owner fence, also required by separate store-reset tests;
it is not evidence that prediction minted a new ID. The fixture now holds only
background probe/change-feed work during explicit replay. Its complete refusal
census, generated-ID equality and authoritative stream assertions are retained.
The affected loaded file set and later complete heavy/slow suites pass both hosts.
See CASE-NOTES and TEST-CHANGES in the SL report.

[SL report](../../snapback4/reports/20260929-sl-suite-under-load/REPORT.md) includes raw baseline, negative-control and corrected-suite logs.
