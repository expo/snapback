# S1-CX advocate raw evidence

The archive is on expo-build-450b at `/home/ccheever/sb4scale/archive/s1cx-20261021-advocate.tar.gz`.
It holds the 14-cell run directory: per-rate JSON, histogram buckets, Postgres before/after snapshots, wait and CPU captures, native metrics, service logs, PID records, and the derived ledger and figures. It contains no database password, private key, admin key, or JWT. Service logs are large because `RUST_LOG=info` at the high read rates. Summaries and plots in this directory are the git copy; the cell directories live only in the archive.

| Archive | Bytes | SHA-256 |
|---|---:|---|
| `s1cx-20261021-advocate.tar.gz` | 250,857,309 | `b67b00373de97e8d7044bf8e7bbc8f786ef6638db9e9829a226a1cdceae30714` |

The measured tree was the working copy that produced harness binary `c70e0ab5ad52b153886fdb365dc28debda464d501ed6ac5532533c0bd6154b14`, recorded with parent commit `4a505a1210748e28b476a1e0e4f5ba6b4370db29` in [ownership.json](./ownership.json). File hashes in that ownership record bind the Rust, runner, and Convex sources that ran.

```sh
mkdir -p "$HOME/sb4scale/replay-s1cx-advocate"
tar -xzf "$HOME/sb4scale/archive/s1cx-20261021-advocate.tar.gz" -C "$HOME/sb4scale/replay-s1cx-advocate"
cd snapback4/experiments/scale-controls
python3 scripts/report-convex.py "$HOME/sb4scale/replay-s1cx-advocate/advocate-20261021"
python3 scripts/audit.py "$HOME/sb4scale/replay-s1cx-advocate/advocate-20261021"
"$HOME/sb4scale/s1sb-plot-venv/bin/python" scripts/plot.py "$HOME/sb4scale/replay-s1cx-advocate/advocate-20261021"
"$HOME/sb4scale/s1sb-plot-venv/bin/python" scripts/plot-convex-comparison.py "$HOME/sb4scale/replay-s1cx-advocate/advocate-20261021"
```

Plotting used matplotlib 3.11.2 ([plot-version.txt](./plot-version.txt)). Regenerating the SVGs can change internal ids without changing the data.
