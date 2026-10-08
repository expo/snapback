# Snapback 4 witness post-driver compression diagnostic assertion flakes under load

Status: Open
Date: 2026-10-08
Scope: Snapback 4 native witness test / post-driver retention
Related: LLP 3000.030 §15

Lane PG's instrumented baseline (main `1dd87edd57` plus refusal-detail-only
instrumentation in recovery.rs) failed witness-module run 8/9 at
`background.rs:567`, in
`witness_passed_outcome_survives_post_driver_compression_failure`:

```text
assertion failed: String::from_utf8_lossy(&output.stderr).contains("receipt compression failed")
```

The nested fixture returned success. The failing assertion does not print its
captured stderr, so the alternate diagnostic and cause are unknown. Do not
infer a process-inspection failure, lost lease, or suppressed compression
failure from this assertion alone. PG's next run reproduced the separately
tracked `/proc` refusal with exact bytes, at a different test/assertion.

Evidence: [baseline run 8](../snapback4/reports/20261008-pg-proc-group-inspection/instrumented/008.log.gz),
[campaign summary](../snapback4/reports/20261008-pg-proc-group-inspection/instrumented/summary.json)
and [PG report](../snapback4/reports/20261008-pg-proc-group-inspection/REPORT.md).
The campaign used four libtest threads, CPUs 88–91, six owned busy loops and
two short-lived-process churners. No background/retention code changed in PG.

Next: include captured stderr in this assertion's diagnostic and reproduce
the alternate outcome before changing retention or fixture synchronization.
Keep the result-preservation and expected-compression-error assertions.
