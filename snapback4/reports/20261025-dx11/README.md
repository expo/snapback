# DX11 measurements and replay

Local implementation commits: 560dcebdbc (reviewed amendment), 35d24f0a37
(security/decisions/private refusal attribution), 0efdc7bdf1 (hooks/starter/proof
workflows). 67ffad2f78 merges fetched origin/main b2959e2455; only the append-only
journal conflicted, and both tails were preserved. No publication or push.

`measurements.json` contains all fifty schema-copy outcomes. Default output:

| Analyzer/output | Median lines | Median characters | Passing |
| --- | ---: | ---: | ---: |
| 0.4.41 baseline | 38 | 5300 | 50/50 |
| DX11 | 2 | 318 (approximately; elapsed-time digits vary) | 50/50 |
| Available SEC10 release | 58 | 9703 | 41/50 |
| SEC10 reports through DX11 renderers | 2 | 318 | 41/50 |

The SEC10 comparison uses its actual release binary and captured structured
reports, then DX11's production presentation functions. All nine pending gate
outcomes remain blocking; every captured code also has a durable renderer
regression. It does not qualify an integrated SEC10 build. The baseline and
SEC10 digests are retained in the measurement file. These measure output
volume, not throughput or a new builder-preference bakeoff.

`measure.py MODE BINARY` copies only Quarry sources, package metadata and lane
metadata from the read-only wave-28 apps into `/tmp/dx11-replay/MODE`. Both
controls start with fresh disposition state. Temporary replay trees are
removed after the workstream. No credential fixtures are copied.

`starters.json` records tarball installs, typechecks, builds and frontend proofs
for Expo, password web and password Expo. The packed probe:check test drives
its actual npm script for thirty seconds and verifies group/store release.
The packed picker test uses a real browser file selection. `clock018.json`
records lane 018's copied-schema advance/deploy/restart reproduction. Darwin
and native device execution are skipped as commissioned.

`checks.json` retains sanitized test summaries, including initial failures and
subsequent corrections. The full CLI run found an inherited store-port ratchet
red in untouched G7 files, now tracked by
`issues/20261025-snapback4-g72-store-port-ratchet-adapter-types.md`; no ratchet
allowance was changed. Root generated/guide/inventory checks require the
separate root dependency/generated-artifact bootstrap (acorn/typescript/ajv
and demo projections), which is absent in this Snapback-4-only setup. The
Snapback 4 guide suite, packaged docs, diagnostics and ref-check run separately.

The conservative affected selector expands shared inputs to seven Rust crates
and the complete client pool, explicitly prohibited by this brief. Run
`node snapback4/reports/20261025-dx11/run-scoped.mjs` for the disclosed bounded
execution; add --worktree to bind local edits. It retains the original plan
and writes a receipt with `fullSelectorPlanExecuted:false`. This scoped
receipt is not a publication/complete-battery qualification. The final receipt
and precise remaining limitations are recorded in WORKSTREAM-REPORT.md.
