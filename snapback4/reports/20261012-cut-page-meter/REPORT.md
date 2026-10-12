# CUT page/meter qualification — 2026-10-12

Both requested issues are closed. The root `WORKSTREAM-REPORT.md` records the
changes, commits, reviews, tests and bounded deferrals. This directory retains
machine-readable `QUALITY.json`, the final engine/device campaign reports and
compressed execution logs.

Final runtime: `51d1687277`, independently READY from fresh Codex and Muse.
Test-only tombstone correction: `1a6762efc8`. The exact requested complete Rust
command exits 0; `quality-green.log.gz` includes every target and doctest.
Superseded/incomplete and stale-expectation logs remain explicitly separate.

`run20k-qualified.json`: zero disagreements and generator errors.
`devices3k-qualified.json`: 210 inherited-signature disagreements, no new
signature or generator error; its exit-1 result is preserved. Earlier final
campaign JSONs retain matching counts and signature sets.

Actual web wasm: 2,192,440 B raw / 661,536 B gzip, −109 B from the 661,645 B
rebuilt base, within the unchanged 662,145 B budget. See `wasm-build.log.gz`.
Matching's pre-existing prefix-key heap gap is a separate open ticket; no
matching-meter parity claim is made by this ordinary-page correction.
