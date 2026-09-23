# F3a: declared Following, revisions 5 and 6

Worktree: `snapback-w12a`. No commits, pushes or stash. The original lane
brief and both continuation rulings govern this patch; `llp/` is untouched.
The supervisor owns integration and independent review. This report covers
server execution; F3b owns device prediction and composed-commit delivery
qualification.

## Declaration and disclosure

```quarry
maintain feed: timeline
  authors profiles by principal
  events posts by authorId, at removed by removed
  reposts reposts by actorId, postId, at
  edges follows by followerId, followedId
```

The `reposts` clause explicitly maps the original-card reference, on a separate
line. Reads use `feed[viewer] after c last 20`, returning event rows
`{ id, postId, actorId, authorId, repost, at }` for application shaping.
The compiled feeds and language examples include the complete required schema.

The expansion reuses the installed recipe's schema and purge source. It owns
`feedAuthors`, `feedPulls`, `feedPullCounts`, `feedPullTotals`, `feedPosts`,
`feedRemovedEvents`, `feedFeed` and `feedBroadcast`. There is no `feedFollows`.
Routes and inboxes remain reader-private; modes, events, tombstones and
broadcasts remain public. Counts are public and online-only; the internal
total is unreadable. Every application/program write to an owned table is
refused, including system program calls outside the generated purge job.

Profiles register eagerly in their inserting mutation. Allowed profile
deletion retains the mode and its permanent promotion. Activation registers
0–1,000 existing profiles atomically, with empty mapped posts/reposts/follows;
1,001 profiles refuse without changing the generation or data. Activation
uses the generation barrier and does not append publication events. Unchanged
adoption, source-only adoption, reopen and trusted restoration preserve state.
Untrusted `load`, `seed` and seed deletion reject mapped/owned imports.

## Implementation seams

- Parser/AST: a separate timeline declaration, expanded by `bind/timeline.rs`.
  Admission reuses the public bridge validator and adds the removal flag and
  mapped-edge index/caps. Generated-name collisions refuse before expansion.
- `engine/write.rs`: the existing source-change tail calls the transition
  module for each actual transition. Owned writes use ordinary insert/update/
  delete validation, constraints, caps, indexing and the caller's meter.
  A narrowly scoped authority bypasses only owned-table write rules.
- Pull writes deliberately use the source path so the internal count maintain
  updates; they never silently skip that dependency as `Origin::Maintained`.
- `store/activation.rs` guards lifecycle changes; `Engine::activate` registers
  existing profiles in the same transaction. `Engine::load_trusted` restores
  complete images without running transitions.
- `engine/job.rs` grants the generated purge job its owned-table authority.
  Its existing minute schedule and one-tombstone chunks remain the recipe's.
- The read lowers to the existing merge and tombstone predicate. It reuses
  cursor, authorization, completeness and meter-cut behavior.
- `bind/residency.rs` adds an implicit server site through `timeline::write_site`
  for every mutation touching a mapped table. Existing device admission sees
  `predicts: never` and queues it without rows. A runtime guard also refuses
  device transitions; the web build excludes the server-only implementation.
- `timeline_cost.rs` adds the bounded transition matrix, per-row index/key/byte
  bounds, purge costs and shared 1,024-write composition ceiling to `check --cost`.

The new codes are `E_TIMELINE_SHAPE`, `E_TIMELINE_FOLLOWS`,
`E_TIMELINE_REMOVAL`, `E_TIMELINE_READ`, `E_TIMELINE_OWNED`,
`E_TIMELINE_SERVER`, `E_TIMELINE_IMPORT`, `E_TIMELINE_ACTIVATE`, and
`E_TIMELINE_REDEFINE`. Each has an explanation in `guide::CODES`, a dedicated
feeds paragraph, and rewrite/guide routing. Existing `FEED_*` codes remain.

## Oracle and boundaries

`tests/timeline/common.rs` compiles two apps: the installed recipe plus its
actual generated bridge, and the same app with the declaration and direct
source mutations. Traces run through the real engine under default meters;
ordinary setup uses mutations. Separate restoration/corruption/purge fixtures
use the explicitly trusted loader.

The harness compares public event identities, Following data/order, complete,
cut, cursor descriptors/positions and continuation pages, refusal codes, row
write counts and normalized durable state. Independently minted storage IDs
for profiles, edges, modes, routes, counts and copies are ignored; event IDs
are exact. Cursor comparison translates only the physical copy-ID suffix;
each actual cursor is then followed on its own engine. The recipe's duplicate
edge table is excluded. The asymmetric overflow exception has a separate
regression, so it cannot silently excuse any other divergence.

Coverage includes posting; repeated/fresh/self reposts; removed-original
repost refusal; original and repost removal; repeated removal; one-way flag
and initially-true refusals; backfill; time ties and tombstone-filled pages;
promotion at 51; both slot-cap refusals and rollback; saturated-author own
copies; permanent promotion through profile deletion/recreation; unfollow and
refollow in one mutation; missing count refusal; author/source caps; purge;
and the application card/profile joins used by a Clique-shaped feed.
Admission covers each mapping/type/audience/rule/immutability/key condition,
all edge bounds, owned-name collisions, read shape and source-write authority.
Lifecycle covers empty/populated activation, existing profiles, cap overflow,
redefinition/removal refusal, unchanged adoption, reopen, trusted restoration
and rejected imports.

The ruled accounting is asserted, not inferred:

| Mutation | Recipe | F3 |
| --- | ---: | ---: |
| First post + 1,021 ordinary notes | 1,024, commits | 1,024, commits |
| Promotion + 865 copied events | 1,024, commits | 1,023, commits |
| That promotion + one more app write | 1,025, refuses | 1,024, commits |
| That promotion + two more app writes | beyond ceiling | 1,025, refuses |
| Purge 1,001 copies + their tombstone | 1,002 | 1,002 |

The 900-older-pushed + 100-newer-shared trace copies exactly 765 pushed events
and reads the 100 shared events from the broadcast lane. Refusals roll back
all application and derived rows; no history window is shortened.

## Mutation proof

In `/tmp/sb4-f3a-r6-evidence/mutation`, only the follow-insert transition call
was removed. The Clique equivalence test failed (exit 101): refollow's write
accounting diverged, 56 versus 31 after the duplicate-edge adjustment. The
file was restored byte for byte, and the same test passed (exit 0).
Original/restored SHA-256:
`d0182c7e49267865838f63d67158e4c9594b09b2caf22b6083262d431e8d96e1`.
The primary worktree was never mutated for this proof. Cache resets force
subsequent verification to compile the primary worktree's own source.
The only later change in this file is activation's codec-wrapper correction
reported below; the follow-insert hook and its oracle are unchanged. An exact
file comparison verifies that single replacement against the restored proof
copy (`mutation-proof-final-delta.json`). Final file SHA-256:
`454632485312459d64e285c2a7494e8878ed82839b8fce4c505bd73e5675f7db`.

## Size and measured work

Owned-row upper bounds use maximum admitted identity encodings, worst-width
integers and the actual schema's indexes. The private maintained total uses
its canonical group-key identity. Sizes exclude SQLite page/record overhead.

| Table suffix | Index entries per row | Tagged row bytes | Wire row bytes | Sum of encoded index-key bytes |
| --- | ---: | ---: | ---: | ---: |
| Authors | 2 | 340 | 309 | 552 |
| Pulls | 2 | 471 | 442 | 690 |
| PullCounts | 2 | 348 | 318 | 552 |
| PullTotals | 2 | 498 | 468 | 585 |
| Posts | 4 | 703 | 641 | 1,399 |
| RemovedEvents | 3 | 469 | 440 | 966 |
| Feed | 6 | 990 | 923 | 2,364 |
| Broadcast | 5 | 990 | 923 | 1,950 |

The maximum-backfill F3 promotion measured 1,214 examinations, 8,259 metered
index entries and 718,935 metered heap bytes for 1,023 writes. All application
rows and any extra indexes join these costs in the ordinary meter. These
row bounds do not claim F3b's composed-commit transport qualification.

## Verification and measurements

Targeted heavy commands ran serially on this shared Mac with Node 24.18.0,
`CARGO_BUILD_JOBS=4`, and serial Rust test threads. Raw logs and machine-load
observations live in `/tmp/sb4-f3a-r6-evidence/`.

| Command | Result |
| --- | --- |
| `cargo test -p snapback4-core` | 175 passed |
| `cargo test -p snapback4-lang` | 359 passed, 4 existing ignored |
| `cargo test -p snapback4` | 306 passed, latency measurement explicitly ignored here |
| `cargo test -p snapback4-sim` | 505 passed, 4 existing ignored; includes seven invariants and Following traces |
| `cargo test -p snapback4-core --test corpus -- --nocapture` | 18 adapter tests pass; corpus 212 passed, 83 named skips, 0 failed; Postgres feature disabled (295 skipped) |
| `bun run --cwd packages/snapback4 typecheck` | Passed |
| Explicit ignored Following latency measurement | Passed; 20 measured samples after 3 warmups per case |
| `cargo test -p snapback4 --test timeline` | 16 passed, 1 separate latency measurement |
| `cargo test -p snapback4 --test timeline_design` | Both ceiling regressions passed |
| Owned-row measurement rerun | Passed, including double-escaped maintained group IDs |
| CLI `check --cost` on the complete guide example | Passed; asserted composition, purge, index and byte output |
| `bash scripts/build-wasm.sh` | Passed, unchanged budget |

The language-card check initially caught two example integration mistakes:
a second executable block, then an application table colliding with an owned
name. The example now lives inside the card's single program, uses
`timelineCards`, and has an execution test. The final complete language run
passes. The shared guide inventory also includes the generated purge schedule.

| Warm operation | Recipe p95 ms | F3 p95 ms |
| --- | ---: | ---: |
| Following: 5 followed authors | 0.0852 | 0.1250 |
| Following: 500 followed authors | 0.0822 | 0.1884 |
| Following: includes a 901-follower celebrity | 0.2204 | 0.1854 |
| Post: ordinary author, 5 followers | 0.9132 | 0.2672 |
| Post: celebrity, 901 followers | 0.5534 | 0.0745 |

F3's 500/5 Following ratio is 1.51; its celebrity/ordinary posting ratio is
0.28. Both are below 3. Sparse/dense Following examines 42 rows in either
implementation; the celebrity lane examines 85. The F3 event-row projection
adds interpreter steps and heap work to reads; its transition hooks remove
recipe interpreter work from mutations. These are debug-profile local-engine
observations on a busy shared machine, not published-pin or network latency
qualification. The one-minute load was 71.16 at measurement start and 66.27
at completion; other lanes were active.

Cold snapshot accounting beside that run:

| Reader | Recipe rows / JSON bytes | F3 rows / JSON bytes |
| --- | ---: | ---: |
| Sparse | 4,792 / 890,241 | 3,376 / 605,568 |
| Dense | 4,792 / 890,191 | 3,376 / 605,518 |
| Celebrity reader | 4,793 / 890,892 | 3,377 / 606,219 |

The snapshot reduction is the absent duplicate edge table. These figures
include the public application model, not just the private inbox.

The baseline wasm build was made from this worktree's committed HEAD in an
isolated copy with the same toolchain. Gzip grew from **443,551 to 447,508 B**
(**+3,957 B**, 0.89%); raw bytes grew from 1,599,837 to 1,612,970 (+13,133).
The unchanged budget is **452,000 B**, leaving 4,492 B. The server transition
implementation is excluded from the web-only build while its queueing guard
remains. A shared-target cache reuse was detected and discarded; clean
recompilation produced the reported artifact. Final SHA-256:
`e86017753c8c701b2771040b669075757ade2824daf9f3dea432cdb152290f05`.
The artifact contains both the timeline schema marker and server-only guard.

### Single full-suite invocation and the final correction

`scripts/test.sh` was run **once**, with
`SNAPBACK4_RUST_TEST_PROCESSES=1` and
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` on the shared host. Its result, verbatim:

```text
== 1 failure(s) in 999 s
   client tests
```

Load averages (1 / 5 / 15 minute): **12.70 / 28.89 / 32.08** at start,
**9.03 / 11.31 / 18.38** at completion. The nominal 60-second suite target
was not met with this serial test configuration and shared-host build load.
The suite's Cargo build, wasm, docs budget, release guard, package checks,
app checks, fixture tests, all **2,242 Rust tests** (808 executions, 12 ignored)
and workspace doctests passed. Client tests recorded 950 passed, 2 failed,
and 3 skipped.

Both client failures were the codec census reporting the same new activation
line: it decoded the previous schema with `serde_json::from_str` directly.
The final patch uses the required `crate::json_codec::from_text` wrapper,
which delegates to that same decoder. No allowlist or census relaxation was
added. After that correction, these focused rechecks all passed:

- `node --test packages/snapback4/test/wasm-codec-census.test.mjs`: **26 passed**.
- `cargo test -p snapback4 --test timeline --test timeline_design`:
  **18 passed**, with the separately measured latency test ignored.
  This reruns activation, restoration, equivalence and both ceiling regressions.
- `bash scripts/build-wasm.sh`: **447,508 B gzip**, unchanged from the reported
  measurement, under the existing budget.

The complete suite was not rerun, honoring the once-only instruction. The
final state therefore has a red historical full-suite result and green
focused verification of its correction; it is not represented as a green
second full-suite run. Logs: `full-suite.log`, `full-suite.json`,
`post-suite-repair.json`, `codec-census-fixed.log`, `timeline-codec-fixed.log`
and `wasm-codec-fixed.log` in the evidence directory.


## Remaining scope

No further design counterexample was found. Device prediction, both-store
device transition qualification and composed-commit stream deliverability
remain F3b's commissioned work. This lane supplies server execution and
explicit unpredicted queue classification; it makes no device delivery claim.
The existing compiler warnings and named corpus skips remain. No budget was
raised; no serialized corpus encoding was changed.


## Changed files

- `crates/snapback4-core/src/engine/job.rs`
- `crates/snapback4-core/src/engine/mod.rs`
- `crates/snapback4-core/src/engine/read.rs`
- `crates/snapback4-core/src/engine/runner.rs`
- `crates/snapback4-core/src/engine/timeline.rs`
- `crates/snapback4-core/src/engine/write.rs`
- `crates/snapback4-core/src/error.rs`
- `crates/snapback4-core/src/schema.rs`
- `crates/snapback4-core/src/schema/timeline.rs`
- `crates/snapback4-core/src/store/activation.rs`
- `crates/snapback4-lang/src/ast.rs`
- `crates/snapback4-lang/src/bind/mod.rs`
- `crates/snapback4-lang/src/bind/program.rs`
- `crates/snapback4-lang/src/bind/residency.rs`
- `crates/snapback4-lang/src/bind/timeline.rs`
- `crates/snapback4-lang/src/diag.rs`
- `crates/snapback4-lang/src/guide.rs`
- `crates/snapback4-lang/src/guide/codes.rs`
- `crates/snapback4-lang/src/guide/language.rs`
- `crates/snapback4-lang/src/guide/timelines.md`
- `crates/snapback4-lang/src/parser.rs`
- `crates/snapback4-lang/src/parser/timeline.rs`
- `crates/snapback4-lang/tests/guide.rs`
- `crates/snapback4-lang/tests/timeline_guide.rs`
- `crates/snapback4/src/main.rs`
- `crates/snapback4/src/timeline_cost.rs`
- `crates/snapback4/src/verbs.rs`
- `crates/snapback4/tests/timeline.rs`
- `crates/snapback4/tests/timeline/admission.rs`
- `crates/snapback4/tests/timeline/app.q`
- `crates/snapback4/tests/timeline/common.rs`
- `crates/snapback4/tests/timeline/declaration.q`
- `crates/snapback4/tests/timeline/equivalence.rs`
- `crates/snapback4/tests/timeline/latency.rs`
- `crates/snapback4/tests/timeline/lifecycle.rs`
- `crates/snapback4/tests/timeline/measure.rs`
- `crates/snapback4/tests/timeline_design.rs`
- `reports/20260922-f3a-timeline.md`
