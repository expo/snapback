# WK round 2 failures and attribution

## Expected controls against our round-1 implementation

`regressions-before.log.gz` initially ran six new tests: the positive durability
control passed; five failed. Two removal cases first stopped at a fixture error
(**ours**): the ordinary query needed POST, so GET returned 404 rather than 200.
After correcting the fixture, `removal-before.log.gz` reproduced both requested
failures of **our round-1 implementation**:

- `removed worker retains query fence while deletion is locked`: HTTP 200 rather
  than 401 while the retired family still awaited deletion.
- `removed worker retains retirement custody while deletion is locked`: timeout
  waiting for the family marker to disappear after the writer lock was released.

The other initial controls correctly detected **our round-1 defects**:

- `restart refuses an entry symlink already rejected by discovery`: the rejected
  external entry executed and created the escape marker.
- `launch executes validated entry and helper bytes after source paths are replaced`:
  the delayed Node launch executed `escaped` rather than `validated` bytes.
- `watchdog SIGKILL terminates its Node group before replacement`: the first
  Node PID was still alive when its replacement started.

`mutant-durability.log.gz`: **0 pass / 1 fail**, the expected mutation-control
failure. A disposable copy of the compiled ledger changes FULL to OFF; the new
real-connection commit witness observes 0 rather than the required SQLite value
2. Product source and its compiled module were never mutated for this control.

Initial affected run: **68/68 pass**, including all six new witnesses.
Final affected run after Grok's completed review: **73/73 pass**.
Core effect-policy checks: **13/13 pass**, with named/manual seats exercised
through both owner and detached authentication. Whole guide: **98/98 pass**.
No intermediate product compile or final affected-test failure.

## Grok follow-up controls

`grok-before.log.gz`: **1 pass / 4 fail** against the pre-follow-up round-2 binary.
The busy-open positive control passed. All four failures are expected controls
of **our implementation**, retained without relabeling:

- New-declaration retry timed out after repairing Node without a source edit.
- Direct watchdog SIGTERM, SIGINT and SIGHUP each exited with its Node PID alive.
  These fixtures exercise a watchdog without a live supervisor fallback.

`mutant-open-busy.log.gz`: **0 pass / 1 fail**, expected mutation-control failure.
The disposable ledger changes only the open-path busy-code comparison. Opening
while a real writer holds the lock fails with `database is locked` rather than
waiting for rollback. The original module passes.

All five follow-up tests pass within the final **73/73** affected run. The
locked-removal test also requires mutation and refresh HTTP 401 while deletion
is still blocked. Updated whole guide passes **98/98**. No ceiling or timeout
was increased.

## Setup and command errors

Initial required merge had journal and worker-constructor conflicts; retained
both journal sides and main's managed-cleanup rename with all round-1 fields.
Some orientation reads guessed absent paths and two were excessively broad,
causing output truncation; repeated scoped reads of actual governing files.
Two checks initially used report paths relative to snapback4 from the repository
root and failed at shell redirection before the test ran (**ours**). Reran each
from snapback4. No environment or credentials were changed.
Two exploratory gzip-library measurements (Python gzip and Node zlib) differed
from the project's canonical compressor; neither was a qualification failure.
Corrected wasm.json to use the actual build command, GNU `gzip -9 -c`, which
matches the suite's 592,975 B result.

## Additional host-unit verification

The first `cargo test -p snapback4 --bin snapback4` invocation used Cargo's
ambient test concurrency instead of the canonical runner's two threads. It
reported **200 passed / 3 failed / 4 ignored** in `host-final.log.gz`:

- `serve::tests::adoption_tests::reads::adoption_keeps_queries_and_sync_readable_and_serializes_writes_once`: **environmental**, explicit `Too many open files` from tiny_http, then a missing HTTP response.
- `serve::tests::latency_tests::latency_release_requires_a_live_service_and_never_allows_reset`: **environmental**, `Resource temporarily unavailable` on the response read.
- `serve::tests::overload_tests::full_mutation_workers_refuse_upload_without_body_drain_or_eviction`: **environmental**, missing response in the same resource-exhausted run.

The invocation choice was ours. The follow-up uses the unchanged product/tests
with `--test-threads=2`, matching scripts/run-rust-tests.mjs. It passed **203/203**, with four declared ignores, as recorded in REPORT.md and
`host-final-canonical.log.gz`. No timeout, descriptor
limit, concurrency policy or assertion in product/tests was changed. These
failures are outside the requested single full-suite invocation.

A final evidence-path helper initially treated Grok's inline example `push.mjs`
as a report artifact and raised an assertion (**ours**, helper scope only).
Restricted that helper to the authored report/dispositions/failure ledger;
all actual evidence paths exist. Retained reviews normalize trailing whitespace
only; their original input hashes are recorded in review-inputs.json.

## Required single full-suite run

Exit **0**, exact summary `== 0 failure(s) in 1400 s`. No failed stage or test
in this invocation: none ours, baseline or environmental. Clients: 4,595 passed,
zero failed, ten declared skips. Models: 79 passed, zero failed. The inherited
60-second process target is a baseline miss; round 1 was already 1,319 seconds.
Grok's final follow-ups arrived after the Rust stage and were tested separately;
see REPORT.md for the final-source qualification boundary.
