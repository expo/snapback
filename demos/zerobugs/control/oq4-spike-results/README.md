# OQ4 coalescing measurement spike — run artifacts

Spike per `issues/20260808-oq4-coalescing-measurement-spike.md` (LLP 0191
"Author rulings" #4). Run 2026-08-08 on this branch
(`spike/oq4-coalescing-measurement`, base main 55566dc0a) on the M5 Max
primary machine, N=1 per arm — shape/existence evidence only under
`benchmarks/protocol.md` repetition rules; no variance or ratchet claims.

- Store: online-backup clone of the persistent 5,549,113-row
  `hot-diag-baseline` (`pragma quick_check` ok), one APFS clonefile per arm,
  every arm starting from the identical pristine image.
- Server: this branch's `target/debug/snapback`, `SNAPBACK_SPIKE_TRACE`
  JSONL enabled; control arms with `SNAPBACK_LIVE_COALESCE_DISABLED=1`.
- Client: `scripts/diag-hot-stream.mts` with the spike axes
  (`--arrival-mode`, `--observer-count`, `--observer-partition`,
  `--cycle-offset 10`), asserting the store's pinned LLP 0058 deployment via
  the ingest-era carrier (`OQ4_STARTUP_ARTIFACTS`); control sources are
  byte-identical since the v10 receipt commit a7f502691, so the pin is
  behavior-neutral.
- `oq4-analysis-12arm.txt`: full `scripts/analyze-oq4.mts` output (JSON +
  comparison table) over all twelve arms. Raw per-arm traces
  (client-trace.jsonl, server-trace.jsonl, server.log) live in gitignored
  fixture space `demos/zerobugs/fixtures-local/oq4-arms/` on the machine that
  ran the spike; the analysis file preserves everything the findings cite.

Findings and their disposition live in the closed spike ticket and the dated
2026-08-08 results note in LLP 0191 §1.
