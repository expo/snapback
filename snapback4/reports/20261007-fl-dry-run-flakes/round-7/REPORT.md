# FL round 7 — exact identity for the fixture's selected binary

2026-10-07. Base `d7e733d122`, branch `sb4-intent/fl-dry-run-flakes`.
Implementation and execution stayed in this worktree on eb1000. No other
machine, worktree or lane's processes were used. Nothing pushed.

## Diagnosis and change

The user's reading is correct. Round 4 introduced `signalFixture` with seven
command forms whose argv[0] was always the module's original debug binary.
The Darwin retention-overlap test copies that binary to
`<fixture>/snapback4-interposed`, adds `@loader_path/r.dylib` to its Mach-O load
commands, re-signs the copy, and selects it through `f.env.SNAPBACK4_BIN`.
Consequently its worker could not satisfy that identity check. No signal was
sent; the test failed before reaching its retention assertions.

The launch chain confirms the executable rather than merely suggesting it:
the export wrapper calls the fixture's shell CLI shim, the shim's resolver
selects `SNAPBACK4_BIN`, and native `background::executable()` uses
`std::env::current_exe()` for its worker and subsequent native children.
On Darwin `taskpolicy` execs the selected binary before that worker writes
its readiness record. The command being checked is the native worker, not
the shell, Node shim or taskpolicy launcher.

`signalFixture` and its seven command forms now live in
[`helpers/fixture-signals.mjs`](../../../packages/snapback4/test/helpers/fixture-signals.mjs).
Every recorded fault in export-background uses this helper. It binds argv[0]
to **the fixture's selected `f.env.SNAPBACK4_BIN`**, and paths to its `f.root`.
The default binary is canonicalized once before either launching or building
expectations. The root was already canonicalized at fixture creation; the
private copy is created under that same root. Thus macOS `/var/folders` aliases
become `/private/var/folders` at the source used for launch and expectations.
No observed argv is normalized, no alternate spellings are accepted, and
the anchored run/deadline patterns and complete argument counts are unchanged.

This is a fixture correction. Product code, native ownership/cleanup order,
all existing outcome assertions, strict non-sequence read comparison, state
waits, atomic PID publication and compiler group custody remain unchanged.
[Preservation hashes](evidence/preservation.json). The llp-orient context is
LLP 3000's publication-suite-under-contention section and LLP 3000.030 §15;
their ownership and exact-identity requirements still apply without a new
design decision or LLP change.

## Regression and safe negative controls

The new test in `test-signals.test.mjs` compiles a small native stdin-controlled
child, copies it to a different executable path, and launches the copy with
all seven witness command forms (eight vectors including both publication
modes). Native argv[0] is preserved; no shebang stand-in hides the distinction.
For each vector the real inspector and shared dispatcher accept the selected
copy, then refuse the original binary, a symlink spelling of the selected
copy, an alias spelling of the root, and a different root. Roots contain regex
metacharacters too. Numerical signal dispatch is intercepted throughout;
each child exits through its retained stdin pipe in `finally`.

Two private mutations prove the regression's sensitivity:

- Restoring a hardcoded original debug binary fails the positive dispatch
  with `expected fixture command required`.
- Canonicalizing the expectation arguments inside the matcher, which would
  accept an alternate spelling of the same inode, fails the required refusal
  with `Missing expected exception`.

Both controls fail exactly one selected test, clean up their children and
leave their command groups empty. No recorded PID is actually signalled.
[Control summary](evidence/fixture-negative-summary.json),
[original-binary failure](evidence/original-binary-negative.log),
[normalization failure](evidence/normalize-expectations-negative.log).
Reproduce with `node reports/20261007-fl-dry-run-flakes/round-7/reproduce/fixture-negative.mjs`
from `snapback4/`.

## Darwin case and branch audit

The scope is every script, test and shared helper changed by FL through round
6, plus this round's helper. [Source census](evidence/darwin-signal-census.txt)
records platform branches, binary overrides and dispatch sites. This is a
code audit on Linux, not Darwin execution evidence.

All **32 Darwin-only background cases** are covered below. Names identify
the source test or parameter matrix; counts expand every parameter value.
Every background fixture uses its canonical root for cwd, artifact paths,
mock tools and environment. Only the private-copy case changes its native
binary while dispatching a recorded fault.

| Background case / matrix | Count | Launch and identity audit |
| --- | ---: | --- |
| export publishes before smoke completes | 1 | Default native binary; status/doctor observers use it directly. Tool release is a private marker; no recorded signal. |
| new publication supersedes blocked smoke | 1 | Both publications use the same default binary/root; product supersession owns tool cancellation. |
| SIGKILL driver; SIGKILL/SIGTERM/SIGHUP worker | 4 | Native role records name `background-run` or `background-worker`; shared helper now derives argv[0] from that fixture's launch environment. |
| interrupting a status observer | 1 | Direct native status child; `signalChild` uses its captured complete argv/birth and retained handle, including cleanup. |
| background product failure stays loud | 1 | Default native launch and canonical-root xcrun; private completion marker, no signal. |
| failed evidence pruning | 1 | Default native launch; gzip shell fixture exits 99, with no recorded-PID dispatch to that interpreter. |
| driver death during auto-create-buffered-timeout; driver/worker death during auto-create-race | 3 | Fault targets the native driver/worker, not Python xcrun. Shared helper receives default binary/root. Copied simctl fixture explicitly removes its unused parent/group signal modes. Round-2 completion waits are intact. |
| explicit opt-out supersedes a proof | 1 | Native binary unchanged by opt-out; product supersession and private tool-release marker. |
| failed latest handoff, equal/changed export bytes | 2 | Same binary/root; failure injected at pointer write, no PID dispatch. |
| blocked retention after SIGTERM/SIGKILL/supersede | 3 | Native worker faults use selected default binary; compressor shell execs Node but is never matched as the worker. Teardown members signal their own group. |
| overlapping skipped export, marker/handoff failure | 2 | Node wrapper launched with `process.execPath`; preload changes filesystem behavior, not argv. Private resume marker and awaited wrapper exit, no recorded signal. |
| request timestamp at publication commit | 1 | Clock preload does not change binary or argv. Ordinary cleanup markers. |
| direct export-retain and manually rejected inner worker | 1 | Direct native child has captured spawn argv; cancellation uses its retained handle. Shell/Node compression descendants remain product group custody. |
| SIGKILL overlap with still-held retention lock | 1 | **Fixed.** Copied/re-signed binary and dylib are under the canonical root. Worker re-execs that copy; shared helper now expects exactly the selected copy. Load-command injection and assertions unchanged. |
| first-started last-published, off/non-macOS/background | 3 | Node wrapper/canonical paths; platform preload only chooses wrapper behavior. No manual signal; private resume and completed child exit. |
| failed handoffs with held leases, off/non-macOS/background | 3 | Same Node/native launch sources; filesystem preload holds leases. No signal; marker release and joined wrapper exits. |
| failed export lease / legacy ownerless runs, off/non-macOS/background | 3 | Temporary `lease-fails` shell either exits or execs the explicitly named original binary for initialization. Environment is restored after each invocation; no recorded fault while that script is selected. |

The four portable **before-driver custody** cases also have Darwin branches:
Linux alone preloads a fake platform, while Darwin runs the actual background
path and waits for xcrun readiness. Both dispatch to the fixture's selected
native worker. Neither platform substitution nor Node's shebang changes the
worker command. All seven before/after cases retain their state assertions.

The two portable **ownerless publication before/after exchange** cases select
a Node shebang dispatcher only in the spawned wrapper's environment. That
dispatcher explicitly spawns the original native binary with unchanged argv;
`waitForPublisher` checks that exact binary, source and destination. It does
not expect the script as the native publisher. Darwin selects a `.dylib` and
`DYLD_INSERT_LIBRARIES`; Linux selects `.so` and `LD_PRELOAD`. The private
barrier request still makes the publisher signal itself. Other maintenance
fault matrices use the default native binary; Python custody launchers
`execve` it with the exact same root/binary strings before writing their native
checkpoints. Read-only `alive`/ps branches never authorize a signal.

| Other changed file(s) | Darwin branch / dispatch audit |
| --- | --- |
| `export-failure.test.mjs` | No platform-skipped cases. The installed-shim signal child uses a Node shebang and signals itself. Publication dispatcher uses a canonical root, explicitly spawns the native binary, and forwards termination by signalling itself. `.dylib`/`-dynamiclib`/DYLD selection changes injection, not argv. Fake-Darwin wrapper selection runs on Linux too. Maintenance identity is observation only. |
| `export-native.test.mjs` | One Darwin-only static-adapter refusal launches `process.execPath` plus `prepare.mjs`; no fault dispatch. Portable wrapper-forwarding cases launch `node <parent.mjs>` and use captured child identity/handle. The npm-bin symlink case uses the same explicit native binary; no recorded signal. `skipReason('darwin', ...)` is pure data. |
| `export-publication.test.mjs` | No Darwin-only skip. The C probe omits Linux `-ldl` on Darwin; `[probe]` is exactly its spawn vector. Its uncanonicalized temporary spelling is passed unchanged to both spawn and identity, with no native self-relaunch. The inherited publisher is explicitly spawned with exactly the same binary/source/destination strings later checked. Node wrapper faults use captured child handles. |
| `test-processes.test.mjs`, `scripts/test-processes.mjs` | No platform skips. Darwin tables/UIDs/states and fresh identity lookup are read-only routing/metadata tests, not argv-based signal authority. Fake-Darwin reuse tests release an actual private keeper through its pipe. Real timeout/overflow commands use captured interpreter argv and retained handles on refusal. Signal-0 existence probes require a positive PID and confer no ownership. |
| `test-signals.test.mjs`, `scripts/test-signals.mjs` | No platform skips. Actual Darwin imports compile the native inspector under private group custody. Native snapshots preserve exact argc/argv and microsecond birth; executable-path header bytes are distinct from argv[0]. Direct shebangs capture the kernel-inserted interpreter; `node <file>` retains its complete vector. Simple `env interpreter script ...` permits only that exact exec transition, preserving the full script path and arguments. Other transitions fail closed. Mock-Darwin compiler/cleanup tests use self/group custody with no expected compiler argv. New copy/alias regression runs on both platforms. |
| `scripts/test-process-identity.c` | Darwin-only inspector never signals. It reads exactly argc NUL-delimited arguments, not ps display text or environment bytes, and rechecks birth. It does not rewrite `/var` or `/private`, interpreter paths or copied-binary names. |
| `test-command-group.test.mjs`, `scripts/test-command-group.mjs` | No platform skips. Subprocesses run through exact `process.execPath` vectors; fake compiler/frontends are Node files, with group cleanup requested over a pipe. Their recorded PIDs are used only for observation. Darwin keeps `X` live rather than using Linux's dead-X classification. No argv matcher or recorded signal in that branch. |
| `scripts/test-owned-command.mjs`, `test-command-owner.mjs`, `test-file-owner.mjs` | No Darwin-only branch. Private keepers inherit `process.execPath`/argument arrays and signal their executing group. Compiler paths, shebang insertion and macOS aliases do not become independently reconstructed signal targets. Leaf inspection timeout uses its retained handle. |
| `helpers/publication-barrier.mjs`, `publication-interposer.c` | JS helper delegates exact argv and birth to the inspector, then creates a private request. Darwin interposes `renamex_np`; Linux interposes `renameat2`. Atomic PID record and `raise` act within the same injected process, with no recorded-PID kill. |
| `helpers/app-server.mjs`, `avatar-fixture.mjs`, `read-through-server.mjs`, `timeline-recovery.mjs` | No Darwin-only branch. Each selects a binary once, spawns it, and cleans up through that tracked child. Identity uses the captured spawn/kernel argv rather than another module's default binary. Overrides and interpreter paths are not rebuilt at dispatch. |
| `helpers/live-margin-load.mjs` | Explicit Linux qualification helper (`taskset`, `/proc`), no Darwin branch. Busy-loop stdin and keeper stdin provide cleanup; recorded IDs are metadata only. |

The unchanged adjacent `export-native-round2.test.mjs` is also rerun. None of
these audited branches requires a relaxed command match. The only code changes
are the shared fixture binding, default launch-path canonicalization and its
regression. Owned groups/handles remain preferred; recorded-PID dispatch still
rechecks identity immediately before signalling and retains the small
exit/reuse race between that check and the kernel syscall described in round 6.

## Verification

- **Nine export/helper/runner suites: 194 passed, 33 platform skips**, zero
  failures, cancellations or runner leaks. Background is **63 passed / 32
  Darwin skips**. [Suite log](evidence/suites.log). This includes all five export
  files, test-processes, test-signals, test-command-group and test-file-runner.
- **Signal helpers: 9/9** in a separate final run after giving the new native
  fixture compilation the inspector's existing 30-second work allowance and
  a 120-second outer guard. [Final signal suite](evidence/signals-final.log).
  Identity and outcome assertions did not change with that setup allowance.
- **`dev_refusals`: 22/22**; source unchanged from round 6.
  [Rust suite](evidence/dev-refusals.log).
- Both new mutation controls fail at the intended assertion, release their
  children and drain their owned groups. No extra signal was sent.
- **`./ref-check`: one inherited failure**, the missing
  `#5.1-stage-1-a-generator-and-rust-against-rust-comparison` anchor in
  LLP 3000.035, referenced from unchanged difftest `src/lib.rs:3`.
  [Reference-check log](evidence/ref-check.log). No new reference error.

From `snapback4/`, with local binary/client artifacts and Node 24:

```sh
node scripts/run-client-tests.mjs 3 files packages/snapback4/test/export-background.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-failure.test.mjs packages/snapback4/test/test-signals.test.mjs packages/snapback4/test/test-command-group.test.mjs packages/snapback4/test/test-processes.test.mjs packages/snapback4/test/test-file-runner.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=6 cargo test -p snapback4 --test dev_refusals
```

Run `./ref-check` from the repository root. Darwin execution is reserved for
the user's Mac soak; none is claimed from Linux inspection or mocked-platform
coverage. The native Darwin inspector, Mach-O injection and all 33 skipped
cases still need that execution. No publication qualification is claimed.
