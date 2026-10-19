# Snapback 4: intermittent Following wasm-session timeout

Status: Open
Date: 2026-10-19
Scope: `snapback4/packages/snapback4/test/following-unfollow.test.mjs`

Integration 18's third client cohort timed out the wasm scenario at its unchanged
216,000 ms guard; the file completed after 302,098 ms with native passing. The
same file passed in the two earlier cohorts (8,231 ms and 14,538 ms), then passed
alone again (both scenarios, 7,497 ms). No assertion or deadline was weakened.
The final complete cohort is recorded separately in the Integration 18 report.

The fixture itself is unchanged from base `3653cae823`. This does not establish
that the cause is inherited: the merged runtime and shared host load differ.
The failure provides no inner assertion or stack beyond the outer timeout.
Investigate outstanding sync/held response/cleanup versus resource contention;
do not classify a passing repetition as a root-cause repair.

Raw evidence is under `~/sb4-loop/integ18/`: `clients-full1.log`,
`clients-full2.log`, `clients-full3.log`, `following-alone.log` and
`clients-final.log`. Superseded cohorts are explicitly distinguished from the
final full run. The final cohort uses one 16-file pool instead of 24 on the shared
host, plus the same serialized timer files and full-count models.
