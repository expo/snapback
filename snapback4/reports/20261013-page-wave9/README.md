# PAGE wave-9 qualification

Final reviewed semantic source: `f6025c0c91673039c7efe17525db3abdf81ab199`. Base: `e82bb70b97`.

The required four-crate command passed at `ee0e339c80c9a32e0cdcc163e24894246e6d6073`: **4,672 passed, zero failed, 30 ignored, 309 unfiltered harnesses**. Its four crate trees and Cargo manifests match the reviewed source. Exact commands, source objects, results and file SHA256 digests are in [verification.json](./verification.json).

Native20k: zero disagreements across1,166,103 executions. Lean20k: no new signatures; four retained families account for230 disagreements, with15,412 passed and4,358 unsupported. Lean exits1 for the retained disagreements; it is not a zero-disagreement qualification.

Lean proof, readauth census, strict wasm budget, client build, CLI notes and reference check passed. Final wasm is2,278,983 raw /690,290 gzip under690,790 budget. Final source changes and per-item decisions are in [WORKSTREAM-REPORT.md](../../../WORKSTREAM-REPORT.md).

Qualifying blind reviews are planner round19 and maintained/reference round12 under `llp/reviews/`, both Muse and fresh Codex READY. Formal guarantees remain scoped to declared witnesses, not physical discovery, expiry, resources or cursor safety.

Logs are gzip-compressed; campaign reports retain their exact machine-readable outcomes. `superseded/` contains completed failing broad attempts and the interrupted argument-pin build; these are not final qualification. Final focused29/13/59/9 outputs exist only in agent tool transcripts; no older filesystem log substitutes for them. The final Codex review independently ran190 focused tests, including29 native/Lean differentials.

[commits.tsv](./commits.tsv) lists all PAGE commits preceding the delivery-record commit. No push was performed.
