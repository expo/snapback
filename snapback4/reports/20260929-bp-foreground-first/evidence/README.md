# Evidence map

`manifest.json` records byte counts and SHA-256 for the explicit archive.
Gzip metadata is deterministic. Stores, bearer state, generated API, binaries,
dependencies and unfiltered server logs remain in ignored `target/bp/`.

- `live-{immediate,warm}-curve.json.gz` combines every unchanged checkpoint
  batch in monotonic replay order. Per-checkpoint originals are also retained.
- `summary.json` retains every point's p50, median batch p95, global maximum,
  pooled p95 separately, and all frozen rule margins for every batch.
- `batches.csv.gz` pairs individual batch p50/p95/max with host load.
- `server-diagnostic.jsonl.gz` contains only numeric SQ/BP records, operation
  names and Linux TIDs. BP_REQUEST preserves CPU for short-lived threads that
  `/proc` sampling misses. BP_BACKGROUND contains cumulative per-kind counts,
  CPU nanoseconds and wall nanoseconds on the one maintenance thread.
- `host.jsonl.gz` contains thread state, CPU counters, affinity, sampled
  runnable populations, host `/proc` counters and continuous queue observations.
- `process-host.jsonl.gz` adds server aggregate CPU, RSS, descriptor and WAL
  samples from SQ's observer, started after replay began. CPU counters are
  cumulative from process start, including exited request threads.
- `attribution.json.gz` contains derived CPU splits and per-probe paired
  client/total/wait/engine/CPU times. No subtraction is called a proven OS wait.
- `*-queues.json.gz` are SQ's samples after each checkpoint's warm probes;
  `drain.json.gz` records the final three-empty-sample drain.
- `*-live-offset.json.gz`, `*-immediate-end.json.gz` and action receipts retain
  the distinction between last mutation settlement, probe hook entry and the
  end of probes. Snapshot/verification time can allow background progress.
- `replay/` retains all action receipts and the unchanged verifier's full
  entity/user/chat counts, spot checks, paging and write probes.
- `validation/` retains complete build, affected-test, guide and full-suite
  logs. The report distinguishes product-test failures from setup failures.

Kernel schedstat delay accounting was disabled. `hostRunnableOnSet` is a
sampled count of R-state tasks assigned to CPUs 0–9, including executing
tasks, not an atomic queued-only kernel trace. Host load/pressure are global.
