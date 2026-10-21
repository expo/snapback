# Raw advocate evidence

Raw evidence is retained outside Git on expo-build-450b:

- Archive: `~/sb4scale/archive/results-20261021-supabase-advocate-cells.tar.zst`
- SHA-256: `53e79c31b975a6ae40d6ebdbb6ccda5d13c430c5447629cee8a3f5155e63d74a`
- Compressed size: 14,818,181 bytes; captured file content: 518,617,365 bytes
  before tar padding/headers. `zstd -t` passed.
- Exact database-password, JWT signing-secret, SCRAM-verifier and bearer-token
  scans passed on all 9,501 input files. Secret/token files are excluded.
  [Scan summary](./secret-audit.json).

The archive contains the completed
`results-20261021-supabase-advocate-finish-cells/` (60 cells, 224 rates,
672 trials), with original trial stdout/HDR buckets, intended-arrival and
counter witnesses, before/after SQL/WAL/I/O snapshots, local/remote CPU,
wait/connection samples, RTT controls, per-cell effective configurations,
source/binary hashes, complete PID ledgers and exit statuses. It also retains
the fresh authorization checks, both-size seed/final-grant inspection, detached
supervisor/monitor source, logs and poll history. The process audit inside
the archive precedes the archive worker's own exit; the committed final audit
additionally verifies the finalizer and its children exited.

The interrupted Grok run (`results-20261021-supabase-advocate-cells/`), its
checks/probes and original log/PID ledger are preserved as historical evidence.
**No partial cells from that run contribute to this report.** Its working
source predated control commit `03e1ce4330`; the complete replacement run
records that commit in ownership.json.

Extract outside the checkout, then regenerate from the completed cell root:

```sh
mkdir -p "$HOME/sb4scale/review-advocate"
tar --zstd -xf "$HOME/sb4scale/archive/results-20261021-supabase-advocate-cells.tar.zst" \
  -C "$HOME/sb4scale/review-advocate"
cd snapback4/experiments/scale-controls
python3 scripts/audit.py \
  "$HOME/sb4scale/review-advocate/results-20261021-supabase-advocate-finish-cells"
# Python with matplotlib 3.11.2; uses the committed original control summaries.
"$HOME/sb4scale/s1sb-plot-venv/bin/python" \
  results-20261021-supabase-advocate/summarize.py \
  "$HOME/sb4scale/review-advocate/results-20261021-supabase-advocate-finish-cells"
```

Do not pass audit.py's `--full`: that option asserts the older 132-cell matrix.
The advocate summarizer separately validates the exact 60-cell set, three
repetitions, brackets and matched per-cell pool configurations. The original
[Supabase archive](../results-20261021-supabase/ARCHIVE.md) and
[raw-PG archive](../results-20261021-raw-pg/ARCHIVE.md) retain their independent
SHA-256 values. Only aggregate summaries, source/configuration and plots
enter Git; the archive includes the complete raw histograms without rewriting.
