# FL round 10 — complete retention process listings

2026-10-08. Based on round 9, `5932626f79`. Work stayed in
`~/sb4-intent/lane-fl` on eb1000 (`expose-builder-pixel`). No other host,
worktree or unowned process was used. Nothing pushed.

## Finding and fix

The user's macOS failure is consistent with the code: round 8 made the
coalescing test report `spawnSync` errors, exposing an older 1 MiB default
buffer on `ps -axo pid=,command=`. Previously the test could count a partial
table. Full command lines on a busy publication host can exceed that limit.

Both coalescing variants now call the same `retentionProcesses` function.
Its full-table listing has an explicit **128 MiB** capture limit: room for
32,768 rows averaging 4 KiB, or 20,000 such rows with about 50 MiB of headroom.
`-ww` also prevents `ps` from clipping command lines to a display width.
There is no finite cap that fits every possible process table: exceeding this
one still throws `TEST_FIXTURE_COMMAND_FAILED` with cause `ENOBUFS`, never
returns a truncated result to the assertion. A nonzero exit or signal also
refuses before filtering. The call uses the existing 900-second fixture work
bound and SIGKILL timeout termination; it is an owned leaf `ps` command.

The filter still uses the exact original fixture root and the three original
worker names. Every one of the 28 exports must still observe exactly one
matching process and the same pending observer, no native custodian directory,
28 initial evidence directories, and the original 5 full / 20 compressed /
25 total retained runs after draining. No retry, output slice, sampling or
relaxed count was added. Product behavior and the shared asynchronous runner
and identity helpers are unchanged.

## Scope and governing context

The orientation follows [LLP 3000's contention rules](../../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention)
and [LLP 3000.030 §15](../../../../llp/3000.030-native-proof-in-minutes.rfc.md#15):
retain outcome assertions, prove custody with completed observations, and do
not turn failed inspection into evidence of absence. The existing source
reference still applies; this correction needs no new design decision or LLP.
The report and append-only journal record the implementation and qualification.

## Complete synchronous-call audit

Audited every call, including calls inside generated fixture source, in the
eight test files and four helper/runner modules changed by round 8. The
[source census](evidence/sync-call-audit.txt) records the exact locations on
this revision. Line numbers below refer to this revision. Only the full-command
table needed a buffer change. Other default-buffer callers have output bounded
by a fixed fixture, not the host's process table, accumulated logs or a host
directory listing.

| File / synchronous sites | Output and disposition |
| --- | --- |
| `export-background`: `retentionProcesses` (683, previously inline at 691) | All host PIDs and full commands. Fixed to 128 MiB, wide output, checked transport and successful exit before filtering. Both coalescing cases use it. |
| `export-background`: `alive` (264); custody PGID reads (419, 627, 1071) | One selected PID's state or group number. Output stays one short row; transport errors already throw. No table-size exposure. |
| `export-background`: wrapper `invoke` (60), `status` (67), doctors (104, 293, 788), cleanup/contender (421, 776, 782, 822), refused worker (514), maintenance arm (1250) | Eleven sites. Fixture Expo emits no build log, publication/status print summaries, and doctor reads the fixture's empty schema/current result. Native cleanup writes diagnostics for a fixed fixture inventory. No host-table or growing log dump. Native background output goes to fixture log files. Existing checked transport errors remain. |
| `export-background`: `cc` (531, 928), `codesign` (553) | Two fixed small C sources and one private executable. Compiler/signing diagnostics are checked; no process or directory listing. |
| `export-background`: generated gzip (347) and publication dispatcher (934) | `stdio: 'inherit'` (plus lease fd where required); these calls do not capture output in a `spawnSync` buffer. |
| `export-failure`: `cc` (58), generated dispatcher (83), wrapper `run` (89), cleanup (109) | Fixed C source; inherited dispatcher output; small mocked Expo/native publication diagnostic; fixed fixture cleanup. The wrapper explicitly checks `result.error`, and compiler/cleanup require successful status. No host-scaled output. |
| `export-native`: bin-symlink `invoke` (81), Darwin preparation refusal (243) | The Expo fixture writes files without build logs. The Darwin case rejects `react-native.config.mjs` before toolchain discovery/prebuild/Xcode, printing its single compatibility diagnostic. No build or process-table output. |
| `export-publication`: `publish` (30), `cc` (60), lease (163) | One fixture export's receipt/diagnostic, fixed probe source, and one lease result. No host-scaled listing or log. Status/termination assertions remain. |
| `schema-capability-refusals`: `native` (27) | Fixed request arrays over the three small schema fixtures, each seeded with one row. JSON device replies do not grow with the host; errors still throw before parsing. Database dumps use SQLite directly, not a subprocess buffer. |
| `test-processes`: delayed real-ps fixture (81) | Already sets **16 MiB** explicitly and forwards the runner's short metadata table (`comm`, not arguments). The outer asynchronous runner refuses transport errors/nonzero status. No default-buffer exposure. |
| `test-file-runner`: delayed real-ps fixture (267) | Same explicit 16 MiB metadata listing. Unchanged. |
| `test-file-runner`: `execFileSync` shell fixtures (147, 168, 340, 440), double-fork shell (362) | Three print one PID; the fourth and double-fork emit no captured output. Sleep descendants redirect all streams; handoff markers/PIDs use private files. No host-scaled output. |
| `test-file-runner`: native self-group-kill baseline (637), reap-window `ps` (681) | One fixed Node test's small TAP output (transport error must be absent), and at most two `stat` rows (error/status checked). No whole table. |
| `test-signals.test.mjs` | No synchronous subprocess calls remain after round 9; timeout/capture fixtures use asynchronous helpers and explicit small buffers. |
| `helpers/fixture-command.mjs` | Generic `checkedSpawnSync` passes explicit options through and throws on every transport error, including overflow. Reviewed all its callers above. Its asynchronous sibling uses the owned-command helper's explicit 16 MiB cap and reports errors. |
| `scripts/run-client-tests.mjs`, `scripts/test-signals.mjs`, `scripts/test-work-bounds.mjs` | No synchronous subprocess calls remain. Darwin's asynchronous one-PID identity probe has explicit 16 MiB. Work bounds do not inspect or capture. |

Also checked the surrounding `test-command-group` and `export-native-round2`
tests: neither calls these synchronous APIs (the latter has an unused import).
Their shared process inspectors already have explicit 16 MiB limits, reject
transport/nonzero-status failures, and read short metadata. Full native build
logs are outside these fixtures; this audit does not claim a repository-wide
subprocess rewrite or macOS execution.

## Regression and negative controls

The new Linux- and Darwin-runnable regression replaces `ps` only in that
invocation's PATH. A real child emits roughly 3 MB: one matching row, 20,000
unrelated rows, then two matching rows covering the other worker names. The
assertion requires all three exact rows and the intended wide-listing argv.
Silently returning the initial partial output would falsely report a single
observer. The test then requires refusal for a failed `ps` after output and
for a real buffer overflow beyond 128 MiB. The fake tool has no descendants;
its synchronous invocations complete/reap before the fixture directory is removed.

[The focused regression passes](evidence/process-listing.log).
[Three private-copy controls](reproduce/process-listing-controls.mjs) run only
that regression and all fail at the intended assertion, with their owned
command groups drained ([summary](evidence/controls.log)):

- [Default buffer restored](evidence/default-buffer.log): the successful large
  listing throws `ENOBUFS` before the exact-row assertion.
- [Unchecked truncated output](evidence/silent-truncation.log): removing the
  buffer and transport/status checks loses the two trailing matches, so exact
  row equality fails.
- [Failed status ignored](evidence/failed-status-ignored.log): accepting output
  from the failed `ps` triggers “Missing expected exception.”

The controls never modify the suite's source. Temporary adjacent copies are
removed in `finally`; the reproducer uses the owned command helper and requires
successful group cleanup. No recorded-PID signalling was added. Existing
recorded-PID dispatch still has the previously documented small race between
identity inspection and the syscall; group/handle custody remains preferred.

## Verification

On eb1000 with Node 24.13.1, the prerequisite check prints
[`deps-ok`](evidence/deps.log). The real file runner passes all ten files:
**205 passed, 33 Darwin skips, zero failures/cancellations/leaks**
([full output](evidence/suites.log), [per-file counts](evidence/suite-summary.json)).
Export-background passes **64 tests with 32 Darwin skips**, including both
28-export coalescing variants and the new process-listing regression. The
remaining nine files pass 141 tests with one Darwin skip. The source and debug
binary were held fixed throughout ([hashes](evidence/source-hashes.txt)); no
Cargo build replaced the binary while workers were alive.

The separate focused regression and all three expected-failure controls also
pass. `./ref-check` reports **zero errors and zero unchecked references**
([output](evidence/ref-check.log)); `git diff --check` is clean.
The only deliberate failures are the three isolated controls. No synthetic
load or native Darwin execution is claimed for this round. The user's r9
Mac evidence is the reported trigger, not a qualification of this change.
The earlier round-8 maintenance/native-inspection tickets remain unresolved;
this scoped green run is not complete publication qualification.

## Reproduce

From `snapback4/`, with the existing debug binary and SDK build artifacts:

```sh
bash ~/sb4-intent/check-sdk-deps.sh
node --test --test-name-pattern='retention process listing' packages/snapback4/test/export-background.test.mjs
node reports/20261007-fl-dry-run-flakes/round-10/reproduce/process-listing-controls.mjs
node scripts/run-client-tests.mjs 3 files \
  packages/snapback4/test/export-background.test.mjs \
  packages/snapback4/test/export-failure.test.mjs \
  packages/snapback4/test/export-native.test.mjs \
  packages/snapback4/test/export-native-round2.test.mjs \
  packages/snapback4/test/export-publication.test.mjs \
  packages/snapback4/test/test-processes.test.mjs \
  packages/snapback4/test/test-file-runner.test.mjs \
  packages/snapback4/test/test-signals.test.mjs \
  packages/snapback4/test/test-command-group.test.mjs \
  packages/snapback4/test/schema-capability-refusals.test.mjs
../ref-check
```
