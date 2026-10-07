# Snapback 4 native witness intermittently refuses a proc process-group snapshot

Status: Open
Date: 2026-10-04
Scope: Snapback 4 native witness / Linux process inspection
Related: LLP 3000.030; LLP 3000#publication-suite-under-contention

LU round 2's first full Linux suite, on merged main `2cc55e168c9` plus the
initial LU candidate, failed one CLI unit test:

```text
verbs::witness::preparation::tests::recovery_volta_style_shim_drains_late_group_member
preparation.rs:449:45
E_WITNESS_PROCESS: invalid /proc process group
```

The error occurs during idempotent recovery after the group's late member has
already drained. The CLI unit target reported 282 passed, one failed and four
ignored. LU changes delivery scanning and maintenance pacing, and does not
change witness code. The native witness parser in `recovery.rs` rejects the
process-group field of a readable stat snapshot before deciding whether its
process belongs to this group. This record does not retain that rejected
snapshot or identify the PID, so its contents, liveness and cause are unknown.
Do not infer a particular exit race, permissions failure or owned leak.

Ten isolated runs of the same test on the unchanged merged-main binary and ten
on the initial candidate all passed. Two complete CLI unit runs per revision
also passed. These controls do not reproduce the failure on baseline and do
not erase the first suite failure. They support investigating the unchanged
witness path separately, rather than attributing this diagnostic to LU.

The [LU round-2 report](../snapback4/reports/20261003-lu-live-update-latency/REPORT.md#round-2--wide-replay-fan-out-under-contention)
retains the failure excerpt, control records, final-suite disposition and raw
log hashes. The original large suite log is ignored at
`snapback4/target/lu-r2/full-suite.log` on eb1000.

Next: retain the exact non-environment stat snapshot and PID/liveness evidence
at the first native inspection refusal, then identify whether this is malformed
live metadata or a disappearing process. Preserve fail-closed ownership and
group-drain checks. The earlier
[QF JavaScript inspection ticket](closed/20261003-snapback4-malformed-proc-stat-during-stress.md)
addresses a separate parser and is not a resolution for this native path.

## FH recurrence, 2026-10-07

FH round 1's resumed Linux suite on `1b40450b39a` plus the internal Following
reader changes hit the same native inspection diagnostic in
`stalled_resolver_sigint_is_bounded_journalled_and_drained`, at
`preparation.rs:523:45`, during evidence retention after the resolver exited
and its launcher/descendant drained. The target reported 317 passed, one failed
and four ignored. The witness source is byte-unchanged from this lane's base.
The failed read's PID and stat bytes are not retained, so the cause remains
unclassified; this record does not infer an ownership leak or a kernel race.

The exact test passes on its first isolated rerun (1.33 s). The complete CLI
unit target also passes: 318 passed, zero failed, four ignored in 79.50 s.
These results and the complete suite disposition are recorded in the
[FH round-1 report](../snapback4/reports/20261006-fh-following-history/round-1/REPORT.md).
Raw logs `full-suite-resumed.log`, `witness-sigint-rerun.log` and
`cli-target-rerun.log` live beside that report. A passing rerun does not erase
the suite failure or close this issue. No inspection check is weakened by FH.

## FH round 2 recurrence, 2026-10-07

The full native suite on `8adc7879dd` plus FH round 2 again failed
`stalled_resolver_sigint_is_bounded_journalled_and_drained` at
`preparation.rs:523:45`: evidence cleanup refused an invalid `/proc` process
group after the resolver's launcher and descendant drained. The target had
317 passes, one failure and four ignores. Witness source remains unchanged;
the failed stat snapshot is still unavailable, so its cause remains unclassified.

The exact test passes its first isolated rerun (1.00 s), and the complete CLI
unit target passes all 318 tests with four ignores (37.23 s). The
[FH round-2 report](../snapback4/reports/20261006-fh-following-history/round-2/REPORT.md)
retains the full-suite failure and both rerun logs. No ownership inspection or
group-drain check was relaxed. This recurrence does not close the issue.
## 2026-10-06 — RO Round 3 recurrence

The complete RO Round 3 suite at implementation commit `63d6cf1400` reported
this same diagnostic in two CLI unit tests, at `preparation.rs:418:106` while
spawning the preparation process:

- `recovery_shell_shim_drains_final_empty_snapshot_joiner`
- `recovery_volta_style_shim_drains_late_group_member`

The target reported 324 passed, two failed and four ignored. The witness code
is unchanged from Round 2 head `929086afde`; Round 3 changes SDK session custody
and documentation. All seven `preparation::tests::recovery_` tests passed on one
unchanged rerun, followed by an entire CLI unit rerun with 326 passed and four
ignored. These reruns do not erase the full-suite failures or identify their
cause. No rejected stat snapshot was retained, and no separate baseline binary
was run in this round. Ownership checks were not changed.

Evidence is retained under
[`reports/20261006-ro-read-only/evidence/`](../snapback4/reports/20261006-ro-read-only/evidence/):
`round3-full-suite.log.gz`, `round3-witness-rerun.log.gz` and
`round3-cli-rerun.log.gz`. See that report's Round 3 section for the complete
run's final disposition.


## 2026-10-07 — RO Round 5 recurrence

The complete RO Round 5 suite from implementation checkpoint `16fa765c09`
reported the same diagnostic in
`preparation::cleanup_tests::direct_enumeration_resizes_and_keeps_births_in_the_selected_group`,
at `preparation.rs:224:26` during `keeper.cleanup().unwrap()`. The CLI unit
target reported 325 passed, one failed and four ignored. The Round 5 delta is
SDK session custody, tests and documentation; no native witness code changed.

The complete unchanged CLI unit target rerun passed 326 tests with four existing
ignores, using the full runner's one test thread and the same build inputs. This
does not erase the full-suite failure or identify its cause. No rejected stat
snapshot was retained and no separate baseline binary was run in this round.
Ownership and process-group checks remain unchanged.

Evidence: `round5-full-suite.log.gz` and `round5-cli-rerun.log.gz` under the
[RO report evidence](../snapback4/reports/20261006-ro-read-only/evidence/).


## 2026-10-07 — EM round 3: parked export maintenance with retained state

The four-core CPU/disk cohort's invocation 15 failed
`maintenance crash matrix: publication-handoff (off, next Expo fails)` after
104.99 seconds. The other three selected cases in that invocation passed. The
maintenance result records `E_WITNESS_PROCESS: invalid /proc process group`;
the strict 90-second drain check finds a parked claim after the observer exits.
Native work itself returned successfully in 142 ms, but its group cleanup
refused and left the `.retention-*` journal directory. The scan then recorded
the error and handed off with the claim parked, as designed for a known failure.

The [EM round-3 report](../snapback4/reports/20261007-em-export-maintenance-drain/round3/REPORT.md)
links the complete TAP and bounded failure snapshot. It retains queue/result
journals, trace timestamps and verified fixture-process observations. The
rejected `/proc` row itself is still unavailable: no claim is made about its
contents, PID, a disappearing process or an owned leak. EM changes queue wakeup
handoffs, not `recovery.rs` or native inspection. The recorded CLI is SHA-256
`121fde12ce9d73c073d3c25b963d05d054e2fb64f50d8d6cdec6e0dead67402c`.

This connects the known native inspection refusal to an observed maintenance
drain assertion, without identifying the earlier incidents' causes. Keep this
ticket open. No process-group or parked-drain check is weakened; the recurrence
remains a failure even if later repetitions pass.

## 2026-10-07 — FL round 2 recurrence

The FL round-2 affected witness-module run (one test thread) reported this same
diagnostic in `preparation::tests::recovery_volta_style_shim_drains_late_group_member`,
at `preparation.rs:454:45` during idempotent `recovery::cleanup`. Result:
71 passed, one failed. FL round 2 changes JavaScript test observation only;
native witness source is unchanged from its `fc9f9f2740` base. All three runs
used the same pre-existing test binary without rebuilding it.

The focused unchanged rerun passed, followed by a complete unchanged witness
module rerun with 72 passes. Neither erases the first failure. No rejected stat
snapshot was retained; the cause is still unknown. The failed fixture's recorded
runtime-resolution and preparation keepers/guardians were absent on inspection.
No ownership checks were relaxed and no other process was signalled.

Evidence: [FL round-2 report](../snapback4/reports/20261007-fl-dry-run-flakes/round-2/REPORT.md),
with `witness-unit.log`, `witness-focused-rerun.log`, `witness-unit-rerun.log` and
`failed-unit-process-check.json` in its evidence directory. This ticket stays open.
