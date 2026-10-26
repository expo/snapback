# Integration 27 evidence

See the root `WORKSTREAM-REPORT.md` for the release and landing record. Feature source is `80411b9d8f` (0.4.43), fixture repairs are `c6874cb0b7`,
and incoming main is merged as `8eabb1f777`, then PostgreSQL-only Stage P as
`02cf700f71` (upgrade facts `f8e52af152`); subsequent evidence/report commits
add metadata only.
This directory records affected source verification and copied-store/schema
measurements. It does not qualify an npm publication or a platform release.

- `verification-summary.json` composes actual outcomes for the original 31-command
  selector plan: seven whole Rust packages and 446 client files. The canonical
  outer timeout exits 124 during the serial timer group; its raw receipt stays
  incomplete. The independently bounded client runner completes under supervision;
  remaining commands and repaired files run separately. `client-file-outcomes.json`
  records every final file exit, counts and superseded failures. The 18 Lean
  baseline disagreements remain an explicit nonzero oracle result.
- `affected-receipt.json.gz` and `affected.log.gz` preserve that actual execution.
  Earlier interrupted runs are supplemental only, retained in the external log
  directory; no incomplete or stale-fixture receipt is relabeled PASS.
- `survey-summary.json` classifies all 800 schemas against SEC10's source-bound
  baseline. `survey-final-summary.json` repeats all waves29/30 plus every prior
  refused project (117 copies) on the final native and checks verdict, FIX,
  disposition and witness-ID parity. `survey-final.json.gz` retains those outputs. `merged-main-summary.json`
  and its compressed outputs bind a further 117-schema / 150-store repeat and
  focused HTTP/proof tests to the final incoming-main native.
- `calibration-coverage.json` scores exact calibrated M holes, not unrelated
  questions. `replay-summary.json` and `replay.json.gz` retain the final 150-store
  replay, concrete security operations and independent row-shape assertions.
- `proof-load.json` binds ten complete serial-file runs to 16 busy loops on the
  same eight CPUs. `proof-injected-failure.log` records prompt failed-poll exit.
- `wasm.json` records GNU gzip/Brotli measurement and exactly 500 B headroom.
  `lean-baseline-comparison.json` compares all finding files byte-for-byte with
  the retained Integration26 baseline; unsupported cases are not passes.
- `provenance.json` binds source revisions, binaries and raw artifact hashes.

Feature-measurement native SHA-256:
`278210037b3e2adb503ab908d27529757c338cdbefb28624ae2f5ae1689446d5`.
It is the optimized Cargo test-profile CLI, with eight survey/replay workers and
concurrent host verification. The final merged-main native and timing method
are recorded in `merged-main-summary.json`. The later PostgreSQL-only delta,
its targeted checks and the final rebuilt artifacts are in `stage-p-summary.json`. Timing is not isolated production-build
metrology.
Only copies were opened; original wave stores were never opened with SQLite.
Ownership/token sidecars were excluded and temporary copies disposed after use.

Reproduction harnesses are included under `tools/`; their default paths describe
this run and should be adapted for another checkout. Full logs, initial 800-row
outputs, review runner output and baseline records remain at
`/home/ccheever/sb4-loop/reports/integration27/`. Reviews are verbatim under
`llp/reviews/3000.037.000-integration27-seam.*`: Muse READY; fresh Codex's two
findings corrected without inventing a subsequent READY verdict.

No publication worktree or `target/publication/` was touched. Packed five-crate
and installed-client qualification, qualify-linux, Mac, Exact and 20k/devices are
the publication's remaining work.
