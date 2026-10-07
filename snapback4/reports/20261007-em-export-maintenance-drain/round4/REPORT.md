# EM round 4 — integrate FL before review and the macOS soak

2026-10-07, Linux on eb1000 (`expose-builder-pixel`), in
`~/sb4-intent/lane-em`. Merge parents are EM
`df77cebc37e6faf5fd9d0da8ac4ee8ee4ef31081` and fetched `origin/main`
`2797247960867e7444f63ba0882dcad9d28d8378`. The merge was held with
`--no-commit` to resolve and verify it before committing. No other host,
worktree or lane's processes were changed. Nothing was pushed or published.

## Conflict resolutions

- `packages/snapback4/test/export-background.test.mjs`: keep FL's tracked
  spawn and signal helpers, publication barrier helper, identity-bound
  `signalFixture`, custody waits and Darwin cases. Add EM's evidence import,
  fixture watch, cleanup capture and `observedMaintenance` wrapper. Resolve
  binary selection by canonicalizing the selected EM override or default
  binary once before launch. FL still builds exact identity expectations from
  each fixture's `f.env.SNAPBACK4_BIN`, including the private Darwin copy;
  observed argv is never normalized. The drain predicate and 90,000 ms guard
  are unchanged.
- `issues/20261004-snapback4-native-witness-proc-group-inspection.md`: retain
  both appended sections verbatim, including EM's parked-claim recurrence
  and FL's process-inspection recurrence. The ticket remains open.
- `JOURNAL.md`: retain both complete appended histories verbatim, then append
  this round's integration record. No earlier entry is rewritten.

The [diff against main](evidence/background-vs-main.diff) shows the complete
combined background-test delta. [Preservation checks](evidence/preservation.json)
verify both parents' documentation sequences and byte equality for EM's
wakeup product code, diagnostics and regressions, plus FL's identity helpers.
The background file remains below the 1,500-line limit.

The governing context remains LLP 3000's publication-suite-under-contention
section and LLP 3000.030 §15. This merge changes no queue, retention or deadline
decision. Round 2's capture bounds, private evidence, identity checks and
nonblocking trace behavior remain intact. Round 3's two wakeup fixes and
deterministic barriers remain intact. Both maintenance tickets stay open:
the historical macOS failure still needs the operator's soak, and round 3's
separate Linux inspection refusal is still recorded without being attributed
to the repaired wakeup windows.

## Build and reproducibility

From `snapback4/`, `bun install --frozen-lockfile` passed without lockfile
changes, followed by `bash ~/sb4-intent/check-sdk-deps.sh`, which printed
`deps-ok`. Native build, `bash scripts/build-wasm.sh` and
`bun run --cwd packages/snapback4 build` passed. The wasm artifact is
645,448 bytes gzip against the unchanged 645,607-byte budget. Generated
build artifacts are not committed.

Native builds and Rust checks use
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=6`.
Node is v24.13.1, Bun 1.3.14, Rust/Cargo 1.97.0 and wasm-bindgen 0.2.127.
The native binary was copied to an immutable digest path before JavaScript
tests; no rebuild ran during those tests. Background, wakeup and diagnostic
fixtures selected that copy. Other export files used the identical default
debug binary. [Build identity](evidence/build-identity.json),
[tested source digests](evidence/source-sha256.json).

Each check has a `.json` command/exit/timing receipt beside its complete log
under `evidence/`, produced by [check.py](check.py). Rust logs are losslessly
compressed as `.log.gz`. The JavaScript command
runs eleven files through `scripts/run-client-tests.mjs` at concurrency three:
all five export files, wakeup, diagnostics, test-signals, test-processes,
test-command-group and test-file-runner. No synthetic load or mutation of
product code was introduced for this merge verification; round 3 retains
the loaded repetitions and the controls that remove each wakeup fix.

## Verification

All eleven JavaScript files passed through the shared runner: **205 passes,
33 Darwin skips, zero failures or cancellations**, and no runner leak or
inspection failure. [Complete suite log](evidence/suites.log),
[per-file results](evidence/results.json), [exact command](evidence/suites.json).

| Scope | Passed | Skipped |
| --- | ---: | ---: |
| Export background | 63 | 32 |
| Maintenance wakeup regressions | 6 | 0 |
| Maintenance diagnostics, including FIFO trace sink | 5 | 0 |
| Export publication / native / native-round2 / failure | 20 | 1 |
| test-signals | 9 | 0 |
| test-processes | 53 | 0 |
| test-command-group | 7 | 0 |
| test-file-runner | 42 | 0 |

The background file took 381.4 seconds. This includes the publication-handoff,
failed-export/dead-journal, retention-deferral and parked-recovery cases; none
exceeded the unchanged drain guard. The copied-binary identity regression and
its refusal vectors ran in test-signals. The two window regressions, additional
notification race and stop-condition checks ran in the wakeup file. Diagnostics
also checked capture limits, stale/wrong-group identities, a stuck collector
and partial-write accounting.

Rust checks passed **6 retention-filtered tests** (including the trace sink),
**25 recovery-filtered tests**, and **22 dev_refusals tests**. The broader name
filters include adjacent retention/recovery checks in other witness modules.
Their logs and exact commands are in `evidence/retention.*`, `recovery.*` and
`dev-refusals.*`. `./ref-check` passed with zero errors or unchecked references;
[final log](evidence/ref-check-final.log). Both the selected immutable binary and default
debug binary still matched the recorded digest after testing, and all 93
recorded source files retained their pre-test hashes.

The collector retained only its four recent cleanup snapshots. They are
archived with their private file modes in [snapshots.tar.gz](evidence/snapshots.tar.gz).
Every archived file was verified against its original bytes before removing
the round-specific unpacked copies; [manifest](evidence/snapshot-manifest.json).
These successful-run observations supplement the earlier failure/control
evidence; they do not identify the historical macOS cause or close either
maintenance ticket. Darwin execution remains the operator's next step.
