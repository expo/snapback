# Atomic Following launch — lane FA round 2

The implemented contract is **start this feed now**: all retained own events and
the newest 1,000 live events per existing follow, newest first, with no refill
when events are removed. See [LLP 3000.026](../../../../llp/3000.026-following-over-a-populated-store.rfc.md).

The online publisher remains unbuilt. Both complete round-1 reviews are retained
next to the older experiment. There are no manifests, fences, reservations,
rosters, tasks, source staging, partial publication or new device formats.

## Measurement method

Run the ignored `calibration_atomic_launch_measurement` test in
`crates/snapback4-lang/tests/following_atomic_launch.rs` with `--release`,
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, `FA_SCALE=1` or `10` and
`FA_ATOMIC_DIR` naming a fresh worktree-local output directory. It seeds the
actual predecessor, checkpoints the WAL, then times the actual `Engine::adopt`
path. The reported writer lock is the sum of activation phase timings, beginning
at the uncontended `BEGIN IMMEDIATE` through commit; total wall time also includes
the read-only preflight. Counts are checked against a fixture formula independent
of the estimator, and the resulting feed has no pending or parked work.

1×: 48,000 posts, 1,000 reposts, 6,000 follows, 1,008 principals. 10× scales all
four populations. Actors are uniform, remain below the per-follow 1,000 cutoff,
and include tied times. Bodies are 200 bytes. This is the round-0 calibration-#22
shape, not a production trace. Window cut/tie and multi-actor behavior are tested
separately. One measured sample per final scale, serially, on shared Linux
expo-build-1000. Rust 1.97.0, SQLite bundled through rusqlite 0.40.2. No performance
claim about other hardware, offered traffic, skew or online preparation follows.

The first 1× implementation measured 101.639 s holding the writer lock: 56.332 s
rebuilt indexes that launch had just created. The final code reuses those exact
candidate-schema indexes and retains the full validation pass. Both results are
retained (`1x-before-index-reuse.json`, `1x.json`); this is a code change, not a
best-of-run selection. The initial printed 20,000-copies/s placeholder is replaced
by the measured estimate in the finished implementation.
After timing, an unused metadata counter assignment was removed (one SQL
write). The measured durations are retained without subtracting that write;
the construction, slot fill, index reuse and validation paths are unchanged.

## Results and verification

| Final measurement | 1× | 10× |
|---|---:|---:|
| Copies | 340,697 | 3,407,033 |
| Writer lock, seconds | 46.901456848 | 696.667497247 |
| Total adoption wall, seconds | 47.037331693 | 698.068136903 |
| Logical row writes including slots | 493,697 | 4,937,033 |
| Final database bytes | 908,492,800 | 9,093,439,488 |

The finished estimate uses 7,000 logical row writes/s, rounded down from the
slower observed rate. It computes `(sources + 2*events + copies)/7000`, so filtered
source rows still contribute slot work. Predictions for these fixtures are
70.53 s / 705.29 s. This is an estimate, not a latency guarantee. The hard
5,000,000 limit applies to copies, summed across all adopting declarations.
Disposable benchmark databases were removed after preserving these JSONs and
complete measurement logs; all installs/build outputs stayed in the worktree.

Affected checks pass: atomic launch 7 (plus the process-death child invoked by
its parent), retained-source research 4, language Following 8, background 17,
epoch 1, CLI Following 2, deployment/adoption 10, delivery 1, counter 1, HTTP
launch isolation 1 and core activation equivalence 6. The corrected bounded
rollback regression passes its focused rerun. The whole guide passes 86/86;
the JavaScript wasm codec census passes 26/26. The complete device package
passes **1,321 tests, zero failures, three existing ignored tests**, across
67 harness summaries (including its empty doctest harness).

Device wasm is **1,981,512 bytes raw / 572,049 bytes gzip**, 792 bytes below
the unchanged 572,841-byte budget. Launch construction is gated with the
SQLite server store; no device implementation or protocol changed.

Ran `scripts/test.sh` **exactly once**, exit 1. Exact summary:

```text
== 2 failure(s) in 1212 s
   cargo test
   client tests
```

The two failed phases contain exactly three failing tests, all **ours**:

| Test | Cause and resolution |
|---|---|
| `snapback4::init::orphan_and_invalid_recipe_options_keep_the_clear_retirement_refusal` | Stale expected recipe message still said to declare before source data; updated to the new adoption recovery |
| `snapback4::init::retired_feed_installer_and_all_its_options_refuse_without_writes` | Same stale expected message; all option combinations and no-write assertions retained |
| `Retired Following installer and orphan options preserve fresh and existing directory trees` (JavaScript) | Same stale expected message; directory-preservation assertions retained |

No baseline or environmental full-suite failures. Rust: 3,920 passed, 2 failed,
28 ignored. Client files including all shards: 2,699 passed, 1 failed, 10 skipped.
Client models: 78/78; fixture wrappers: 9/9. All other phases passed. The inherited
60-second overall budget remains exceeded and unchanged.

After that run, corrected the two expectation constants and clarified the
ceiling diagnostic: `--allow-feed-adoption` cannot override the hard limit.
Added that assertion to the zero-write ceiling regression. Targeted final reruns
pass: Rust init **21/21**, deployment/adoption **10/10**, atomic launch **7/7**
(two separately exercised ignored entrypoints), whole guide **86/86**; JavaScript
init **4/4**. The full script was not repeated. No unresolved affected-test failure
remains. [verification.json](./verification.json) records totals, attribution
and the full log digest.

The exact full log, start marker, exit status and affected logs are in the ignored
`snapback4/target/fa-round2/` directory. The run used Node 24.13.1, Bun 1.3.14,
Rust 1.97.0, eight Cargo build jobs and an open-file limit of 65,536. No product
meter, test timeout or budget was raised. The feeds card ends 13 bytes smaller
than its round-1 version (17,695 versus 17,708). LLP 3000.013's stale empty-source
paragraph now points to the implemented launch contract.

Final reference audit: 518 LLP documents, 9,633 references, zero errors or
unchecked references. The staged whitespace audit flags only the verbatim Astra
review's three Markdown hard breaks and a terminal blank line in each of the
three raw measurement logs. Those four archival files retain their original
bytes; the edited source and documentation pass the scoped whitespace check.

Development checks found and resolved these failures before that full run:

- **Ours:** initial Rust integration compile errors (cursor byte keys versus
  decoded suffixes, activation transaction/catalog lifetimes, and a test path
  passed as String). Fixed without weakening meters or isolation.
- **Ours:** the old research test expected populated adoption to refuse. It now
  verifies successful launch; its historical counterexamples remain.
- **Ours:** a tied-time fixture tried to update immutable timestamps. It now seeds
  tied timestamps from the start and tests the independent event-id cut.
- **Ours:** three guide failures: `familiar::every_moved_fact_has_its_why_or_details_home`
  and `w9b_every_code_has_bounded_card_context_and_a_full_card_command` caught an
  oversized N_SPARSE_FILTER excerpt (4,216 bytes); `following_cards_scope_older_recipe_measurements`
  caught changed historical-measurement wording. Shortened/restored the prose;
  the entire guide then passed 86/86 within the unchanged budgets.
- **Baseline test assumption:** `review::background_refusal_rolls_back_chunk_and_parks_work`
  expected both follower copies in one 1 ms cooperative slice. Under load the
  first copy legitimately commits before the next slice hits its cap. The worker
  file is byte-identical to HEAD (SHA-256
  `065dc4a11aa4e72dd54c7caf97107a60de20a1f0a1f01aaf27118f8880a58c9c`).
  The affected test now requests a whole bounded chunk with `Duration::MAX`;
  normal meters and production scheduling are unchanged.

One initial HTTP-test command used an unqualified name with `--exact` and ran
zero tests; it is not counted. The corrected filter ran and passed the named
HTTP launch regression. No tool installation was needed (`bun install
--frozen-lockfile` found the existing worktree dependencies unchanged).
