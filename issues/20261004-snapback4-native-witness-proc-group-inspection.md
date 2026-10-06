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
