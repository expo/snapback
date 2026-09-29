# AQ validation and failure ledger

## Product checks

- Affected browser/client scope: **241 passed, 0 failed, 0 skipped**,
  295.894 s. This includes all `web-*.test.mjs`, `worker.test.mjs`,
  `server-clock-wire.test.mjs` and `sync-scale.test.mjs`, using the production
  binary. Earlier focused `web-review.test.mjs`: 14 passed / 0 failed.
- `witness/worker-protocol.mjs`: exit 0; all 48 protocol cases passed, including
  interruption during strict commits, offline reopen, claim custody and
  conditional commit authority. Full output is retained.
- Canonical wasm build, package typecheck/build, docs budget, release guard,
  and chat check passed in the required full invocation.
- `./ref-check --verbose`: exit 0, exact result
  `ref-check: ok — 523 LLP docs, 9852 refs in 28914 files, 0 errors, 0 unchecked`.
- Whole guide: **98 passed, 0 failed**, 2.23 s execution in the final run.
  Exact summary: `test result: ok. 98 passed; 0 failed; 0 ignored; 0 measured;
  0 filtered out; finished in 2.23s`. The earlier 98/98 run waited for the full
  inventory build lock; the final run includes the revised client card.
- Full suite: one invocation, exit 0, **`== 0 failure(s) in 1967 s`**.
  All stages passed. Client tests aggregate 4,565 pass / 0 fail / 10 skips;
  final seeded models 79 pass / 0 fail. No baseline or environmental
  product-test failures occurred. Full output: `evidence/full-suite.log.gz`.

## Introduced guide failure — ours, corrected

After adding the measurement recipe to the client card, the whole-guide run
failed `client::client_aliases_keep_typing_on_ephemeral`: the card exceeded
its existing 130-line limit (97 passed / 1 failed, 2.23 s). The client card now
keeps the expected times and measurement steps and points to the complete
public-API recipe in `guide sync`. The cap and test are unchanged; the final
card has 114 lines and the full guide retest passes 98/98. The failing output
is retained as `guide-card-cap.log.gz`.

## Deliberate negative control — ours, expected rejection

`SNAPBACK4_WEB_REVIEW_MUTANT=many-roots` exits 1. Two subtests fail, plus the
enclosing suite's aggregate failure:

1. `cold row batches use 64 bounded buckets in one strict transaction`:
   actual 256 reads / 256 bucket writes, expected 64 / 64. All rows and the
   one strict transaction remain present; this isolates the performance
   structure being pinned.
2. `a root split, later child writes and their conditional commit are atomic`:
   changing the hash to 256 roots prevents the planned root from splitting;
   consequently the injected split abort never fires and the expected
   rejected/unchanged result fails.

This mutant modifies only the test's private Vite source overrides. The
ordinary source and all ordinary affected tests pass.

## Exploratory/setup failures — ours, corrected before qualification

These did not enter the official paired samples or the suite result:

- Relative-path mistakes while running from `snapback4/` caused missing
  directory/file errors during initial evidence setup, the optional CPU SDK
  copy and a report-link edit. Corrected paths; an accidentally nested empty
  report directory was removed. No retained fixture was modified.
- Initial browser launch preceded the private server and got `E_OFFLINE`.
- The first harness called browser `Response.status` as a function; corrected
  to the property.
- An overbroad IndexedDB-name filter attempted to read the session authority
  database as a device database and got `NotFoundError`. Corrected to the
  exact public device-store name.
- Capturing `app.client` before authentication kept the obsolete facade and
  left the acquisition observer waiting. That owned run was terminated;
  observers now attach when the signed-in client is published. Initial
  first-screen observations made after `app.ready` are not used as earliest
  screen timings.
- An intentionally long temporary directory exceeded Chromium's Unix-socket
  path limit and caused SIGABRT. Reverted to the ordinary temporary directory.
- This pinned wasm-bindgen has no `--profiling` option. A symbol-preserving
  Cargo build plus ordinary `--target web` retains names. Early stripped
  exploratory profiles are not used for the reported category medians.
- The grouped-read experiment reduced request count but did not improve wall
  time; it was discarded. An `strace` run was too intrusive for wall-time
  comparison and is excluded. One preliminary phase run overlapped tracing;
  the final paired measurements replace that preliminary set in full.

The full-suite result is from this AQ invocation; previous lanes' failures
are not counted as this run's results. Its model tests intentionally log
`E_AUTH` refusals while exercising authority fences; every model test passed.

The existing 60 s suite budget is exceeded (1,967 s including cold inventory
compilation). No count, timeout, skip, ceiling or test was relaxed. There is no
unresolved introduced failure. The only introduced product-check failure was
the corrected guide-card length failure recorded above.
