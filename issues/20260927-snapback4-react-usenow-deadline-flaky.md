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
