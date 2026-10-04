# Worker refresh fixture can assert before its whole-line log arrives

Status: Open
Date: 2026-10-04
Scope: Snapback 4 client fixture; found during FY round 1

`worker-regressions.test.mjs` waits for `refresh-result` and the stderr
`refresh-logged` marker, then immediately requires both `refresh-whole` and
`refresh-split` in the host log. The stderr marker does not witness forwarding
of the worker's independent stdout stream.

Apartment mini repetitions 26, 27 and 28 failed at the final log assertion
(line 198 on FY round 1), with split/marker present and whole-line absent.
The body is byte-identical to review base `0982b0d5e2`. A baseline scratch
control delays observation of the whole line by 500 ms: the assertion fails,
then `CONTROL_DELAYED_WHOLE_ARRIVED` proves the line was not lost.

Follow-up: witness both required log records with a bounded state wait before
checking their exact content and bearer absence. Preserve refresh refusal,
session-count, manual-token and redaction assertions; permanent missing output
must still fail. FY's cleanup-hook patch deliberately leaves this body alone.

Evidence: [FY Round 1 report](../snapback4/reports/20261004-fy-fixture-races/REPORT.md#round-1--bounded-cleanup-hooks),
including complete repetition logs and the baseline control source/output.
