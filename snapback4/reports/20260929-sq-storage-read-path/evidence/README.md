# Evidence map

`manifest.json` records each artifact's size and SHA-256. Gzip archives contain
ordinary UTF-8 JSON, JSONL, CSV or text, with deterministic compression metadata.
`inputs.json` identifies the base, fixture, build flag and binary/wasm digests.

- `*-curve.json.gz`: every raw read batch, response timings, meters, result
  hashes, completeness and host load. `control-before`/`control-after` are the
  final byte-identical production control. `before` is the original retained
  store baseline. `live-*` groups the per-checkpoint live files without
  resampling. `trace-*` wall times are diagnostic only.
- `summary.json`, `batches.csv.gz`: derived points, every frozen read-rule
  margin, and per-batch latency/load. No failed batch is excluded.
- `*.strace.gz`: complete buffer-suppressed strace plus syscall summary.
  `physical.json.gz` attributes complete, reconstructed calls to query threads.
- `*-diagnostic.jsonl.gz`: filtered numeric SQ_BEGIN/SQ_END/SQ_QUEUE records;
  other server log lines are excluded because dev can issue credentials.
- `live-summary.json.gz`, `live-host.jsonl.gz`, `live-writes.jsonl.gz`,
  `write-overlap.json`, `probe-delays.json`: per-read cache/wait attribution,
  live process load, observed commit changes and checkpoint receipt timing.
- `*-queues.json.gz`, `*-drain.json.gz`: backlog/drain observations. **The
  original `10%-queues` and `50%-queues` Following zero counts are invalid**;
  see FAILURES.md. Corrected snapshot samples have `replayed-` names and are
  observations at a later time, not retrospective replacements.
- `pf-*.jsonl.gz`: all seven read-only engine probes, effective pragmas, SQL
  plans/VM work and cache counters under six configurations at three scales.
  Their wall times overlap final compilation and do not qualify latency.
- `replay/`: complete action receipts, replay result and unchanged verifier's
  10%/50%/final proofs. The write rule uses these actual receipts.
- `subprocess-attempt/`: intentionally superseded partial replay. Its fresh
  Node startup contaminated immediate client latency; it is never pooled.
- `validation/`: complete build, affected/guide/full-suite logs, corrected
  initial failures and the final one-file handoff harness execution.

No private state, credentials, databases, dependencies or executables are
included. Do not commit whole ignored `target/sq/` trees to extend this archive.
