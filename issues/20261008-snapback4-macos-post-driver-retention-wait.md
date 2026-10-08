# macOS post-driver retention wait expires with a live maintenance scan

Status: Open
Date: 2026-10-08
Scope: Snapback 4 native retention/custody investigation; EM round-8 soak
Related: [LLP 3000.030 §15](../llp/3000.030-native-proof-in-minutes.rfc.md#15),
[EM handoff ticket](20261006-snapback4-export-maintenance-handoff-drain.md),
[EM deadline ticket](20261007-snapback4-export-maintenance-deadline-timeout.md)

The operator's macOS soak of `affcd4919b` passed wakeup 21/21 and the first
export-background run 95/95. Run 2 passed 93/95. One failure is the separate
unchecked whole-table `ps` listing, assigned to FL round 10. This ticket tracks
`first-started last-published generation remains full evidence (background)`:
`background proof and post-driver retention finished`, test duration 113.909 s.
The failing assertion has a 30-second wait. It precedes `maintenanceIdle`;
neither that predicate nor its 90-second guard is the assertion that failed.

Retained input: [exact supplied archive](../snapback4/reports/20261008-em-export-maintenance-macos/evidence/em-r7-mac-run2.tar.gz),
SHA-256 `d113e693190930ffdc47597f8d9d7a5a88fe432430b7cef23d3001040ca400c6`.
Inside it, the relevant directory is
`sb4-em-evidence/maintenance-cfef6bd701aa7c2f/snapshot-1791419664460053000-4757c24f-failure-test-guard/`.
[Machine-readable timeline and omissions](../snapback4/reports/20261008-em-export-maintenance-macos/evidence/snapshot-analysis.json),
[investigation/report](../snapback4/reports/20261008-em-export-maintenance-macos/REPORT.md).

The wakeup was adopted and consumed at 1791419580429. Observer 5642 launched
scan 7363, which claimed work and recorded `scanning`. Custodian 6004 started
retention at 1791419584185; scan 7363 started its retention at 1791419584324.
Worker 7412 logged `compress-before` at 1791419584734. This is a retention
worker PID, not an identified gzip PID: the event precedes `Command::output()`.
There is then a 79.760-second gap in retained trace before the snapshot.
Observer 5642 and scan 7363 were still identity-verified live processes. The
archive does not establish the continued liveness of custodian 6004 or worker
7412, nor which operation any of them was blocked in.

The test entered its `finally` cleanup drain at 1791419614243, approximately
30 seconds after the retention work started and 50 seconds before the snapshot.
Cleanup completed later; the log records a cleanup snapshot at 1791419668197,
but the four-entry cleanup ring subsequently evicted it. There is no retained
snapshot at the initial failing wait. Cleanup does not signal these workers;
it waits for their native custody to finish.

This is **delivered work with live custody**, not the reproduced EM lost-wakeup
state (pending work, free lease, absent observer). The wakeup writer lock has
no observer/scan acquisition path. Retention workers use `try_lock` and refuse
busy retention custody; the existence of `maintenance-wakeup.lock` proves no
owner or lock cycle. The sleep predicate already tolerates increases up to
1,000 ms. No retained sleep refusal or parked claim attributes this failure to
clock drift. Linux injection covers 1/20/1,000 ms drift without resetting the
sample, and the existing 2,000 ms controls still require a stop.

The compression, recovery, native process group and preparation code, the real
Darwin clock, and post-driver retention path predate EM. The work-budget function
is unchanged since round 4. [Source hashes](../snapback4/reports/20261008-em-export-maintenance-macos/evidence/source-provenance.json)
establish that code provenance; **they do not establish that this incident is
pre-existing or independent of changed scheduling**. Root cause remains unknown.
Do not close this as a compression, sleep, wakeup or lock-order fix without
additional evidence. A 30-second work budget plus custody cleanup also does not
justify assuming the worker must exit within the test's 30-second wait.

The snapshot hit its 64-file copy cap before both retention group journals and
stderr logs (157 and 76 bytes), and before the current proof's worker journal and
background log. No retention status file was inventoried. Async trace writes
are best-effort; silence does not prove all custody threads stopped. The missing
journals/logs prevent choosing between compressor/native custody failure,
filesystem or scheduling delay, and a wait-budget mismatch.

Round 8 fixes that diagnostic selection defect, prioritizing bounded retention
work directories and current-proof custody over historical receipts, and adds
capture at the original post-driver assertion before cleanup. It keeps all
capture/privacy limits and both wait guards. The next macOS reproduction should
retain `post-driver-timeout` alongside `test-guard`, including those stderr and
group records. Use their birth identities for any further process inspection;
do not infer ownership from bare PIDs or empty lockfiles. Both original EM
tickets and this incident remain open pending macOS evidence.

## 2026-10-08 — EM round 9: macOS deadline parking and fixture priority (still open)

The six-run soak of `e408e47929` passed wakeup 22/22 and five background runs
95/95; run 6 was 94/95. Its retained drain-timeout snapshot shows a delivered
wakeup, a claimed scan, 39 compression commits, then the explicit 30-second
work deadline and a parked claim. Cleanup completed at 30.936 s; no queue
lease was leaked. The drain check correctly refused the remaining parked work.

Darwin's `taskpolicy -b -c background` reaches the observer/scan and proof
worker/driver, then their retention supervisor, worker and gzip descendants.
The 15.782-second initial gap and slow compression are consistent with CPU/I/O
throttling; the archive does not contain kernel throttle counters. Production
priority, parking and next-export recovery stay unchanged. Automatic progress
continuation would need a reliable progress receipt and retry/cleanup semantics;
lossy diagnostic events cannot authorize another work budget.

A debug-only, exact-value fixture override now skips the two launch sites'
background policy; semantic assertions, fault dispatch and both wait bounds
stay unchanged. Separate Darwin tests require policy 1 with the override
removed and policy 0 with it set. Linux validates command selection and release
inertness; the operator will run the real Mac policy probes and soak. This
snapshot does not attribute every earlier timeout. Keep this ticket open until
that qualification, along with the other maintenance/incident tickets.

[Round-9 evidence, implementation, controls and exact mini commands](../snapback4/reports/20261008-em-export-maintenance-priority/REPORT.md).
