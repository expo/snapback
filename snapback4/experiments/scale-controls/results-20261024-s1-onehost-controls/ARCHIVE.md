# Raw evidence archive

The raw campaign evidence is local, outside Git:

- Path: `/home/ccheever/sb4scale/archive/s1-onehost-20261024.tar.gz`
- SHA-256: `2ad9953ae6e01a790171e3778547e2703f4d0db9e991039f2833c03543ecb7fb`
- Size: 189,826,768 bytes
- Contents: 8,008 entries; all 615 matrix trial JSON files and 615
  lossless HDR companions, before/after counters, CPU/IO/waits, RTTs, affinity,
  PID ledgers, setup failures, smokes, frozen measured source and audits.

The final check independently recomputes the archive digest and verifies all
three systems' audit/cleanup/source records and every trial/HDR companion.
The archive contains no benchmark passwords, signing keys, tokens or other
known private values; [the scan](./secret-audit.json) runs before runtime
credential deletion. Raw evidence remains in place as well as in the archive.
Post-archive report receipts are committed here. No archive is published.

To inspect independently, extract to a new directory outside Git, then run the
unchanged trial auditor from the repository root:

```sh
mkdir -p "$HOME/sb4scale/s1c-inspect-NEW"
tar -xzf "$HOME/sb4scale/archive/s1-onehost-20261024.tar.gz" \
  -C "$HOME/sb4scale/s1c-inspect-NEW"
python3 snapback4/experiments/scale-controls/scripts/audit.py \
  "$HOME/sb4scale/s1c-inspect-NEW/s1-onehost-20261024/matrix-rawpg"
python3 snapback4/experiments/scale-controls/scripts/audit.py \
  "$HOME/sb4scale/s1c-inspect-NEW/s1-onehost-20261024/matrix-supabase"
python3 snapback4/experiments/scale-controls/scripts/audit.py \
  "$HOME/sb4scale/s1c-inspect-NEW/s1-onehost-20261024/matrix-convex"
```

`--summaries-only` on `s1-onehost-finish.py ROOT OUT --archive UNUSED` can
regenerate aggregate tables without credentials, services or archive creation.
Create `OUT`'s parent first. The original launch manifests retain inherited
legacy two-host rerun fields; use [the corrected commands](./replay-cells.json)
to run the one-host method.
