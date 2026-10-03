# Snapback 4: retain the malformed proc-stat snapshot from a stress refusal

Status: Open
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
The [Round 3 report](../snapback4/reports/20261002-qf-qualification-flakes/REPORT.md#round-3--shared-host-token-inspection-2026-10-03)
and `round3/stress-load-207.log.gz` retain the original refusal and its
classification. The token-environment permission ticket is resolved separately.

A second execution, `load-753` (remembered-answers.test.mjs), refused
`/proc/268164/stat` with the same diagnostic after all 21 assertions passed.
Its complete failure log is `round3/stress-load-753.log.gz`; the cause remains
unclassified beyond the observed metadata-inspection failure.
