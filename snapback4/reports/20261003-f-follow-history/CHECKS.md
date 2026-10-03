# Lane F verification receipts

Base: `22f2207f3fadb355f2964ba0e463e002e16c3f07`.
Environment: eb1000, Node 24.13.1, Rust 1.97.0, Bun 1.3.14, locked Binaryen 132.
The final suite kept the shared `CARGO_TARGET_DIR`; used lane-specific
`RUSTFLAGS='-C metadata=sb5_f_follow_history'`, 16 compiler jobs, a real local
`target` data directory and a local CLI copy via `SNAPBACK4_BIN`. Test counts
and the suite's client/Rust concurrency policies were unchanged.

## Required full suite

Command, from the repository root:

```bash
bash snapback4/scripts/test.sh
```

Final stdout summary lines, verbatim:

```text
-- ok: cargo build (2 s)
wasm 2031763 B raw, 610487 B gzip (budget 610782: ok)
-- ok: wasm build (31 s)
docs budget: README 300/300 physical lines
-- ok: docs budget (47 s)
release guard: ok (web-device-check refuses the wasm profile)
-- ok: release guard (10 s)
-- ok: package typecheck (2 s)
-- ok: package build (3 s)
-- ok: chat app check (0 s)
-- ok: cargo test (825 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
-- ok: fixture wrapper tests (10 s)
wasm [
wasm moved survivor hidden=false: payload-bytes=655 identical-worlds=2 completions=1 key-at=100
wasm moved survivor hidden=true: payload-bytes=655 identical-worlds=2 completions=1 key-at=100
wasm unselected control removed=false: completions=1 key-at=1500 page-complete=true
wasm unselected control removed=true: completions=1 key-at=1000 page-complete=true
wasm empty groups: groups=5000 pages=158 max-response-bytes=119331
wasm written unselected round-trip=true: payload-bytes=836 worlds=2 p1-puts=3 completions=1 key-at=1000
wasm written unselected round-trip=false: payload-bytes=746 worlds=1 p1-puts=2 completions=1 key-at=1000
wasm membership collision kind=scope row-event=null: payload-bytes=663 identical-worlds=2 completions=1 key-at=1500
wasm membership collision kind=scope row-event=put: payload-bytes=789 identical-worlds=2 completions=1 key-at=1500
wasm membership collision kind=scope row-event=del: payload-bytes=650 identical-worlds=2 completions=1 key-at=1000
wasm membership collision kind=join row-event=null: payload-bytes=687 identical-worlds=2 completions=1 key-at=1500
wasm membership collision kind=join row-event=put: payload-bytes=813 identical-worlds=2 completions=1 key-at=1500
wasm membership collision kind=join row-event=del: payload-bytes=674 identical-worlds=2 completions=1 key-at=1000
wasm {
-- ok: client tests (686 s)
-- ok: client models (310 s)
== 0 failure(s) in 1916 s
```

Full stdout/stderr: [full-suite.log.gz](./evidence/full-suite.log.gz).
The 1,916-second elapsed time includes cold artifact isolation/rebuild and the
stock long-running oracles. It does **not** meet the command sheet's 60-second
time budget; no timing/publication qualification is claimed. The script
reported no failed checks. In particular, the full guide and all new history
regressions passed. No runtime meter or wasm size ceiling was raised.

Client package aggregate, verbatim:

```text
ℹ tests 5796
ℹ suites 0
ℹ pass 5786
ℹ fail 0
ℹ cancelled 0
ℹ skipped 10
ℹ todo 0
```

Client models aggregate, verbatim:

```text
ℹ tests 79
ℹ suites 0
ℹ pass 79
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Named client skips, verbatim (not counted as passes):

```text
﹣ Expo native media storage migrates MP4 filenames, decodes their URIs, and preserves cache lifecycle (0.532169ms) # requires macOS Foundation and AVFoundation
﹣ managed organization and invitation policy runs in the shared interpreter (0.942104ms) # set SNAPBACK4_B1D_MANAGED_BIN, SNAPBACK4_B1D_MANAGED_BIN_SHA256, SNAPBACK4_B1D_MANAGED_SCRATCH_PARENT to the pinned parent binary and a private scratch parent
﹣ managed OIDC profile binding orders and expires trusted email evidence (0.485709ms) # set SNAPBACK4_IDENTITY_PROFILE_SCRATCH_PARENT to an existing private directory
﹣ published 0.2.27 reference: four tasks with one and two search cursors (0.189294ms) # set BOUNDS_BINARY to the published 0.2.27 binary
﹣ published 0.2.33 rejects F2 stores, serving, backend opening and device adoption (0.538177ms) # set SNAPBACK4_F2_LEGACY_BIN to the published 0.2.33 platform binary
﹣ published 0.2.33 capability fence: timeline-v2 (0.575903ms) # the published 0.2.33 native witness requires darwin-arm64
﹣ published 0.2.33 capability fence: recorded-attribution (0.102013ms) # the published 0.2.33 native witness requires darwin-arm64
﹣ published 0.2.33 capability fence: maintained-column (0.074041ms) # the published 0.2.33 native witness requires darwin-arm64
﹣ published 0.2.33 control: capability-free bytes and stores stay compatible (0.074091ms) # the published 0.2.33 native witness requires darwin-arm64
﹣ new client syncs against the actual 0.2.32 server's deny_unknown_fields request contract (0.206159ms) # set SNAPBACK4_LEGACY_BIN to the published 0.2.32 binary
```

## Focused checks and scale runs

The three expensive scale targets are ignored by the ordinary test inventory
and were run explicitly. Measurement commands and ordered fixture setup are
in [REPORT.md](./REPORT.md#reproduce). Raw metric JSON, including the initial
unoptimized task-queue pilot, is under `evidence/`; wire capture and binary
sizes/digests are in [external-artifacts.json](./evidence/external-artifacts.json).

`cargo test -p snapback4-lang --test timeline_background`

```text
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.08s
```

[Full receipt](./evidence/background.log.gz).

`cargo test -p snapback4-lang --test following_history --test following_history_compat --test guide`

```text
test result: ok. 9 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 2.54s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.09s
test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.49s
```

[Full receipt](./evidence/final-affected.log.gz).

`cargo test -p snapback4-device --test following_history`

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.79s
```

[Full receipt](./evidence/fence-devices.log.gz).

`node --test packages/snapback4/test/following-history.test.mjs`

```text
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7549.646585
```

[Full receipt](./evidence/fence-process-wasm.log.gz).

`FOLLOW_HISTORY_OUT=... cargo test -p snapback4-lang --test following_history measure_skew_and_more_than_16384_heads -- --ignored --nocapture`

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 160.60s
```

[Full receipt](./evidence/scale-final.log.gz).

`FOLLOW_HISTORY_OUT=... cargo test -p snapback4-lang --test following_history measure_read_alternatives_and_device_pages -- --ignored --nocapture`

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 6 filtered out; finished in 13.03s
```

[Full receipt](./evidence/read-alternatives.log.gz).

`FOLLOW_HISTORY_OUT=... cargo test -p snapback4-lang --test following_history stress_scale_with_short_slices -- --ignored --nocapture`

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 588.08s
```

[Full receipt](./evidence/stress.log.gz).

`FOLLOW_HISTORY_OUT=... FOLLOW_HISTORY_ORACLE_ONLY=1 cargo test -p snapback4-lang --test following_history measure_read_alternatives_and_device_pages -- --ignored --nocapture`

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 0.73s
```

[Full receipt](./evidence/stress-oracle.log.gz).

`bash scripts/build-wasm.sh`

```text
wasm 2031763 B raw, 610487 B gzip (budget 610782: ok)
```

[Full receipt](./evidence/fence-wasm.log.gz).

The archived-base compatibility run also passed (`compat-base.log.gz`).
The current test embeds that captured control and checks equality on every
run. `compat-base.json` and `compat-final.json` are identical.

Both device measurement commands exited 0:

```bash
node reports/20261003-f-follow-history/tools/devices.mjs /absolute/output
FOLLOW_HISTORY_STRESS=1 node reports/20261003-f-follow-history/tools/devices.mjs /absolute/output
```

Their full JSON stdout is retained in `cold-devices.log.gz` and
`stress-devices.log.gz`; the scale replay passed all 100 complete pages and
then required withholding at the fixed floor on both actual hosts.

## Failure classification and repair

No failure remained in the final required suite or focused checks.

- **Ours, fixed:** normalized Work retirement could precede archive copies
  and produce a falsely complete third page. The scale oracle captured it in
  `stress-devices-false-complete.log.gz`. Version-3 streams now select the
  existing image publication barrier without requiring a local prediction.
  The strengthened memory/SQLite/process/wasm regressions and complete scale
  page oracle pass. Version-2 barrier selection is unchanged.
- **Environmental, fixed:** the preliminary suite's file-backed row-view
  targets refused the ignored `target` symlink. A real local data directory
  resolved the private-store check; the final full run passes all four
  affected targets. The exploratory run was interrupted when the publication
  repair superseded its binaries, and supplies no full-suite success claim.
- **Environmental, fixed:** a shared Cargo artifact collision produced a
  parser without the `experimental` keyword. The lane-specific metadata tag
  and local CLI copy prevent this lane's qualification from reusing that
  parser. The shared target directory is retained.
- **Development fixture mistakes, ours, fixed:** the fairness assertion gave
  the growing queue too few turns; the corrected 128-turn stress still adds
  arrivals on every turn and checks alternation and full original history.
  The dispatcher exposes `loading`, not the Rust outcome's `unavailable`;
  the actual-device tests now assert the dispatcher contract. An aggregate
  refusal is checked at engine schema validation rather than against an
  unused compiled view. Initial compile/API and command setup errors were
  corrected before the passing receipts; no such failed run qualifies code.

No inherited failure is asserted, so there is no unproven base-red claim.
The named platform/optional-binary skips above remain unqualified witnesses.

## Reference and change audit

The scoped LLP audit keeps .016's default, .026's start-now/5M ceiling, and
.007.003's slot/identity rules intact; only the new Review RFC selects the
experimental behavior. No guide/README surface was paved. Source files stay
within the 1,500-line rule (`engine/read.rs` is exactly 1,500).
`git diff --check` and `git diff --cached --check`: exit 0, no output.

Final `./ref-check --verbose` receipt is recorded below.

```text
ref-check: ok — 527 LLP docs, 10113 refs in 32536 files, 0 errors, 0 unchecked
```
