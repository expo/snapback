# S1-CX raw evidence archives

All archives are on expo-build-450b under `/home/ccheever/sb4scale/archive/`.
They contain no credentials or executables. The final table selects only `final66/`;
the other runs remain separately archived as development/methodology history.
[Full verification](./archive-verification.json) recomputes all three hashes,
checks safe member paths and scans every decompressed member for retained secrets.

| Archive | Bytes | SHA-256 |
|---|---:|---|
| `s1cx-20261021-final66.tar.gz` | 147,147,282 | `6cea5bbc94d236e37b078b0b654f3dfd4e2e823236d1798b4b348299fbf27241` |
| `s1cx-20261021-history.tar.gz` | 122,412,775 | `093b1eaab66e098f4bac51b4aec5626e954555d9d85c808dde2e993d351c411d` |
| `s1cx-20261021-preflight.tar.gz` | 56,112,797 | `a07ffe034d78b7bf1457b20bea6855bf9475221675db1f89349aa1a7d7310d1f` |

- `final66`: all 66 final cells, original stdout, mergeable histogram buckets, before/after PG and native metrics, CPU/RSS/wait captures, native drain samples, both seed inputs’ hashes, complete PID/cleanup records, config/ownership/source proof, derived report/figures; detached launcher/log/polls and the own-database reset record.
- `history`: complete/partial `matrix66`, `matrix25`, `matrix12` and preliminary `uniform66` runs, their logs/PIDs/launchers and regression witnesses. None contributes a final headline or rate choice.
- `preflight`: installer/build/check captures, full seed export witnesses, source/default excerpts and detached-process records. Generated private keys, admin keys, passwords, JWT files, `.env.local`, binaries and regenerable seed JSONL inputs are excluded.

The final data was captured under commit `75ef46117d`; [source-proof.json](./source-proof.json)
checks critical Rust/runner/application inputs and the measured harness binary. Postprocessing
is identified by [derivation.json](./derivation.json). The final source function metadata and the
per-cell `cell.json` commands are authoritative. The inherited base ownership logger named
`scripts/run.py`; the reporter corrects it to `scripts/convex.py`, retaining its captured field.

Extract and regenerate from this checkout:

```sh
mkdir -p "$HOME/sb4scale/replay-s1cx"
tar -xzf "$HOME/sb4scale/archive/s1cx-20261021-final66.tar.gz" -C "$HOME/sb4scale/replay-s1cx"
cd snapback4/experiments/scale-controls
python3 scripts/report-convex.py "$HOME/sb4scale/replay-s1cx/final66"
python3 scripts/audit.py "$HOME/sb4scale/replay-s1cx/final66"
"$HOME/sb4scale/s1sb-plot-venv/bin/python" scripts/plot.py "$HOME/sb4scale/replay-s1cx/final66"
"$HOME/sb4scale/s1sb-plot-venv/bin/python" scripts/plot-convex-comparison.py "$HOME/sb4scale/replay-s1cx/final66"
```

The plotting environment uses the version recorded in [plot-version.txt](./plot-version.txt);
it may instead be installed from `scripts/plot-requirements.txt`. Archive hashes bind the
captured artifacts; regenerating figures may change SVG internal IDs without changing data.

The final full matrix starts from recreated **only** `sb4scale_convex_100000` and
`sb4scale_convex_1000000`, then imports the unchanged deterministic seed. The archived
`reset-own-databases.json` and launcher document this preparation. A single-cell replay
command is in each cell manifest; `--rates` can replay its recorded offered-rate grid.
Reusing a served database retains native version history and is a different starting state.
No recipe restarts/reconfigures the shared PostgreSQL cluster.

The backend is stopped. The [harness README](../README.md#s1-cx-native-convex-with-postgres-persistence)
records the native restart command and recorded-PID cleanup procedure.
