# Lane CQ — a top-N answer is complete

Branch: `sb4-intent/cq-topn-complete`, based on `8dfbf7daa`.
Decision recorded first in commit `83f543fec`, LLP 3000.027.
Implementation, documentation and regressions: `4d5a93669`.
No push, publication, version bump or budget increase.

## Result

A cursorless `first N` or `last N` that fills its bound is complete, with no
`next`. This applies to ordinary scans, eager and lazy merges, word search,
projected views, bounded scalar inputs and composed previews. Meter cuts,
undecided authorization and unknown device coverage remain incomplete.
The client uses the same outcome without requesting the server merely because
more rows exist. Declared cursor ownership and interrupted collectors retain
their existing rules.

`complete` means the query answered its declared request within known coverage
and execution limits.

## Forms exercised

These bodies run over the 1,000-row fixture in
`crates/snapback4-sim/tests/common/topn.rs`. Each returned row's timestamp is
checked, not just its count or completeness. `posts` is public, replicated,
and contains timestamps 0–999. `cards` projects posts; `byLane` indexes
`lane, at, id`; every body matches `cof`.

| Form | Example | Result |
|---|---|---|
| Newest bound | `return posts last 10 by .at` | 999–990, complete, no next |
| Oldest bound | `return posts first 10 by .at` | 0–9, complete, no next |
| Filtered bound | `return posts where not slow or count(posts) > 0 last 10 by .at` | With `slow: false`, 999–990 complete; with `slow: true`, the read meter cuts and completeness is false |
| Explicit merge | `return merge posts last 10 by byLane:` with lanes `[0]` and `[1]` | 999–990, complete, no next |
| Projected view | `return cards last 10 by .at` | 999–990, complete, no next |
| Search | `return posts matching 'cof' last 10 by .at` | 999–990, complete, no next |
| Composed preview | `return { latest: (posts last 1 by .at), label: 'preview' }` | Latest is 999; complete, no next; no cursor note |
| Preview beside a continued page | `latest = posts last 1 by .at` then `return { latest, rows: posts last 10 by .at after c }` with `c: cursor ?` | Complete with the main page's next |

No new syntax was introduced. The note for a standalone cursorless page now
advises `c: cursor ?` and `after c` only if the screen pages. It no longer
proposes narrowing data or imposing a schema cap to gain completeness.

## Files

Paths below are relative to `snapback4/`, except the LLP rows.

| File | Change |
|---|---|
| `../llp/3000.027-top-n-answer-is-complete.rfc.md` | Supervisor decision, invariants, implementation and verification contract |
| `../llp/current/3000.027-top-n-answer-is-complete.rfc.md` | Working-set link during implementation; archived when finished |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | Amendment explicitly supersedes the old cursorless-overflow rule without rewriting historical measurements |
| `crates/snapback4-core/src/engine/read.rs` | Remove ordinary/eager-merge answer overflow; preserve incomplete lane discovery |
| `crates/snapback4-core/src/engine/word_merge.rs` | Remove cursorless word/lazy-merge answer overflow |
| `crates/snapback4-core/src/engine/view_merge.rs` | Remove projected-view answer overflow |
| `crates/snapback4-core/src/engine/runner.rs` | Explain that the remaining overflow flag is lane discovery, not an answer bound |
| `crates/snapback4-core/src/engine/pages.rs` | Identify whole returned cursorless pages separately from bounded record fields for advice |
| `crates/snapback4-core/src/engine/mod.rs` | Export that compiler-facing provenance helper |
| `crates/snapback4-core/tests/corpus.rs` | Stop translating cursorless limit stops into partial; retain checks for missing declared cursor ownership, including ambiguous pages |
| `crates/snapback4-lang/src/bind/mod.rs` | Suppress composed-field advice; shorten N_NO_CURSOR to conditional continuation advice |
| `crates/snapback4-lang/src/bind/residency.rs` | Source-coverage explanation no longer requires continuation |
| `crates/snapback4-lang/src/guide/reads.rs` | Definition, bound semantics, continuation advice and shorter lead |
| `crates/snapback4-lang/src/guide/bounds.rs` | Bound semantics; remove cap/narrowing rewrites for completeness |
| `crates/snapback4-lang/src/guide/search.rs` | A held first-1 answer can be complete |
| `crates/snapback4-lang/src/guide/search_all.md` | Remove the cursorless bound from incompleteness causes; membership plan untouched |
| `crates/snapback4-lang/src/guide/codes.rs` | Revise existing N_NO_CURSOR entry; no new code |
| `crates/snapback4-lang/src/guide/why/N_NO_CURSOR.md` | Short continuation explanation |
| `crates/snapback4-lang/src/guide/why/E_QUERY_HELD.md` | Correct first-1 and source-coverage wording |
| `packages/snapback4/README.md` | Short completeness definition, within 300 physical lines |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Remove reason 3 and its workaround; retain freshness, cuts and horizon wording |
| `crates/snapback4-sim/tests/common/topn.rs` | Shared 1,000-row fixture and exact result oracle |
| `crates/snapback4-sim/tests/topn_complete.rs` | Server top-N forms, composed preview and meter cut |
| `crates/snapback4-device/tests/topn_complete.rs` | Both device stores, reopen, component coverage, cut, horizon, undecided prefix and hidden-row control |
| `crates/snapback4-device/tests/components.rs` | Full bounded retained component no longer loses retained-only classification |
| `crates/snapback4-device/tests/read_cut/mod.rs` | Cursorless first-1 wire answer is complete; cut/unknown controls unchanged |
| `crates/snapback4-device/tests/search_global/coverage.rs` | Only the two firstHeld completeness expectations change |
| `crates/snapback4-device/tests/search_merge/mod.rs` | Only retained classification of mixed_incomplete changes; its horizon still makes the answer incomplete |
| `crates/snapback4-device/tests/trending/rolling.rs` | Ranking over the declared 4,095-candidate input is complete beyond that input bound |
| `crates/snapback4-sim/tests/common/helper_pages.rs` | Clarify that its unchanged refusal assertion concerns interrupted collection, not a fulfilled bound |
| `crates/snapback4-sim/tests/common/held_coverage.rs` | Expected residency explanation |
| `crates/snapback4-sim/tests/common/merge_continuation.rs` | C2d auxiliary last-1 no longer makes uniform search incomplete |
| `crates/snapback4-sim/tests/common/shape_pages.rs` | Bounded prelude count is complete; the 9,000-row meter-cut control is unchanged |
| `crates/snapback4-sim/tests/loopbar.rs` | Cursorless global top-20 is complete |
| `crates/snapback4-sim/tests/residency.rs` | firstHeld is complete over full holdings |
| `crates/snapback4-sim/tests/trending/mod.rs` | Same bounded-candidate ranking expectation on the server |
| `crates/snapback4-lang/tests/chat.rs` | Returned record field no longer gets N_NO_CURSOR |
| `crates/snapback4-lang/tests/cursor_advice.rs` | Rewrite preserves the query, compiles, and emits no completeness/cap advice; composed first/last fields stay silent |
| `crates/snapback4-lang/tests/extremum_expressions.rs` | Scalar over a declared page is complete |
| `crates/snapback4-lang/tests/feed_forms.rs` | Filtered cursorless merge is complete |
| `crates/snapback4-lang/tests/repairs.rs` | Legacy ranking is complete over its declared input; a winner outside that input is still excluded |
| `crates/snapback4-lang/tests/residency_notes.rs` | Updated note assertions; fitting-cap suppression and genuine cuts still tested |
| `crates/snapback4-lang/tests/fixtures/guide-fact-homes.json` | Three revised facts track their new source text |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Updated N_NO_CURSOR definition assertion |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Updated continuation rewrite assertion |
| `crates/snapback4/tests/check.rs` | CLI note/why expectations and a new 1,000-row `snapback4 test` regression |
| `crates/snapback4/tests/delivery_page.rs` | Top-50 complete; explicit pagination and message-scoped reads still reach later acknowledgements |
| `crates/snapback4/tests/scale_row_ranges.rs` | Live-view certificate test accepts complete cursorless page; cost checks unchanged |
| `packages/snapback4/test/client-lifecycle.test.mjs` | Complete local cursorless mock needs zero server queries |
| `packages/snapback4/test/client-seams.test.mjs` | Real native/web top-N stays complete and local; meter cuts remain incomplete and local |
| `JOURNAL.md` | One append-only dated landing/measurement entry |
| `reports/20260927-cq-topn-complete/REPORT.md` | This report |
| `reports/20260927-cq-topn-complete/first-run-failures.md` | Every failure from the first full run, with ownership |
| `reports/20260927-cq-topn-complete/qualification.json` | Exact full-run summary and final affected-check receipts |
| `reports/20260927-cq-topn-complete/wasm.json` | Toolchain, sizes, hashes and unchanged budget |

The server/device outcome builders, component aggregation, client routing,
React completeness accumulation and `snapback4 test` reporting already consume
the shared runner's facts. Their product logic needed no change. The scale
certificate prices the same work and makes no complete-result promise; its
live-view regression changes the completeness expectation, not its bound.

## Tests and merge notes

New server test `cursorless_top_n_and_composed_preview_are_complete` checks
all seven forms plus the filtered form and a real examined-meter cut.
New device tests `sqlite_top_n_and_preview` and `memory_top_n_and_preview`
repeat those assertions after sync and reopen and inspect independent field
coverage. `sqlite_horizon_remains_incomplete` and its memory twin hold only
five of 1,000 rows: top-10 is incomplete, top-1 inside the window is complete,
and the server still returns complete top-10. The two `*_and_server_undecided_prefix_stays_incomplete`
tests use expiring membership search, return exactly the same visible top ten
on server/device, and exclude a newer hidden row while keeping completeness
false. This deliberately preserves the existing distinction: ordinary trusted
held scans may establish authority on the device that the server prefix cannot.

The new CLI regression `fixture_test_reports_cursorless_top_n_complete`
loads 1,000 fixture rows and requires the measured top-N line to say
`complete`, not `capped`. Compiler tests check direct, pinned, first/last,
composed and continued forms. Existing native/web client tests check no `/q/`
fallback for a known cursorless answer or a meter cut.

GS merge attention, with no membership-plan edits:

- `common/merge_continuation.rs`: `control_c2d_uniform_words_continue_and_nonuniform_word_cuts_withhold_candidate`, only the uniform auxiliary last-1 completeness assertion/comment.
- `search_global/coverage.rs`: `w9r1a_truncated_held_page_memory` and `..._sqlite`, false → true only.
- `search_merge/mod.rs`: `r1a_left_read_cannot_mask_an_unknown_held_read_in_either_order`, retained-only classification is true for the cursorless auxiliary, false for unknown presence; overall horizon completeness remains false.
- `common/held_coverage.rs`, `residency.rs`: corresponding source-coverage wording and firstHeld expectation.
- Search card/why text: remove reason 3; all query blocks and membership plans remain identical.

## Engineering choices and deviations

No design deviation. The remaining `page_overflow` flag is reserved for
incomplete lane discovery, because incomplete discovery cannot certify a
merged result. Loss of a declared cursor and interrupted collectors are kept
unchanged, rather than reinterpreting other existing language behavior.
The corpus adapter now requires an expected continuation before considering a
returned page an owner; this preserves the ambiguous-two-cursor negative
case that the old cursorless preview overflow had also made partial.
The advice walk is separate from runtime ownership, so silencing composed
previews cannot transfer a cursor. Fitting-cap note suppression is preserved.

The required LLP lives outside the Snapback 4 fence, as requested; the older
governing LLP gets one amendment. No new skill, dependency, tool installation
on a shared path, or registry is introduced. `llp-orient` was read from the
existing sibling checkout because this lane's skill symlink was broken.
Binaryen 123 was copied into this lane's ignored `target/cq-tools/`.
Only this lane's newly created incremental build output was deleted for space.

The legacy bounded-ranking tests now deliberately say complete for the selected
candidate domain. Their checks that an outside winner is absent remain; this
is not a claim of a globally exact ranking over rows the query did not request.
Postgres production outcomes share the changed runner; no live Postgres
qualification was run. The core corpus explicitly reports its disabled
Postgres cases as skipped.

## Size and verification

Both wasm artifacts used Rust 1.97.0, wasm-bindgen 0.2.127 and Binaryen 123
through `scripts/build-wasm.sh`. Baseline: 1,981,512 B raw / 572,053 B gzip.
Candidate: 1,981,159 B raw / 572,010 B gzip. Delta: −353 B raw / −43 B gzip.
Budget stays 572,841 B gzip; headroom 831 B. Exact hashes: `wasm.json`.
The nine affected guide/client text files shrink from 42,376 to 42,098
whitespace-delimited words (−278); README is 300/300 physical lines.

The one required full run of `scripts/test.sh` exited 1 with the exact summary:

```text
== 3 failure(s) in 1280 s
   docs budget
   cargo test
   client tests
```

The docs budget and 14 Rust target failures were lane-owned obsolete assertions
or edited text exceeding the unchanged budget. They are corrected in the
implementation commit. Every affected check now passes, including the whole
86-test guide. The full run is still reported red: no second complete run was
performed. `first-run-failures.md` enumerates every target, failing test and
failed corpus case, without dropping failures from the first run.

Final affected evidence (counts include only the named check groups):

| Check | Final result |
|---|---|
| New server top-N test | 1 passed |
| New SQLite/Memory top-N, cut, horizon and authorization tests | 6 passed |
| Components, helper pages, loopbar and residency regression targets | 173 passed |
| Core corpus harness | 18 passed; frozen SQLite cases 212 passed / 83 skipped; disabled Postgres cases 295 skipped |
| Chat, cursor advice, residency notes, extrema, feed forms, repairs | 76 passed |
| Whole guide | 86 passed |
| CLI check, delivery page, scale row ranges | 78 passed |
| Inherited shape exhaustion, bounded ranking, retained composition | 17 passed |
| README budget | 300/300 lines; first-account guide check passed |
| Isolated rerun of the two client failures | 11 passed, 0 failed, 0 skipped |
| Full-run client models | 78 passed, 0 failed, 0 skipped |

The full run also passed cargo/wasm builds, release guard, package build and
typecheck, both app typechecks, chat app check and all nine fixture-wrapper
tests. No new source exceeds 1,500 lines; the largest changed source is
`crates/snapback4/tests/check.rs` at 1,454. Raw logs remain in the lane's ignored
`target/cq-*.log`; their hashes and exact result lines are in `qualification.json`.

## Open observations and reproduction

There is no known remaining CQ product failure. Two existing client test
bodies failed under the full run's concurrency at load 42.49/96 CPUs:

- `W6d web: two client POSTs with the caller id apply once after a lost reply`:
  expected two POST attempts, saw one. Classified environmental/timing
  provisionally; an exact-baseline failure was not established. Receipt recovery
  racing the retry is a code-based hypothesis, not a proven diagnosis.
- `HTTP admission, encoding, slow readers and idle changes polls`: the server
  did not print its URL within the existing three-second startup wait.
  Classified environmental/timing; its complete isolated rerun passed.

The observed reproducer is `scripts/test.sh` with normal client concurrency on
this shared host. The isolated command below passed both (11 tests including
nested HTTP checks); reproduction remains nondeterministic:

```sh
node --test --test-name-pattern='W6d web: two client POSTs|HTTP admission, encoding' \
  packages/snapback4/test/client-seams.test.mjs \
  packages/snapback4/test/http-bounds.test.mjs
```

Run from `snapback4/` after building wasm and the package. Neither timeout,
assertion nor unrelated client behavior was changed. No live Postgres service
was tested, and this lane makes no full-suite-green or publication claim.
