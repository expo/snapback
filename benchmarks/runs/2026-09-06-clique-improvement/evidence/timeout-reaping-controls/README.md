# Timeout-reaping controlled tests

The six [r2 controls](r2/execution/REPORT.json) passed with actual outer exit 0, in a 10.023559333-second execution loop. Root read the complete report and all six case results. The exact parent reproduces the missing-receipt failure. The candidate records timeout 124 independently of an eventual actual exit 0; it reaps a live matching group after its owned signal and refuses a changed identity, retaining an unknown terminal and incomplete-log receipt. The test controller later releases that child separately without rewriting the unknown receipt. Ordinary success remains accepted.

The first [r1 attempt](r1/execution/REPORT.json) failed on Python 3.9's unsupported kqueue context manager before the intended assertion. The first case actually exited 1; its controller recorded child exit 0 and five cases did not run. [The exact correction](r2/regression-vs-r1.diff) uses explicit try/finally close. Parent/candidate helper bytes and all deadlines remained unchanged. Both attempts are preserved.

These are controlled measurement tests with a test-local clock and harmless FIFO children, not install latency measurements. The [original 0.0.17 npm timeout](../cli-017-public-installed/README.md) remains failed with unknown npm exit and unrun ci. No install was repeated or retroactively qualified. The helper change awaits independent review and has not been deployed into a release packet.

The Python files are exact evidence copies with their original absolute-path bindings, not a newly installed repository test runner. [Copy hashes](copied-evidence.json) bind every retained regular file; FIFO endpoints were not copied.

## R3 correction accepted

The first review found an unsupported log-completeness inference. The [r3 derivative and evidence](r3/README.md) remove that field, preserve all six meaningful controls, and have fresh READY/READY reviews. Root requires that accepted base for the next public default-install packet; original017 remains failed/unknown. Earlier review-pending statements describe the earlier frozen stage.
