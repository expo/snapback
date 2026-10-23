# Raw evidence custody

Host: **expo-build-450b** (`expose-builder-pixel-a`).

Path: `~/sb4scale/archive/s1pg3-20261023-snapback-postgres-b1.tar.gz`

Size: **3,351,574 bytes**. Files: **241**.

SHA-256: `d71dae85f64c4314c3fc3db4685372fda703b720499676d3b60627d20b841dee`.

The archive's root is `s1pg3-control/`. It retains every setup-controller
version, build/launch/exit log, PID ledger, host wait, native seed log,
completed trial, full histograms and per-second cohorts, before/after SQL
statistics, clean probe, six RTT captures, CPU/wait observations and the
operator stop. Original script/app/RFC/authority snapshots and the exact
adapted controller are included. Large raw data is not committed.

Private runtime/deployment directories are outside this tree. Passwords,
member/service tokens and remote private configs are excluded, then removed
from their owned setup locations after the known-secret scan. The original
private password files remain untouched. `reproduced/`, temporary previews,
Python caches, live archive output and internal work-state notes are excluded.
The [manifest](./raw-manifest.json) gives every archived member's size and
SHA-256; all 241 members and the container hash were independently
validated. Final post-analysis PID checks live in the committed report,
including short-lived helpers that ran after this snapshot was made.

Verify the container without extracting:

```sh
sha256sum "$HOME/sb4scale/archive/s1pg3-20261023-snapback-postgres-b1.tar.gz"
```

Offline regeneration of aggregate JSON and plots uses this checkout's
committed PG2 reporter/audit and historical inputs (same source as product
base `69ab3076b9`):

```sh
mkdir /tmp/s1pg3-extracted-NEW
tar -xzf "$HOME/sb4scale/archive/s1pg3-20261023-snapback-postgres-b1.tar.gz" \
  -C /tmp/s1pg3-extracted-NEW
export S1PG3_REPO=/home/ccheever/projects/sb4-s1sk
export S1PG3_OUT=/tmp/s1pg3-summary-NEW
python3 /tmp/s1pg3-extracted-NEW/s1pg3-control/summarize.py
python3 /tmp/s1pg3-extracted-NEW/s1pg3-control/finish-report.py
"$HOME/sb4scale/s1sb-plot-venv/bin/python" \
  /tmp/s1pg3-extracted-NEW/s1pg3-control/plot-results.py
```

No database, credentials, SSH or load is needed for those three commands.
Handwritten README/METHOD/PROVENANCE and final live custody receipts remain
committed explanations. The aggregate reproduction check compares the
qualification, ledger, curves, statement counts, RTTs, budget interpretation,
contention and counter audit. **Do not run `campaign.py`, `observers.py` or
`custody.py` against an extracted archive**: those are live operator actions,
not offline regeneration.
