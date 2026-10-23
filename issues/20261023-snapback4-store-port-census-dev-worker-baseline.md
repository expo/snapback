# Snapback 4: inherited dev-worker test store-port census mismatch

Status: Open
Date: 2026-10-23
Scope: snapback4/crates/snapback4/src/dev_worker_tests.rs; snapback4/crates/snapback4/tests/store_port_ratchet.test-allow.txt
Related: LLP 3000.009.001.000 §3.2

The full binary sweep and isolated store-port ratchet on P1-EV-1 report four
sites in `dev_worker_tests.rs` against listed zero. Both that file and the test
allowance are byte-identical to base `06a9d2c47f`; the ratchet reports no other
over-budget file introduced by this lane. The independent committer ratchet
passes. No allowance was raised or census test disabled.

Move the fixture access behind the appropriate neutral test hook, or obtain
the required reviewed allowance decision. Preserve the census coverage. Logs
are retained in [the lane report](../snapback4/reports/20261023-p1-ev1-schema-evolution/REPORT.md).
