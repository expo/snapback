# Lane Z — owned events follow their source rows

2026-09-25 · LLP 3000.016 revision 12, increment 5 · branch `sb4-intent/z-event-slots`.

Implemented the accepted event-slot design. The view-own reduction exceeds 5× with either follows residency, including against the already-floored Lane U round-1 result. No packages were published and no branch was pushed.

Implementation commits: `b8400a49f` (slots, residency and activation), `98536bbac` (upgrade preview and compatibility witnesses), and `a57eb686b` (source-prediction dependencies and adversarial host replays). Final full-suite result: **`== 0 failure(s) in 612 s`**, exit 0.

## Inventory

| Run | View rows | View row bytes | View-only cold | Whole rows | Whole row bytes | Whole cold |
|---|---:|---:|---:|---:|---:|---:|
| U round 1, before | 131,499 | 30,370,560 | not measured | 171,330 | 35,901,571 | 281.264 s |
| U round 1, after floors | 58,712 | 9,561,158 | not measured | 98,543 | 15,092,169 | 117.812 s |
| Supplemental legacy view-only control | 131,499 | 30,370,560 | 201.325 s | — | — | — |
| Slots, follows sync public | 9,484 | 1,855,714 | 6.100 s | 49,315 | 7,386,725 | 59.746 s |
| Slots, follows online only | 3,563 | 1,003,090 | 2.294 s | 41,383 | 6,312,824 | 33.245 s |

Against U round 1 **after** source/inbox floors, fully synced follows reduce view rows **6.19×** and bytes **5.15×**; online-only follows reduce them **16.48×** and **9.53×**. Against U’s original before run, the corresponding reductions are 13.87×/16.37× and 36.91×/30.28×.

Each cell below is **rows / bytes**. Bytes are UTF-8 JSON of snapshot `event.data`, not physical database usage. Zero includes a table deliberately absent from the device partition.

| Table | U before | U after floors | Slots/full follows | Slots/online follows |
|---|---:|---:|---:|---:|
| `posts` | 50,228 / 13,496,683 | 1,000 / 299,000 | 1,000 / 332,000 | 1,000 / 332,000 |
| `reposts` | 1,004 / 161,640 | 1,000 / 161,000 | 1,000 / 219,000 | 1,000 / 219,000 |
| `follows` | 5,921 / 852,624 | 5,921 / 852,624 | 5,921 / 852,624 | 0 / 0 |
| `followingPosts` | 49,228 / 7,796,444 | 49,228 / 7,796,444 | 0 / 0 | 0 / 0 |
| `followingRemovedEvents` | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| `followingFeed` | 24,555 / 7,938,537 | 1,000 / 327,458 | 1,000 / 327,458 | 1,000 / 327,458 |
| `followingWork` | 63 / 22,132 | 63 / 22,132 | 63 / 22,132 | 63 / 22,132 |
| `followingEdges` | 500 / 102,500 | 500 / 102,500 | 500 / 102,500 | 500 / 102,500 |
| `conversations` | 100 / 23,596 | 100 / 23,596 | 100 / 23,596 | 100 / 23,596 |
| `followerCounts` | 1,006 / 110,689 | 1,006 / 110,689 | 1,006 / 110,689 | 0 / 0 |
| `followingCounts` | 1,005 / 110,588 | 1,005 / 110,588 | 1,005 / 110,588 | 0 / 0 |
| `likes` | 5,008 / 826,312 | 5,008 / 826,312 | 5,008 / 826,312 | 5,008 / 826,312 |
| `members` | 248 / 42,556 | 248 / 42,556 | 248 / 42,556 | 248 / 42,556 |
| `messages` | 500 / 127,606 | 500 / 127,606 | 500 / 127,606 | 500 / 127,606 |
| `profiles` | 1,008 / 357,825 | 1,008 / 357,825 | 1,008 / 357,825 | 1,008 / 357,825 |
| `reactionCounts` | 2,000 / 301,000 | 2,000 / 301,000 | 2,000 / 301,000 | 2,000 / 301,000 |
| `reactions` | 2,000 / 288,500 | 2,000 / 288,500 | 2,000 / 288,500 | 2,000 / 288,500 |
| `recipients` | 25,000 / 3,225,000 | 25,000 / 3,225,000 | 25,000 / 3,225,000 | 25,000 / 3,225,000 |
| `replyCounts` | 1,956 / 117,339 | 1,956 / 117,339 | 1,956 / 117,339 | 1,956 / 117,339 |
| `typing` | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

The view-own scope is exactly posts, reposts, follows and the five `following*` owned tables above. The other application aggregates, profiles, likes and messaging tables remain in the whole-partition counts. Afterward the whole partition is dominated by **25,000 recipients / 3,225,000 bytes**, followed by follows when synced and likes. Within the view, follows dominate the full-follows variant; posts, inbox copies and reposts dominate the online-follows variant.

### Method and storage format

- [measure.mjs](./measure.mjs) adapts Lane U’s round-1 harness; [inventory.json](./inventory.json) records every table, wire bytes, page counts and artifact digests, alongside U’s original inventory. [inventory-own-control.json](./inventory-own-control.json) records the supplementary legacy view-only acquisition. The scale log and read-only SQLite backup hashes match U exactly.
- All runs use headless Chromium 151.0.7922.34, the actual wasm web device and IndexedDB, and actor `u0500`. All slot treatments floor posts/reposts at 1,000; their inbox keeps its existing 1,000-row floor. Work and tombstones retain their existing semantics. The legacy control has no source/inbox floors.
- Both U’s measurements and these runs use the pre-Lane-V IndexedDB format (serialized row/index changes). These are logical row JSON bytes; neither set claims physical SQLite/IndexedDB disk size. The server uses isolated SQLite backups. No source store or credentials were changed or copied into the report.
- Whole cold time covers authenticated `createLocalClient` through completed acquisition, excluding login, page load, server schema adoption and UI rendering. View-only cold runs separately set unrelated application tables and aggregates to `online only`; their view-own inventories exactly match the whole runs. U did not record view-only cold times, so none are inferred.
- The supplemental view-only control uses U’s exact before-server binary (SHA-256 verified), the same fixture/backup, and the current web client/wasm on that legacy backend. It measures 201.325 s for precisely U’s before view inventory. The two slot treatments measure 6.100 s and 2.294 s for the same scope (33.00× and 87.76× faster in these runs). This new control is not U’s original whole-partition timing or a measurement of U’s floored view-only time.
- The measurements are one run per treatment on the shared host, not a latency distribution or an isolated-hardware throughput claim. The full test build overlapped this measurement; rows and bytes are deterministic, elapsed times include host contention.
- The measured binary/device digests are authoritative. Acquisition was measured on the slot implementation committed as `b8400a49f`, before the later read-only preflight diagnostic and query-dependency fix. Those changes do not alter snapshot selection, stored row images or the acquisition path. The final suite qualifies the final implementation.

Reproduce from `snapback4/` after building production, wasm and the package:

```sh
PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --profile production -p snapback4
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
node reports/20260925-event-slots/measure.mjs
node reports/20260925-event-slots/measure.mjs --legacy-own
```

`CLIQUE_SCALE_APP`, `CLIQUE_SCALE_LOG`, `SNAPBACK4_BIN` and `SNAPBACK4_BEFORE_BIN` can select the same completed fixture and binaries on another host. The harness creates its own isolated copies under `target/event-slots-scale`.

## Forms and behavior

The existing Following form now carries slots automatically; no slot syntax is author-visible:

```quarry
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view feed: activity where .actor = viewer or exists follows[viewer, .actor]
```

- A posts/reposts source with `sync public last 1000 by .at` retains its slot in every held source image and holds zero owned rows of that kind. With `sync public`, owned events still sync and apply normally; with `online only`, neither source nor that kind’s event state is held.
- Application follows now accept `sync public`, `sync public last 1000 by .id`, and `online only`. Their public read and owner write rules remain required.
- `insert posts { id: postId, authorId: viewer, at: now }` stamps the original live bit and predicts its own inbox copy when eligible. `update posts[postId] { removed: true }` clears that bit and tombstones the event. `insert reposts { id: repostId, actorId: viewer, postId, at: now }` stamps its minted event id; `delete reposts[viewer, postId]` tombstones the id read from the pre-delete image.
- `return feedPosts[eventId]` withholds an unknown miss; `return feedPosts last 10 by .at` withholds when it could contain a non-fully-synced kind. A hit of a fully synced kind is returned. `return feedPosts[actor, postId, false]` retains known-null semantics when originals are fully synced.
- `view totals: count feedPosts by .actorId` fences event-changing prediction for partial kinds. Adding `online only` to that aggregate restores the ordinary eligibility conditions.
- Existing `by <index>`, `merge`, `chunk`, `maintain` and legacy timeline declarations remain supported. The guide’s compiled programs and compatibility suites pass; event-state residency and its corresponding diagnostics/count expectations deliberately change.

## Implementation, file by file

- [`crates/snapback4-core/src/schema/timeline.rs`](../../crates/snapback4-core/src/schema/timeline.rs): Canonical per-declaration/per-role slot names; legacy-backend compatibility; per-kind residency, ordinary-event coverage, aggregate dependencies and per-transition inputs.
- [`crates/snapback4-core/src/engine/timeline/slots.rs`](../../crates/snapback4-core/src/engine/timeline/slots.rs): Metered slot preparation, witnessed original/repost lookups, partial-kind aggregate fence, tombstoning and unknown-event read detection.
- [`crates/snapback4-core/src/engine/timeline.rs`](../../crates/snapback4-core/src/engine/timeline.rs): Transitions consume source slots, use the stamped repost identity, and omit partial owned-row writes on devices while keeping own inbox delivery.
- [`crates/snapback4-core/src/engine/write.rs`](../../crates/snapback4-core/src/engine/write.rs): Prepare each insert/update slot before the one physical source write and its row-change/log accounting; deletion retains the pre-delete witness.
- [`crates/snapback4-core/src/engine/validate.rs`](../../crates/snapback4-core/src/engine/validate.rs): Separate pre-slot application validation from final required-slot validation.
- [`crates/snapback4-core/src/engine/recorded.rs`](../../crates/snapback4-core/src/engine/recorded.rs): Reject slot fields in application payloads and strip slots from application row images.
- [`crates/snapback4-core/src/engine/read.rs`](../../crates/snapback4-core/src/engine/read.rs): Unknown ordinary event misses/probes/scans trigger withholding; internal transitions retain slot access while public row results strip them.
- [`crates/snapback4-core/src/engine/write_target.rs`](../../crates/snapback4-core/src/engine/write_target.rs): Expose the existing conservative row-copy allowance inside the crate for activation lookup prepayment.
- [`crates/snapback4-core/src/engine/mod.rs`](../../crates/snapback4-core/src/engine/mod.rs): Re-export that crate-private allowance for slot activation.
- [`crates/snapback4-core/src/partition.rs`](../../crates/snapback4-core/src/partition.rs): Filter non-fully-synced event kinds in the horizonless snapshot walk; no serving-time pairing or event horizon.
- [`crates/snapback4-core/src/store/event_slots.rs`](../../crates/snapback4-core/src/store/event_slots.rs): Fill newly added slots from byActorPost at one pinned time inside the adoption transaction, in metered pages and without partition logs.
- [`crates/snapback4-core/src/store/activation.rs`](../../crates/snapback4-core/src/store/activation.rs): Run slot fill before successor assessment and row validation.
- [`crates/snapback4-core/src/store/successor.rs`](../../crates/snapback4-core/src/store/successor.rs): Read-only preflight recognizes the engine-filled required bool without mutating the old store.
- [`crates/snapback4-core/src/store.rs`](../../crates/snapback4-core/src/store.rs): Register the slot-activation module.
- [`crates/snapback4-core/src/successor.rs`](../../crates/snapback4-core/src/successor.rs): Any newly added slot vetoes literal-default image retention, including an optional repost slot beside an unrelated default.
- [`crates/snapback4-device/src/device/snapshot.rs`](../../crates/snapback4-device/src/device/snapshot.rs): Ignore non-fully-synced owned puts during snapshot staging and catch-up; source slots travel with their images.
- [`crates/snapback4-device/src/device/deferred.rs`](../../crates/snapback4-device/src/device/deferred.rs): Apply the same event-kind filtering during ordinary and deferred stream folding; raw deletes never touch source slots.
- [`crates/snapback4-lang/src/bind/timeline.rs`](../../crates/snapback4-lang/src/bind/timeline.rs): Admit public follows residency choices, inject required-bool/optional-id columns, and attach named aggregate fences and transition inputs.
- [`crates/snapback4-lang/src/bind/residency.rs`](../../crates/snapback4-lang/src/bind/residency.rs): Classify ordinary partial-event reads as horizon sites, with literal-key refinement for a fully synced kind, including rule probes.
- [`crates/snapback4-lang/src/emit.rs`](../../crates/snapback4-lang/src/emit.rs): Exclude slots from TypeScript application row types.
- [`crates/snapback4-lang/src/emit/rust.rs`](../../crates/snapback4-lang/src/emit/rust.rs): Exclude slots from native row/write structs and field-name allocation.
- [`crates/snapback4-lang/src/guide/language.rs`](../../crates/snapback4-lang/src/guide/language.rs): Compile the Following example with online-only application follows.
- [`crates/snapback4-lang/src/guide/feeds.md`](../../crates/snapback4-lang/src/guide/feeds.md): Explain only the required residency, event-read, source-slot prediction and aggregate-fence changes.
- [`crates/snapback4-lang/src/guide/codes.rs`](../../crates/snapback4-lang/src/guide/codes.rs): Update E_TIMELINE_SHAPE guidance for public follows residency; no new refusal code.
- [`crates/snapback4/src/timeline_cost.rs`](../../crates/snapback4/src/timeline_cost.rs): Report each kind’s event residency and the actual follows residency while retaining server write and work bounds.
- [`packages/snapback4/src/backend.ts`](../../packages/snapback4/src/backend.ts): Include partial event sources in query dependency expansion so source predictions fence event fallback and invalidate observations. Neither local.ts nor local-query.ts was edited.
- [`crates/snapback4-device/tests/event_slots.rs`](../../crates/snapback4-device/tests/event_slots.rs): Six memory/SQLite tests for all nine residency combinations, transition behavior, direct slot/index agreement, read-only preflight and interrupted upgrades.
- [`crates/snapback4-device/tests/event_slots_trace.rs`](../../crates/snapback4-device/tests/event_slots_trace.rs): Nineteen server-generated adversarial schedules with asserted semantics, exported for actual device-host replay.
- [`packages/snapback4/test/event-slots.test.mjs`](../../packages/snapback4/test/event-slots.test.mjs): Replay every exported schedule through actual wasm and native devices, including persisted reopen. Only host-local send revision is substituted in its captured echo.
- [`packages/snapback4/test/bounded-following.test.mjs`](../../packages/snapback4/test/bounded-following.test.mjs): Add two public-client tests proving event-read offline withholding, pending source-prediction fencing (including an untaken conditional branch), later server fallback and failed-transport withholding.
- [`crates/snapback4-lang/tests/bounded_following.rs`](../../crates/snapback4-lang/tests/bounded_following.rs): Six compiler tests: source/follows admission, fixed slot shapes, hidden generated fields, exact transition classes, ordinary-event classes and named aggregate fences.
- [`crates/snapback4-device/tests/bounded_following.rs`](../../crates/snapback4-device/tests/bounded_following.rs): Update deliberate partial-event row-count changes; retain existing horizon and missing-card tests.
- [`crates/snapback4-device/tests/timeline.rs`](../../crates/snapback4-device/tests/timeline.rs): Move the synthetic unheld-event dependency witness to the original source row which now owns that event state.
- [`crates/snapback4-device/tests/timeline/round1.rs`](../../crates/snapback4-device/tests/timeline/round1.rs): Likewise test retained-only source coverage rather than the now-unused owned-event lookup.
- [`crates/snapback4-lang/tests/guide/refusal_actions.rs`](../../crates/snapback4-lang/tests/guide/refusal_actions.rs): Update the tested E_TIMELINE_SHAPE definition for relaxed follows residency.
- [`crates/snapback4/tests/following_view.rs`](../../crates/snapback4/tests/following_view.rs): Assert the new per-kind event residency certificate.
- [`crates/snapback4/tests/timeline/admission.rs`](../../crates/snapback4/tests/timeline/admission.rs): Legacy declaration tests now admit online-only follows and public follows horizons; authority, source time ordering and expiry refusals stay tested.
- [`crates/snapback4/tests/timeline/review.rs`](../../crates/snapback4/tests/timeline/review.rs): The trusted missing-event fixture now also carries a filled false slot, preserving the slot/index invariant while retaining its cleanup and authorization checks.
- [`crates/snapback4/tests/timeline_adoption.rs`](../../crates/snapback4/tests/timeline_adoption.rs): Retirement preserves application data and the surviving declaration’s slots, and removes the retired declaration’s engine fields.
- [`metrics/wasm-budget.json`](../../metrics/wasm-budget.json): Raise the measured gzip ratchet from 496,000 to 499,000 B with its reason; runtime meters are unchanged.
- [`JOURNAL.md`](../../JOURNAL.md): Append one dated execution and measurement entry.
- [`reports/20260925-event-slots/measure.mjs`](../../reports/20260925-event-slots/measure.mjs): Reproducible four-treatment adaptation of U’s inventory harness, plus the supplemental legacy view-only control.
- [`reports/20260925-event-slots/inventory.json`](../../reports/20260925-event-slots/inventory.json): Raw measured inventories, timings, fingerprints and U’s comparison inventory.
- [`reports/20260925-event-slots/inventory-own-control.json`](../../reports/20260925-event-slots/inventory-own-control.json): Supplemental legacy view-only inventory, cold time and artifact fingerprints.
- [`reports/20260925-event-slots/test-first.log.gz`](../../reports/20260925-event-slots/test-first.log.gz): Complete first full-suite log, with the compatibility failures below.
- [`reports/20260925-event-slots/test-final.log.gz`](../../reports/20260925-event-slots/test-final.log.gz): Complete final full-suite log.
- [`reports/20260925-event-slots/REPORT.md`](../../reports/20260925-event-slots/REPORT.md): This implementation, test, inventory and deviation record.

## Tests and what they establish

- `event_slots.rs`: `residencies::{memory,sqlite}` cover all 3×3 source residency combinations, fully synced hits and kind-specific known misses, partial scans/unknown misses and raw row inventories. `source_transitions::{memory,sqlite}` cover predicted removal/unrepost/repost without partial owned rows and unheld-source queueing. `interrupted_activation::{memory,sqlite}` covers populated legacy backfill, required-bit and optional-id retention vetoes beside a literal default, read-only preview, no activation logs, and interrupted/reopened reacquisition. The helper compares every held source slot with the server’s actual `byActorPost` index lookup after writes and adoption.
- `event_slots_trace.rs` exports 19 asserted schedules. `event-slots.test.mjs` runs each on actual wasm and native hosts (**38 passing replays**): same-mutation birth/edit and a whole-floor backdated insert; A/B normalized removal; snapshot deletion before insert catch-up; source-id reuse for another original; interrupted snapshot reopen; floored and online-only ordinary event point/scan/rule probes; synced versus online-only aggregate fence including a direct-predict bypass attempt; shared sources with distinct originals filters and independent declaration retirement; slot activation beside `pinned`; deferred normalized images and reopen; unheld removal/unrepost/repost; event-id reuse in both split/whole delivery and original/repost incarnations; and all four fully-synced/floored live/reply/removed transition combinations. Those last schedules also compare server/predicted minted ids and verify application rows omit slots.
- Public-client `owned-event fallback waits for the source prediction` runs on wasm and native (**2 passing tests**) and proves the source-slot dependency participates in client invalidation and fallback fencing without an owned-event predicted row. Existing bounded-Following tests continue to cover original-cursor fallback, quiet authors, inbox floors, held queries, meter cuts, pending post observation and native query modules.
- Compiler tests verify a plain post insert stays eligible with only a Held tombstone input; unrepost has no original-post site; literal full-kind event reads remain Held; other event reads are Horizon; synced aggregates are named Server sites; and online-only aggregates remove that fence. The language card, all guide blocks and definition checks pass (**80 guide tests**).
- Compatibility validation: device timeline **26/26**, CLI Following **2/2**, CLI timeline **23/23**, CLI adoption **9/9**, basic event slots **6/6**, bounded language **6/6**. No modified source file exceeds 1,500 lines.

Standalone fault replay:

```sh
cargo test -p snapback4-device --test event_slots_trace
node --test packages/snapback4/test/event-slots.test.mjs
```

## Full-suite results and failure accounting

Both full invocations use one lane-owned suite at a time, `SNAPBACK4_RUST_TEST_PROCESSES=8 CARGO_BUILD_JOBS=8 taskset -c 0-15 bash scripts/test.sh`, from `snapback4/`. The shared host’s cold link/build work exceeds the repository’s nominal 60-second budget; no timeout or test count was relaxed.

The first exact summary was **`== 1 failure(s) in 1061 s`**, with failed step **`cargo test`**. Every failing test was ours (none baseline or environmental):

1. `snapback4-device::event_slots_trace::emit_fault_schedules_for_wasm_and_native`: the retirement fixture retained new rule-probe tables pointing at the retired event table. The fixture now retires those dependent tables too.
2. `snapback4-device::timeline::declared_timeline_unheld_memory`.
3. `snapback4-device::timeline::declared_timeline_unheld_sqlite`.
4. `snapback4-device::timeline::round1::retained_inputs_memory`.
5. `snapback4-device::timeline::round1::retained_inputs_sqlite`.
   These four tests injected missing/retained owned-event metadata. The accepted design deliberately moves that dependency onto the source’s slot; the same adversarial tests now remove/retain the actual source witness.
6. `snapback4::following_view::bounded_target_certificate_names_whole_partition_floors_and_card_fallback`: old full-owned-event certificate expectation; updated to the two source-slot kinds.
7. `snapback4::timeline::admission::admission_refuses_every_unsupported_bridge_shape`: old refusal expectation for follows residency; updated to the newly admitted forms.
8. `snapback4::timeline::review::original_removal_with_missing_event_still_hides_private_copies`: its hand-built trusted fixture removed the event but left the newly added slot true. It now records the matching false slot while retaining the same removal/authorization proof.
9. `snapback4::timeline_adoption::dev_removes_populated_view_and_preserves_sources_and_other_views`: raw source equality included the retired declaration’s slot. It now expects that field to disappear and all surviving data to remain equal.

Focused development runs additionally caught the stale guide definition, initial fixture namespace/store-name mistakes, and an invalid expectation that a duplicate repost would reach FEED_POST_NOT_FOUND before its existing uniqueness refusal. All were corrected in tests; the uniqueness order was preserved. The web replay echoes its own send revision because a reopen fences older sends; it compares every other acquisition, outbox and query result.

The supplied baseline ended **`== 1 failure(s) in 276 s`** (`cargo test`), naming `schema_capabilities_legacy::genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`, `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots`, `readauth::census::authoring_census`, and `snapback4/check::w9b_why_operation_keeps_residency_and_cost_output`. None reproduced in this lane’s full runs, and no fixes to them were made.

The final exact summary is **`== 0 failure(s) in 612 s`**, exit **0**. All build, wasm budget, release guard, package, Rust, application typecheck, fixture wrapper, client and model stages passed. The main client run reports **1,592 passes and 10 existing skips**; all **78 model tests** pass. There are **no final failures** to classify as ours, baseline or environmental. No source or test changed after this qualification; the final commit adds this evidence and the journal entry.

## Decisions, deviations and remaining scope

- No change to the accepted slot/residency/transition design was needed. Engine columns use `$timeline:<declaration>:post` and `$timeline:<declaration>:repost`, avoiding a new wire-side pairing structure or a second source write.
- Existing serialized revision-5 backends without these columns keep their old fully synced event semantics until normal adoption adds the slots. This avoids requiring a history reconstruction or an artificial timeline version bump.
- Static aggregate fencing conservatively treats a source update as a potential event transition, consistent with the existing table/write-kind effect summary; the runtime fence fires when an event is actually inserted or removed. There is no new data or authority permission.
- The extra read-only successor preview and `backend.ts` dependency expansion are required integration work: otherwise `check` rejects a safe slot upgrade or a server answer can pass a pending source-slot prediction. Lane U’s `local.ts` and `local-query.ts` remain untouched.
- The wasm budget is the only raised bound: **1,787,614 B raw / 498,768 B gzip**, versus U’s recorded 1,776,325 / 495,299 (+11,289 / +3,469). The smallest rounded gzip budget is **499,000 B**, leaving 232 B. This is a whole-artifact comparison, not per-feature attribution. Examined, steps, heap, output, rule-probe, index-entry and write ceilings remain unchanged.
- No owned event horizon, time-based event selection, tombstone bounding, history-window change, serving-time pairing, slot repair of arbitrary corrupt trusted imports, package publication or push. No Lane V packed storage changes were imported.
- No open correctness failure or blocked design part is known after the listed tests. The independent blind code reviews and integration are the supervisor’s remaining work.
