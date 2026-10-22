# Raw evidence archive

Host: **expo-build-450b** (`expose-builder-pixel-a`).

- Path: `/home/ccheever/sb4scale/archive/s1pg-20261022-snapback-postgres.tar.gz`
- SHA-256: `6733e6ceb659b5cdf9902ad7cb956f46019c86af52421b6d0e4aff8ebc4c03f7`
- Compressed bytes: 65,693
- Members: 168; every extracted member verified against [raw-manifest.json](./raw-manifest.json).

Contains original deployment refusals, every attempted probe group, all prepared-query
repetitions, tiny-counter before/after statement statistics and outcomes, logs,
launch/child PID receipts and cleanup. No 1M seed or W1–W5 load exists: deployment
refused first. Runtime deployments, worker state, databases, passwords and bearer
material are excluded. The two interrupted setup attempts and the socket-binding
retry refusal are deliberately retained.

Verify and regenerate, from `snapback4/experiments/scale-controls`:

```sh
sha256sum "$HOME/sb4scale/archive/s1pg-20261022-snapback-postgres.tar.gz"
mkdir -p target/s1pg-extracted
tar -xzf "$HOME/sb4scale/archive/s1pg-20261022-snapback-postgres.tar.gz" -C target/s1pg-extracted
"$HOME/sb4scale/s1sb-plot-venv/bin/python" scripts/report-postgres.py \
  target/s1pg-extracted/s1pg-20261022 target/s1pg-regenerated
```

The report's prose, RFC, ticket, final independent cluster/process audits and
this receipt are committed separately. The generator writes the numeric ledger,
RTT, diagnostic statement deltas, qualification/missing-evidence records and SVG;
paths in ownership and PID records retain their original locations. Source hashes
include the post-run deployment-directory correction, which changes repro
filesystem destinations only; request code and measured release binary did not change.
