# External raw evidence

Private archive on expo-build-450b:

`/home/ccheever/projects/sb4-msuite/target-msuite/msuite-raw-20261024.tar.gz`

- SHA256: `d60c9a6c3c590652a1983368fe742fafd6379071ca86b1520f6ae6b1e4351f69`
- Size: 11,758,552 bytes; mode 0600.
- Source manifest: `raw/source-sha256.json`, 66 source snapshots, SHA256 `a2ea6e9393b87bfff9267f0c1b9b30d14c68a92f0e2f97609909517ec6598c99`.

The uncompressed evidence remains under `target-msuite/raw/` (mode 0700). The archive contains the raw measurements, plans, protocol witnesses, samples, environment/process evidence, closed first epoch and source snapshots described in [PROVENANCE.md](./PROVENANCE.md). No database data directory, account-token file or released executable is included. Executables are retained separately with the hashes in [provenance.json](./provenance.json).

The archived PID ledger is a snapshot taken during packaging; packaging exit and the final independent process/port audit occur afterward. [cleanup.json](./cleanup.json) records the post-package confirmation and archive hash. No owned benchmark process remains. The raw source and artifact checks used after packaging remain alongside the archive; they do not change its checksum. No raw logs are added to Git.
