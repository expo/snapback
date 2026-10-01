# Snapback 4: 1,000 per-row React hooks render loading during revalidation

Status: Resolved
Date: 2026-10-01
Scope: Snapback 4 client / React, LLP 3000.023 §10
Observed by: RY round 6 full-suite qualification

`packages/snapback4/test/per-row-react.test.mjs:98` fails its zero-loading
assertion after a relevant write. All 1,000 rows update with the expected
2,000 total calls, but some hooks render loading rather than retaining a
revalidating answer. The fixture uses a mocked HTTP backend with no tables;
it does not execute the Rust/wasm receipt interpreter.

Reproduced unchanged on pinned main `d959efe2edf405e1270dce35f75703d89a0ccbf7`:
expected `{ loading: 0, calls: 2000, rows: 1000 }`, actual loading **61**.
RY full suite observed **87**; an isolated RY invocation observed **106**.
SDK source and this test have no diff from that main revision. Counts vary,
so investigate scheduling/retention rather than assuming a fixed affected
subset. The full suite's adjacent wasm/worker/process real-clock cases pass.

From `snapback4/`, after the ordinary package build:

```sh
node --test --test-name-pattern='^1,000 per-row useQuery hooks:' packages/snapback4/test/per-row-react.test.mjs
```

Preserved failure output and qualification:
[RY round 6 report](../../snapback4/reports/20260930-ry-receipts-allocation/round6/REPORT.md),
[main reproduction](../../snapback4/reports/20260930-ry-receipts-allocation/round6/main-per-row.log.gz),
[branch reproduction](../../snapback4/reports/20260930-ry-receipts-allocation/round6/candidate-per-row.log.gz).
No timeout, assertion or retention policy was weakened in RY.

Resolution, 2026-10-01: PRL traced the failure to repeated ready notifications
exhausting the necessary online queue-inclusive authority second. Round 0
coalesces positive callbacks while preserving publication and withdrawal fences;
round 1 isolates listener exceptions, corrects React Native's notification
window and recovers rejected capacity tasks. The original real-clock online
case passes 20/20 under SL's 48-worker, ten-CPU load after the main merge;
all 1,529 affected audit tests pass. See the
[PRL round-1 report](../../snapback4/reports/20261001-prl-per-row-loading/round1/REPORT.md)
and its retained negative controls and qualification scope.
