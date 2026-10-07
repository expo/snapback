# Snapback 4: native export wrapper intermittently returns 1 instead of the export child's 7

**Opened:** 2026-10-06, lane RX full-suite verification
**Status:** Open; cause unconfirmed
**Area:** `snapback4/packages/snapback4/test/export-native.test.mjs:88`, `snapback4/packages/snapback4-expo/export-ios.mjs`
**Related:** LLP 3000.030 §15; [RX evidence](../snapback4/reports/20261006-rx-rule-hops/REPORT.md)

On eb1000, the full `bash snapback4/scripts/test.sh` run with the publication
SQLite flag failed the third `export-native.test.mjs` case, “npm bin symlink
really exports, preserves export failure and honors opt-out”. The second
export invocation should preserve its mock Expo child's status 7; the observed
wrapper status was 1. The preceding successful export passed. The assertion
does not include the failed invocation's stdout/stderr, so the triggering
error is unknown. Do not infer a cause or dismiss this as proven infrastructure.

An immediate unchanged-file rerun passed (nine passes, one Darwin-only skip).
Twenty serial and forty concurrency-eight trials of that case also passed,
with diagnostic assertions retaining stdout/stderr if it recurs. The test and
wrapper files are unchanged by RX. This does not prove that the failure is
inherited: the current full run and these reruns are the direct evidence.
Published 0.4.13 cannot serve as a wrapper baseline because it lacks the
checkout's export-maintenance/lease initialization protocol.

Follow up by including the failed subprocess's stdout, stderr, signal and
spawn error in the assertion, then reproduce under the ordinary client pool.
Preserve the expected status 7 and the invariant that a failed export leaves
the previous publication intact. Do not weaken the assertion or hide a
cleanup/lease failure behind the expected export status.

Evidence in the RX report directory: `full-suite-export-status.log.gz`,
`export-native-rerun.log`, `export-native-control.json` and
`export-native-parallel.json`. The control JSON retains the original test
hash and explicitly marks the unusable published-version control.


**2026-10-07 resumption:** the unchanged native-export test passed inside the
ordinary full-suite client pool after the eb1000 reboot. The case remains
open because that pass does not explain the earlier failure; the RX report
retains both runs and the diagnostic repetitions.
