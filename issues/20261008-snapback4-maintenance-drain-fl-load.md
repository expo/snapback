# Snapback 4: two maintenance drain assertions fail in the FL round-8 load replay

Status: Open
Date: 2026-10-08
Scope: Snapback 4 export maintenance; cause unclassified
Related: LLP 3000.030 §15;
[earlier lock-drain failure](20261007-snapback4-export-retention-lock-drain-timeout.md),
[earlier deadline cancellation](20261007-snapback4-export-maintenance-deadline-timeout.md),
[earlier handoff drain failure](20261006-snapback4-export-maintenance-handoff-drain.md).
Similar predicates do not establish a common cause.

FL round 8's Linux replay at base `2797247960` failed these assertions under
synthetic CPU load on CPUs 80–87:

- Round 2: `skipped maintenance never blocks publication and drains under
  SIGTERM (off)`, 92.5 seconds, `maintenanceIdle` called at line 637.
- Round 3: `retention cannot remove a run between directory creation and
  export lease acquisition`, 117.1 seconds, call at line 973.

Both fail `coalesced maintenance queue drained`, the unchanged 90-second
predicate requiring no request/claimed/parked record and no live next/active
process. They are assertion failures, not the enlarged outer test guard or a
CLI transport timeout. The kernel keeper acknowledges cleanup with no file
leak or inspection failure. No predicate, count, deadline or product behavior
has been relaxed to accept these outcomes.

This replay keeps test/helper sources and the debug CLI fixed. It is separate
from the discarded earlier batch in which a concurrent Cargo run replaced the
debug executable. A private binary-replacement control reproduces that earlier
failure mechanism; it does not explain these two fixed-input failures.

The failed fixtures had already been removed by cleanup, so their queue and
maintenance log contents are unavailable. Both cases then passed 60 focused
diagnostic repetitions each (20 initially, then 40 under eight additional
busy loops confined to the same CPUs). The complete frozen-input background
replay passed 18 of 20 runs. Further evidence and all final replay totals are
recorded in the [FL round-8 report](../snapback4/reports/20261007-fl-dry-run-flakes/round-8/REPORT.md).
Passing reruns do not resolve the original failures or identify their cause.

Evidence:
[SIGTERM case](../snapback4/reports/20261007-fl-dry-run-flakes/round-8/evidence/final-load/background-02.log),
[initialization case](../snapback4/reports/20261007-fl-dry-run-flakes/round-8/evidence/final-load/background-03.log),
[focused diagnostic runs](../snapback4/reports/20261007-fl-dry-run-flakes/round-8/evidence/queue-edge-diagnostic.log),
[additional loaded diagnostics](../snapback4/reports/20261007-fl-dry-run-flakes/round-8/evidence/queue-edge-highload.log).

Round 8 now retains the seven queue/result records, maintenance log and fresh
process identity observations before cleanup on a drain failure. The diagnostic
control preserves the original assertion and captures a live owned observer;
the drain predicate and its 90-second bound remain unchanged. A separate later
background run hit the existing native `/proc` inspection diagnostic tracked
in [its own ticket](closed/20261004-snapback4-native-witness-proc-group-inspection.md).
That is not evidence that it caused either drain failure here.

Next: use the snapshot on the next failure to determine whether
work stayed pending, a custodian exited, or a scan parked an error. Keep the
drain predicate and native custody assertions intact; do not infer that simply
increasing the wait or sending another export would repair the guarded defect.
