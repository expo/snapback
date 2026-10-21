# Raw per-cell results

The 132 per-cell directories (per-trial histograms, arrival logs, resource
captures; 817 MB uncompressed) are not committed. They are archived on
expo-build-450b at `~/sb4scale/archive/results-20261021-raw-pg-cells.tar.zst`
(59 MB, zstd -19), SHA-256
`80cfb9e0780741688602cc5a00b069c44d0fc1ebd8f68a3d230d17f8d72be0f1`.
Every summary in this directory (`ledger.json`, `curves.json`, the SVG
plots, `README.md`) was computed from them; the harness reproduces any cell
with the command listed for it in `README.md`.

Two superseded runs are archived the same way, beside it in
`~/sb4scale/archive/` (hashes in `SHA256SUMS.txt` there):
`results-20261021-generator-core1` (the load generator pinned to one core,
before it was given room outside the app cores) and
`results-20261021-smoke03`.
