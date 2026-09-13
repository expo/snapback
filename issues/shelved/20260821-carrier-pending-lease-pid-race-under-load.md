# Possible pending-lease PID race in the carrier teardown under heavy load

Systems: CLI, Carrier, Process teardown
Status: Open
Opened: 2026-08-21

During the binding-refresh landing's verification (host load ~99-108 on 10
CPUs, suites serial), the carrier lifecycle suite's final pending-lease case
intermittently failed on the LANDED main carrier code (byte-identical
control), suggesting a load-sensitive race in the pending-lease PID
finalization path landed with the durable-pending-leases commit. The
binding-refresh branch does not touch that code (proven byte-identical).

Fix-forward: reproduce on a quiet machine; if it reproduces, the
pending→active lease finalization ordering needs a deterministic sync point;
if it does not, add a load-tolerant event-driven wait to the fixture.
