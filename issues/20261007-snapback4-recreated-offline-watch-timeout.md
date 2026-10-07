# Snapback 4: recreated offline watch intermittently times out

Observed during RX round-1 qualification on eb1000, 2026-10-07. Open;
the triggering race and which snapshot field failed the predicate are unknown.

`packages/snapback4/test/residency.test.mjs:121` failed in the full 24-file
client pool while waiting for a recreated offline watch to recover audit row
`a2` with `fresh === false`. The 122,000 ms guard expired. The preceding watch
had already returned that row offline. The failure log does not capture the
new watch's last snapshot, so it does not distinguish missing data from stale
freshness metadata.

The complete ten-test file passed immediately through the normal runner.
Ten further executions of the failing case on RX all passed. Alternating
controls against the integrity-verified published 0.4.13 Linux engine produced
the **same timeout in trial 7 of ten**; the other nine passed. These controls
use the current client package. The relevant test and client read/watch/native
source files are byte-identical to the pre-RX `9bcf6cfb630e` base; the merged
SDK's additions are an unused `matchRead` helper and React export. This
corroborates the failure outside the RX engine change without claiming the
entire installed SDK is the published package.

Evidence and reproduction script:
[RX round-1 report](../snapback4/reports/20261006-rx-rule-hops/REPORT.md#round-1--legacy-identity-and-merged-qualification-2026-10-07),
[original failure](../snapback4/reports/20261006-rx-rule-hops/round-1/residency-first-failure.log),
[published-engine failure](../snapback4/reports/20261006-rx-rule-hops/round-1/residency-controls/published-0.4.13-7.log),
[source control](../snapback4/reports/20261006-rx-rule-hops/round-1/residency-source-control.json).
From `snapback4/`, run `node --test --test-name-pattern='^server-class watches run locally' packages/snapback4/test/residency.test.mjs`;
set `SNAPBACK4_BIN` to the published engine for the control. The report retains
all twenty trials. No guard, assertion, test count or client implementation
was changed to obtain a pass.

Next: retain the recreated snapshot plus remembered-answer invalidation/cut
events on failure, then add a deterministic regression for the observed race.
