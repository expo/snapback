# Round 6 reproduction and failure ledger

Base: `ac15813e7f` (round-5b control), branch
`sb4-np/nx-export-proves-native-slim`; round-5 implementation `adbabda71e`.
Astra's complete round-5 review was read at
`ccheever@100.65.137.99:~/sb4-intent/reviews/nx-r5.astra.md`.
No new independent review is claimed.

## Reproduction

From `snapback4/`, Node 24.x and the existing frozen workspace dependencies:

```sh
cargo test -p snapback4 --bin snapback4 verbs::witness -- --nocapture
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4 --test witness -- --nocapture
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build -p snapback4
node --test packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-failure.test.mjs
```

The first mini standalone checks inherited Volta's workspace Node 26.9.0;
the canonical suite explicitly pins Node 24.18.0. JS controls were also rerun
with that pinned Node; both logs are retained. The suite reruns all Rust units
and integration on the pinned environment.
The first mini unit run used the ordinary SQLite build configuration. Integration,
the rebuilt JS-test CLI and the single canonical suite used the packaged SQLite
flag above. The suite runs the final witness units again with that flag.
`run-suite.py` records its sole invocation, PID, exit status and wall duration.
It uses Node 24.18.0 and `caffeinate -i bash scripts/test.sh`; no guard or
concurrency override was supplied.

Linux used `/tmp/sb4-nx-r6.yhcFoC` on eb1000 (100.65.137.99), Rust 1.97.0,
Node 24.13.1, `CARGO_BUILD_JOBS=8` and the same packaged SQLite flag.
`source-transfer.json` binds the pre-commit source archive and affected files;
`fixture-transfer.json` binds the two supplementary existing benchmark inputs.
The built JS resolver was copied from the mini; it contains no native code.
`bun install --frozen-lockfile` supplies the actual Expo config dependencies.
Linux has no iOS execution claim. Its one JS skip is the existing Darwin-only
`react-native.config.mjs` static preparation adapter test (passed on the mini).

## Setup failures retained

- The first mini test launch had an incorrect relative log-directory prefix;
  shell redirection failed before Cargo ran. Corrected the directory and ran
  the affected tests. No test result was produced or omitted by that attempt.
- Linux's first unit build exited 101 because the source subset omitted
  `benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/source/snapback/{schema,windows}.q`,
  which are `include_str!` inputs of another test module in the same binary.
  Added those exact unchanged files; the retry passed all 30 witness units.
  Raw log: `linux-logs/rust-witness-linux-setup-failure.log`.
- Linux's first JS run: 16 passed, two failed, one platform skip. Both failures
  were `E_WITNESS_NATIVE_COMPAT` while evaluating actual Expo prebuild config:
  the new scratch tree had no workspace dependencies. Installed with the frozen
  lockfile and reran the identical four files: 18 passed, zero failed, one
  platform skip. Both raw runs and the install log are retained under `linux-logs/`.
  `linux-logs/status.txt` is the initial status, before dependency installation.

An initial scratch-cleanup command also had a shell-quoting error before SSH
ran; the corrected Python/subprocess invocation deleted only the named scratch
directory and recorded `linux-cleanup.json`.

These are harness provisioning failures, not changed product assertions. No
assertion, sample, budget, timeout or cache allowlist was weakened.

## Crash controls and limits

`witness_orphan_markers_recover_after_repeated_sigkill_and_retain_then_prune`
executes six cases: commit, rejected rollback and pre-destination-intent write,
each with existing/initially absent destination. It SIGKILLs the publisher after
the actual destination-marker unlink (or the earlier run-intent write), publishes
a later verified export, then SIGKILLs cleanup twice after private-tree removal.
Normal cleanup then clears the marker, retains compressed evidence and removes
the run after 31 newer completed-run fixtures. A committed receipt survives
compression; rejected/unpublished private exports do not. Later visible bytes
remain exact throughout. Cases cover unfinished and premature-finished records.
The second regression preserves live run/export/destination leases, matching
pending transactions, changed private identities and another run's pending intent.
The pause hooks are compiled only into the Rust test executable, not the CLI.

The lease regression runs in an isolated test process, verifies FD_CLOEXEC,
forks an intentionally blocked descriptor holder, drops the owner, asserts the
lease remains busy, then releases and reaps the child before reacquisition.
Production uses ordinary spawn paths with no waiting pre-exec callback; transient
fork inheritance may conservatively refuse/defer a contender until exec/exit.
The explicit wrapper fd-3 lease is intended shared custody and is unchanged.

No native simulator proof/timing cohort was run in round 6. All simulator
operations in integration tests use their fake `xcrun` fixture. No real simulator,
X27R worktree, user app or system setting was changed. `mini-verify-iphone` was
never selected or touched. No publication or push is authorized or performed.

## Scoped LLP orientation

Scope: `publication.rs`, `recovery.rs`, `preparation.rs`, their witness tests,
the witness guide card and this report. Governing documents are
[LLP 3000](../../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing),
[LLP 3000.030 §15](../../../../llp/3000.030-native-proof-in-minutes.rfc.md#15-export-proves-native-nx-round-0-2026-10-01)
and [LLP 2000.000](../../../../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md).
All three are linked from `llp/current/`; the Snapback 4 fence scopes out the
Snapback 1 foundation's gates. Active constraints/rationale: §15's publication
custody, receipt commit point, retention and honest-project boundary; LLP 3000
§4's fence/budgets; LLP 3000's “Publication suite under contention” test semantics.
Risks remain §15's documented Darwin PID-reuse limits and the unresolved social
timing qualification. Existing LLP/card/report/ticket updates and the append-only
JOURNAL entry cover this change; no new LLP or review panel is needed. Hand-off: none.

## Canonical result

Exactly one invocation: `== 0 failure(s) in 2253 s`, exit 0. Client pool
5,767 passed / zero failed / five existing skips; final models 79/79; guide
110/110; witness integration 53/53; complete CLI unit target 232 passed with
four existing ignored tests. The known delivery-fault `follow` injection flake
on this pre-fix branch did not reproduce; this is not a claim that it was fixed.
`delivery-fault-baseline.json` records the unchanged pre-fix harness inputs.
No canonical failure needs product attribution. The provisioning failures above
remain in the evidence; no failed run was substituted or relabeled as passing.

The complete log is content-addressed outside git as `round6/full-suite.log.gz`
through `EVIDENCE-ARCHIVE.tsv`. Its compressed bytes and decompressed raw SHA-256
were read back and checked. Wasm exactly matches round 5 (2,014,420 B raw /
604,666 B canonical gzip; unchanged 605,225 B cap).

Git whitespace checking flagged extra terminal blank lines in four raw Rust
logs. Only those blank lines were removed from the committed small-log views;
`small-log-formatting.json` maps their original/committed hashes. The original
bytes are preserved as four additional external `.gz` blobs. Linux validation
records the original hashes; affected-verification records both forms.
