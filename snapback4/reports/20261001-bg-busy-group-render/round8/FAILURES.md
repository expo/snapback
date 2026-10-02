# Round 8 failure ledger

The corrected final source passes its full-suite run; both invocations and all
development failures are recorded below.

Development failures, all **ours**:

- `compiler-first.log.gz`: Rust E0063 in `bind/actions.rs`; the new compiler-only
  `maintenance_scopes` field was missing from the action `BoundProgram`
  initializer. Added its empty map. No test ran in that attempt.
- `compiler-second.log.gz`: `helper_parameters_and_results_join_calls_across_operations`
  used `rows`, already declared by the shared fixture, and hit
  `E_QUARRY_UNKNOWN` for a duplicate operation. Renamed it `helperRows`.
- `compiler-second.log.gz`: `reuse_is_scope_wide_even_before_the_row_assignment`
  used `max(null, null)`, which already fails ordinary type checking. Replaced
  that consumer with `share(1, [saved], saved)` so the test demonstrates the
  newly forbidden, otherwise well-typed reset/reuse, both before and after the
  maintained-row assignment. It asserts E_VIEW_KEY and the separate-variable
  rewrite. No product assertion was relaxed.
- Two setup commands did not apply their edits: invoked the unavailable `python`
  alias instead of `python3`, then used repository-relative paths from the
  `snapback4/` directory. Corrected the interpreter and working directory. The
  first no-run compilation therefore built unchanged source and is not claimed
  as candidate evidence.

All three development compilation/test failures are corrected; the compiler
cohort then passed 43/43, and the final-source compiler/guide run passed 43/43
and 110/110. No baseline or environmental classification waives these failures.

- `language-all.log.gz`: all eight `baseline_golden_and_ownership_switch_shard_0`
  through `_7` tests failed, **ours**, for 96 historical IR digests changed by
  the required point-read row/count slot split. There were no ownership-on/off
  IR, admission or execution/meter differences. Preserved the historical files,
  added 96 explicit replacement digests, and verified the exact inverse slot
  split/temporary renumbering restores every one of the 3,228 historical hashes.
  `lowering-delta.json` lists all 96 programs. The remaining language cohorts
  passed. These are intentional source changes, not baseline failures.
- The first invocation of the one-off inverse-lowering proof normalized numeric
  suffixes even in programs with no changed slots. That proof script failed on
  `generated-1-for-1-false-false-and-mutation:probe`, **ours**. It now leaves
  names untouched when there is no offset; all 3,228 historical hashes match.


## First full-suite run (candidate before the held-count integration correction)

Exact summary: `== 1 failure(s) in 1430 s`, exit 1. The failed step is client
tests (eight assertions). Rust: 281 binaries / 994 executions and doctests pass;
clients: 5,738 passed, 8 failed, 10 skipped; serial models: 79/79. All 1,791
frozen input hashes stayed unchanged; wasm matched the measured artifact.
This run is `first-suite.log.gz`, with its source and verification receipts.

Every failure is **ours** (baseline 0, environmental 0):

1. `one-shot-review.test.mjs`: wasm — impossible held count refuses in one evaluation and never contacts the server.
2. Same test: process.
3. Same test: app-wasm.
4. Same test: app-process.
5. `one-shot.test.mjs`: wasm — an unavailable held online-only view refuses instead of returning loading.
6. Same test: process.
7. Same test: app-wasm.
8. Same test: app-process.

Every assertion expected `E_QUERY_HELD`, got `E_QUERY_RETRY`. The compiler's
new separate row/count slots no longer matched backend.ts's narrow old-shape
recognizer. All eight fail again in isolation (`held-before-fix.log.gz`, exit 1).
The correction recognizes both exact three-statement count forms, retaining
all schema/key/input/source exclusions; no runtime evaluator or retry budget
changes. The complete unchanged one-shot and review files then pass **117/117**
(`held-final.log.gz`, exit 0), including the existing branch/time/argument/membership
and prediction controls. This necessitated a second suite invocation, once on
the corrected final source. The first failed run is not waived or called final.

A read-and-test shell command initially used `llp/` from the Snapback 4 cwd;
the missing path prevented that command from starting tests. Corrected to
`../llp/`. This is another setup mistake, **ours**, not an environmental failure.

## Corrected final-source full-suite run

Exact summary: `== 0 failure(s) in 1407 s`, exit 0. Rust: 281 binaries / 994
scheduled executions and doctests pass; clients: 5,746 passed, 0 failed,
10 skipped; serial models: 79/79. Final failures: **ours 0, baseline 0,
environmental 0**. No failure is waived. The known site-48 injection flake
passes; its existing ticket remains open.

All 1,791 frozen source inputs remained unchanged and the wasm artifact matches
the measured bytes. See `full-suite.log.gz`, `final-source.json` and
`final-verification.json`. This is the second suite invocation in the round,
and the only invocation on the corrected final source.

A documentation patch initially failed its context check and wrote nothing;
the corrected patch applied. This editing mistake was ours and affected no
source or test result.
