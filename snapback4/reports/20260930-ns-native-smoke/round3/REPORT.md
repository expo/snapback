# Lane NS, round 3 — landing fixes

Merged `origin/main` **9d03e946232b4017564f3e7c6aa87bd424ce8d58**
(SL's landing) into the lane in **98ae0eb0a4**. The merge preserves both
append-only journal histories, every NS scenario, and SL's fixture watchdog.
The watchdog retains ownership through assertions, uses files for output,
and reaps its owned group on cleanup. NS's direct driver invocations and
listener-handoff control now use it too. The per-step budget is the published
120 seconds; independent guards remain 150 seconds for preparation and 600
for multi-step scenarios. `timeout-prepare` blocks with `signal.pause()` until
reaped, without a finite sleep that can expire under load.

All three requested findings are addressed:

- **Astra P3:** fixture directories are explicitly created at 0700 and
  ownership records at 0600. Unsafe-record/directory controls start from those
  safe modes, then apply only their intended symlink or writable-mode mutation.
  Product ownership checks are unchanged.
- **Grok Low 2:** iPhone generations parse their leading digits, including 17e.
  The newest generation wins; within it prefer plain, Pro/Pro Max, then other
  suffixed variants. Compare that numbered winner with unnumbered models such
  as Air using the runtime's supported-device order, later first (global type
  order only if the runtime supplies no list). Seven driver cases cover 17e,
  Air before/after the numbered winner, Pro, Pro Max, standard-model preference,
  and the older-device-last regression. Air cases deliberately reverse the
  global list to distinguish it from runtime order. LLP 3000.030 §13 is updated.
- **Grok Low 3:** failed backend `check` now points to `check-stderr.log`, whose
  first diagnostic is included in the error. The existing missing-schema/exit
  wrapper test also blocks code generation to force a child-check failure,
  verifies the actual canonical stderr path and diagnostic, rejects the stdout
  path, and confirms no install occurred.

The llp-orient skill was read from
`/Users/ccheever/projects/snapback-presence/vendor/llp/skills/llp-orient/SKILL.md`
(the lane's symlink is uninitialized). Scope: witness selection, preparation
errors and driver fixtures. Governing context: LLP 3000#4 (fence),
LLP 3000#publication-suite-under-contention (state barriers, independent guard,
cleanup assertions), LLP 3000.030#13 (selection/record custody and native scope,
in `llp/current/`), and LLP 2000.000#12 (measured loop). Rationale: preserve
ownership assertions while changing fixture scheduling, never use another
session's device, and keep native claims separate from fake-driver evidence.
The existing LLP needs only its selection paragraph/revision updated; no new
LLP or gate. No unresolved design question; hand-off: none.

## Reproductions and development results

Three expected negative controls ran before the corresponding fixes:
`control-umask-before.log.gz` rejects default-mode records under 0002;
`control-device-before.log.gz` selects 16 instead of 17e;
`control-check-before.log.gz` points to stdout instead of stderr. Each exits 101.
Their exact summaries are retained below, not counted as validation passes.
The adapted interruption control was also run against the saved round-1 CLI,
whose hash matches round 2's provenance. It still detects the checker holding
the port, before the recorded Node PID and guarded group are cleaned up (exit
101). `interruption-control.json` records the test/old/current binary hashes;
the current CLI was restored in a `finally` block and its digest checked.

The check-path assertion was then made canonical because the driver prints an
absolute artifact path, including macOS's `/private` normalization.

The first integrated driver invocation was **44 passed / 3 failed**:

1. **Ours:** numeric parsing alone let the lexical suffix `17e` beat `17-Pro`.
   Explicit Pro preference fixes that while preserving standard-model priority.
2. **Ours, merge adaptation:** the existing stalled checker exited at its own
   30-second deadline before the newly retained 120-second witness deadline.
   Its shell wrapper now starts the real Node checker as a child and waits;
   Node keeps the diagnostic pipes open after the wrapper is reaped. Readiness
   remains blocked until the witness ends startup. The exact timeout and
   listener-free assertions still run before cleanup of the recorded Node PID.
3. **Unclassified initial failure:** the existing-app refusal assertion failed
   without printing the actual diagnostic. The original log is retained; it
   does not establish a cause. A focused rerun with the earlier merged test
   executable passed. The assertion now includes stderr without relaxing the
   condition, and the subsequent complete runs exercise it again. No product
   defect or environmental cause is inferred from the isolated observation.

A few exploratory reads used the wrong relative path or an unmatched shell
glob; they changed no files. A name-only merge audit initially flagged the
pre-existing NS round-0 replacement of the old ambiguous-simulator refusal case;
a comparison accounting for that intentional automatic-selection change finds
all scenarios present. Both parents' final journal entries are verbatim. Compiler dead-code warnings are retained in logs.
No timeout, outcome assertion, cleanup assertion or source/wasm budget was
relaxed. No full suite and no new native timing run were required or run this
round. Earlier complete-suite/native results remain in their original reports;
this round makes no new native performance or full-suite qualification claim.

## Validation

All requested checks run on this Mac. Cargo commands use
`~/np-tools/node/bin:~/np-tools/bun/bin` on PATH and
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. Host/toolchain and
prompt/review hashes are in `host-and-inputs.json`. No real simulator was
created, booted, used, shut down, erased or deleted; `mini-verify-iphone` and all
other sessions' devices were untouched. No xcode-select/system setting changed.
Only fixture-owned processes and recorded PIDs were signaled.

Wasm rebuilt with `bash scripts/build-wasm.sh`:
**1,977,951 B raw / 593,592 B gzip**, **127 B** below the unchanged
**593,719 B** ratchet. The raw summary is retained in `wasm.log.gz`.

The requested ticket
`issues/20260930-snapback4-native-smoke-fixtures-device-choice-log-name.md`
was absent from `origin/main` at the merged commit, so there was no ticket to
update or close. All three items it names are resolved here.

Requested commands:

```sh
# Whole driver/protocol group, each under umask 0022 and 0002:
cargo test -p snapback4 --test witness
# Witness unit group, each under umask 0022 and 0002:
cargo test -p snapback4 --bin snapback4 witness::
# Starter and entire guide, under umask 0022:
cargo test -p snapback4 --test init
cargo test -p snapback4-lang --test guide
bash scripts/build-wasm.sh
# Repository root:
./ref-check --verbose
git diff --check
```

A final full 0022 driver repetition follows the last fixture-only refinement
that restores the original older-device-last ordering. The complete 0002 run
and final witness units already use those fixture bytes. Product logic is
unchanged between these successful driver runs. Initial and final units are
both retained; starter and guide results need no rerun for that fixture change.

Exact command outcomes and every test summary follow. Logs preserve initial,
expected-negative and final results separately; a focused pass never relabels
an earlier red invocation green.

Final required outcomes: **47/47 witness driver/protocol and 11/11 witness
units under each umask; 22/22 starter and 106/106 guide.** All exits 0.

`control-check-before.log.gz`:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 46 filtered out; finished in 0.77s
```

`control-device-before.log.gz`:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 46 filtered out; finished in 7.15s
```

`control-interruption-round1.log.gz`:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 46 filtered out; finished in 15.89s
```

`control-umask-before.log.gz`:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 46 filtered out; finished in 0.95s
```

`existing-app-investigation.log.gz`:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 46 filtered out; finished in 4.22s
```

`guide.log.gz`:

```text
test result: ok. 106 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.10s
```

`starter.log.gz`:

```text
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 14.81s
```

`witness-0002.log.gz`:

```text
test result: ok. 47 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 132.13s
```

`witness-0022-final.log.gz`:

```text
test result: ok. 47 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 132.10s
```

`witness-0022-initial.log.gz`:

```text
test result: FAILED. 44 passed; 3 failed; 0 ignored; 0 measured; 0 filtered out; finished in 147.57s
```

`witness-0022.log.gz`:

```text
test result: ok. 47 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 138.79s
```

`witness-unit-0002-final.log.gz`:

```text
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 207 filtered out; finished in 2.37s
```

`witness-unit-0002.log.gz`:

```text
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 207 filtered out; finished in 2.85s
```

`witness-unit-0022-final.log.gz`:

```text
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 207 filtered out; finished in 2.44s
```

`witness-unit-0022.log.gz`:

```text
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 207 filtered out; finished in 2.86s
```

Merge compile (`cargo test -p snapback4 --test witness --no-run`): exit 0.

```text
wasm 1977951 B raw, 593592 B gzip (budget 593719: ok)
ref-check: ok — 525 LLP docs, 9995 refs in 30421 files, 0 errors, 0 unchecked
```

Final reference audit after report/journal writing:

```text
ref-check: ok — 525 LLP docs, 9995 refs in 30425 files, 0 errors, 0 unchecked
```

The first staged diff check flagged the original Cargo logs' blank EOF lines.
Logs are now retained losslessly as `.log.gz` files (`gzip -dc` to read), with
original-byte hashes in `check-logs.json`. No evidence bytes were edited.
`git diff --check` and the staged diff check pass.

The report, one appended journal entry, LLP selection update and fixes are
committed locally with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing is pushed or published.
