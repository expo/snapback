**Chunk 1b — progressive history on the Rust device — 2026-11-02**

Implemented in the existing `sb4/progressive-history` worktree, left uncommitted for the supervisor. No agents, clones, remote commands, commits, stash, checkout, rebase or push. No client source, wasm build source, guide, JOURNAL or LLP changes. This report is the stop point; no next-chunk implementation was started.

The final full device run passed (1,591 passed, 4 ignored), as did the core suite (1,293 passed, 6 ignored) and simulator suite (750 passed, 7 ignored). These are sums of the emitted target summaries, not unique cross-target scenarios. The required affected runner was attempted but **did not complete**; see the precise limitation below. Earlier failed runs and their fixes are retained.

**Changes and code locations**

All paths in this table are within `snapback4/`.

| File and line | Change |
| --- | --- |
| [crates/snapback4-device/src/device.rs:48](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device.rs:48) | Accept the legacy backend encoding and the new durable progressive discriminator; reject ambiguous generation fields. Wire serialization remains unchanged. |
| [crates/snapback4-device/src/device.rs:87](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device.rs:87) | Add durable progress to `SyncState`: cursor, exhaustion, whole-table names, floored-group count, replacement requirement. |
| [crates/snapback4-device/src/device.rs:131](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device.rs:131) | Add optional `StreamPage.acquire`, consuming the chunk 1a shape unchanged. |
| [crates/snapback4-device/src/device/acquisition.rs:11](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/acquisition.rs:11) | Define the acquisition unit/progress types and validate cold acquisition versus staged replacement. Unsupported whole-table facts and invalid completion evidence are refused using existing error codes. |
| [crates/snapback4-device/src/device/acquisition.rs:56](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/acquisition.rs:56) | Stamp the durable backend on first accepted acquisition, preserving rows, outbox, outcomes, schema and program paths. Prior Backend decoders require `generation` and refuse this saved envelope, which uses `progressive_generation`. |
| [crates/snapback4-device/src/device/acquisition.rs:75](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/acquisition.rs:75) | Apply cursor, whole-table facts and completion evidence through the ordinary recording applicator; touch completed tables, including empty ones. |
| [crates/snapback4-device/src/device/acquisition.rs:88](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/acquisition.rs:88) | Distinguish cold delivered-history membership from a genuine retained rejoin. Tier-1 delivered-history rows establish their existing Held membership; Left/Rejoined remains conservative. |
| [crates/snapback4-device/src/device/acquisition.rs:124](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/acquisition.rs:124) | Publish `ACQUIRED` only after progressive exhaustion and application through the final image head; reset progressive facts for staged replacement. |
| [crates/snapback4-device/src/device/acquisition.rs:150](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/acquisition.rs:150) | Query-only admission using `ir::read_sites`, whole-table facts and existing published boundaries. Mutation/prediction admission still calls the existing global gate. |
| [crates/snapback4-device/src/device/boundary.rs:16](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/boundary.rs:16) | Rebuild the derived floor count on open, preserving missing-zero legacy metadata; maintain it transactionally as changed group markers/scopes are saved. It is status data, never coverage evidence. |
| [crates/snapback4-device/src/device/boundary.rs:45](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/boundary.rs:45) | Add table-boundary discovery and count known floors; reuse marker validation and ordinary row admission. Cold held rows do not falsely turn the first acquisition into a retained rejoin. |
| [crates/snapback4-device/src/device/deferred.rs:210](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/deferred.rs:210) | Pass progressive context into ordinary boundary markers while respecting earlier scope events; apply history and acquisition facts through the same recorder used by Repair B. |
| [crates/snapback4-device/src/device.rs:838](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device.rs:838) | Validate and stamp acquisition inside the existing application transaction before the unchanged `should_defer` decision. |
| [crates/snapback4-device/src/device.rs:978](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device.rs:978) | Commit completion with the applied watermark and all row/media/base/outcome effects. |
| [crates/snapback4-device/src/device.rs:1043](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device.rs:1043) | Load published boundaries once per query and reuse them for admission and coverage frames. |
| [crates/snapback4-device/src/device/store_identity.rs:17](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/store_identity.rs:17) | Include cursor/replacement state in adoption captures; clear progressive state and boundaries on store replacement or same-store restore refusal. |
| [crates/snapback4-device/src/device.rs:450](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device.rs:450) | Clear progress during generation/schema reset; the explicit row-clear path at line 774 does likewise. |
| [crates/snapback4-device/src/device/opening_native.rs:12](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/opening_native.rs:12) | Include progress-count recovery in native opening's existing atomic acceptance transaction; the non-native opening path does the corresponding initialization. |
| [crates/snapback4-device/src/device/snapshot.rs:1](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/snapshot.rs:1) | Adapt the existing staged marker call to the additional progressive-context parameter; staged snapshots pass false. |
| [crates/snapback4-device/src/memory.rs:110](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/memory.rs:110) | Test-only commit failure hook, consumed before commit so transaction Drop rolls the unit back. No production MemoryStore field/format change. |
| [crates/snapback4-device/src/device/progressive_tests.rs:50](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/src/device/progressive_tests.rs:50) | Atomic rollback/persistence, saved-format refusal, media-upgrade refusal and own-write deferral witnesses. |
| [crates/snapback4-device/tests/progressive_history.rs:122](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-device/tests/progressive_history.rs:122) | Engine-to-device witnesses on memory and SQLite, plus a real child-process SQLite reopen. |
| [crates/snapback4-sim/tests/progressive_history.rs:75](/Users/ccheever/projects/snapback-ph-20261102/snapback4/crates/snapback4-sim/tests/progressive_history.rs:75) | Thirty-two bounded acquisition/stream/reopen schedules with a full snapshot/catch-up oracle. |

The largest changed source is `device.rs` at 1,441 lines. The acquisition helper is 176 lines; the new integration test is 329 lines. No changed/new source exceeds the 1,500-line limit. Large evidence logs were split losslessly into parts below that limit; [LOGS.json](LOGS.json) records original names, parts, line counts and concatenated SHA-256 hashes.

**Publication and recovery**

The server page shape from 1a is unchanged: `acquire.unit`, `cursor`, `exhausted`, `whole_tables`, alongside ordinary events, acquisitions, joins, watermark, image-head and pending-write evidence. Additional server hint/skipped fields remain harmless unknown fields to the device's additive decoder.

Rows use the ordinary put-by-id path, including indexes and media bookkeeping. Published boundaries, table facts and cursor are written in that same transaction. Repair B's `should_defer` runs unchanged: if it defers a page, the existing deferred recorder holds its rows **and** floor/cursor/table/completion metadata. Published progress does not move, and affected observations are notified only on publication. Tests cover reopen while this private bundle exists.

Durable keys:

| Key | Meaning |
| --- | --- |
| `device:acquisition-cursor` | Opaque next cursor; empty means the walk exhausted, absence means no active progressive walk. |
| `device:acquired-table:<name>` | Eligible horizonless table completed, with the applied watermark at completion. One entry per such table. |
| Existing `device:acquisition-boundaries:` namespace | Server-named group floor/whole, with existing unfinished/unknown meanings. |
| `device:acquisition-complete-at` | Final served image head that the sole applied WATERMARK must reach before whole-partition readiness. |
| `device:acquisition-group-count` | Derived progress count, saved/deferred with boundary changes and reconstructed on open. |
| `device:acquisition-replacement` | Reset requires the existing staged full replacement. |
| `device:progressive-format` | Preserve the old-reader refusal discriminator across reopening/adoption. |

There remains one applied partition watermark. The final image head is fixed completion evidence, not a second applied cut or per-group cut. An ordinary terminal stream page cannot finish an active, unexhausted walk. Continuing writes can pass the captured completion target without requiring quiescence. Progressive re-acquisition is refused after generation/store reset or a media-format upgrade.

Query preflight admits a program only when every synced read-site table has a whole fact or a published table boundary; existing range frames then decide exact coverage. Incomplete ranges, missing points and unsafe counts remain unknown. Native query programs keep the old global gate. A valid found row on a horizoned table retains the RFC's existing point-read semantics; it does not certify its surrounding range. Mutations/predictions retain `require_acquired`.

**Unwalked-group choice: HOLD**

The existing ordinary applicator already accepts unwalked puts. Keeping this behavior avoids a new membership/filtering path and lets subsequent edits/deletes repair the same held row. Its history range remains unknown until a valid floor is published; a missing-row deletion remains a no-op. Known floors retain the existing filtering of previously unheld rows below the floor. Scope and authority processing is unchanged. No storage-benefit comparison against DROP was measured in this chunk.

**Witnesses and limits**

| RFC case | Concrete witness |
| --- | --- |
| 1, tier 1 and restart | `tier1_and_group_read_admission_survive_reopen_on_both_stores`: whole inbox and thread rows before messages; memory and SQLite reopen. |
| 2, foreground group while incomplete | Same test: A's newest page is complete while `acquired=false`; B is unknown and explicitly `complete=false`; an empty group is complete/empty. |
| 3, floor boundary and unsafe reads | Same test: paging across A's floor is incomplete, missing `exists` and count are unknown, mutation prediction is still refused. Timestamp ties use the id tie-break. |
| 4, in-flight changes | `inflight_insert_edit_delete_and_order_key_move` applies response before/after the stream; stale responses are rejected and retried. `real_server_own_write_image_defers_acquisition_and_survives_reopen` supplies real `committed_above`, and checks n=1 rather than a double replay. A unit test also checks deferred cursor, floor and completion. Existing pending custody is imported via the established enqueue/recovery path; fresh prediction remains gated. |
| 5, revoke/rejoin | `revoke_rejoin_and_delayed_old_page_obey_both_policies` checks both retention policies, rejects the delayed pre-scope response, and leaves retained rejoin unknown until replacement. |
| 6, one commit / three groups | `one_commit_two_floored_groups_and_an_unwalked_group_is_held` applies an actual engine commit touching A, B and C; A/B are locally covered, C is held but its range unknown, and its later deletion is not resurrected by acquisition. This directly isolates the commit's applicator effects: it requests from the seeded engine baseline and substitutes the device's requested-watermark echo. A complete from-zero transport schedule would also acquire C via the fixture's historical membership joins. This is a direct applicator witness, not a full network scheduling witness. |
| 7, persistence failure | Test-only MemoryTx failure before commit leaves exported rows/metadata byte-identical. Host persistence loss after a memory commit is modeled by reopening the prior durable export; successful persistence reopens the new unit. Both tier-1 and group units are exercised. This does not execute IndexedDB. |
| 10, lifecycle | Generation adoption, store replacement and restore refusal clear cursor/facts/floors/count. Generation/replacement reject progressive pages and complete through staged snapshot/catch-up. A separate process reopens a partial SQLite acquisition. |
| Quiescence oracle | Device fixture compares final rows, boundaries, whole-table names and history answers against full snapshot plus catch-up, with reopen after every acquisition. Simulator runs 32 interleavings and compares rows/floors/whole-fact presence plus covered query answers. Table-fact timestamps are normalized because the paths legitimately acquire at different watermarks. |

The simulator checks current-server answers after catch-up, not in the middle of legitimate current-image convergence. Its moving-row fixture has a whole ten-row horizon; the device oracle also exercises a bounded suffix with ties. These are concrete convergence witnesses, not a claim that all held rows are always the exact current horizon. No exact horizon maintenance was added.

**Where the existing code differs from the RFC's description**

- The pre-change device also marked a terminal **ordinary** page acquired, including legacy replacement/resumption cases. It was not limited to staged snapshot completion as §2 suggests. Existing Repair B tests exposed this. Legacy stores retain that behavior; active progressive walks cannot use it, and upgraded replacement paths stay staged.
- Same-store head regression is an existing persistent `E_STORE_RESTORE` halt, not an automatic staged retry. This chunk clears progressive claims on refusal and preserves the halt. It does not attempt to reacquire a refused incarnation.
- Chunk 1a's acquisition page has `watermark=from` and `images_at=current head`. Thus exhaustion waits for the ordinary watermark to cover the final image head, as §6.2 requires.
- Real repository section anchors for the numbered RFC subsections remove the dot (for example `#61-the-acquisition-page`). The added references use the forms validated by ref-check.

**Validation outcome and remaining supervisor work**

| Command | Observed result |
| --- | --- |
| `cargo test -p snapback4-device` | Run three times while fixing regressions: legacy replacement completion, boundary namespace scanning, then a zero-count legacy-open rewrite. All failed-run summaries are preserved below. |
| `cargo test -p snapback4-device --no-fail-fast` | Final full suite, exit 0; 1,591 passed, 4 ignored. Includes 67 library tests, all 10 progressive-history integration tests, all 110 Repair B tests, and the boundary-scan regression. |
| `cargo test -p snapback4-sim` | Both full runs exit 0; latest 750 passed, 7 ignored. Final 32-schedule oracle also rerun after the last legacy-zero optimization: exit 0. |
| `cargo test -p snapback4-core` | Exit 0; 1,293 passed, 6 ignored, including doctests. Core source was not changed in this chunk. |
| `cargo check -p snapback4-device --no-default-features` | Final check exit 0; validates the non-native Rust path without building the wasm product. |
| `./ref-check --verbose` | Latest: 583 LLP docs, 12,965 refs, 0 errors, 0 unchecked. Run with pinned Node 24.18.0 via Volta. |
| `git diff --check` | Final exit 0, no output. |
| `node scripts/affected.mjs --base origin/main --worktree --run` | **Incomplete, exit 1 after interruption.** Selected 32 commands, 7 whole Rust packages and 489 client files, including inherited 1a changes. `bun install --frozen-lockfile` completed with no changes. Interrupted in the build-cli stage before excluded wasm/client stages; its compiler subsequently printed a Finished line. The runner did not record CLI-stage completion. No affected-gate pass is claimed. |

The affected receipt is `target/affected/491bc5949327-1793618931395.json` at the repository root, generated there by the required runner itself. It records only successful install-client and `complete:false`. No source outside `snapback4/` was edited. The incomplete receipt predates the final device fixes and cannot certify the final tree.

Not run: `react.test.mjs` and `witness/idb.mjs` — **not run (sandbox)**, per the supplied SIGABRT limitation. Product wasm build, remaining affected-runner client/browser stages, client scheduling/negotiation, hook/UI integration, heavy-account timing/heap/bytes and packed publication qualification were outside this chunk. No loopback failure occurred in the completed requested suites, so no loopback retry was needed. Existing ignored tests remain ignored and are counted above.

No unresolved Rust test failure remains. Integration questions/obligations for the supervisor's next chunk:

- Negotiate server support **and** detect the upgraded device's additive SyncState fields before choosing this path. Server capability alone cannot make an older device understand `acquire`; no device capability identity was changed here.
- Resume the durable cursor, distinguish exhaustion from an unstarted null cursor, and serialize acquisition requests. Do not advance durable/UI progress from an unpublished response.
- If application reports `published=false` or reopening finds publication pending, drain the ordinary stream before advancing the walk. At watermark zero, use the server's existing `stream:true` switch; otherwise its legacy zero request selects a snapshot.
- Use staged whole replacement when `replacement_required` is set, and keep the existing restore-refusal halt. Select progressive acquisition before a legacy terminal ordinary page can claim an otherwise unmarked cold store.
- Run the excluded browser/IndexedDB and affected remainder in the supervisor environment. The old-reader refusal test reconstructs the previous required-generation decoder; an installed-old-binary matrix was not run.

**Command record**

[COMMANDS.json](COMMANDS.json) contains every directly invoked shell command, its working directory, exact multiline text, originating log parts, observed exit code where collected, and verbatim summary lines. File reads/edits have no independent test verdict; the ledger explicitly says so. Session polls are continuations of those commands, not additional shell commands. The affected-runner Ctrl-C is described above. Patch-tool edits are represented by the working-tree diff, not invented shell commands.

The following index maps each invocation to that ledger; long inspection/script commands are abbreviated here only. All cargo, bun and Node application commands ran from `snapback4/`; root ref-check was invoked via its repository-root wrapper. Log splitting occurred only after commands ended, and concatenations were verified byte-for-byte.

| ID | Working directory | Command (first line; exact text in ledger) | Summary |
| --- | --- | --- | --- |
| 1 | repository root | `cat llp/3000.001.001-prioritized-progressively-usable-history.rfc.md` | Read/edit/inspection; no independent test verdict |
| 2 | repository root | `sed -n '306,385p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md` | Read/edit/inspection; no independent test verdict |
| 3 | repository root | `cat snapback4/AGENTS.md snapback4/NOT-DOING.md snapback4/reports/20261102-progressive-history-1a/REPORT.md` | Read/edit/inspection; no independent test verdict |
| 4 | repository root | `cat skills/llp-orient/SKILL.md; rg -n 'Repair A\|Repair B\|^## ' llp/3000.001-durable-replica-and-write-lifecycle.research.md; git status --short; …` | Read/edit/inspection; no independent test verdict |
| 5 | repository root | `sed -n '285,310p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md; sed -n '650,845p' llp/3000.001-durable-replica-and-write-lifecy…` | Read/edit/inspection; no independent test verdict |
| 6 | repository root | `cat snapback4/NOT-DOING.md; sed -n '180,420p' snapback4/AGENTS.md` | Read/edit/inspection; no independent test verdict |
| 7 | repository root | `sed -n '1,215p' snapback4/reports/20261102-progressive-history-1a/REPORT.md` | Read/edit/inspection; no independent test verdict |
| 8 | repository root | `mkdir -p snapback4/reports/20261102-progressive-history-1b` | Read/edit/inspection; no independent test verdict |
| 9 | repository root | `cat snapback4/crates/snapback4-core/src/engine/acquisition.rs snapback4/crates/snapback4/src/serve_acquire.rs` | Read/edit/inspection; no independent test verdict |
| 10 | repository root | `cat snapback4/crates/snapback4-core/src/partition/acquire.rs` | Read/edit/inspection; no independent test verdict |
| 11 | repository root | `sed -n '1,240p' snapback4/crates/snapback4-device/src/device.rs` | Read/edit/inspection; no independent test verdict |
| 12 | repository root | `sed -n '240,730p' snapback4/crates/snapback4-device/src/device.rs` | Read/edit/inspection; no independent test verdict |
| 13 | repository root | `sed -n '730,1070p' snapback4/crates/snapback4-device/src/device.rs; cat snapback4/crates/snapback4-device/src/device/deferred.rs` | Read/edit/inspection; no independent test verdict |
| 14 | repository root | `cat snapback4/crates/snapback4-device/src/device/boundary.rs; sed -n '1,260p' snapback4/crates/snapback4-device/src/device/history.rs` | Read/edit/inspection; no independent test verdict |
| 15 | repository root | `rg -n 'ACQUIRED\|BOUNDARIES\|restore_refus\|reset_publication\|FORMAT\|version' snapback4/crates/snapback4-device/src/device/store_identity.rs snap…` | Read/edit/inspection; no independent test verdict |
| 16 | repository root | `rg -n 'FORMAT\|format_version\|store_version\|STORE_VERSION\|compatib\|version' snapback4/crates/snapback4-device/src/{memory*,native*,store*,lib.r…` | Read/edit/inspection; no independent test verdict |
| 17 | repository root | `rg --files snapback4/crates/snapback4-device \| rg '(publication\|format\|version\|memory\|native\|store)'; cat snapback4/crates/snapback4-device/s…` | Read/edit/inspection; no independent test verdict |
| 18 | repository root | `cat snapback4/crates/snapback4-device/src/device/publication_tests.rs; cat snapback4/crates/snapback4-device/src/opening.rs; cat snapback4/crates/s…` | Read/edit/inspection; no independent test verdict |
| 19 | repository root | `sed -n '1,220p' snapback4/crates/snapback4-core/tests/progressive_acquisition.rs; sed -n '1,185p' snapback4/crates/snapback4-device/tests/repair_b.…` | Read/edit/inspection; no independent test verdict |
| 20 | repository root | `cat snapback4/crates/snapback4-device/src/store.rs \| head -145; cat snapback4/crates/snapback4-device/src/device/opening_native.rs; sed -n '1,130p…` | Read/edit/inspection; no independent test verdict |
| 21 | repository root | `rg -n '\.marker\(\|reset_for_install\|fn commit\|fn load\|fn export' snapback4/crates/snapback4-device/src/{device,memory.rs,sqlite.rs}; sed -n '1,…` | Read/edit/inspection; no independent test verdict |
| 22 | repository root | `python3 - <<'PY'` | Read/edit/inspection; no independent test verdict |
| 23 | repository root | `sed -n '160,310p' snapback4/crates/snapback4-device/tests/common/mod.rs; rg -n 'pub fn (store\|into\|export)\|store\(' snapback4/crates/snapback4-d…` | Read/edit/inspection; no independent test verdict |
| 24 | snapback4/ | `cat > crates/snapback4-device/tests/progressive_history.rs <<'EOF'` | focused.log; exit 101 |
| 25 | repository root | `tail -22 snapback4/reports/20261102-progressive-history-1b/focused.log; sed -n '1,120p' snapback4/crates/snapback4-device/src/device/deferred/recor…` | Read/edit/inspection; no independent test verdict |
| 26 | repository root | `tail -30 snapback4/reports/20261102-progressive-history-1b/focused.log; sed -n '300,340p' snapback4/crates/snapback4-device/src/device/predictions.…` | Read/edit/inspection; no independent test verdict |
| 27 | repository root | `tail -55 snapback4/reports/20261102-progressive-history-1b/focused.log` | Read/edit/inspection; no independent test verdict |
| 28 | repository root | `sed -n '128,180p' snapback4/crates/snapback4-device/src/memory.rs; cat snapback4/crates/snapback4-device/src/device/publication_round7.rs \| head -…` | Read/edit/inspection; no independent test verdict |
| 29 | repository root | `sed -n '115,130p' snapback4/crates/snapback4-device/src/memory.rs; tail -38 snapback4/reports/20261102-progressive-history-1b/focused.log; sed -n '…` | Read/edit/inspection; no independent test verdict |
| 30 | repository root | `rg -n 'pub fn system\|fn as_system\|system\(' snapback4/crates/snapback4-core/src/engine/context.rs snapback4/crates/snapback4-device/tests/retaine…` | Read/edit/inspection; no independent test verdict |
| 31 | snapback4/ | `python3 - <<'PY'` | focused-r2.log; exit 101 |
| 32 | repository root | `sed -n '1120,1195p' snapback4/crates/snapback4-device/src/device.rs; tail -8 snapback4/reports/20261102-progressive-history-1b/focused-r2.log; sed …` | Read/edit/inspection; no independent test verdict |
| 33 | repository root | `sed -n '/failures:/,$p' snapback4/reports/20261102-progressive-history-1b/focused-r2.log` | Read/edit/inspection; no independent test verdict |
| 34 | repository root | `rg -n 'pub fn seed\|pub struct Engine\|fn seed_at' snapback4/crates/snapback4-core/src/engine/{mod.rs,*.rs} \| head -20; sed -n '1340,1395p' snapba…` | Read/edit/inspection; no independent test verdict |
| 35 | snapback4/ | `python3 - <<'PY'` | focused-r3.log; exit 0 |
| 36 | snapback4/ | `cat > crates/snapback4-device/src/device/progressive_tests.rs <<'EOF'` | transactions.log; exit 101 |
| 37 | repository root | `tail -28 snapback4/reports/20261102-progressive-history-1b/focused-r3.log; tail -8 snapback4/reports/20261102-progressive-history-1b/transactions.l…` | Read/edit/inspection; no independent test verdict |
| 38 | repository root | `rg -n -A8 '^error' snapback4/reports/20261102-progressive-history-1b/transactions.log; rg -n 'Self \{\|MemoryStore \{' snapback4/crates/snapback4-d…` | Read/edit/inspection; no independent test verdict |
| 39 | snapback4/ | `python3 - <<'PY'` | transactions-r2.log; exit 0 |
| 40 | snapback4/ | `cat > crates/snapback4-sim/tests/progressive_history.rs <<'EOF'` | sim-focused.log; exit 101 |
| 41 | repository root | `tail -35 snapback4/reports/20261102-progressive-history-1b/transactions-r2.log; tail -15 snapback4/reports/20261102-progressive-history-1b/sim-focu…` | Read/edit/inspection; no independent test verdict |
| 42 | snapback4/ | `python3 - <<'PY'` | device-full.log; exit 101 |
| 43 | repository root | `tail -10 snapback4/reports/20261102-progressive-history-1b/device-full.log; git diff -- snapback4/crates/snapback4-device/src/device.rs snapback4/c…` | Read/edit/inspection; no independent test verdict |
| 44 | repository root | `tail -18 snapback4/reports/20261102-progressive-history-1b/device-full.log; rg -n 'FAILED\|^error:' snapback4/reports/20261102-progressive-history-…` | Read/edit/inspection; no independent test verdict |
| 45 | repository root | `tail -10 snapback4/reports/20261102-progressive-history-1b/device-full.log; rg -n 'FAILED\|^error:' snapback4/reports/20261102-progressive-history-…` | Read/edit/inspection; no independent test verdict |
| 46 | repository root | `python3 - <<'PY'` | Read/edit/inspection; no independent test verdict |
| 47 | repository root | `cat >> snapback4/crates/snapback4-device/tests/progressive_history.rs <<'EOF'` | Read/edit/inspection; no independent test verdict |
| 48 | repository root | `tail -15 snapback4/reports/20261102-progressive-history-1b/device-full.log; rg -n 'FAILED\|^error:' snapback4/reports/20261102-progressive-history-…` | Read/edit/inspection; no independent test verdict |
| 49 | repository root | `PATH=/Users/ccheever/.volta/bin:$PATH ./ref-check --verbose > snapback4/reports/20261102-progressive-history-1b/ref-check.log 2>&1` | ref-check.log; exit 0 |
| 50 | snapback4/ | `cargo test -p snapback4-sim > reports/20261102-progressive-history-1b/sim-full.log 2>&1` | sim-full.log; exit 0 |
| 51 | repository root | `tail -15 snapback4/reports/20261102-progressive-history-1b/device-full.log; tail -5 snapback4/reports/20261102-progressive-history-1b/ref-check.log…` | Read/edit/inspection; no independent test verdict |
| 52 | repository root | `cat snapback4/crates/snapback4-device/src/device/acquisition.rs; sed -n '200,290p' snapback4/crates/snapback4-device/src/device/deferred.rs` | Read/edit/inspection; no independent test verdict |
| 53 | repository root | `tail -12 snapback4/reports/20261102-progressive-history-1b/device-full.log; tail -5 snapback4/reports/20261102-progressive-history-1b/sim-full.log;…` | Read/edit/inspection; no independent test verdict |
| 54 | repository root | `rg -n 'pub fn (enqueue\|queue\|transfer)\|fn retain' snapback4/crates/snapback4-device/src/device.rs; sed -n '1080,1125p' snapback4/crates/snapback…` | Read/edit/inspection; no independent test verdict |
| 55 | repository root | `python3 - <<'PY'` | Read/edit/inspection; no independent test verdict |
| 56 | repository root | `tail -12 snapback4/reports/20261102-progressive-history-1b/device-full.log; tail -6 snapback4/reports/20261102-progressive-history-1b/sim-full.log` | Read/edit/inspection; no independent test verdict |
| 57 | repository root | `rg -n 'FAILED\|^error:\|test result:' snapback4/reports/20261102-progressive-history-1b/device-full.log \| tail -15; rg -n 'FAILED\|^error:\|test r…` | Read/edit/inspection; no independent test verdict |
| 58 | snapback4/ | `cargo test -p snapback4-core > reports/20261102-progressive-history-1b/core-full.log 2>&1` | core-full.log; exit 0 |
| 59 | snapback4/ | `PATH=/Users/ccheever/.volta/bin:$PATH node scripts/affected.mjs --base origin/main --worktree --run > reports/20261102-progressive-history-1b/affec…` | affected.log; exit 1 |
| 60 | repository root | `tail -8 snapback4/reports/20261102-progressive-history-1b/affected.log; tail -5 snapback4/reports/20261102-progressive-history-1b/core-full.log; ta…` | Read/edit/inspection; no independent test verdict |
| 61 | snapback4/ | `cargo test -p snapback4-device --test progressive_history > reports/20261102-progressive-history-1b/focused-final.log 2>&1` | focused-final.log; exit 0 |
| 62 | repository root | `tail -10 snapback4/reports/20261102-progressive-history-1b/affected.log; tail -7 snapback4/reports/20261102-progressive-history-1b/device-full.log;…` | Read/edit/inspection; no independent test verdict |
| 63 | repository root | `rg '^== \|^# [0-9]+ commands\|^Checked\|^Receipt:\|^BLOCKED:' snapback4/reports/20261102-progressive-history-1b/affected.log; rg -n 'FAILED\|^error…` | Read/edit/inspection; no independent test verdict |
| 64 | snapback4/ | `PATH=/Users/ccheever/.volta/bin:$PATH node --version` | v24.18.0 |
| 65 | repository root | `rg -n 'device:backend\|BACKEND\b' snapback4/crates/snapback4-device/src \| head -65; tail -18 snapback4/reports/20261102-progressive-history-1b/foc…` | Read/edit/inspection; no independent test verdict |
| 66 | repository root | `rg -n 'device:backend' snapback4/packages/snapback4/src snapback4/packages/snapback4-expo \| head -30; tail -10 snapback4/reports/20261102-progress…` | Read/edit/inspection; no independent test verdict |
| 67 | repository root | `sed -n '1,105p' snapback4/packages/snapback4/src/web-residency.ts` | Read/edit/inspection; no independent test verdict |
| 68 | repository root | `tail -8 snapback4/reports/20261102-progressive-history-1b/device-full.log; tail -8 snapback4/reports/20261102-progressive-history-1b/core-full.log;…` | Read/edit/inspection; no independent test verdict |
| 69 | snapback4/ | `cargo test -p snapback4-device --lib progressive_ > reports/20261102-progressive-history-1b/transactions-final.log 2>&1` | transactions-final.log; exit 0 |
| 70 | snapback4/ | `cargo test -p snapback4-device --test progressive_history > reports/20261102-progressive-history-1b/focused-header.log 2>&1` | focused-header.log; exit 0 |
| 71 | snapback4/ | `cargo test -p snapback4-sim --test progressive_history > reports/20261102-progressive-history-1b/sim-final.log 2>&1` | sim-final.log; exit 0 |
| 72 | repository root | `sed -n '45,180p' snapback4/crates/snapback4/src/serve_sync.rs; tail -6 snapback4/reports/20261102-progressive-history-1b/transactions-final.log; ta…` | Read/edit/inspection; no independent test verdict |
| 73 | repository root | `tail -8 snapback4/reports/20261102-progressive-history-1b/device-full.log; tail -8 snapback4/reports/20261102-progressive-history-1b/core-full.log;…` | Read/edit/inspection; no independent test verdict |
| 74 | repository root | `sed -n '1955,1999p' snapback4/reports/20261102-progressive-history-1b/device-full.log; rg -n -A65 -B8 'replacement_before_first_publication' snapba…` | Read/edit/inspection; no independent test verdict |
| 75 | repository root | `sed -n '49,100p' snapback4/crates/snapback4-device/tests/repair_b/resumption.rs` | Read/edit/inspection; no independent test verdict |
| 76 | snapback4/ | `cargo test -p snapback4-device > reports/20261102-progressive-history-1b/device-final.log 2>&1` | device-final.log; exit 101 |
| 77 | repository root | `git diff --check; git diff --numstat; rg -n 'pub struct Acquisition\|pub\(super\) fn (validate\|backend_text\|stamp\|events\|history\|publish\|rese…` | Read/edit/inspection; no independent test verdict |
| 78 | repository root | `tail -8 snapback4/reports/20261102-progressive-history-1b/device-final.log; python3 - <<'PY'` | Read/edit/inspection; no independent test verdict |
| 79 | repository root | `tail -8 snapback4/reports/20261102-progressive-history-1b/device-final.log; rg -n 'FAILED\|^error:\|test result:' snapback4/reports/20261102-progre…` | Read/edit/inspection; no independent test verdict |
| 80 | repository root | `tail -10 snapback4/reports/20261102-progressive-history-1b/device-final.log; rg -n 'FAILED\|^error:\|test result:' snapback4/reports/20261102-progr…` | Read/edit/inspection; no independent test verdict |
| 81 | repository root | `tail -10 snapback4/reports/20261102-progressive-history-1b/device-final.log; rg -n 'FAILED\|^error:' snapback4/reports/20261102-progressive-history…` | Read/edit/inspection; no independent test verdict |
| 82 | repository root | `python3 - <<'PY'` | Read/edit/inspection; no independent test verdict |
| 83 | repository root | `rg '^test result:' snapback4/reports/20261102-progressive-history-1b/device-full.log \| head -20; tail -8 snapback4/reports/20261102-progressive-hi…` | Read/edit/inspection; no independent test verdict |
| 84 | repository root | `PATH=/Users/ccheever/.volta/bin:$PATH ./ref-check --verbose > snapback4/reports/20261102-progressive-history-1b/ref-check-final.log 2>&1` | ref-check-final.log; exit 0 |
| 85 | snapback4/ | `cargo test -p snapback4-device --lib progressive_ > reports/20261102-progressive-history-1b/transactions-media.log 2>&1` | transactions-media.log; exit 0 |
| 86 | repository root | `tail -10 snapback4/reports/20261102-progressive-history-1b/device-final.log; tail -5 snapback4/reports/20261102-progressive-history-1b/ref-check-fi…` | Read/edit/inspection; no independent test verdict |
| 87 | repository root | `rg -n 'replacement_before_first_publication\|FAILED\|^error:' snapback4/reports/20261102-progressive-history-1b/device-final.log; sed -n '70,110p' …` | Read/edit/inspection; no independent test verdict |
| 88 | repository root | `tail -8 snapback4/reports/20261102-progressive-history-1b/device-final.log; rg -n 'FAILED\|^error:' snapback4/reports/20261102-progressive-history-…` | Read/edit/inspection; no independent test verdict |
| 89 | snapback4/ | `python3 - <<'PY'` | focused-complete.log; exit 0 |
| 90 | repository root | `tail -10 snapback4/reports/20261102-progressive-history-1b/device-final.log; tail -7 snapback4/reports/20261102-progressive-history-1b/focused-comp…` | Read/edit/inspection; no independent test verdict |
| 91 | repository root | `tail -28 snapback4/reports/20261102-progressive-history-1b/device-final.log; rg -n -A85 -B10 'thousand_lane_merge_loads_boundaries_once' snapback4/…` | Read/edit/inspection; no independent test verdict |
| 92 | snapback4/ | `cargo test -p snapback4-device --test w13g_probe review::thousand_lane_merge_loads_boundaries_once > reports/20261102-progressive-history-1b/bounda…` | boundary-count.log; test summary observed; exit uncollected |
| 93 | snapback4/ | `tail -n 45 reports/20261102-progressive-history-1b/boundary-count.log` | Read/edit/inspection; no independent test verdict |
| 94 | snapback4/ | `cargo test -p snapback4-device > reports/20261102-progressive-history-1b/device-complete.log 2>&1` | device-complete.log; exit 101 |
| 95 | snapback4/ | `sed -n '1,270p' crates/snapback4-device/src/device/boundary.rs` | Read/edit/inspection; no independent test verdict |
| 96 | snapback4/ | `sed -n '1,240p' crates/snapback4-device/src/device/acquisition.rs` | Read/edit/inspection; no independent test verdict |
| 97 | snapback4/ | `git diff --stat` | Read/edit/inspection; no independent test verdict |
| 98 | snapback4/ | `sed -n '1,330p' crates/snapback4-device/src/device/deferred.rs` | Read/edit/inspection; no independent test verdict |
| 99 | snapback4/ | `git diff -- crates/snapback4-device/src/device.rs crates/snapback4-device/src/device/store_identity.rs crates/snapback4-device/src/memory.rs` | Read/edit/inspection; no independent test verdict |
| 100 | snapback4/ | `sed -n '1,260p' crates/snapback4-device/src/device/progressive_tests.rs` | Read/edit/inspection; no independent test verdict |
| 101 | snapback4/ | `sed -n '1,400p' crates/snapback4-device/tests/progressive_history.rs` | Read/edit/inspection; no independent test verdict |
| 102 | snapback4/ | `cat crates/snapback4-sim/tests/progressive_history.rs` | Read/edit/inspection; no independent test verdict |
| 103 | snapback4/ | `sed -n '1,180p' crates/snapback4-device/src/device/opening_native.rs` | Read/edit/inspection; no independent test verdict |
| 104 | repository root | `sed -n '92,195p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md` | Read/edit/inspection; no independent test verdict |
| 105 | repository root | `sed -n '790,1005p' snapback4/crates/snapback4-device/src/device.rs` | Read/edit/inspection; no independent test verdict |
| 106 | repository root | `rg -n 'complete\|coverage\|exists\|missing' snapback4/crates/snapback4-device/src/device/history.rs` | Read/edit/inspection; no independent test verdict |
| 107 | snapback4/ | `tail -n 10 reports/20261102-progressive-history-1b/device-complete.log` | Read/edit/inspection; no independent test verdict |
| 108 | snapback4/ | `cargo test -p snapback4-sim > reports/20261102-progressive-history-1b/sim-complete.log 2>&1` | sim-complete.log; exit 0 |
| 109 | snapback4/ | `cargo check -p snapback4-device --no-default-features > reports/20261102-progressive-history-1b/non-native.log 2>&1` | non-native.log; exit 0 |
| 110 | repository root | `sed -n '220,308p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md` | Read/edit/inspection; no independent test verdict |
| 111 | repository root | `sed -n '380,460p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md` | Read/edit/inspection; no independent test verdict |
| 112 | repository root | `git status --short` | Read/edit/inspection; no independent test verdict |
| 113 | repository root | `wc -l snapback4/crates/snapback4-device/src/device.rs snapback4/crates/snapback4-device/src/device/acquisition.rs snapback4/crates/snapback4-device…` | Read/edit/inspection; no independent test verdict |
| 114 | snapback4/ | `tail -n 12 reports/20261102-progressive-history-1b/device-complete.log` | Read/edit/inspection; no independent test verdict |
| 115 | snapback4/ | `tail -n 8 reports/20261102-progressive-history-1b/sim-complete.log` | Read/edit/inspection; no independent test verdict |
| 116 | snapback4/ | `tail -n 8 reports/20261102-progressive-history-1b/non-native.log` | Read/edit/inspection; no independent test verdict |
| 117 | snapback4/ | `wc -l reports/20261102-progressive-history-1b/*.log` | Read/edit/inspection; no independent test verdict |
| 118 | snapback4/ | `tail -n 12 reports/20261102-progressive-history-1b/device-complete.log` | Read/edit/inspection; no independent test verdict |
| 119 | repository root | `PATH=/Users/ccheever/.volta/bin:$PATH ./ref-check --verbose > snapback4/reports/20261102-progressive-history-1b/ref-check-complete.log 2>&1` | ref-check-complete.log; exit 0 |
| 120 | repository root | `git diff --check` | Read/edit/inspection; no independent test verdict |
| 121 | repository root | `rg -n 'pub struct Acquisition\|fn (validate\|backend_text\|stamp\|events\|history\|publish\|reset\|require_read\|initialize_count\|count)\|acquisit…` | Read/edit/inspection; no independent test verdict |
| 122 | snapback4/ | `tail -n 8 reports/20261102-progressive-history-1b/device-complete.log` | Read/edit/inspection; no independent test verdict |
| 123 | snapback4/ | `tail -n 5 reports/20261102-progressive-history-1b/sim-complete.log` | Read/edit/inspection; no independent test verdict |
| 124 | snapback4/ | `tail -n 5 reports/20261102-progressive-history-1b/non-native.log` | Read/edit/inspection; no independent test verdict |
| 125 | snapback4/ | `cat reports/20261102-progressive-history-1b/ref-check-complete.log` | Read/edit/inspection; no independent test verdict |
| 126 | snapback4/ | `sed -n '/failures:/,$p' reports/20261102-progressive-history-1b/device-complete.log` | Read/edit/inspection; no independent test verdict |
| 127 | snapback4/ | `cat crates/snapback4-device/tests/codec/old_store.rs` | Read/edit/inspection; no independent test verdict |
| 128 | snapback4/ | `cargo test -p snapback4-device --test codec > reports/20261102-progressive-history-1b/codec-final.log 2>&1` | codec-final.log; exit 0 |
| 129 | snapback4/ | `cargo test -p snapback4-device --no-fail-fast > reports/20261102-progressive-history-1b/device-all.log 2>&1` | device-all.log; exit 0 |
| 130 | snapback4/ | `tail -n 8 reports/20261102-progressive-history-1b/codec-final.log` | Read/edit/inspection; no independent test verdict |
| 131 | snapback4/ | `tail -n 5 reports/20261102-progressive-history-1b/device-all.log` | Read/edit/inspection; no independent test verdict |
| 132 | snapback4/ | `tail -n 5 reports/20261102-progressive-history-1b/sim-complete.log` | Read/edit/inspection; no independent test verdict |
| 133 | snapback4/ | `git diff --check` | Read/edit/inspection; no independent test verdict |
| 134 | repository root | `sed -n '308,380p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md` | Read/edit/inspection; no independent test verdict |
| 135 | repository root | `tail -n 8 snapback4/reports/20261102-progressive-history-1b/device-all.log` | Read/edit/inspection; no independent test verdict |
| 136 | snapback4/ | `cargo test -p snapback4-sim --test progressive_history > reports/20261102-progressive-history-1b/sim-oracle-final.log 2>&1` | sim-oracle-final.log; exit 0 |
| 137 | snapback4/ | `cargo check -p snapback4-device --no-default-features > reports/20261102-progressive-history-1b/non-native-final.log 2>&1` | non-native-final.log; exit 0 |
| 138 | snapback4/ | `tail -n 10 reports/20261102-progressive-history-1b/device-all.log` | Read/edit/inspection; no independent test verdict |
| 139 | snapback4/ | `tail -n 10 reports/20261102-progressive-history-1b/device-all.log` | Read/edit/inspection; no independent test verdict |
| 140 | snapback4/ | `python3 - <<'PY'` | Read/edit/inspection; no independent test verdict |
| 141 | snapback4/ | `tail -n 10 reports/20261102-progressive-history-1b/device-all.log` | Read/edit/inspection; no independent test verdict |
| 142 | snapback4/ | `python3 - <<'PY'` | Read/edit/inspection; no independent test verdict |
| 143 | repository root | `tail -n 30 snapback4/reports/20261102-progressive-history-1b/affected.log` | Read/edit/inspection; no independent test verdict |
| 144 | repository root | `rg '^== \|^# [0-9]+ commands\|^Checked\|^Receipt:\|^BLOCKED:' snapback4/reports/20261102-progressive-history-1b/affected.log` | Read/edit/inspection; no independent test verdict |
| 145 | repository root | `cat target/affected/491bc5949327-1793618931395.json` | Read/edit/inspection; no independent test verdict |
| 146 | repository root | `git diff --check` | Read/edit/inspection; no independent test verdict |
| 147 | repository root | `wc -l snapback4/crates/snapback4-device/src/device.rs snapback4/crates/snapback4-device/src/device/{acquisition,boundary,deferred,opening_native,sn…` | Read/edit/inspection; no independent test verdict |
| 148 | snapback4/ | `python3 - <<'PY'` | Evidence logs: 28 captured; 5 split at 1400 lines; all concatenations verified byte-for-byte. |
| 149 | repository root | `git status --short` | Read/edit/inspection; no independent test verdict |
| 150 | repository root | `git diff --check` | Read/edit/inspection; no independent test verdict |
| 151 | repository root | `python3 - <<'PY'` | Report evidence files: 35; all under 1500 lines. |

**Verbatim command summaries, including failed attempts**

Below are every captured test/build/ref-check summary line, in invocation order. Full diagnostic output is in the linked log parts; the manifest preserves each original log's identity. Compiler warnings remain in those logs. No failed attempt is counted as a passing qualification.

Command 24: `focused.log` — exit 101. [log](focused.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 1m 09s
test result: FAILED. 0 passed; 7 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
error: test failed, to rerun pass `-p snapback4-device --test progressive_history`
```

Command 31: `focused-r2.log` — exit 101. [log](focused-r2.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 18.07s
test result: FAILED. 5 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
error: test failed, to rerun pass `-p snapback4-device --test progressive_history`
```

Command 35: `focused-r3.log` — exit 0. [log](focused-r3.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 15.32s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
```

Command 36: `transactions.log` — exit 101. [log](transactions.log)

```text
error: could not compile `snapback4-device` (lib test) due to 2 previous errors; 1 warning emitted
```

Command 39: `transactions-r2.log` — exit 0. [log](transactions-r2.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 14.79s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 63 filtered out; finished in 0.02s
```

Command 40: `sim-focused.log` — exit 101. [log](sim-focused.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 10.57s
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
error: test failed, to rerun pass `-p snapback4-sim --test progressive_history`
```

Command 42: `device-full.log` — exit 101. [log part 1](device-full.part-01.log), [log part 2](device-full.part-02.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 7m 38s
test result: ok. 66 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.30s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 14.16s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.95s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.44s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.80s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.03s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.36s
test result: ok. 440 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 124.67s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 188.19s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.28s
test result: ok. 9 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.73s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.67s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.45s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.55s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.34s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.80s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 13.11s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.62s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.32s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.42s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.87s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.96s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.42s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.21s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 88 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.64s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.31s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: FAILED. 108 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.77s
error: test failed, to rerun pass `-p snapback4-device --test repair_b`
```

Command 49: `ref-check.log` — exit 0. [log](ref-check.log)

```text
ref-check: ok — 583 LLP docs, 12963 refs in 51323 files, 0 errors, 0 unchecked
```

Command 50: `sim-full.log` — exit 0. [log](sim-full.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 2m 57s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.80s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 254 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 65.15s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.45s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.80s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.26s
test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 2.51s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.08s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.83s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.55s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 35.92s
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.77s
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.16s
test result: ok. 12 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 2.08s
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.65s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.07s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.68s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.34s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.14s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 29 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 25.39s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 18.39s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.57s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.22s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.37s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Command 58: `core-full.log` — exit 0. [log part 1](core-full.part-01.log), [log part 2](core-full.part-02.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 51.81s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 843 filtered out; finished in 0.12s
test result: ok. 840 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 103.63s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 28 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.47s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.41s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 45.59s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.31s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.29s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.21s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.27s
test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.35s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.15s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 153.73s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.06s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 13.32s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.23s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 27 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.86s
```

Command 59: `affected.log` — exit 1. [log part 1](affected.part-01.log), [log part 2](affected.part-02.log)

```text
# 32 commands, 7 whole Rust packages, 489 client files; broad=true
Checked 649 installs across 627 packages (no changes) [240.00ms]
    Finished `dev` profile [unoptimized] target(s) in 55.89s
```

Command 61: `focused-final.log` — exit 0. [log](focused-final.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 1m 00s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.23s
```

Command 69: `transactions-final.log` — exit 0. [log](transactions-final.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 14.14s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 63 filtered out; finished in 0.02s
```

Command 70: `focused-header.log` — exit 0. [log](focused-header.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 37.40s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
```

Command 71: `sim-final.log` — exit 0. [log](sim-final.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 37.68s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
```

Command 76: `device-final.log` — exit 101. [log part 1](device-final.part-01.log), [log part 2](device-final.part-02.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 6m 28s
test result: ok. 66 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.34s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.15s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.89s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.12s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s
test result: ok. 440 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 86.31s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 165.49s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 9 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.64s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.60s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.47s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.62s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.35s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.80s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 10.91s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.75s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.27s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.42s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.62s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.26s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.19s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.22s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 88 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.53s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.70s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.56s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 245.60s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.52s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.89s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 47.48s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 26 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.00s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.76s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: FAILED. 141 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.30s
error: test failed, to rerun pass `-p snapback4-device --test w13g_probe`
```

Command 84: `ref-check-final.log` — exit 0. [log](ref-check-final.log)

```text
ref-check: ok — 583 LLP docs, 12964 refs in 51325 files, 0 errors, 0 unchecked
```

Command 85: `transactions-media.log` — exit 0. [log](transactions-media.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 12.25s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 63 filtered out; finished in 0.02s
```

Command 89: `focused-complete.log` — exit 0. [log](focused-complete.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 16.92s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
```

Command 92: `boundary-count.log` — test summary observed; session exit not separately collected. [log](boundary-count.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 20.78s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 141 filtered out; finished in 0.12s
```

Command 94: `device-complete.log` — exit 101. [log](device-complete.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 4m 31s
test result: ok. 67 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.72s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.25s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.98s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s
test result: FAILED. 10 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.84s
error: test failed, to rerun pass `-p snapback4-device --test codec`
```

Command 108: `sim-complete.log` — exit 0. [log](sim-complete.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 3m 02s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.89s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 254 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 31.72s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.60s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.92s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.39s
test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.67s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.00s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.39s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 24.54s
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.21s
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.96s
test result: ok. 12 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.36s
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.28s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.05s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.09s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.31s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 29 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 20.83s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 35.09s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.11s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.56s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.35s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Command 109: `non-native.log` — exit 0. [log](non-native.log)

```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2m 38s
```

Command 119: `ref-check-complete.log` — exit 0. [log](ref-check-complete.log)

```text
ref-check: ok — 583 LLP docs, 12965 refs in 51325 files, 0 errors, 0 unchecked
```

Command 128: `codec-final.log` — exit 0. [log](codec-final.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 9.67s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.36s
```

Command 129: `device-all.log` — exit 0. [log part 1](device-all.part-01.log), [log part 2](device-all.part-02.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 55.06s
test result: ok. 67 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.31s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.23s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.92s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.12s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.39s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.32s
test result: ok. 440 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 78.52s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 167.92s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 9 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.67s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.60s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.53s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.66s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.32s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.77s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 12.05s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.83s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.32s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.42s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.50s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.07s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.24s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 88 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.63s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.37s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.21s
test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.81s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.22s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.53s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 241.11s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.20s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.47s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 47.89s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 26 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.28s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.11s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.82s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 142 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.45s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.63s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Command 136: `sim-oracle-final.log` — exit 0. [log](sim-oracle-final.log)

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 3.06s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
```

Command 137: `non-native-final.log` — exit 0. [log](non-native-final.log)

```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.46s
```

**Evidence packaging summaries (verbatim)**

```text
Evidence logs: 28 captured; 5 split at 1400 lines; all concatenations verified byte-for-byte.
Report evidence files: 35; all under 1500 lines.
```

These packaging counts precede this report's creation. Stopped after writing this report; supervisor owns committing and subsequent chunks.
