# Snapback 4: intermittent W5c secondary-tab receipt observation

Status: Open
Date: 2026-09-16
Scope: client acquisition/orphan receipt adoption; attribution unconfirmed.

During the A2 full suite at `f91ea2f85`,
`packages/snapback4/test/navigation-model.test.mjs:683` failed in
`W5c a reloaded secondary tab recovers its terminal receipt by id`:
`receipt?.state` was undefined rather than `sent` after the bounded polling
loop. The test file is unchanged by A2. This was not ECONNREFUSED.

The next full suite (`0e5c84935`) passed this case, as did the complete
navigation-model file in the focused 88-test run at `8d66c9be4`. Ten isolated
runs on the clean untouched-main baseline `e16baf3483` also passed. Those
passes do **not** establish an inherited baseline failure or erase the one
observed failure. No timeout was lengthened and no product fix is claimed.

Reproduce with concurrent client-test workload and capture orphan adoption,
lease ownership, receipt observation and fixture timing; distinguish a late
observation from lost receipt state. Do not attribute this to the A2 lanes
without evidence, and do not label it baseline-proven.

Evidence retained under `/tmp/sb4-w9-evidence.nndUKm/`:
`a2-full-f91ea2f85.log`, `a2-full-0e5c84935.log`,
`a2-supervision-checks.log`, `a2-w5c-baseline-recheck.log`.
The ten-pass baseline log SHA-256 is
`5a6ca8917f2864fc5d0abf065aff822c4f79ecede2494df95bb9f29b40476084`.

2026-09-16 A3 qualification: the same assertion recurred in the complete
suite at `d38c7dfcf` (clients 469/471), then passed in the immediate isolated
run alongside the other failed client case. This is a second observation,
not a proven inherited baseline or a claimed fix. Retained logs:
`a3-full-suite.log`, `a3-failure-isolation.log` in the same evidence directory.
