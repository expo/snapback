# Worker deletion fixture can lose its setup race for the SQLite writer lock

Status: Open
Date: 2026-10-04
Scope: Snapback 4 client fixture; found during FY round 1

`removed worker retains query fence while deletion is locked` observes the
worker's `terms` file and immediately executes `BEGIN IMMEDIATE` on a separate
test connection. That marker does not prove the database writer is available.

Apartment mini repetition 27 failed with `database is locked` at this setup
statement (line 307 on FY round 1), before the fencing assertions. The body is
byte-identical to review base `0982b0d5e2`. A baseline scratch control holding
an owned competing write transaction reproduces the same refusal; it releases
that control transaction before fixture cleanup.

Follow-up: obtain the fixture's writer lock with bounded, busy-specific retry,
while preserving the proof that deletion remains blocked and queries reject
the retired family. Do not treat an unrelated SQLite error as success or drop
the retirement assertions. FY's cleanup-hook patch leaves this body alone.

Evidence: [FY Round 1 report](../snapback4/reports/20261004-fy-fixture-races/REPORT.md#round-1--bounded-cleanup-hooks),
including complete repetition logs and the baseline control source/output.
