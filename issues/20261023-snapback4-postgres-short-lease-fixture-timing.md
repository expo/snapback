# Postgres 300 ms ownership fixtures fail under grouped test load

Status: Open
Date: 2026-10-23
Severity: P3
Scope: private-PG ownership test timing; root cause not established

RT6's fresh 25-case ownership rerun on expo-build-450a, with five test threads,
reports 23 passes and two failed live-lease assertions:

- `fenced_transaction_outlives_lease_with_independent_renewal`: the standby
  acquires after renewal where the fixture expects `None`.
- `two_owners_stale_token_refuses_without_a_receipt`: contender B acquires
  where the fixture expects `None`.

Both use the existing 300 ms lease. Both passed earlier in the same lane's
stock-script ownership stage. Each exact case then passes alone using the
identical compiled core executable and owned PG16 cluster: 2.59 s and 2.21 s
respectively, with zero other database clients before each launch. No fixture
body, lease, timeout, retry budget, workload or durability setting was changed.
The grouped red remains recorded; isolated passes do not establish its cause.

The complete identical 25-case ownership executable also passes with
`--test-threads=1` (82.00 s), during the main-workspace compile-only handoff.
All individual fixture bodies, internal concurrency and time bounds are
unchanged. This is a separate lower-concurrency check, not a green five-thread
repeat or a root-cause attribution.

The [P1-EV-1 report](../snapback4/reports/20261023-p1-ev1-schema-evolution/REPORT.md)
records the same short-lease two-owner assertion and an exact isolated pass.
The [RT12 report](../snapback4/reports/20261023-rt12/REPORT.md) records related
unchanged 300 ms renewal/admission fixtures failing in a full sweep and passing
alone. RT6's prepared-flight observer corrections are separate: all 232
adapter cases pass, and both corrected bootstrap observers pass in this group.

Next: capture database-clock lease deadlines and measured gaps around each
renew/acquire to distinguish scheduler/I/O delay from ownership behavior.
Preserve the existing bounds until evidence supports a test design change.
Raw RT6 logs, executable digest and PID records remain outside Git under
`/tmp/rt6-evidence`; the [RT6 report](../snapback4/reports/20261023-rt6-serving-flights/REPORT.md)
records qualification and cleanup.
