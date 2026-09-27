# Snapback 4: React useNow clock-advance assertion is intermittent under load

Opened 2026-09-27, lane FX. Outside the assigned flakes; deliberately not fixed.
Severity: test intermittency; product cause unconfirmed.

During instrumented baseline React runs, `useNow hides a server-answered row
at its deadline and after a clock advance` failed with:

```text
Error: clock advance repaints without another row answer: "bob"
```

Expected the expiring row to be absent. Seen in
`snapback4/target/lane-fx-evidence/react-diagnostic-02.log` (580.357 ms)
and `react-old-03.log`. The diagnostic changes only journal tracing; the
useNow runtime and test case are byte-unchanged from baseline `54099bc882`.
FX moves that case verbatim from `test/react.test.mjs` into
`test/helpers/react-harness.mjs` to meet the source-file size limit.

The complete fixed React file subsequently passed 20/20 loaded runs. This
is an intermittent baseline finding, not a demonstrated environmental error.
No assertion, timer or useNow product code was changed.

Reproduction attempt from `snapback4/`, with pinned tools and built package:

```sh
python3 reports/20260927-fx-flakes/repeat.py usenow-load packages/snapback4/test/react.test.mjs 'React hooks' 20
```

The driver runs five Node/Chromium processes at a time with eight CPU workers
on the same eight cores. This is a stress attempt, not a deterministic
reproducer. The FX report records the separate required full-suite outcome.

## 2026-09-27 — FX round 1 observation

The unchanged case failed again in
`snapback4/target/lane-fx-evidence/round1-mut-clear-04.log`, in 572.904 ms,
with the same `clock advance repaints without another row answer: "bob"`
assertion. That run deliberately removed only the journal listener's
`event.key === null` branch to qualify the new storage-clear regression;
neither the useNow case nor its runtime was modified. Four sibling control
runs passed useNow; all five failed the intended storage-clear regression.
The enclosing React parent fails when either child fails. This remains the
previously observed baseline intermittency, not an environmental diagnosis.
The assigned regression's mutation and this unrelated failure are recorded
separately in the [round 1 report](../snapback4/reports/20260927-fx-flakes/ROUND1.md).

After restoring the mutation, the complete React file passed 19/20 loaded
runs. `round1-react-04.log` failed this same assertion in 561.121 ms, plus
its enclosing parent; its other 46 tests passed, including both new round-1
journal regressions. The new regressions passed all 20 runs. No rerun was
substituted for the red result and no unrelated test or product fix was made.
Reproduce this exact stress group with the command above using label
`round1-react` and pattern `.` to include the new top-level listener test.
