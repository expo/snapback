# MP round 3 — validation and failure attribution

Commands run in this worktree's `snapback4/` workspace unless specified.
Existing toolchain and local build cache; no installation. Logs are compressed
losslessly after capture. The counterfactual script emits `.log` before packaging.

| Command | Evidence / result |
| --- | --- |
| `CARGO_BUILD_JOBS=8 cargo test -p snapback4 --test dev_refusals -- --nocapture` | `process-first.log.gz`: 12 passed |
| `CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 cargo test -p snapback4 --no-fail-fast --bin snapback4 --test dev_refusals --test clock --test maintenance_chunks --test replay` | `affected-host.log.gz`: 246 passed, 4 existing ignored |
| `CARGO_BUILD_JOBS=8 cargo test -p snapback4-lang --no-fail-fast --test guide --test mp_reproduction` | `guide-mp.log.gz`: guide 97 passed / 1 failed; MP 18 passed |
| `CARGO_BUILD_JOBS=8 cargo test -p snapback4-lang --test guide` | `guide-final.log.gz`: 98 passed after exact generated-path correction |
| `python3 reports/20260928-mp-modeling-papercuts/round3/counterfactual.py` | `counterfactual.log.gz`, `mutation-{asset,job,filter,object}.log.gz`: all four runtime failures detect removed repairs; exact source bytes restored |
| `CARGO_BUILD_JOBS=8 cargo test -p snapback4 --test dev_refusals` | `process-final.log.gz`: restored implementation, 12 passed |
| `CARGO_BUILD_JOBS=8 bash scripts/build-wasm.sh` | `wasm.log.gz`: 2,019,925 raw / 586,252 gzip; exit 1, unchanged 59 B inherited overrun |
| Repository root `./ref-check --verbose` | `ref-check.log.gz`; final outcome appended below |
| `git diff --check`, changed-source line counts | pass; every changed source below 1,500 lines |

## Every observed failure

- **Ours, read-only exploration:** initial bulk journal/corpus reads exceeded
  output limits; targeted reads recovered the scoped contents. Several guessed
  source/test/doc paths did not exist (why, assets, clock, serve, jobs-card,
  published-guide and LLP 3000.014 paths); located the real files using rg.
  No state changed from these command errors.
- **Expected integration conflicts:** the read-only merge check and subsequent
  merge reported JOURNAL.md and LLP 3000.028 conflicts. Resolved preserving both
  journals and both revision histories, verified before committing the merge.
  Main had moved, satisfying the user's conditional merge instruction.
- **Ours, MP/EX integration:** whole guide's
  `client::published::published_file_references_resolve_against_package_contents`
  reported `.snapback4/dev-refusals/<storeId>/<instance>.json` as unshipped.
  This is MP's pre-round generated application file, newly checked by EX's
  merged guard. Added that exact path to APP_FILES and a positive example;
  no general exemption, removed assertion or path-matching relaxation.
  Final whole guide passes all 98 tests.
- **Ours, deliberate regression probes:** four intentional mutants fail their
  named process tests. Asset, job and object mutants leave the earlier record;
  the filtering mutant changes the stream after successful reads. Each is a
  runtime detecting failure, never a compile failure. No mutant remains.
- **Baseline/inherited:** wasm build exits 1 because 586,252 B gzip exceeds
  the unchanged 586,193 B ceiling by 59 B. Raw/gzip sizes and SHA-256 match the
  pre-round artifact and round-2 final measurement exactly. Round-3 delta zero.

No other affected product-test or environmental failure was observed.
The four existing ignored host tests were not requalified. No `scripts/test.sh`
invocation, budget change, full-suite claim, push or publication.

Final reference audit (exit 0):

`ref-check: ok — 522 LLP docs, 9811 refs in 28326 files, 0 errors, 0 unchecked`.
