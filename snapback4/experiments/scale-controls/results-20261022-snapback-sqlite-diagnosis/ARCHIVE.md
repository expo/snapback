# Raw evidence archive

- Host: expo-build-450b (local hostname expose-builder-pixel-a).
- File: `/home/ccheever/sb4scale/archive/s1dx-20261022-snapback-sqlite-diagnosis.tar.gz`
- SHA-256: `7adc302f284707965b139023854db34f3cd80ced4243686fe81e43cafa16c323`
- Bytes: 3,130,432

The archive contains `s1dx/bracket/` (33 unchanged-build trials),
`s1dx/layers/` (three direct-engine trials, the two SQLite primitive controls,
the timing build and three traced serve trials), build logs/digests, PID
receipts, resource samples, HDR buckets, flush events and final process/token
checks. Initial failed build/supervisor attempts remain visible. Bootstrap
Python scripts are omitted; reproducible experiment code is committed here.
No deployment database, bearer-token file or binary is included. Private
runtime stores and the restored local measurement patch backup remain in
this worktree's ignored owned targets. The patch is reproducible from the
committed instrument script and its recorded digest.

From `snapback4/experiments/scale-controls`, use an existing Python environment
with Matplotlib to verify and regenerate (the original environment is
`~/sb4scale/s1sb-plot-venv/bin/python`):

```sh
sha256sum "$HOME/sb4scale/archive/s1dx-20261022-snapback-sqlite-diagnosis.tar.gz"
mkdir -p /tmp/s1dx-evidence-NEW
tar -xzf "$HOME/sb4scale/archive/s1dx-20261022-snapback-sqlite-diagnosis.tar.gz" -C /tmp/s1dx-evidence-NEW
"$HOME/sb4scale/s1sb-plot-venv/bin/python" scripts/report-sqlite-diagnosis.py \
  /tmp/s1dx-evidence-NEW/s1dx /tmp/s1dx-regenerated-NEW
```

The reporter asserts every arrival/HDR/counter and stage/flush join before
writing `bracket.json`, `bracket.md`, `breakdown.json`, `breakdown.md`,
`layers.json`, `predictions.json`, `audit.json` and `bracket.svg`.
`--skip-plot` needs only the Python standard library. The README,
configuration, checks and custody summaries are curated alongside these
regeneratable aggregates. No benchmark is started by regeneration.
