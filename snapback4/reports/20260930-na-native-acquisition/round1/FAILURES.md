# Round 1 failure ledger

Affected Rust (531 pass / one existing ignore), whole guide (107 pass), native
production/debug builds, wasm build, SDK builds, all 12 witness runs, physical
store comparisons and ref-check have no failures. The complete suite ran exactly once, exit 0:
`== 0 failure(s) in 1431 s`. All 13 stages pass; full-run failures are **ours 0,
baseline 0, environmental 0**. Rust 4,439 pass / 33 existing ignores; client
files 5,397 pass / ten existing skips; models 79 pass; fixture wrappers 9 pass.
No cancellations. The inherited nominal 60-second suite budget is exceeded,
without changing any limit. The initial affected SDK failure below is ours;
its corrected witness file passes 43/43 before the full run. No runtime assertions, seeds, timeouts or budgets were removed or relaxed;
the obsolete guide assertions were updated as described below.

Setup/inspection dispositions:

- Environmental workspace lookup: the initial guessed `lane-na.prompt.md` did
  not exist; used `lane-na.r0.prompt.md`. The local `skills/llp-orient` symlink
  targeted an uninitialized vendor checkout; searched and read the installed
  skill in `lane-bn/vendor/llp/skills/llp-orient/SKILL.md`. No task work was dropped.
- Expected integration conflicts: the requested merge reported three content
  conflicts (LLP 3000.007 revision header, append-only journal, bounds card).
  Resolved with both histories, NA's attribution and BN's final public receipt
  semantics. Merge committed before round-1 changes; no runtime conflict.
- Ours, progress inspection: one ad-hoc JSON read opened an in-progress empty
  acquire.json and raised JSONDecodeError. It did not change the witness or any
  artifact. Read only completed receipts for the final successful comparison.
- Preflight globs for optional local library/request paths and a nonexistent
  standalone reopen test filename had no matches. Located the existing paths
  and the reopen cases inside the device/acquisition suites; no test omitted.

- **Ours, affected SDK guide regression:** the initial affected run passed 380
  tests and failed `bounds names the known process-device apply defect independently
  from retention`. Its first failure was `/known performance defect/`; it also
  required BN's old 37.9/41.7-second profile and 35.5-second final call. The guide
  had replaced these with the new measured process and C ABI figures. Updated
  the existing regression to assert the merged 12.989/14.691-second medians,
  explicit unmet 10-second target, 9.552/8.833-second C ABI clocks, exclusion of
  server sync/IPC, Expo's ABI route and separate coverageVerifiedMs. This updates
  obsolete documentation expectations; no runtime/fault assertion, workload or
  timeout was removed. Original red: `affected-sdk.log`; correction checks:
  `guide-sdk-correction.log` and `witness-sdk-final.log`. The full-suite guard
  stopped before invoking test.sh on the red, so this was not a full-suite run.

- Ours, artifact accounting: the first artifact manifest used Python's gzip
  implementation and measured 596,897 B. Replaced that with the build gate's
  actual `gzip -9 -c <named-wasm-file>` command, which reproduces **597,059 B**.
  The product size gate and report always used the build log's value; no budget
  changed. This was a corrected evidence-method mismatch, not a test failure.
