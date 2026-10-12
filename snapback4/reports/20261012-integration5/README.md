# Integration 5 qualification evidence

Source merge: 4a011e26b56178e1c0b3abfdef7fcdae5fe12618.
Root inventory/Guide repairs: f540d8037fdcd2bd572fce1c5ce354cff8f025ec.

`quality-summary.json` records exact accounting, all final campaign counts,
corrective evidence, wasm size/headroom and independent review disposition.
Logs are individually gzip-compressed with deterministic headers; `.exit`
files retain original command statuses. Initial failed evidence is retained
where it explains a repair or corrective run; final logs are named explicitly.
Campaign subdirectories retain worker and aggregate JSON reports.

The full requested Rust command exits zero; captured summaries include nested
subprocesses, and overlapping rerun totals are not added. Regular client
qualification replaces one browser file's failed evidence with its passing
complete-file rerun. The timeout rerun is unchanged, as commissioned. All
actual review responses live under `llp/reviews/3000-integration5.*`.

No publication, push, macOS measurement or broader Lean/Postgres campaign
is claimed. Existing main follow-ups remain explicitly open.
