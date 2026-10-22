# Raw evidence custody

Host: **expo-build-450b** (`expose-builder-pixel-a`).

Path: `~/sb4scale/archive/s1pg2-20261022-snapback-postgres-2.tar.gz`

Size: **50,330,113 bytes**.

SHA-256: `a323eaa5e164524e7ca51098725c8661f6a782e73eba8548c0720ced87015773`

```sh
cd "$HOME/sb4scale/archive"
printf '%s  %s\n' 'a323eaa5e164524e7ca51098725c8661f6a782e73eba8548c0720ced87015773' 's1pg2-20261022-snapback-postgres-2.tar.gz' | sha256sum -c -
```

The archive's top directory is `s1pg2/`. It retains all setup/seed attempts,
interrupted cells, complete cells, detached launch logs/PIDs/exit markers,
source-at-launch snapshots, full histogram buckets, per-second cohorts,
role/database statistics, PG wait samples and CPU/WAL supplements. `campaign/`
contains relative links selecting twelve complete cells and the cross-trial
counter audit; all link targets are inside the archive. Internal `WORK-STATE.md`
notes are excluded. Private deployment/token/config directories are outside
this evidence root and excluded; the known-secret scan precedes archiving.
The seed/product/load binaries are identified by digests, not bundled.

Selection is two natural W1/W2 cells from `raw-final`, seven complete cells
from `raw-tail`, and three delayed write cells from `raw-writes`. Partial W3
and the first delayed W4 remain raw; neither substitutes for a complete cell.
[PROVENANCE.md](./PROVENANCE.md) records the retained failures, original
1,085.265 s seed, final 916.504 s seed, corrected helper provenance and recovered
760-increment abandoned-write offset.

Offline regeneration from a fresh extraction (no database, SSH or load):

```sh
mkdir /tmp/pg2-extracted-NEW
tar -xzf "$HOME/sb4scale/archive/s1pg2-20261022-snapback-postgres-2.tar.gz" \
  -C /tmp/pg2-extracted-NEW
cd /home/ccheever/projects/sb4-s1sk/snapback4/experiments/scale-controls
python3 scripts/combine-postgres-2.py /tmp/pg2-extracted-NEW/s1pg2 \
  --out /tmp/pg2-reselected-NEW
"$HOME/sb4scale/s1sb-plot-venv/bin/python" scripts/report-postgres-2.py \
  /tmp/pg2-reselected-NEW /tmp/pg2-report-NEW
```

Use the committed reporter and historical fairness/SQLite aggregate inputs from
this branch. [Plot environment](./plot-environment.txt) records the interpreter,
Matplotlib and font configuration. The combiner checks completed cleanup and
counter continuity. The reporter independently verifies every repetition,
arrival/HDR count, SLO/counter verdict and bracket, then exports twelve-cell
comparison, statements, latency/resource curves and steady-state plots.
Do not run the final custody helper against an extracted archive: it is an
operator action for the original run's recorded machine directories.

For new load, follow the [detached full-campaign recipe](../README.md) and choose
fresh owned output/socket names. The inherited per-cell `rerun` argv in raw
`cell.json` is generic control metadata, not an authoritative PG2 launcher;
`scripts/postgres-2.py` provisions/deploys/seeds the native PG application.

Committed stdout metadata strips trailing spaces; archived original stdout is
unchanged. The archived analysis-source snapshot precedes that cosmetic export
normalization; use the committed generator for regenerated summaries.
