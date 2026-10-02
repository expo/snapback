# Rejected wall-time pacing candidate

This exact source and binary were qualified and measured before replacing wall
elapsed pacing with thread-CPU pacing and removing the minimum pause. The
source patch applies to parent 3ed1e1c2c4; `custody.json` binds its changed source
and production executable. The final candidate is measured separately in the
parent directory. These numbers are **not** the final implementation's results.

All eight small mixed cells passed. Three combined Following cells completed:
0/48/96 busy drained 1,000 tasks in 103.094/88.923/386.570 s. Their raw samples,
summaries and logs remain. The 144-process cell was intentionally stopped before
its 30-minute guard; **it is incomplete, not passed and not a measured drain**.
Its in-memory latency/backlog samples were not flushed on SIGTERM. Its server
log and the generated stopped store remain (the latter ignored under target).
The three-entry aggregate summary was reconstructed from the three completed
JSON records already printed by the harness; per-cell raw samples were already
flushed. The controller marks the interrupted cell exit 143; `runner.exit`
retains the shell wrapper's observed termination status. No final 144-process
summary or latency sample set is fabricated.
No real 6,507-task trial started for this candidate.

The supplemental read-only check at Unix ms 1790925495418 found 694 tasks still
pending, roughly fourteen minutes into the cell; it took 2.958 ms and is not a
latency sample. A passive `/proc` snapshot at Unix ms 1790925681666 records the
bulk thread with 52.611 CPU seconds and 98.719 seconds waiting on the run queue.
Wall-time pacing charged time already spent off CPU and added a 1 ms minimum
pause to cheap or empty turns. This is **ours: an excessive pacing cost**, not
an environmental explanation that erases the observation. Both mechanisms are
revised before final qualification and fresh timing. The stop record and raw
scheduler/read-only observations remain alongside the incomplete run.

The one complete suite on this superseded source reports exactly
`== 2 failure(s) in 1561 s`; its environmental artifact mismatch, known baseline
fault-injection flake, and corrected development errors are all enumerated in
`FAILURES.md`. The final source receives its own single complete-suite run.
The initial scripts are retained as historical inputs; their relative output
paths originally targeted the round4 directory before this archive was created.
