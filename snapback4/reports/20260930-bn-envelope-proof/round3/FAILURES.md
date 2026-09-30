# BN round 3 failure ledger

No full suite was run. Final witness and guide checks are reported separately;
expected red controls and development failures below are not erased by passes.

## Expected detecting controls (round 2)

- `round2-rust-controls.log`, exit 101: new runtime UDID and artifact-reservation
  tests both fail against unchanged round-2 implementation. The filter also
  selected one unrelated existing scale test, which passed. Only tests had
  changed when Cargo compiled this control.
- `round2-node-controls.log`, exit 1: the real `byOwner(owner: principal)` query
  with `{"owner":7}` still emits the coverage advice, failing the new argument
  rejection assertion. This ran before the acquisition implementation edit.

These are expected reproductions of the two reviewed defects, not final failures.

## Development failures — ours

- An initial mechanical edit temporarily changed the `reject(value)` function
  declaration into an invalid parameter literal. `node --check` caught it;
  repaired before the helper tests executed. Output was in the tool transcript,
  not a saved log.
- One helper-edit/check command mistakenly used repository-prefixed paths from
  `snapback4/`: Python reported FileNotFoundError and two syntax checks reported
  MODULE_NOT_FOUND. Corrected the working directory; no environment defect.
- Preparation assertions initially expected target names, paths or rejected
  values. They now assert the fixed reason and, where previously expected,
  require the rejected path to be absent. Output containment, file preservation,
  HBC identity, admission and receipt checks remain; no workload or timeout was
  reduced. All failed cases in each saved attempt are listed below.

preparation-first.log:

- dangling final and ancestor output links refuse before an outside file can be created
- output audits follow symlinks before parent traversal, including within link targets
- preparation rejects wrong HBC versions and escaping outputs before issuing a build receipt
- compiler records cover spaced and macro includes, transitive dependencies and missing coverage
- all target outputs and symlink parents must stay private
- Pods graph audit refuses external search paths, config includes, phase lists and scripts
- linker records require products and refuse external frameworks including missing probes

preparation-fixed.log:

- preparation rejects wrong HBC versions and escaping outputs before issuing a build receipt
- all target outputs and symlink parents must stay private

preparation-final.log:

- preparation rejects wrong HBC versions and escaping outputs before issuing a build receipt
- all target outputs and symlink parents must stay private

- `witness-rust.log`, exit 101: `smoke_barrier_advances_only_the_commit_clock`
  expected the backend owner's address in a refusal. Updated to assert the
  command-authored store-ownership reason and absence of the address; all
  ownership, sequence and unchanged-row assertions remain.
- The same exploratory run failed the unchanged
  `lease_preserves_an_existing_owner_and_releases_on_drop` after owner drop.
  It also included a temporary extra subprocess test. That redundant new test
  was removed; Node preparation controls cover helper refusal output. The
  unchanged lease test passes in the final eight-thread witness run. A concurrent
  fork retaining the lock briefly is a possible explanation, not a proven root
  cause. Conservatively classified as our development test interference, not
  evidence of a baseline/environmental product defect.

No baseline or environmental failures are claimed. No existing test was removed,
no timeout or safety assertion was weakened. The initial gzip inspection used
Node zlib and an incorrect budget property; the report uses the repository's
actual `gzip -9 -c <file>` command and `gzip` budget field instead.
