# Integration round 9 — U/Z/V/Y/X/T over Q/R/S/W

2026-09-25. Branch `sb4-intent/integration-042b`, based on fetched main
`88d5bfca4`. Nothing pushed or published. Package versions remain 0.4.1;
this branch qualifies the combined implementation for the supervisor's 0.4.2
release rather than performing that release.

| Order | Requested lane head | No-fast-forward merge |
|---|---|---|
| U | `fb0a89ba4` | `ad47caee2` |
| Z | `781877eab` | `a046c5788` |
| V | `7c027d052` | `911e2df62` |
| Y | `eecb2b3cb` | `5b234d2a6` |
| X | `874b247cf` | `85be70da5` |
| T | `b2f871eca` | `9532015d2` |

`589f1ccdb` adds integration regression tests, updates three former recount
cost expectations, reconciles the guide fact inventory and repairs references.
`df1a4e2a3` makes the Z inventory harness preserve historical evidence and
verify V's packed persistence after timing acquisition. The subsequent fixture
repairs are `2c6654eee` (speculative source projection), `3b3317bbb`
(controlled retained-history clock), `45cfee1ce` (remembered freshness),
`b874b1da7` (browser bootstrap imports) and `891841323` (actual client-clock
fork calibration). The final full suite tests the file tree of code head `891841323`; the
remaining evidence commit changes only this report directory and the journal.
A final metadata cleanup removed Git's conflict comments that followed the
required co-author footer on five unpublished merge commits.
All file trees and merge parents were preserved. [commit-map.tsv](commit-map.tsv)
records the original and final commit identities and their identical tree IDs;
raw measurement fingerprints retain their original identities. No test or
measurement was repeated solely for this message-only correction.

## Integration work, file by file

Paths below are relative to `snapback4/`. [files.tsv](files.tsv) lists every
path changed from the fetched main and the merge that brought it in, including
the inherited lane tests, reports and raw evidence. The inherited feature
implementations are detailed in the [U report](../20260925-bounded-following-r1/REPORT.md),
[Z report](../20260925-event-slots/REPORT.md),
[V report](../20260925-lane-v-web-start.md) and [V round 9](../20260925-lane-v-r9.md),
[Y report](../20260925-lane-y.md), [X report](../lane-x-report.md) and
[X round 5](../lane-x-round5-report.md), and [T round 12](../20260925-intent-lane-t-round12.md).
The following are the resolutions and additions made by this integration lane.

| File | Result |
|---|---|
| `packages/snapback4/src/local-query.ts` | U's numbered procedure remains the sole publication router. Y supplies issued device time and estimated server time; local and remote expiry deadlines remain separate. T's retained-row composition runs inside the same session, prediction, held-query and final-expiry fences and never enters the remembered-current-page cache. |
| `packages/snapback4/src/local-through.ts` | Retains T's source-identity merge helpers; removes its duplicate routing procedure. |
| `packages/snapback4/src/local.ts` | Preserves V's admission, store binding, settlement and delayed notifications. Issues every device query/mutation time through Y's clock, raises that clock on recovered outbox writes, and schedules local and server expiry independently. |
| `packages/snapback4/src/local-device.ts` | The extracted device interface carries the recovered issued-time floor on `onOutbox`. |
| `packages/snapback4/src/web.ts` | Keeps V's serialized authority checks and store binding on admission, adoption, delivery and exit settlement. Y's issued floor survives every durable outbox commit and orphan recovery. |
| `packages/snapback4/src/app.ts` | Combines V's synchronous prepared admission with Y's clock-wrapped transport. |
| `packages/snapback4/src/react.tsx` | Exposes both V's acquisition hook and Y's clock hooks. |
| `packages/snapback4/src/backend.ts` | Keeps Z's event-source dependency expansion; repairs the owned-event LLP anchor. |
| `packages/snapback4/test/bounded-following.test.mjs` | Retains U's nonempty speculative-page witness over held source images, since Z deliberately removes partial-kind owned rows; independently checks Z's filtered-event withholding. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Uses explicit issued/estimated test clocks and server deadlines. Adds five combined clock/retained-history tests described below. |
| `packages/snapback4/test/retained-history.test.mjs` | Keeps U's device interception and Y's wall-time sync metadata key. The eight local-expiry/permit witnesses control the shared ServerClock instead of mocking Date.now after its capture. |
| `packages/snapback4/test/server-clock-regressions.test.mjs` | Gives remembered-freshness tests a declared query and speculative local result as required by U; explicitly checks stale recovered data and retains Y’s wall-time skew/rollback assertions. |
| `packages/snapback4/test/react.test.mjs` | Retains V's online hooks and Y's expiry recipe tests together. |
| `witness/lib.mjs` | Preserves V's source/entry override options and Y's clock-offset support. A separate bootstrap module prevents defaults and custom entries from redeclaring the same imported public names. |
| `crates/snapback4-core/src/engine/mod.rs` | Registers the existing Q/R modules and T's new point-read, candidate, provenance and expiry modules together. |
| `crates/snapback4-core/src/engine/read.rs` | Combines R's streaming aggregate fold with T's candidate/row expiry scopes. Parent-key aggregate scan refusals remain intact. |
| `crates/snapback4-core/src/engine/read_point.rs` | T's extracted point-read path preserves U's speculative/withheld missing-card behavior and Z's event-kind uncertainty and internal slot access. |
| `crates/snapback4-core/src/engine/read_auth.rs` | T's verdict-based authorization retains U's speculative provenance on unknown authority. |
| `crates/snapback4-core/src/engine/local.rs` | Preserves U's five-part observation provenance and adds T's delivered-history row provenance. |
| `crates/snapback4-core/src/engine/aggregate_expiry.rs` | Holds Q's metered physical-total-minus-expired-backlog implementation. |
| `crates/snapback4-core/src/engine/live_aggregate.rs` | T's scratch reservation and source dependencies wrap Q's server backlog path; device reads retain T's authorized recount and retained-row exclusions. |
| `crates/snapback4-core/src/engine/recorded.rs` | Explicit event-slot writes still refuse before generic engine-field handling. Public row images hide both slots and read-through capture fields. |
| `crates/snapback4-core/src/engine/postgres/mod.rs` | Combines T's generation-aware read-through migration with Q's contribution-index upgrade and store-owned generation. |
| `crates/snapback4-core/src/schema.rs` | Validates contribution indexes against the effective expiry column, including inherited deadlines. |
| `crates/snapback4-core/src/maintain.rs` | Builds those indexes from `is_expiring()`/`expiry_column()`, so a child need not declare its own expiry field. |
| `crates/snapback4-core/src/store/activation.rs` | Installs T's captures and Z's slots at one pinned activation time before compatibility assessment. |
| `crates/snapback4-core/src/partition.rs` | Keeps both event filtering paths and repairs the two owned-event references. |
| `crates/snapback4-core/src/successor.rs` | Keeps slot replacement checks; repairs its reference. |
| `crates/snapback4-core/src/schema/timeline.rs` | Keeps per-declaration source-role slot identities; repairs its reference. |
| `crates/snapback4-core/src/store/event_slots.rs` | Keeps transactional slot filling; repairs its reference. |
| `crates/snapback4-core/src/store/successor.rs` | Keeps filled-slot compatibility preview; repairs its reference. |
| `crates/snapback4-core/src/engine/timeline/slots.rs` | Keeps source-write slot preparation; repairs its reference. |
| `crates/snapback4-device/src/call.rs` | Engine-withheld outcomes omit data/next; retained-row metadata is emitted only for available outcomes. |
| `crates/snapback4-lang/src/bind/timeline.rs` | Keeps U/Z's residency choices and slot rules while applying T's inherited-expiry exclusion; repairs its reference. |
| `crates/snapback4-lang/src/bind/timeline/prediction.rs` | Keeps source-slot prediction classes; repairs its reference. |
| `crates/snapback4-lang/src/emit.rs` | Hides both kinds of engine-owned columns in generated application types. |
| `crates/snapback4-lang/src/guide/language.rs` | Preserves X's structure, T's compiled read-through example and Z's bounded-source/online-follows example; fixes stale prose requiring fully synced follows. |
| `crates/snapback4-lang/src/guide/types.rs` | Keeps X's compact expiry description and Y's held-device/server-answer clock distinction. |
| `crates/snapback4-lang/src/guide/rules.md` | Keeps the paved read-through example, linking detailed refusals to dedicated why pages. |
| `crates/snapback4-lang/src/guide/maintains.md` | Keeps the keyed aggregate example and links its refusal details. |
| `crates/snapback4-lang/src/guide/codes.rs` | Retains all six lanes' code registrations and concrete rewrites. |
| `crates/snapback4-lang/src/guide/why.rs` | Registers four dedicated read-through why pages. |
| `crates/snapback4-lang/src/guide/why/E_READ_THROUGH.md` | Explains required references, immutable capture paths and concrete rewrites. |
| `crates/snapback4-lang/src/guide/why/E_READ_THROUGH_ADOPT.md` | Explains unsupported authority-changing adoption and recovery. |
| `crates/snapback4-lang/src/guide/why/E_PARENT_HAS_CHILDREN.md` | Explains physical-child deletion protection. |
| `crates/snapback4-lang/src/guide/why/E_READ_THROUGH_SCAN.md` | Explains keyed aggregate access and the refused scan forms. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Retains both lanes' definition assertions. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Retains both lanes' refusal action assertions. |
| `crates/snapback4-lang/tests/fixtures/guide-before.json` | Refreshes only the two compiled-block hashes deliberately changed by T and U/Z; keeps X's word budgets and other hashes. |
| `crates/snapback4-lang/tests/fixtures/guide-fact-homes.json` | Pins V's actual synchronous admission, Y's clock/expiry recipes and Z's residency choices; retains all 133 fact identities. |
| `crates/snapback4-lang/tests/read_through.rs` | Adds the inherited-expiry/backlog scaling and hidden-account regression. |
| `crates/snapback4-lang/tests/read_through/review_cases.rs` | Pins Q's indexed aggregate examined counts instead of T's superseded full-live-recount counts. |
| `crates/snapback4-lang/tests/read_through/review_cuts.rs` | Adds an expired contribution so the tight meter still cuts both the backlog and recount paths. |
| `crates/snapback4-lang/tests/read_through/review_metadata.rs` | Accounts for the metered live seek after an occupied expired backlog; missing/denied groups still stop at one lookup. |
| `crates/snapback4/src/scale.rs` | Preserves Q's backlog cost certificate and applies it to inherited expiry. |
| `crates/snapback4/src/serve.rs` | Keeps Y's timed responses and T's explicit transient row-provenance response. |
| `crates/snapback4/src/serve_sync.rs` | Keeps Y's timed transport plus T's stream evaluation time. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Retains U/Z routing/residency, V admission/acquisition/storage and Y clock contracts through the merges. |
| `metrics/wasm-budget.json` | Records 1,849,726 B raw / 521,532 B gzip and rounds the combined ratchet to 522,000 B, with the reason. |
| `reports/20260925-event-slots/measure.mjs` | Reuses Z's four scale treatments, writes separate integration evidence, checks format-2 buckets outside the timed interval and includes U/Z controls. |
| `reports/20260925-intent-integration-r9/` | Combined measurements, file manifest, validation logs and this report. |
| `JOURNAL.md` | Appends one dated integration qualification and measurement entry; previous entries stay intact. |

## Forms and regression coverage

All six lane test families remain in the full suite. Representative combined
forms are `sync public last 1000 by .at` on posts/reposts, `online only` on
public follows, `read through .parent` on a child with `immutable parent`,
and `view totals: count children by .parent.owner` followed by
`return totals[owner]`. X's `members where .conversation = chat where .active
first 20 by .principal after c` and `return m.twice(x)` remain compiled and
executed fixtures. `snapback4 guide from-sql` is reachable through all three
aliases and its Quarry blocks compile without diagnostics or notes.

V's public client form is `const acquisition = useAcquisition()`; first-call
admission, reload recovery and per-delivery binding retain their existing
adversarial tests. Y's forms are `client.now()` and `useNow(deadline)`;
device evaluation uses issued time and server-answer deadlines use the
server estimate. `expire at .until` remains effective through a captured
parent reference without adding a child-authored deadline field.

New regression tests:

- `inherited_aggregate_cost_depends_on_backlog_not_live_population`: 100 and
  10,000 live children, with zero or 50 expired children, give the same exact
  count with `examined = backlog + 2` and the inherited next deadline. A
  different principal receives null, no expiry and exactly one examined row.
- `integration: device observations use the issued clock; server deadlines
  use the estimate`: an issued time ahead of a still-valid server answer
  does not expire that answer; the estimated deadline does.
- Four `integration: retained read-through fallback obeys the common router`
  cases: successful source-identity composition, prediction arriving during
  transport, issued local expiry and estimated server expiry. They check
  incomplete/nonfresh composition, both deadlines and no remembered whole page.

The old three aggregate meter tests were intentionally updated because Q is
already part of main. Their authorization, output, deadline and cut assertions
remain, while expected cost now matches the integrated algorithm.

The bounded-Following fixture also deliberately changes: its speculative
projection reads `posts ... { post: .id, online: exists connected[.authorId] }`
instead of `feedPosts`. Z's partial-kind event table has no device-owned rows
and withholds before projection. The source-row fixture retains the nonempty
speculative/predicted-row assertion, while the adjacent event read retains
the withheld/no-data assertion. Both wasm and native repros pass after this
change, committed in `2c6654eee`.

## Decisions and scope

No requested design change was stopped. Merge choices where the brief left
mechanics open: keep local and server expiry deadlines separate in U's single
router; keep T's provenance merge a pure helper; route expiring server counts
through Q's indexed backlog path while preserving device recounts; isolate
witness defaults in a bootstrap module; use Z's view-only controls as well as
the two requested whole-device treatments. These choices preserve the
specified authorization, disclosure, durability and work bounds.

The guide fact/hash pins and five test-fixture families were updated for
intentional cross-lane behavior: Q's aggregate cost, Z's absent partial-kind
owned rows, Y's captured clock source, U's remembered-answer preconditions and
the shared V/Y browser harness. No test was removed or marked skipped.

## Validation and failures

First full run: `== 2 failure(s) in 2382 s` (`cargo test`, `client tests`).
It found four Rust test failures and fifteen client cases (including the four
clock-fixture watch timeouts), all classified below as ours. Every failing
family has a passing targeted rerun. The client group recorded 1,840 passes, 11 failures, four timeout cancellations
and ten declared skips. All three session models passed at
5,000 / 5,000 / 3,000 sequences in that run; the 78 model tests passed.

Second full run: `== 1 failure(s) in 727 s` (`client tests`). The Rust group
and all three full-count models passed, but two deadline fixtures failed:
`MQ expiry local watch left wasm` and `MQ local permit process`. An isolated
rerun reproduced the first and passed the second. This was an intermittent
fixture defect introduced here, not an environmental exemption: the supplied
clock is forked by the client, and calibrating only its parent left a small
positive measured offset on the client. The fixture now captures and
calibrates the actual fork. It deliberately injects a +5 ms estimate first;
removing fork calibration fails the exact issued-time assertion deterministically.
All eight cases then pass (`891841323`). No production clock or expiry rule
was changed. The removed-calibration mutant is an intentional failing check,
not an unresolved suite failure.

Final full run, exit 0: **`== 0 failure(s) in 647 s`**.
Every group passed, including cargo test (181 s), client tests (193 s) and
client models (262 s). Rust target summaries record 3,194 passes and 19
ignored tests, with zero failures. Clients record 1,934 passes, ten declared
skips, zero failures and zero cancellations (1,944 tests total). The 78 model
tests pass, including online and local session models at 5,000 sequences each
and online publication at 3,000 seeded interleavings. Full evidence:
[test-final.log.gz](test-final.log.gz).

Full-suite command, from `snapback4/` (automatic client-file concurrency and
explicit full model counts):

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_BUILD_JOBS=16 SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=0 SNAPBACK4_SESSION_SEQUENCES=5000 SNAPBACK4_ONLINE_SEQUENCES=3000 bash scripts/test.sh
```

The provided baseline log ended `== 1 failure(s) in 276 s` with four older
Rust failures (legacy capabilities, word-expansion fixtures, authoring census
and a why-operation assertion). Those failures did not recur in the fetched
round-8 main plus these lanes. None of the failures below was assigned to
that baseline, and no environmental failure has been used to excuse a red.
The suite's declared platform/optional-artifact skips remain unchanged.

Merge-time compiler errors from overlapping Q/T live-aggregate implementations
were resolved before the first full run by the split described above.

The initial guide run exposed two stale X pins (old expiry prose and compiled
block hashes). After merging the remaining text, the first full suite exposed
five more stale fact texts under one fact-inventory test and the three former
T recount expectations. These are integration compatibility failures, owned
and fixed here, rather than attributed to the host baseline.

The first full client run also failed the same bounded-Following fixture on
wasm and native with `TypeError: Cannot read properties of undefined (reading
'length')`. Both failed again in isolation, ruling out an intermittent host
failure. The source-row adjustment above fixes both while retaining the two
distinct assertions. Reproduce with:

```sh
node --test --test-name-pattern='unrelated held reads cannot validate' packages/snapback4/test/bounded-following.test.mjs
```

Eight retained-history expiry/permit cases (four scenarios on wasm and
process devices) also use an obsolete clock fixture. The first device query
asserts `deadline - 1`, but replacing `Date.now` after Y constructed its clock
leaves the captured wall source unchanged. One-shot cases fail that assertion;
watch cases time out waiting for an intercept whose assertion already failed.
The isolated old one-shot fixture reproduces the mismatch. All eight cases
pass when the fixture advances the shared `ServerClock`, preserving exact
one-retry, first-publication, row-expiry and secret-permit assertions. These
are integration fixture failures, not environmental failures (committed in
`3b3317bbb`). Reproduce the
fixed family with:

```sh
node --test --test-name-pattern='MQ (expiry local|local permit)' packages/snapback4/test/retained-history.test.mjs
```

Two Y freshness tests also failed in isolation: `syncedAt, device since and
remembered server since remain wall time under +25h skew` and `freshness is
clamped at publication after wall time rolls back`. Their undeclared mock
remote program now correctly receives U's loading result rather than a
remembered answer. The fixtures declare that program and return a speculative
local observation, the actual precondition for remembered recovery. Both
retain the wall-time assertions and now explicitly verify stale recovered
data. All 14 tests in `server-clock-regressions.test.mjs` pass. Classification:
integration fixture failures; no production routing gate was relaxed
(`45cfee1ce`).

Three browser witnesses failed during bundling: `web admission review:
recovery and transport respect the session boundary`, `browser session
authority commits through IndexedDB before releasing the session lock`, and
`web startup: immediate admin navigation, synchronous refusals and acquisition
hook`. Y's default `createApp`/`localStorageSessionStore` imports collided with
V's custom-entry imports in the same generated module. The isolated run
reproduced the parse errors. `witness/lib.mjs` now puts defaults in a separate
bootstrap module, preserving both globals and custom entries. Classification:
our integration harness defect, covered by the same three real-browser tests
(`b874b1da7`); their rerun passed all 82 tests, including nested cases.

The initial reference check found ten Z references to `#2.1a`, which is not
a supported abbreviated numbered anchor. They now use the full heading slug.
The final check passed: `ref-check: ok — 509 LLP docs, 9336 refs in 26494
files, 0 errors, 0 unchecked`.

Targeted validation passed: 119 routing tests, 10 read-through tests, 35
read-through review tests, all 83 guide tests, eight retained-expiry/permit
cases, 14 clock regressions, and 82 real-browser admission/session/startup tests. The supplied
`~/sb4-intent/target-clique.q` compiled with 21 tables, 13 operations, no
problems and six advisory notes (sparse window, two horizon notes, cursor,
synced maintains and maintained-column stream cost).

The source census found no tracked source file above 1,500 lines. Dedicated
why source pages top out at 3,679 bytes; the guide suite also checks actual
rendered and contextual why output against its 4 KB limit. The root diagnostics
registry and generated guide artifacts are unchanged: only `snapback4/` and
two governing LLPs differ from the fetched main. Accordingly the conditional
root `check-inventories.mjs` check is not applicable under the Snapback 4 fence.

## Open problems

No unresolved product or integration defect is known after the fixes and
the zero-failure full qualification recorded above. The declared
optional-service/platform skips are not a claim that PostgreSQL service tests,
macOS witnesses or the external published-tarball fence ran. The one-sample
inventory timing limitations below remain.

## Measurement and limitations

| Treatment | Whole-device rows | Logical row bytes | Cold acquisition (s) |
|---|---:|---:|---:|
| U round 1, before floors | 171,330 | 35,901,571 | 281.264 |
| U round 1, floors 1,000 | 98,543 | 15,092,169 | 117.813 |
| Z round 0, slots, follows fully synced | 49,315 | 7,386,725 | 59.746 |
| Integrated slots + packed storage, follows fully synced | 49,315 | 7,386,725 | 7.355 |
| Z round 0, slots, follows online only | 41,383 | 6,312,824 | 33.245 |
| Integrated slots + packed storage, follows online only | 41,383 | 6,312,824 | 8.352 |

| Following view's own partition | Rows | Logical row bytes | Separate cold acquisition (s) |
|---|---:|---:|---:|
| U round 1, before floors | 131,499 | 30,370,560 | not separately timed |
| U round 1, floors 1,000 | 58,712 | 9,561,158 | not separately timed |
| Z round 0, follows fully synced | 9,484 | 1,855,714 | 6.100 |
| Integrated, follows fully synced | 9,484 | 1,855,714 | 1.759 |
| Z round 0, follows online only | 3,563 | 1,003,090 | 2.294 |
| Integrated, follows online only | 3,563 | 1,003,090 | 0.834 |

The full and online-only treatments have exactly Z's snapshot rows and logical
bytes. Recorded cold time is respectively 8.12× and 3.98× lower than Z's earlier
single samples. These comparisons are whole-tree historical measurements,
not isolated causal estimates for packing. The online-only treatment was
slower than the full treatment in this run despite having fewer rows.

The 2,632,142,848-byte source snapshot has SHA-256
`3b8ad8663ce39b448b88df095a3f0fc58e686ae507fe65984571d46af87b840d`,
identical to Z's round-0 snapshot. [inventory.json](inventory.json) records
fixture, server, wasm, browser bundle, Quarry and harness fingerprints, each
table's rows/bytes, wire bytes and verified IndexedDB format-2 bucket counts.

The combined web artifact is **1,849,726 B raw / 521,532 B gzip** on Rust
1.97.0 and wasm-bindgen 0.2.127 without wasm-opt. The 522,000 B ratchet leaves
468 B. The initial size check exceeded the inherited 516,000 B gate by
5,532 B; the T integration merge records the measured ratchet and reason,
as requested. No runtime meter ceiling changes. The requested pinned heads actually
carry T's later 516,000 B and Z's later 500,000 B ratchets, although the brief
quotes their earlier 510,000 B and 499,000 B numbers. The requested hashes were
merged exactly and the final ratchet comes from the combined measurement.

Inventory timing covers authenticated `createLocalClient` through completed
IndexedDB acquisition, excluding login, page load, UI rendering and the
post-timer persistence inspection. Bytes are the UTF-8 JSON of snapshot row
data, so they compare to U/Z directly; they are not IndexedDB disk usage.
Each treatment uses an isolated SQLite backup and a fresh browser context.
Production builds set `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
as in the U/Z measurements. All four acquisitions persisted format-2 buckets;
the inspection is outside the timed interval.
The original fixture store is opened read-only for backup and never mutated.
The same scale actor, fixture and floor of 1,000 are retained. The harness
also runs Z's two view-only controls, separate from the requested whole-device
treatments.

No design was stopped or weakened. No new syntax or authorization policy was
invented during integration. The optional PostgreSQL feature compiles (`cargo check -p snapback4-core --features postgres`). PostgreSQL service-backed tests,
Kani and macOS/Expo witnesses remain outside `scripts/test.sh`; no
claim about running them is made here. Timing is a single sample per treatment
on the shared host, not an isolated multi-run benchmark or attribution of
packing's independent speedup.

Reproduce the inventory from `snapback4/` on this host:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 cargo build --profile production -p snapback4
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
node reports/20260925-event-slots/measure.mjs
```

`CLIQUE_SCALE_APP`, `CLIQUE_SCALE_LOG`, `SNAPBACK4_BIN`,
`INVENTORY_EVIDENCE` and `INVENTORY_SCRATCH` can relocate the fixture,
production binary and output. The default output is this integration report
directory; U's and Z's historical measurements are not overwritten.
