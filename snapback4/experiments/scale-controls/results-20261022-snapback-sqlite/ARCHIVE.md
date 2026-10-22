# Raw S1-SK evidence archive

- Location on expo-build-450b: `/home/ccheever/sb4scale/archive/s1sk-20261022-snapback-sqlite.tar.gz`
- SHA-256: `0852a5a676a9d9e13766d4e6c746a86888b92a1264b8c662c725f16adf511d02`
- Compressed bytes: 10,340,505; tar entries: 1,443.

The archive contains complete original and continuation campaign captures,
including interrupted W3, seed/check/smoke evidence, launch/PID/exit-status logs,
build records, and `s1sk-measured-20261022`, the six-cell selection used by the
report. W1/W2 come from the original campaign; W3/W4/W5 come from the complete
continuation. No repetitions are selected from different cell attempts.
`ownership.json` retains both provenance manifests and the exact cell selection.
Private runtime stores, session files and control keys are excluded. The
prepared private fixture remains in this worktree's ignored target directory;
recreate it with the committed prepare command when needed.

Verify and regenerate the aggregates from extracted raw data (no load run):

```sh
sha256sum "$HOME/sb4scale/archive/s1sk-20261022-snapback-sqlite.tar.gz"
mkdir -p /tmp/s1sk-evidence
# Extract into an empty directory.
tar -xzf "$HOME/sb4scale/archive/s1sk-20261022-snapback-sqlite.tar.gz" -C /tmp/s1sk-evidence
python3 scripts/audit.py /tmp/s1sk-evidence/s1sk-measured-20261022
"$HOME/sb4scale/s1sb-plot-venv/bin/python" scripts/report-snapback.py \
  /tmp/s1sk-evidence/s1sk-measured-20261022 /tmp/s1sk-regenerated
```

Run from `snapback4/experiments/scale-controls`. The pinned plot dependency is
in `scripts/plot-requirements.txt`. Native source is implementation `b2917e7dd4`
with observer-only fix `c98041046c`; binary/request/Quarry hashes are identical
between the campaigns. Each cell records its detached replay command; the
parent README gives a fresh fixture and campaign command. Launch every replay
with `setsid nohup`, redirected stdin/output, record the PID and poll to exit.
