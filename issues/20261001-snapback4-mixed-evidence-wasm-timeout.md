# Snapback 4 wasm mixed-evidence oracle can time out and retain its worker

Status: Open
Date: 2026-10-01
Scope: Snapback 4 client oracle / test cleanup; outside NX native witness changes

NX round 2's one canonical Apartment mini run reported:

```
✖ mixed evidence schedule wasm: 300 independent histories (1800125.008708ms)
  'test timed out after 1800000ms'
```

The process-host oracle passed all 300 histories in 185.856 s. The wasm case
reached its existing 1,800 s guard, stopped its owned backend, but left the Node
file worker alive with open handles. After retaining the timeout and verifying
the worker's PID, parent and start time, NX sent SIGTERM to that exact test PID
so the canonical script could collect the red and run its final model phase.
No test assertion, seed count or timeout was changed; the suite was not rerun.

Classification: **baseline client/oracle failure observed under contention**,
with the precise trigger unresolved. The oracle, generation/notification
helpers and client sources match NX base `5d5604a7f5` byte-for-byte. Round 1 on
this mini passed process 300/300 in 191.169 s and wasm 300/300 in 165.328 s.
Round 2 overlapped its earlier client phase with native control builds; that
scheduling is ours and may have exposed the existing race. Byte identity alone
does not establish the underlying cause, and the original red remains a red.

Evidence:
[round-2 report](../snapback4/reports/20261001-nx-export-proves-native/REPORT.md),
[complete log](../snapback4/reports/20261001-nx-export-proves-native/round2/full-suite.log),
[baseline input hashes](../snapback4/reports/20261001-nx-export-proves-native/round2/baseline-client-inputs.json),
[owned worker cleanup](../snapback4/reports/20261001-nx-export-proves-native/round2/suite-timeout-cleanup.json).

Follow-up: identify the pending wasm-oracle operation when the case stops making
progress, make timeout teardown close every client/worker handle, and retain all
300 histories and existing assertions. Do not lengthen the guard or reduce the
schedule as the fix.

Isolated follow-up on the same unchanged sources, after native builds and the
final timing cohort drained: **300/300 wasm histories pass in 176.905 s**
(`oracle-isolated.log`, exit 0). The 1,800 s guard and default 300 seeds remain
unchanged. This does not erase the original canonical red or identify its cause.
The original canonical summary is `== 1 failure(s) in 3501 s` (`client tests`);
its final model phase passes 79/79.


## FT investigation — 2026-10-08

Still open. FT ran the unchanged complete oracle repeatedly under confined
CPU contention with real neighbouring client files. Every repetition retains
300 independent process histories and 300 wasm histories, each with all three
schedules, the existing 1,800-second per-host guard and original assertions.
Final exact repetitions and measured durations are in the FT report below.
The timeout did not reproduce. SN changed one-shot settlement and FL/QF's
ordinary file runner now owns and drains descendant process groups; neither
fact identifies the formerly stalled operation or proves every oracle gate
settles. No seed/guard reduction or product change was made. Preserve this
as an unresolved oracle-progress failure rather than equating successful
Linux reruns with the original loaded Darwin event.

[FT commands, retained evidence and final counts](../snapback4/reports/20261008-ft-client-flakes/REPORT.md).
