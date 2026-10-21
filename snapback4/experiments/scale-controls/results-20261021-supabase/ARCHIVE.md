# Raw S1-SB evidence archive

Raw per-cell data is excluded from Git. The archive is on **expo-build-450b**:

`~/sb4scale/archive/results-20261021-supabase-cells.tar.zst`

SHA-256: `b4bbd1c50f22cbe363a5abbb97962323da5a8c4b239a649cacf5692aad6c96c9`

17,592,995 compressed bytes; 467,009,688 source-file bytes,
compressed with `zstd -T4 -19`. `zstd -t` passes. Its digest is also appended to
`~/sb4scale/archive/SHA256SUMS.txt`.

Contents:

- `results-20261021-supabase-cells/`: all 132 cells, 524 rates and 1,572 trials;
  full intended-arrival/HDR JSON, original stdout, before/after SQL/WAL/I/O,
  waits, local and remote CPU/PID captures, RTT controls, effective configs,
  target/seed/storage records, full subprocess cleanup, summaries and figures.
- `s1sb-checks-final/`, `s1sb-capture-smoke/`, `s1sb-inspection/`: final JWT/RLS,
  atomic-maintain/overload checks, resource smoke and both-size seed fingerprints/
  RLS plans. `s1sb-checks-01/` preserves an earlier development check using
  JWT cache 0; it is not a measurement cell. The entire matrix and final checks
  use the verified shipped default of 1,000 cache entries.
- Matrix log, post-run inspection source, secret scan and initial reference
  check. The launch-ledger snapshot predates archiving; archive process PIDs
  remain in `~/sb4scale/s1sb-launch-pids.jsonl`.

No password, JWT signing secret, token file or role verifier is included.
The published secret audit checks all captured files; only configs, code,
aggregate summaries, provenance and SVGs are committed. All per-cell evidence
remains immutable in the archive. This archive includes the complete original
histogram buckets without the optional per-file gzip rewriting.

For example, extract outside the checkout and audit the retained raw cells:

```sh
mkdir -p "$HOME/sb4scale/review-s1sb"
tar --zstd -xf "$HOME/sb4scale/archive/results-20261021-supabase-cells.tar.zst" -C "$HOME/sb4scale/review-s1sb"
python3 scripts/audit.py "$HOME/sb4scale/review-s1sb/results-20261021-supabase-cells" --full
```

`report.py`, `compare.py` and `plot.py` regenerate the ledgers and SVGs from
these cells. Run them from the scale-controls directory; compare against
`results-20261021-raw-pg`. Versions, source hashes and exact cell rerun commands
are retained with the evidence. The derivation manifest records the later
multi-role statement aggregation fix; it changes SQL metrics, not load timing
or rate qualification.
