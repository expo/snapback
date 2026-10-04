# Snapback 4: retain the malformed proc-stat snapshot from a stress refusal

Status: Resolved
Resolved: 2026-10-03
Date: 2026-10-03
Scope: Snapback 4 qualification runner process-identity diagnostics
Related: LLP 3000#publication-suite-under-contention

QF Round 3's resumed 24-file stress run refused background execution `load-207`
(schema-capabilities.test.mjs) at 2026-10-03T03:20:37.296Z. Its one assertion
passed and its four platform skips were unchanged. The first error was:

```text
TEST_PROCESS_INSPECTION: cannot identify 4185250: TEST_PROCESS_INSPECTION: malformed /proc/4185250/stat
```

The identity parser's numeric-field checks were unchanged by Round 3. The raw
stat snapshot was not retained, so the underlying cause and candidate ownership
cannot be determined from this record. Do not claim a baseline product failure,
an environment-permission refusal, or a particular kernel race. The later
cleanup diagnostic (`file group keeper exited before cleanup`) is secondary:
the first cleanup had already killed the group before inspection failed.

The operator requires mechanism failures and unparsable output to remain
fail-closed. Preserve that behavior. A focused follow-up should retain enough
non-environment stat metadata and the first inspection error to diagnose a
recurrence, then determine whether the rejected snapshot is malformed
or exposes a parser gap. Do not turn an unknown process into an owned one or
ignore a failed enumeration to obtain a green result.

The single Round 3 full suite passed with zero failures; this observation comes
from the subsequent stress background, not that suite or either target.
The [Round 3 report](../../snapback4/reports/20261002-qf-qualification-flakes/REPORT.md#round-3--shared-host-token-inspection-2026-10-03)
and `round3/stress-load-207.log.gz` retain the original refusal and its
classification. The token-environment permission ticket is resolved separately.

A second execution, `load-753` (remembered-answers.test.mjs), refused
`/proc/268164/stat` with the same diagnostic after all 21 assertions passed.
Its complete failure log is `round3/stress-load-753.log.gz`; the cause remains
unclassified beyond the observed metadata-inspection failure.

## Round 4 resolution

Implemented the operator's 2026-10-03 ruling. Every failed per-process stat,
identity/parent/start-time or environment read rechecks PID existence. Gone
PIDs count as exited, including empty, truncated and unparsable stat snapshots.
Vanished group/session/token candidates are also omitted from live leak
results. Whole-group cleanup and two fresh empty inspections still reap and
verify surviving descendants. Already observed live leaks still fail.

Present malformed metadata remains fail-closed. Diagnostics retain the exact
metadata bytes in `rawBase64` and the first read/parse error; subsequent cleanup
errors cannot overwrite it. No environment bytes are retained. Stat parsing
uses the last `)` and validates its numeric tail; ps preserves command spaces
and checks per-row disappearance. Whole-enumeration/helper failure still
refuses independently of individual PIDs.

Final focused results: Linux 42 passed plus six Darwin-only skips; Apartment
mini 48/48. Final fixture wrappers pass 9/9. The single eb1000 suite reports
exactly `== 0 failure(s) in 1510 s`, exit 0: introduced, baseline,
environmental and inspection failures are all zero. Both original flaky
regressions pass 200/200 under 24-file stress; every target completion has 23
background files active. All 2,031 background executions across 283 files
finish with zero assertion failures and zero refusals, exit 0.

The [Round 4 report](../../snapback4/reports/20261002-qf-qualification-flakes/REPORT.md#round-4--vanished-process-inspection-2026-10-03)
retains the deterministic regressions, source hashes, host evidence and full
run records. The two Round 3 snapshots cannot be recovered, so their exact
contents and cause remain unknown. No implementation or qualification work
remains for this ticket; a future present-process malformed read will now
retain the evidence required to diagnose it.
