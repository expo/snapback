# S1-FR raw evidence archive

Archives are retained on expo-build-450b under `/home/ccheever/sb4scale/archive/`.
No password, signing key or JWT is included. Raw keys/tokens stayed outside
these trees in mode-600 files. Only summaries/configs/plots are in Git.

| Archive | Bytes | SHA-256 |
|---|---:|---|
| `s1fr-20261022-fairness.tar.zst` | 41,997,476 | `5866873083782a8bc35ad9bcdcb549f7e553cd8be45e74f95d6e31ff69233204` |
| `s1cx-20261021-advocate.tar.gz` (reused Convex evidence) | 250,857,309 | `b67b00373de97e8d7044bf8e7bbc8f786ef6638db9e9829a226a1cdceae30714` |

The new archive contains `fairness-20261022/` (all 36 cells),
`fairness-checks-20261022/` (separate functional/overload witnesses), and the
two launcher PID files. Each campaign retains its per-cell manifests, every
rate/repetition result and original stdout with HDR buckets, before/after
Postgres snapshots, CPU/wait captures, effective PostgREST configuration,
service/tunnel logs, source and binary hashes, full PID ledgers and cleanup.
The supervisor's 15-second poll history and log are retained. No failing trial
was dropped. All runs were stopped before archiving.

The reused Convex archive has 14 original cells; the matched report selects
its 12 exact/mix headline cells, excluding its two labelled sharded variants.
The generator verifies its SHA-256 and re-reads every passing headline
repetition, rather than trusting rounded README values. Its full audit and
custody are preserved in the [original record](../results-20261021-convex-advocate/ARCHIVE.md).

From `snapback4/experiments/scale-controls/`, extract and regenerate without
starting any service or benchmark:

```sh
mkdir -p target/replay-fairness
sha256sum "$HOME/sb4scale/archive/s1fr-20261022-fairness.tar.zst"
tar --zstd -xf "$HOME/sb4scale/archive/s1fr-20261022-fairness.tar.zst" -C target/replay-fairness
"$HOME/sb4scale/s1sb-plot-venv/bin/python" scripts/report-fairness.py \
  target/replay-fairness/fairness-20261022 target/rederived-fairness \
  --convex-archive "$HOME/sb4scale/archive/s1cx-20261021-advocate.tar.gz"
```

The plot environment uses [plot-requirements.txt](../scripts/plot-requirements.txt)
(matplotlib 3.11.2). `report-fairness.py` invokes the independent all-trial
audit and the resource-ledger derivation, verifies method/cell identity,
regenerates the table, checks tail equality across all three repetitions,
and writes standalone SVGs. Source/binary and derivation hashes are in
[provenance.json](./provenance.json) and each campaign's `ownership.json`.
Manual interpretation, final process/cluster receipts and this archive
receipt are retained in Git, rather than regenerated as historical facts.
