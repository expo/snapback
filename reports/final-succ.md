# REPORT — lane `succ` (LLP 1020 A1, A2, A3, A6; acceptance A8.1, A8.2)

Worktree `~/projects/snapback-s2y`, branch `s2/ri-succ`, base `c25b0ec98f` (origin/main at
start). The codex run (gpt-6-astra) implemented most of the lane and died at its usage limit;
its partial work is the wip commit `78ddf6e237`. This report covers the whole lane: what codex
landed, what this session added or reverted, and the verbatim results.

## 1. What changed (files)

Core, `snapback2/crates/snapback2-core/src/`:

- `successor.rs` — `widens(current, next)` (A1) replaces `next_type != column_type` in both
  `plan()` and `additive_refusal`, recursive through `Optional`/`List`; enum superset in any
  order, larger `text`/`bytes`/`video`/`json`/`image`/list maxima, `T → T?`, `adding_once`;
  decimal/money scale or currency changes fall through to destructive. `plan()` takes a
  `Connection` and skips the column/index delta of a maintained target whose stored rows are
  all predecessor-projected (A3); non-owned survivors keep a plan. **This session** replaced
  codex's `projected_owned_ids` (predecessor ∪ successor projection, recomputed at every check)
  with one `OwnedIds` set from `projected_predecessor_ids`, read once before any migration
  drop and threaded through `additive_refusal`, `validate_stored_rows`, `checked_narrowings`,
  and `apply_additive` (`rebuild_target` already unions in the successor projection). Codex's
  form failed two pre-existing core tests the lane's name filters had skipped: computing the
  successor projection inside `plan()` turned a Sum-overflow into `E_SUCCESSOR_STORE` before the
  destructive classification (`tests/successor.rs::failed_migration_rolls_back_…`), and
  re-deriving predecessor ids after a `TypeChange` drop hit `MissingField("group")`
  (`tests/successor_maintains.rs::migration_rebuilds_an_unchanged_maintain_when_group_types_change`). `SuccessorRefusal` gains `from`/`to` (`compared()`
  formats "(generation from → to)" into the message) and every constructor a declaration
  `site` (`schema.tables.T.columns.C`, `.indexes.I`, `.constraints[i]`). `SuccessorReport`
  gains `maintains` (the regroup line `maintain counts: by sender → by recipient`) and
  `narrowings` (every checked narrowing, zero counts included); `apply_additive` writes the
  report to `_meta.last_successor` inside the installation transaction. `successor_refusal()`
  is deleted; `Runtime::open`/`apply_successor_at`/`apply_migration` run `plan` +
  `additive_refusal` inside the transaction and wrap refusals with `compared()`.
- `successor_narrowing.rs` — `is_narrowing` composes enum compatibility through wrappers
  (outer `T? → T` keeps LLP 1016's scope); `checked_narrowings` walks every stored value
  (`contains_removed` through arrays) recording `removed_cases`, `affected_rows`, `null_rows`,
  ten sampled ids; `narrowing_refusal` refuses only a nonzero count and pastes `removal_job`:
  **this session** made the pasted job a single whole-table sweep
  (`chunk p in T first 100 by byId: if p.C = 'case': delete T[p.id]`) for scalar enums, keeping
  codex's per-sampled-id sweeps only for list-wrapped enums (Quarry bindings are lexical, so a
  flag set in nested list loops cannot reach an outer delete — codex's first form deleted
  nothing).
- `successor/caps.rs` — `E_SUCCESSOR_CAP` carries `from`/`to` and a `constraints[i]` site.
- `registry.rs` — 1,333 lines (tests moved out to `registry_tests.rs`, 150 lines);
  `registry_evolution_tests.rs` (775 lines, new; A8.1).

Owner, `snapback2/crates/snapback2/src/`:

- `writer.rs` — the successor log line (`{"successor":"applied","report":…}`) is written from
  the apply path so hot and watch-driven installs both log it; `E_GENERATION_CHANGED` guide
  `successor/runtime → successor`; refusals pass through `protocol::successor_site`.
- `writer_ledger.rs` — `dev --status` / `/control/status` carries `successor` (the last
  report, from `_meta.last_successor`).
- `protocol.rs` — `from_successor` guide `successor/migrations → successor`, details
  `from`/`to`/`affectedRows`/`removedCases`; `successor_site()` resolves a schema site to
  `file:line:col` through the compiled `sources` (next generation first, then previous).
- `owner.rs`, `watch.rs` — foreground open and the watcher use the same site resolution; the
  watcher's duplicate log line is gone.
- `writer_replay.rs` — **this session reverted** codex's change that settled a replayed intent
  refused `E_INPUT` as an `E_OFFLINE_CONFLICT` terminal (see §4).
- `guide.rs` — `guide migrations` reads `successor.md` (the alias); `guide successor` resolves
  by file, `guide migration` by the H1 alias in `keywords.json`.

Compiler, `snapback2/packages/compiler/src/`:

- `quarry/bound-schema.ts` — table, column, and index declarations are recorded in `sources`
  (`schema.tables.T`, `.columns.C`, `.indexes.I`) so a successor refusal names its line.
- `quarry-job-checks.ts` — **this session** re-pointed the recipe check from `guide/job.md` to
  `guide/successor.md` (the recipe moved; codex re-pointed the Rust `jobs.rs` test but not this
  one, which was red). Outside the lane's named areas; one path and one test name.

Guide, `snapback2/packages/snapback2/guide/`:

- `successor.md` (new, 4,045/4,096 bytes; title `# Successors: \`migrations\`, \`migration\``),
  `migrations.md` deleted, `operator.md`/`job.md` defer to it (their duplicated prose removed;
  the `fillAvatars` block is now the first ```q block of `successor.md`, which `jobs.rs` and the
  compiler check read).
- `families.source.json` — `E_SUCCESSOR_DESTRUCTIVE` (site + Quarry wrong), the enum
  `E_SUCCESSOR_NARROWING` pair, `E_SUCCESSOR_COLUMN_REQUIRED`, `E_SUCCESSOR_UNIQUE`,
  `E_SUCCESSOR_CAP`, `E_SUCCESSOR_ROW_INVALID`, `E_SUCCESSOR_STORE`, `E_GENERATION_CHANGED →
  successor`; **this session** replaced the narrowing `right` example's dead flag idiom with
  the executable `if p.kind = 'image': delete items[p.id]` and added the `E_STEPS` pair
  (family `bound`, page `bounds`; wrong = `range(0, 1000000)`, right = `range(0, 1000)`, both
  verified with the binary — see §5 for why it is not in the compiler gate's list).

Tests:

- `snapback2/crates/snapback2-core/src/registry_evolution_tests.rs` (11 tests, A8.1),
  `crates/snapback2-core/tests/assets/once.rs` (+1: widening an image keeps its claimed asset),
  `crates/snapback2/tests/owner_cases/{mod,operator,jobs}.rs` (site format `file:line:col`,
  guide `successor`, the destructive probe narrows `<=120 → <=119` because widening is now
  additive).
- `snapback2/packages/snapback2/tests/real-owner-successor.test.ts` (+4 tests, A8.2; 530 lines);
  `tests/client.test.ts` mock guide slug `successor` (one string).

Docs: `llp/1020-…rfc.md` implementation record (one line); `llp/1017-…rfc.md` §2.5 page name
`successor/migrations → successor` (the RFC says the dangling name resolves; it now names the
page that exists). New ticket
`issues/20260910-snapback2-online-client-query-during-hot-regroup.md` (§5).

## 2. Before / after

Base commit, from the codex run's reproduction (`registry_evolution_tests.rs` on `c25b0ec98f`):

```
enum case add:     Err(SuccessorRefusal { code: "E_SUCCESSOR_DESTRUCTIVE", plan: { drops: [TypeChange { table: "items", column: "value", from: Enum { variants: ["text", "image"] }, to: Enum { variants: ["image", "poll", "text"] } }] } })
enum case removal (no row holds it): Err(SuccessorRefusal { code: "E_SUCCESSOR_DESTRUCTIVE", plan: { drops: [TypeChange { … from: Enum ["text", "image"], to: Enum ["text"] }] } })
maintain regroup:  Err(SuccessorRefusal { code: "E_SUCCESSOR_DESTRUCTIVE", … Drop::Column / Drop::Index on counts })
guide successor:   E_GUIDE_UNKNOWN
```

After:

```
enum case add:     Ok(SuccessorReport { narrowings: [], maintains: [] })  rows byte-identical, commit_seq unchanged
enum case removal: Ok(SuccessorReport { narrowings: [{ removed_cases: ["image"], affected_rows: 0, sample: [] }] })
                   or E_SUCCESSOR_NARROWING "items.value removes cases [\"image\"]: 1 affected rows (0 null or absent); run the pasted job under the predecessor schema, then apply again (generation f2… → 9a…)" with the sweep job
maintain regroup:  Ok(SuccessorReport { maintains: ["maintain counts: by sender → by recipient"] }); the line is in .snapback/log.jsonl and dev --status.successor; `query count(who): return counts[who]` still certifies (`check` ok)
nested refusal (owner wire): {"from":"869a…","to":"cd84…","site":"snapback/schema.q:8:3","affectedRows":1,"removedCases":["b"],"sample":["remove"],"rewrite":"-- keep the predecessor schema; …\njob remove_messages_tags():\n  chunk p0 in messages['remove'] first 1 by byId:\n    delete messages[p0.id]"}
guide successor == guide migrations == guide migration (4,045 bytes)
```

## 3. Tests and verbatim results

Core (`cargo nextest … -p snapback2-core -E 'test(/evolution|successor|narrowing|widening|registry|once/)'`):

```
Summary [   0.775s] 54 tests run: 54 passed (1 leaky), 477 skipped
```

Owner binary, the lane's affected set (`-p snapback2 -E 'test(/offline_replay_successor|narrowing|successor|guide|jobs::run_file/)'`):

```
Summary [  51.463s] 31 tests run: 31 passed, 341 skipped
```

Package (`node --test tests/real-owner-successor.test.ts`), before the deterministic regroup
fix: `tests 7 / pass 6 / fail 1` (the regroup test raced, §5); the queued-intent test:

```
✔ two clients and cold carrier reopen preserve rows through widening; removed enum intents keep bytes and explicit conflict
ℹ old-generation intent: {"state":"queued","refusal":{"code":"E_INPUT","family":"input","message":"arg kind value \"image\" is not in [\"text\", \"poll\"]",…},"reset":"E_OFFLINE_RESET","originalBytes":"{\"args\":{\"kind\":\"image\",\"body\":\"queued original: \\\" \\\\ ☺\"},\"intent\":\"s2id-…:2\"}"}
```

Compiler (`bun src/test.ts`) before re-pointing the recipe check: `Compiler checks: 286 passed, 1 failed`
(`Job guide recipe is the compiled fixture …: null is not an object` — the block had moved).

Blocking suite (`scripts/test.sh`, this Mac, 18 cores, load average 25–31 throughout because
lane `cost`'s own nextest and a `~/projects/ibex` test binary ran beside it), verbatim:

```
== package offline protocol + store + bytes + outbox + twin + real owner
ℹ tests 1059 / ℹ pass 1022 / ℹ fail 22 / ℹ cancelled 15        (every failure "test timed out"/"owner readiness timed out" at the 10 s --test-timeout, or a cancel cascaded from one)
== cargo-nextest workspace tests (parallel, no fail-fast)
     Summary [ 191.110s] 945 tests run: 936 passed (2 slow), 9 failed, 4 skipped
== cargo workspace doctests (no fail-fast)                   test result: ok (both crates)
== evaluator (IR twin vs corpus)                             every regression line "passed"
== compiler tests                                            Compiler checks: 287 passed, 0 failed
test.sh exit=1
```

The nine nextest reds, each re-run alone afterwards:

- `snapback2-core::successor failed_migration_rolls_back_drops_backfill_and_generation_metadata`
  (`E_SUCCESSOR_STORE` where `E_SUCCESSOR_DESTRUCTIVE` was expected) and
  `snapback2-core::successor_maintains migration_rebuilds_an_unchanged_maintain_when_group_types_change`
  (`MissingField("group")`) — **real**, from codex's `projected_owned_ids`; fixed by the
  pre-drop `OwnedIds` threading (§1). Whole core crate after the fix:
  `Summary [  11.749s] 530 tests run: 530 passed, 1 skipped`.
- `snapback2::owner stop_during_generation_update_is_bounded_and_cannot_recreate_owner_state`
  (`started.elapsed() < 2 s`), `snapback2::test_verb synchronous_loop_times_out_and_a_leaked_handle_cannot_hold_the_runner`
  (`< 12 s`), four `media_helper::tests::*` (5,000 ms wall-clock ceilings) and
  `project::tests::dropping_worker_kills_descendant_holding_stdout_without_hanging` — wall-clock
  assertions under the load above. Re-run alone together with the lane's affected set
  (`-E 'test(stop_during…) | test(synchronous_loop…) | test(/media_helper::tests::/) | test(dropping_worker…) | test(/offline_replay_successor|narrowing|successor|guide|jobs::run_file/)'`, 2 threads):
  `Summary [  76.368s] 39 tests run: 39 passed, 333 skipped`.

The 15 package files that timed out under the parallel run, re-run serially with the same
10 s timeout (`node --test --test-concurrency=1 --test-timeout=10000 …`) after the fix and a
fresh `node build.mjs`:

```
ℹ tests 89 / ℹ pass 88 / ℹ fail 0 / ℹ cancelled 1 / ℹ duration_ms 144992
✖ custom cursor custody drains offline on every carrier (10001.660541ms)   tests/local-data-recovery.test.ts (pre-existing; last touched 44d64e9661)
```

That one alone: `✔ … (9909.047875ms)` at the 10 s timeout and `✔ … (8362.875791ms)` at the
package's own 120 s timeout — a wall-clock artifact of the shared machine, not a red.
`real-owner-successor.test.ts` in that serial run: 7/7 (`durable client intents …` 6.8 s alone
earlier; it has no per-test timeout and is the one that hit 10 s in the parallel run).

Earlier bin-crate run before the two fixes (8 threads, the whole `-p snapback2` crate):
`Summary [ 241.956s] 369 tests run: 362 passed (2 slow, 1 leaky), 7 failed, 3 skipped` —
one real (`offline_replay_successor…`, the reverted replay patch, §4.1) and six `test_verb`
"journey exceeded the 5000 ms host deadline" reds; all seven pass alone (`31 tests run: 31 passed` and the 39 above).

Other gates: `./ref-check --verbose` → `ok — 433 LLP docs, 7890 refs in 19064 files, 0 errors`;
`node scripts/caps.mjs` → 2 violations, both inherited Snapback 1 files this lane never touched
(`crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` 1504, `packages/snapback-contract/agent-authority-contract.test.mjs` 1508; baseline 204, now 206 on main).

A8.1 coverage (`registry_evolution_tests.rs`): `widening_matrix_installs_migrates_and_reopens_without_rewriting`
(10 rows of A1's table × install/migration/reopen, rows byte-identical and `commit_seq`
unchanged), `narrower_bounds_and_changed_scale_currency_or_once_keep_destructive_plans` (the
reverse direction, 10 rows × 3 routes, `from`/`to` asserted), `enum_widening_preserves_populated_rows`,
`enum_removal_is_checked_instead_of_destructive` (zero and nonzero, rewrite pinned),
`nested_enum_removal_counts_rows_once_and_preserves_bytes_on_every_path` (`[[enum]?]?` with 12
rows → 12 affected, 10 sampled, bytes unchanged, on all three routes),
`mixed_outer_narrowing_and_inner_widening_checks_nulls`, `zero_enum_removal_still_checks_uniqueness_caps_and_required_columns`,
`text_constraints_change_only_write_admission_not_stored_rows`, `regroup_replaces_only_the_owned_projection_without_a_plan`,
`regroup_with_non_owned_survivor_keeps_a_destructive_plan`,
`injected_installation_failure_rolls_back_rows_indexes_generations_and_timers` (a SQLite
trigger aborts the `_meta.generation` write after timer reconciliation; `rows`, `index_entries`,
`_meta`, `_timers` snapshots equal before/after on install, migration, and reopen; the retry
then reports the regroup line and persists `last_successor`).

A8.2 coverage (`real-owner-successor.test.ts`): two clients + `restart()` cold reopen across the
widening successor (data identical, `live: false` cold reads); a queued removed-case intent
(bytes preserved, `E_OFFLINE_RESET` observed on resume, `E_INPUT` naming the case, intent
unspent, store untouched, and — once the case is re-added — the same bytes commit); a removed
operation's retained terminal; absent and hidden maintained groups (server `0`, receipt-only
replay `partial` with `never-held`); `guide successor/migrations/migration` identity and
every successor family `right` example certifying through `check`; the nested and the scalar
pasted jobs actually running (`state: done`) and repairing the store.

## 4. Deviations from the RFC, and what the RFC must say

1. **Queued intents carrying a removed case (A2, A8.2).** The RFC says they "keep their bytes
   and receive the existing conflict/reset behavior (LLP 1001 §'queued intents across
   generations')". LLP 1001 has no such section; the existing behavior is LLP 1012 §7/§8 plus
   the owner test `offline_replay_successor.rs`, which pins that a replay refused by current
   validation is a plain `E_INPUT` refusal that **never spends the intent** ("validation
   failures never spent the intent": restoring the project lets the same intent commit).
   Codex had turned that refusal into a recorded `E_OFFLINE_CONFLICT` terminal, which spends
   the intent and broke that test. Reverted; the package test now asserts the real contract:
   resume `E_OFFLINE_RESET`, replay `E_INPUT` ("arg kind value \"image\" is not in
   [\"text\", \"poll\"]"), entry still `queued` with byte-identical args/intent/generation,
   and the intent committing byte-identically after the case is widened back. The RFC should
   cite LLP 1012 §7 and say: reset at resume; the server judges the replay by current
   validation; a trace conflict settles as a `conflict` terminal, an argument that no longer
   fits is refused unspent. Open question in §5.
2. **The narrowing rewrite for list-wrapped enums** deletes the ten sampled rows per run
   (rerun until zero), not "the affected rows" in one job: a `contains` over nested lists needs
   a flag that Quarry's lexical bindings cannot carry out of the loop. Scalar enums (the M7
   case) get the whole-table sweep. The guide page says both.
3. **"once J1b lands" (A6, Evidence).** Already absent at the base commit (the required-column
   rewrite named `run fill_… --as system --wait` and `guide job`); the package test pins its
   absence. The RFC's evidence bullet is stale.
4. **`E_STEPS` family pair (A6)** is in `families.source.json` and `guide E_STEPS` renders it,
   but it is not added to `test-final-gates.ts`'s executable list: that gate requires every
   refusal of the wrong example to be the claimed code, and the certificate prices heap at
   32 bytes per step, so any program over the 1,000,000-step ceiling refuses heap `E_BOUND`
   too (steps 4,000,003 → heap 128,000,096 > 8 MiB). `check` also files E_STEPS under family
   `opaque`, guide `opaque/subset` (`protocol.rs::certification_family_guide` fallback) while
   the runtime says `bound`/`bound/runtime`; `bound/ceiling` (E_BOUND's slug) does not resolve
   either. Left to lane `cost` (A4 owns the check-time refusal surface).
5. **`guide.rs` alias.** `migrations` is an explicit branch reading `successor.md`; the
   `keywords.json` H1-alias mechanism would also resolve it (and resolves `migration`). Kept
   explicit as the RFC names it; no other alias added (`successor/migrations` is not an alias —
   LLP 1017's text now names `successor`).

## 5. Open questions

- **A stuck head-of-queue.** With the existing contract, a queued intent whose enum case was
  removed is refused `E_INPUT` on every drain, `drain()` rejects, and `outbox.dismiss` refuses
  queued intents — the FIFO is blocked until the operator re-adds the case or the client's
  partition is reset. A settled terminal (codex's choice) unblocks the queue but contradicts
  "validation failures never spent the intent". The author should rule which the day-two
  brief wants; the guide page states the current behavior.
- **Online client racing a hot regroup** (ticket
  `issues/20260910-snapback2-online-client-query-during-hot-regroup.md`): under load a client
  left online through the regroup answered `client.query` with `E_OFFLINE_STATE` "E_SCHEMA:
  missing index components counts.bySender" at `client.query.commit`; alone it passes (2/2).
  The package test now goes `offline()` before the install (LLP 1012's reset path). Client
  twin, outside this lane.
- Wall-clock assertions (`test_verb` journeys' 5,000 ms host deadline, `media_helper`'s
  5,000 ms ceilings, the owner-stop 2 s bound, node's 10 s `--test-timeout`) are the whole
  residual red of `scripts/test.sh` on this machine while another lane's suite runs; every
  one passes alone (§3). None needed `ps`.

## 6. Files outside the lane's named areas (with the reason)

`packages/compiler/src/quarry/bound-schema.ts` (codex: declaration sources for refusal sites),
`packages/compiler/src/quarry-job-checks.ts` (recipe moved), `packages/snapback2/tests/client.test.ts`
(mock slug), `crates/snapback2-core/tests/assets/once.rs` (widening test), `crates/snapback2-core/src/engine/search_boundaries.rs`
(one test call gains the new `owned` argument), `llp/1017-…` (page name), `issues/…` (ticket). No file over 1,500 lines was added or grown past the cap.

## Fix round r1

Worktree `~/projects/snapback-s2y`, branch `s2/ri-succ`, applied uncommitted on top of
`0f09ff88e5` (base `7f5c48cdbd`; `origin/main` has since moved by `611761f664`, not merged
here — the orchestrator integrates). Brief `briefs/fix-succ-r1.md`; reviews `succ-r1-grok.md`,
`succ-r1-muse.md`. Item by item, then verbatim counts.

### Items

1. **Combined narrowing pastes both repairs — fixed.** `successor_narrowing.rs::repair_job`
   builds one job for a column that loses its outer `?` and a case at once:
   `job remove_T_C(value: <successor type>)` with `if p.C = null: update T[p.id] { C: value }`
   then `if p.C = 'c': delete T[p.id]` (exclusive conditions, so no row is written twice).
   Tests: `registry_evolution_tests.rs::combined_unwrap_and_enum_removal_pastes_one_job_that_fills_and_deletes`
   (`enum('a','b','c')?` → `enum('a','b')` with a null, a `'c'` and an `'a'` row: `null_rows` 1,
   `affected_rows` 2, the pinned rewrite; after the job's two effects the successor admits with
   `affected_rows` 0); `successor_narrowing.rs::combined_and_truncating_repairs_are_the_fixture_the_compiler_lowers`
   (the paste is byte-identical to the new compiler fixture
   `packages/compiler/fixtures/quarry-jobs/snapback/repairs.q`, which `quarry-job-checks.ts` now
   lowers with its typed argument and certifies); and on the real owner
   `real-owner-successor.test.ts::combined and list-narrowing pasted jobs run to zero on the real owner`
   (`run --file repair.q '{"value":"b"}' --as system --wait` → `"state":"done"`, the re-apply
   reports `affectedRows` 0, the `'c'` row is gone, the null row holds `'b'`).

2. **A3 ownership is the union — fixed (union kept; no soundness reason to stay
   predecessor-only).** `successor.rs::projected_owned_ids` replaces `projected_predecessor_ids`:
   per rebuilt target, predecessor projection ∪ successor projection, read once before any
   migration drop and threaded through `plan()` (new `owned` parameter), `additive_refusal`,
   `validate_stored_rows`, `checked_narrowings` and `apply_additive`. The successor side joins
   only when it can be computed over the stored rows; a backfill that cannot (the Sum overflow
   of `tests/successor.rs::failed_migration_rolls_back_…`, a group field the successor adds)
   contributes nothing at plan time and refuses at the rebuild with its own code — the exact
   failure codex's union form had, which is why both pre-existing core tests stay green; the
   migration route reads the set before the drops. Test:
   `regroup_with_survivor_at_successor_key_is_owned_and_regroups_without_a_plan` (a `counts`
   survivor whose id is `canonical_json(["dev:bob"])`, the successor key, regroups without a
   plan; `report.maintains == ["maintain counts: by sender → by recipient"]`; the table then
   holds exactly `{id: key, recipient: dev:bob, value: 1}` with no `sender`). The
   `@ref LLP 1020#a3` gloss and RFC A3 say "union, computed once before any drop".

3. **`E_STEPS` family row — fixed.** `protocol.rs::certification_family_guide` gains
   `"E_STEPS" => ("bound", "bounds")`. The range-loop pair could never be executable: any
   program over 1,000,000 steps also exceeds heap (32 bytes/step vs 8 MiB) and `check` emits one
   item per (program, error), so the gate would see `E_BOUND` beside `E_STEPS`. The one pricing
   path that raises steps without heap is search-term derivation on writes (`certificate.rs`
   computes heap before adding `derived.steps`) — also the M7 "bulk job" shape — so the pair is
   now a job chunk over `body: text <=100` with `by bySearch: wordPrefixes(body), id`:
   `chunk … first 100` refuses `E_STEPS` alone (steps 2,465,228; `check --json --ir` returns
   exactly one error), `first 10` admits. `"E_STEPS"` is in `test-final-gates.ts`'s executable
   list; the package guide test asserts the CLI reports `code E_STEPS, family bound, guide
   bounds` for the wrong side and exit 0 for the right. Coordination: `origin/main`
   (`611761f664`) carries no `E_STEPS` families row, so lane `cost`'s pair is unmerged; on
   merge keep one row per code — this one is gate-executable.

4. **Max-shrink is checked narrowing — fixed per the ruling.** `is_narrowing` composes a new
   `checked` relation — enum removal and a smaller `text`, `bytes` or list maximum, through
   `Optional`/`List` (`json`/`image`/`video` maxima stay destructive: the ruling names
   list/text/bytes, and asset sizes and JSON bytes are not measurable in Quarry).
   `NarrowingConflict.oversize_rows` (`#[serde(default)]`, wire `oversizeRows`, also in
   `protocol.rs::from_successor` details); `exceeds()` flags a value over the new maximum at
   any depth; message
   `items.value removes cases ["b"] and lowers its maximum: 2 affected rows remain (0 null or absent, 1 over the new maximum)`.
   Tests: `lowered_list_maximum_with_enum_removal_is_checked_narrowing` (`[enum(a,b)] <=5` →
   `[enum(a)] <=3` with a 4-element row refuses with both counts and bytes unchanged; a shrink
   alone pastes the whole-table `.length` sweep; no offending rows admits with `oversize_rows`
   0) and `lowered_text_and_bytes_maxima_are_checked_narrowing` (text 20→10 on install and
   reopen refuses with the `slice` truncation job and keeps the old generation; no offending
   rows admits; bytes 20→10 refuses with the sampled job and admits once the row is gone). The
   A8.1 destructive matrix drops its text/bytes/list rows. The owner test
   `refused_destructive_successor_keeps_the_active_build_cache` probed `text <=120 → <=119`,
   no longer destructive; it now changes `byCreator`'s components (`Drop::Index`; no program
   reads that index) — same test, one string.

5. **Cold-open succession logs the line — fixed.** `Runtime` keeps the report `open_inner`
   produced (`opened_successor`), `Runtime::take_opened_successor()` yields it once, and
   `owner.rs::foreground` writes `{"successor":"applied","report":…}` via `watch::log` right
   after `Runtime::open`. Tests: the nested core test's reopen route asserts
   `take_opened_successor()` equals `_meta.last_successor` and is `None` the second time;
   `real-owner-successor.test.ts` (first test) stops the owner, edits the schema on disk,
   restarts, and asserts exactly one `successor: applied` line whose report lists
   `messages.category` with `from != to`. (Reading the log right after `start()` can catch the
   owner's own `{"ready":…}` record mid-write — `watch::log` formats in several syscalls — so
   the test skips an unparsable line; the successor line is written before it.)

6. **List-narrowing rerun procedure — the ruling's second branch, for a measured reason.**
   The language allows the sweep (`for row in p.tags ?? []: for v in row: if v = 'b': delete …`
   compiles and certifies) but it does not run: a row holding the case twice, or over-long and
   holding it, is deleted twice in one iteration and the engine refuses the second `delete`
   (`E_REQUIRE:NOT_FOUND`, the nested package test parked at chunk 1), and the certificate
   prices the nested fan-out per item per maintain — verbatim: `write amplification 2700
   exceeds ceiling 2047 (messages Delete × 900 + counts maintained applications × 900 +
   hiddenCounts maintained applications × 900)`. Quarry has no `break`, list membership, or
   loop-carried binding, so no single sweep can delete a row at most once for a check on list
   items. The whole-table form is therefore limited to one-statement-per-row checks — `=` on a
   scalar case, one `.length` on the outer list, `slice` on scalar text — and values inside
   lists and `bytes` keep the sampled job, whose header now says why and says rerun; the message
   carries the remaining count (`12 affected rows remain`, pinned in
   `nested_enum_removal_counts_rows_once_and_preserves_bytes_on_every_path`); `successor.md`
   says it explicitly; RFC A2 records both measured reasons. The `.length` sweep runs to zero
   on the real owner in the combined test (`[enum('x','y')] <=3 ?` → `<=2 ?`; the 3-item row
   deleted; `affectedRows` 0 on re-apply).

7. **Maintain report fires for kind/source changes — fixed.** `successor.rs::maintain_change_line`
   names every changed part: `maintain counts: count → sum of value`,
   `maintain counts: from items → from posts, by sender → by recipient, day`; by-only stays
   `maintain counts: by sender → by recipient`. Test: `maintain_report_names_kind_and_source_changes`
   (kind change with identical `by` on the runtime, plus the line function on source+by and on
   an unchanged maintain → `None`).

8. **Ruling — the stuck FIFO — implemented.** `client-outbox.ts::drainQueued` records a
   non-retryable `input`/`schema` refusal of a replay on the queued entry
   (`OutboxEntry.refusal` via `OutboxRuntime.recordRefusal`; the intent stays queued and unspent
   as before; the drain still rejects). `OutboxRuntime.dismiss` admits a queued intent only when
   `dismissibleQueued` (a recorded `input`/`schema` refusal — a transport stop records nothing),
   removes it (the store drops its prediction overlay with `outbox.remove`) and returns
   `{ intent, op, args, refusal }`; `OutboxApi.dismiss` and `useOutbox().dismiss` return
   `DismissedIntent | undefined`; `OutboxStatus.blocked = { intent, code }` names a refused head;
   settlement strips a stale `refusal`. Sentence on `offline.md`. Test:
   `outbox.test.ts::a queued intent refused non-retryably as input is recorded, named by status, dismissible with its bytes, and the FIFO continues`
   (both carriers: the fake owner refuses the first replay 400 `E_INPUT`; drain rejects; both
   entries still queued, only the head carries `refusal`; `status().blocked` names it; the
   un-refused second intent is not dismissible; `dismiss(head)` returns op/args/refusal;
   `drain()` → `{ stopped: false, remaining: 0 }`; the second intent committed; the dismissed
   one never executed). RFC A2/A8.2 state the contract and the ruling.

9. **Report adjectives — tests extended, claims trimmed.** `real-owner-successor.test.ts` now
   asserts `server.state === "complete"` and `replay.reason === "never-held"` beside
   `replay.state === "partial"` for the absent and the hidden group (diagnostics verbatim:
   `{"server":"complete","replay":{"state":"partial","data":0,"reason":"never-held","site":"ops.count.0",…}}`);
   the guide test walks every `E_SUCCESSOR_*` row and `E_STEPS` (eight rows asserted present with
   `guide`/`site`) and compiles every Quarry `right` block through `check`
   (`E_SUCCESSOR_NARROWING`, `_COLUMN_REQUIRED`, `_UNIQUE`, `_CAP`) plus both `E_STEPS` sides —
   six compilations counted. Trimmed claim: `E_SUCCESSOR_DESTRUCTIVE.right` is a `sh` block and
   `E_SUCCESSOR_ROW_INVALID`/`_STORE` are prose, so "every successor family `right` example
   compiles" means the four with Quarry. RFC A2/A8.2 now cite LLP 1012 §7 (resume
   `E_OFFLINE_RESET`, replay `E_INPUT` unspent, dismissible).

10. **Implementation record — appended** (one line under LLP 1020 "## Implementation record").

### Also changed

- `successor.md` 4,090/4,096 bytes (sentences for items 4, 6, 8; prose tightened elsewhere to
  fit); `offline.md` 6,968 bytes — `build.mjs` notes it is below 20% headroom (advisory, exit
  0; it was already past that line at 6,758).
- `families.source.json`: the `E_STEPS` row only. `test-final-gates.ts`: `"E_STEPS"` added.
  `quarry-job-checks.ts`: the `repairs.q` jobs lower with the typed argument and certify.
- `tests/owner_cases/mod.rs`: the destructive probe (item 4).
- No file over 1,500 lines (`outbox.test.ts` 1,434; `registry.rs` 1,360;
  `registry_evolution_tests.rs` 1,111). `./ref-check --verbose`:
  `ok — 433 LLP docs, 7897 refs in 19064 files, 0 errors, 0 unchecked`.
- Not touched, pre-existing red at `0f09ff88e5`: `client.test.ts::query retries HTTP and
  network transport failures while mutation retries neither` fails deterministically (3/3
  alone) on its second variant — a 400 with a non-JSON body resolves `E_WIRE_SHAPE`
  (`client-wire.ts:316`, landed `a830d67d32c` on 2026-09-08) where the test expects a
  retryable `E_TRANSPORT`; `client-wire.ts`/`client.ts` are unmodified by this round.

### Verbatim counts

- Core (`cargo nextest … -p snapback2-core -E 'test(/evolution|successor|narrowing|widening|registry|once|maintain/)'`):
  `Summary [   1.546s] 93 tests run: 93 passed, 444 skipped`
- Owner (`-p snapback2 -E 'test(/offline_replay_successor|narrowing|successor|guide|jobs::run_file|families|steps/)'`):
  `Summary [  56.552s] 31 tests run: 31 passed, 341 skipped`
- Package `node --test tests/real-owner-successor.test.ts`: `ℹ tests 8 / ℹ pass 8 / ℹ fail 0 / ℹ cancelled 0`
- Package `node --test --test-name-pattern "dismissible" tests/outbox.test.ts`: `ℹ tests 1 / ℹ pass 1 / ℹ fail 0`
- Package `node --test --test-concurrency=1 tests/outbox.test.ts tests/outbox-custody.test.ts tests/client.test.ts`:
  `ℹ tests 78 / ℹ pass 77 / ℹ fail 1` (the pre-existing `client.test.ts` red above)
- Compiler (`bun src/test.ts`): `Compiler checks: 287 passed, 0 failed`
- `node build.mjs`: `guide: 31 cards, 77954/98304 bytes (20% headroom)`, exit 0
- Not run: `scripts/test.sh` (per the brief; the orchestrator verifies remotely).

## Fix round r2

Worktree: `/Users/ccheever/projects/snapback-s2y`; branch `s2/ri-succ`; unchanged HEAD `27088fe5c0bde2f51820000c06b935494afa2051`. Changes are uncommitted. Scope: LLP 1020 A2/A6/A8 and the seven-item r2 brief. Governing context: LLP 1020 Part A; LLP 1012 §7 (durable unspent intents, exactly-once replay); LLP 1018.004 §2 (serial inbox admission and follower custody); LLP 1016 D4 (typed null fill). No open design question or hand-off.

### Item verdicts

1. **FIXED — runtime bytes.** The unchanged five-root measurement is **84,575 gzip bytes**, down from **85,142** (−567), ≤ the brief's main target **84,580** and frozen ceiling **85,000**. Node **24.18.0**, esbuild **0.25.9**, gzip level **9**. Minified total **260,269 → 258,143** (−2,126). No root, ceiling, dependency or entry was changed. No required implementation was moved to another entry. Only public blocked-status/result presentation moved to the existing client layer, as requested.

   The measured outbox keeps one optional refusal field and one eligibility predicate. Replay clears the field using the existing write lock. Writer and follower dismissal share one implementation. Other savings: one swap/notification helper, one write serial, one readiness-result construction, one enqueue record construction, fixed code/site and shared recovery text on `OutboxRefusal`, shorter equivalent custody diagnostics, removal of unused internal `ready`, `intentName`, `settledEntry`, `OutboxRefusalCode`, and the duplicate runtime `DismissedIntent` type. Public `OutboxApi.ready()` remains.

   Identical esbuild options were used for before/after metafiles. Per-input `bytesInOutput` diff (all changed inputs):

   | Input | Before | After | Delta |
   | --- | ---: | ---: | ---: |
   | `src/store/outbox.ts` | 8,979 | 6,847 | −2,132 |
   | `src/offline.ts` | 22,573 | 22,579 | +6 |
   | Other 58 inputs | unchanged | unchanged | 0 |

   Both graphs contain the same **60** inputs. Raw evidence: `/tmp/succ-r2-meta-before.json`, `/tmp/succ-r2-meta-after.json`, `/tmp/succ-r2-meta-diff.json`, `/tmp/succ-r2-bytes-before.log`, `/tmp/succ-r2-bytes-final.log`; measurements appended to the existing `snapback2/metrics/twin.jsonl`.

2. **FIXED — durable replay/dismiss eligibility.** `OutboxLedger.attempt` re-reads the entry under `write`, clears the old refusal in a durable swap, then returns the entry for transport. If dismissal won that lock, no request is sent. Once replay wins, neither in-flight nor unknown outcomes are eligible, including after close/reopen. Only a new non-retryable input/schema refusal restores the field. `dismiss` re-reads and checks under the same lock.

   Tests: `outbox-custody.test.ts` — **“replay clears a recorded refusal durably before sending; in-flight and unknown outcomes cannot be dismissed”** (file, IndexedDB, SQLite; cold durable read after acknowledgment loss); `real-owner-successor.test.ts` — **“two clients and cold carrier reopen preserve rows; an enum replay with a lost acknowledgment cannot be dismissed”** (actual enum removal/restoration, owner commit intercepted before acknowledgment, dismissal refused in-flight and after transport loss, next online/resume settles, observer sees exactly one matching row). Original `outbox.test.ts` — **“a queued intent refused non-retryably as input is recorded, named by status, dismissible with its bytes, and the FIFO continues”** still passes on all three carriers.

3. **FIXED — follower dismissal.** The writer consumes a dismissal through the same locked method, atomically removing eligible custody and saving the result on the command row. The existing inbox state union gains `done` for dismissal commands; no new runtime type or store is introduced. The follower reads the durable result, removes that command, and returns the public `{ intent, op, args, refusal }`. A pending command can be retried after the bounded wait; a completed result remains until read. Channel messages remain nudges. Follower status and announced writer status derive `blocked` from the ledger.

   Test: `inbox.test.ts` — **“a follower dismisses a refused queued intent with its original bytes and blocked status; FIFO continues”**. Uses the existing follower harness; an unrefused queued successor is ineligible, the refused head returns exact args/refusal, and only the next queued write executes. The whole follower file passes, including existing alias dismissal/takeover tests.

4. **FIXED — filled null rows survive sampled repairs.** Mixed domain/maximum narrowing counts null rows but excludes null-only rows from its samples, because the typed fill covers them. Pure optional-to-required diagnostics still sample nulls. Scalar combined-narrowing sample assertions were adjusted to that rule.

   Tests: `registry_evolution_tests.rs::sampled_required_list_repair_fills_null_without_deleting_it` uses exactly `[enum('a','b')] <=3 ?` → `[enum('a')] <=3`, one null and one `['b']` row; the paste fills null, samples only the bad row, and the repaired store admits with the null row retained. `real-owner-successor.test.ts` — **“sampled required-list repair keeps filled nulls and converges beyond ten removed-case rows”** executes the emitted jobs with one null, twelve `['b']` rows and one unaffected row: **13 → 2 → 0** affected, disjoint fresh samples, null holds `['a']`, unaffected row JSON identical, all bad rows deleted.

5. **FIXED — stale narrowing integration expectation.** Renamed to `outer_optional_and_maxima_narrow_but_nested_optional_and_retypes_stay_type_changes`. Text/bytes/list maximum shrink now has valid-value admission, oversize refusal, and unchanged-value assertions. Nested optional changes and actual retypes still assert a destructive `TypeChange`. The entire integration file ran, together with the complete narrowing unit module and registry evolution module.

6. **FIXED — presentation and guarded text repair.** Refused queued entries use their refusal's rewrite/message as the “Not sent” label. Item actions use the ledger's eligibility predicate. Both chat outbox panels now show Dismiss for refused queued entries; the thread templates' existing item buttons inherit the fixed flag. `successor.md` and `offline.md` document both-tab recovery, durable clearing, unknown outcomes, and preserved filled nulls. `successor.md` is **4,026 / 4,096 bytes**. `offline.md` is **7,147 / 8,192** under the actual build allocation; no budget changed.

   Test: `client-items.test.ts` — **“queued refusal labels and item dismissal eligibility follow the last known attempt”**. The full snapshot/label file also passes. The text-delete comment now emits an executable inequality against `slice(value, 0, max)`, using empty text for null comparison, so it selects only over-long values. Rust pinned rewrites and compiler fixture `repairs.q` agree. Real-owner test **“text repair truncates scalars or deletes only over-long rows, preserving short text and nulls”** executes both the emitted truncation and the comment's deletion alternative, preserves short text/null rows, truncates twelve emoji scalars to ten or deletes only that row, then re-applies successfully.

7. **FIXED — record.** Appended the r2 implementation line under LLP 1020's Implementation record. Its Status is unchanged. `E_STEPS` family rows were not touched; the orchestrator should retain this branch's search-chunk pair on merge, as instructed.

### Verbatim verification counts

- `NEXTEST_TEST_THREADS=8 cargo nextest run --config-file ../.config/nextest.toml --profile local-proof -p snapback2-core -E 'binary(successor_narrowing) | test(successor::narrowing::) | test(registry::evolution_tests::)' --no-fail-fast`:
  `Summary [   0.297s] 25 tests run: 25 passed, 513 skipped`.
- `node --test --test-concurrency=1 tests/outbox.test.ts tests/outbox-custody.test.ts tests/inbox.test.ts tests/client-items.test.ts tests/snapshot.test.ts`:
  `ℹ tests 72` / `ℹ pass 72` / `ℹ fail 0` / `ℹ cancelled 0`.
- `node --test tests/real-owner-successor.test.ts`:
  `ℹ tests 10` / `ℹ pass 10` / `ℹ fail 0` / `ℹ cancelled 0`.
- Compiler `bun src/test.ts`: `Compiler checks: 287 passed, 0 failed`.
- `cargo build`: passed. `node build.mjs --measure-twin`: passed, **84,575**. `node build.mjs`: passed; no budget/config change.
- `./ref-check --verbose`: `ref-check: ok — 433 LLP docs, 7897 refs in 19066 files, 0 errors, 0 unchecked` (after the r2 record and reports).
- `git diff --check`: passed. Every touched file is below 1,500 lines; the largest is `src/store/range-store.ts`, **1,482**. Root `caps` still reports the same two inherited violations as the supplied host log: Snapback 1 `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` **1,504**, `packages/snapback-contract/agent-authority-contract.test.mjs` **1,508**. Neither was touched.
- `scripts/test.sh` was **not run**, per the r2 brief. No commit, stash, branch operation, full battery, new check/script/registry/config/design document, or ceiling increase.

### Before / after witnesses

- Bytes before: `Error: twin exceeds 85000 gzip bytes: 85142`. After: `gzip: 84575`, `minified: 258143`, `ceiling: 85000`.
- Original integration before: `4 tests run: 3 passed, 1 failed, 0 skipped`; line 170 `called Result::unwrap_err() on an Ok value` for the now-admitted text maximum shrink. After: all four integration tests pass in the 25-test run.
- In-flight baseline regression: `AssertionError: file: in-flight dismissal must refuse`; actual dismissal returned `{ args: { body: 'case returns', conversationId: 'conversation-1' }, intent: '…:0', op: 'messages.send', refusal: { code: 'E_INPUT', … } }`, expected `undefined`. After: `undefined` during request, after acknowledgment loss, and after cold reopen; next resume records one execution.
- Follower baseline: `status.blocked` was `undefined`, expected `{ code: 'E_INPUT', intent: '…:0' }`. After: status and returned original bytes agree; next write executes.
- Presentation baseline: actual `Sending… · Awaiting confirmation`, expected `Not sent · enum case removed`. After: expected label, `dismissible: true`; no refusal gives `dismissible: false`.
- Sampled repair baseline: after the first emitted job, the `00-null` row was gone and three bad rows remained. After: `13 affected; sample ["bad-0","bad-1","bad-10","bad-11","bad-2","bad-3","bad-4","bad-5","bad-6","bad-7"]; repair done; filled null and unchanged row kept`, then two bad rows sampled and zero conflicts on re-apply.
- Text comment before: `To drop those rows instead, replace the update with: delete items[p.id]`, under an unconditional truncation of every text row. After: guarded `if p.value != slice(p.value, 0, 10): delete items[p.id]`; the owner test executes the optional variant and preserves short/null rows.

Raw regression evidence remains under `/tmp/succ-r2-{narrow-before,regressions-before,replay-before,custody-before}.log`; final test evidence is `/tmp/succ-r2-{core-final,package-tests,owner-final,compiler,package-final}.log`. An initial whole owner-file run had an owner startup timeout plus the new guide card over 4,096; the card was shortened and the final full file passed 10/10. No product change was made for the startup timeout.

### Files, deviations, and open questions

Changed files (paths relative to `snapback2/` unless stated):

- Rust: `crates/snapback2-core/src/{successor_narrowing,registry_evolution_tests}.rs`; `crates/snapback2-core/tests/successor_narrowing.rs`.
- Client/runtime: `packages/snapback2/src/{client-inbox,client-items,client-outbox,offline,snapshot,types}.ts`, `src/react-core.tsx`, `src/store/{inbox,outbox,range-store}.ts`.
- Guides/templates: `packages/snapback2/guide/{successor,offline}.md`; `templates/chat/react/src/App.tsx`; `templates/chat/expo/src/Chat.tsx`.
- Tests: `packages/snapback2/tests/{client-items,inbox,outbox-custody,real-owner-successor}.test.ts`; `packages/compiler/fixtures/quarry-jobs/snapback/repairs.q`.
- Records: `metrics/twin.jsonl`; root `llp/1020-day-two-evolution-and-legible-ceilings.rfc.md`, `reports/final-succ.md`, `REPORT-succ.md`.

No r2 item refused. No unresolved product question. Inbox consumption now retains a completed command/result until read, replacing the older LLP 1018.004 §2 delete-command-immediately description as required by B2; the r2 record captures this scoped correction. Public presentation moved to the non-measured client layer under item 1's explicit instruction. Enqueue diagnostics were shortened without changing code, site, admission, or recovery action to pay the measured bytes. Source shows the package builder's current individual-card limit is 8,192, unlike the common brief; this change still keeps successor below its explicitly requested 4,096, and does not alter either budget.

Scope extension note: follower transport/status, item labels/actions, and both template panels are outside the original core-only A1/A2/A3/A6 path list but expressly required by r2 B1/B2/presentation. The compiler fixture change is necessary to keep the emitted text repair executable. No unrelated source was modified.

Report location: the prior report supplied for reading is `/Users/ccheever/projects/snapback-ri-20260910/reports/final-succ.md`, outside this session's writable roots. Its contents, including Fix round r1, are preserved in the worktree-local `reports/final-succ.md` with this r2 section appended. The external source was not modified. The root `REPORT-succ.md` contains this r2 report for the lane hand-off.

## Fix round r3

Base and unchanged HEAD: `36ae7687fd4f3168b50e80fc1e24eceb0b718adb` (`s2/ri-succ`, `/Users/ccheever/projects/snapback-s2y`). All changes below are uncommitted. Read both r3 reviews and the prior report through r2. Scope: the final eight-item brief; LLP 1020 Part A (A1–A3, A6; A8.1/A8.2).

### Item verdicts and evidence

1. **FIXED — dismissal result survives takeover.** The writer's locked `OutboxLedger.dismiss` finds a retained `done` command by backend/principal/session scope and either submitted target, ledger intent, or original inbox alias. It returns the retained entry and deletes the command atomically. Public writer dismissal supplies that scope through `ClientInbox`. Dev commands without an auth epoch use the existing inbox admission convention. `guide offline` documents recovery after takeover/reopening.

   Tests: `inbox.test.ts` — **completed dismissal returns its bytes once after takeover (alias command)**; **… cold reopen (alias command)**; **… cold reopen (intent command)**. The follower pauses before consuming `done`, the writer closes, and the retry uses the original alias. Assertions: exact `{ intent, op, args, refusal }`, wrong backend/principal cannot recover it, one return, command removed, dismissed intent never executes, next intent executes exactly once. The third case proves a command submitted with the ledger intent is recoverable through its original alias.

2. **FIXED — one truthful E_STEPS card and wire label.** The executable search-chunk pair remains; its comment says the **certificate charges** derivation for a patch naming the indexed text, even though equal components skip derivation at runtime. Runtime `Refusal::from_runtime` uses `bound`/`bounds`, matching check and the family card. `guide bounds` names `E_STEPS` and the conservative charge.

   Tests: `protocol::tests::runtime_steps_uses_the_check_family_and_bounds_page_on_the_wire`; existing `engine::search_tests::update_naming_a_derived_column_with_an_equal_value_is_priced_but_performs_no_derivation`; both E_STEPS examples in **successor guide aliases and Quarry diagnostic rewrites compile** and the compiler's final-gate pair.

3. **FIXED — persist the completed report once.** Removed persistence from `apply_additive`. Hot installation, explicit migration, and cold open populate `audience_bounds`, then persist the completed report inside the same transaction. Cold open also returns those bounds in `take_opened_successor`. `guide successor` says status retains the same completed report on all three routes.

   Tests: `registry::evolution_tests::completed_successor_report_is_persisted_once_with_audience_bounds_on_every_route` compares the full persisted report with the returned report on all three routes and installs a trigger that refuses a second report write. **dev status retains the completed install report including delivery audience bounds** installs an authored `deliver` line over `/control/apply` and compares the entire `dev --status --json.successor` with the install response, including `{ deliveries: 10 }`.

4. **FIXED — E_SUCCESSOR_STORE has a wire site.** `SuccessorRefusal::store` supplies `site: "store"`. The guide sentence includes store-wide refusal sites. `protocol::tests::successor_store_failure_names_the_store_on_the_wire` opens an actually corrupt persisted schema and asserts code, family, page, site, rewrite and predecessor/successor hashes in the serialized refusal envelope.

5. **FIXED — narrowing route coverage.** `registry::evolution_tests::maximum_narrowing_preserves_rows_indexes_and_generation_on_all_three_routes` covers **36 scenarios**: text/bytes/list × direct/nested optional-list wrappers × fitting-only/fitting-plus-oversize × install/migration/reopen. The refusal counts exactly one oversized row and samples its ID, preserves predecessor hashes and all `_meta` state; cold refusal is checked on the raw database before reopening the predecessor. Both outcomes preserve serialized rows, all index entries and commit sequence. Zero-conflict admission records zero counts and advances to the successor. Existing guide sentences cover maxima, recursive wrappers, counts and rollback. This item adds coverage; the narrowing implementation already satisfied these cases.

6. **FIXED — owner-route regroup/source/dismissal coverage.**

   - **cold owner regroup logs the old and new keys and serves the successor positional value** stops the owner, changes `by sender` to `by recipient` on disk, restarts, asserts exactly one matching `maintain counts: by sender → by recipient` log record and the status report, then checks old-key zero and successor-key one.
   - `registry::evolution_tests::regroup_replaces_only_the_owned_projection_without_a_plan` now certifies and runs the Quarry-shaped Get/typed-zero positional read through `read_operator`: successor key → 1, predecessor key → 0.
   - **real owner input refusal exposes the head and dismissal returns args before the next queued send commits** queues both writes before enum removal, observes real `E_INPUT`, asserts `status.blocked`, exact dismissal args/refusal, no dismissed message, and one committed second send.
   - **owner source changes rebuild distinct totals and report hot install, migration and cold open** seeds one message and three posts. Hot install switches messages → posts (count 3); explicit migration switches posts → messages (1); cold open switches messages → posts (3). Every route checks the positional query, full status/install report equality and the matching source-change log line. The existing successor guide describes count/sum source replacement and reporting. No additional projection behavior change was needed.

7. **FIXED — text and records.** The required-column rewrite names `guide successor`; `zero_enum_removal_still_checks_uniqueness_caps_and_required_columns` asserts that pointer and rejects the old `guide job` pointer. Corrected the first successor implementation bullet to union ownership. Added the dated amendment under LLP 1018.004 §2 for `done`, one-time recovery and eligible queued dismissal, preserving the historical text. The drain comment now says input/schema refusals persist eligibility and stop the drain. Runtime refusal/drain behavior is exercised by both custody and owner tests above.

8. **FIXED — measurement and records.** Appended this section and the LLP 1020 r3 implementation line; Status unchanged. `REPORT-succ.md` contains this completed r3 report. Final five-root measurement is **84,736 gzip / 258,390 minified**, ceiling **85,000**, headroom **264**; Node **24.18.0**, esbuild **0.25.9**, gzip level **9**. The measurement records HEAD **36ae7687fd4f3168b50e80fc1e24eceb0b718adb**, with this uncommitted delta. The brief supplied a host baseline of **84,514**; final growth is **222** bytes. No ceiling, root, dependency, build configuration, or required runtime placement changed. Both local measurements (84,725 intermediate; 84,736 final) remain appended in `metrics/twin.jsonl`.

### Before → after outputs

Reproductions used the new assertions before changing their corresponding implementation; raw logs are `/tmp/succ-r3-{inbox,steps,report,owner-report,site}-before.log`.

```text
inbox takeover and cold reopen:
  before: actual undefined; expected { intent: 's2id-0000000000000000000000000000000a-0000000000000064:0', op: 'messages.send', args: { conversationId: 'conversation-1', body: 'removed' }, refusal: { code: 'E_INPUT', family: 'input', message: 'enum case removed', guide: 'input/runtime' } }
  before: tests 2 / pass 0 / fail 2
  after: all three takeover/reopen/alias variants pass; exact result, one return, command cleaned, executions ['after']
E_STEPS wire:
  before: left String("bound/runtime"), right "bounds"
  after: code E_STEPS, family bound, guide bounds
completed report:
  before: install audienceBounds { deliveries: 10 }; dev status omitted audienceBounds
  before: persisted last_successor lacked audienceBounds in the core install test
  after: full status/persisted report equals install return; audienceBounds { deliveries: 10 }; all three core routes pass
E_SUCCESSOR_STORE wire:
  before: left Null, right "store"
  after: site "store", family/page successor/successor, both compared generations
```

Coverage-only items 5/6 exercise existing projection/narrowing behavior; they do not claim a newly repaired engine defect. Initial fixture drafting had a Rust borrow/mutability compilation error and a computed seed expression refused as `E_SEED_INVALID`; both were corrected before final verification. An initial concurrent owner run hit two `owner readiness timed out` failures; the final serial full-file run below passed every test without changing the harness or timeouts. No final owner-stop sandbox artifact occurred.

### Verbatim final verification

From `snapback2/`:

```sh
NEXTEST_TEST_THREADS=8 cargo nextest run --config-file ../.config/nextest.toml --profile local-proof -p snapback2-core -p snapback2 -E 'test(registry::evolution_tests::) | binary(successor_narrowing) | test(successor::narrowing::) | test(protocol::) | test(check::) | test(update_naming_a_derived_column_with_an_equal_value)' --no-fail-fast
```

```text
Summary [   0.349s] 44 tests run: 44 passed, 939 skipped
```

From `snapback2/packages/snapback2/`:

```sh
node --test --test-concurrency=1 tests/inbox.test.ts tests/outbox-custody.test.ts
node --test --test-concurrency=1 tests/real-owner-successor.test.ts
node build.mjs --measure-twin
node build.mjs
```

```text
inbox + outbox-custody: ℹ tests 19 / ℹ pass 19 / ℹ fail 0 / ℹ cancelled 0
real-owner-successor:  ℹ tests 14 / ℹ pass 14 / ℹ fail 0 / ℹ cancelled 0
guide: 31 cards, 81670/98304 bytes (16% headroom)
```

`cargo build` and the final package build exited 0. Compiler (`snapback2/packages/compiler`, `bun src/test.ts`): **Compiler checks: 295 passed, 0 failed**. Final logs: `/tmp/succ-r3-{rust-final,client-final,owner-final,compiler-final,measure-final,package-final}.log`.

`ref-check: ok — 439 LLP docs, 7975 refs in 19111 files, 0 errors, 0 unchecked`.
`git diff --check`: exit 0. `caps`: **2 violations**, both inherited Snapback 1 files (`crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs`, 1504; `packages/snapback-contract/agent-authority-contract.test.mjs`, 1508). No changed source exceeds 1,500 lines; largest touched file `registry.rs` is 1,405, `registry_evolution_tests.rs` 1,241. Guide bytes: successor **4,584 / 4,608 pin**, offline **7,861**, bounds **2,534**; no budget raised. The builder retains its existing offline-card headroom advisory.

### Files, constraints, deviations and open questions

Changed paths relative to the repository root:

- `snapback2/crates/snapback2-core/src/{registry,registry_evolution_tests,successor}.rs`.
- `snapback2/crates/snapback2/src/protocol.rs`.
- `snapback2/packages/snapback2/src/{client-inbox,client-outbox}.ts`, `src/store/outbox.ts`.
- `snapback2/packages/snapback2/tests/{inbox,real-owner-successor}.test.ts`.
- `snapback2/packages/snapback2/guide/{bounds,offline,successor}.md`, `guide/families.source.json`.
- `snapback2/metrics/twin.jsonl`; `llp/1018.004-truthful-and-composed-writes.decision.md`; `llp/1020-day-two-evolution-and-legible-ceilings.rfc.md`; `reports/final-succ.md`; `REPORT-succ.md`.

Governing constraints: LLP 1000's Snapback 2 fence; LLP 1001 §4 transaction/ownership; LLP 1012 §7 durable unspent replay; LLP 1018.004 §2 serial inbox custody; LLP 1016 D4 repair under the predecessor; LLP 1020 A1/A2 recursive domain narrowing, A3 exact owned projections/reporting, A6 diagnostic family/site/rewrite/page. No new apparatus, generated source, corpus case, design document or compatibility path. Hand-off: none.

No numbered item refused. No RFC design deviation and no new open product question. Explicit migration source reporting and ledger-intent-command → original-alias recovery received additional coverage within the requested surfaces. All files are within the final brief's named areas, including its explicitly requested LLP 1018.004 amendment. The pre-existing online-client hot-regroup transition issue (`issues/20260910-snapback2-online-client-query-during-hot-regroup.md`) remains outside these eight fixes; this report makes no claim to fix that separate race. No commits, stashes, branch changes or whole-suite run; the orchestrator owns remote full-suite verification and landing.

## Fix round r4 (orchestrator)

Codex r4 (`reviews/succ-r4-codex.md`) found that a follower's dismissal consumed its durable
result and then rejected its caller when the role changed during the deletion's refresh, losing
the bytes; and that two overlapping follower dismissals could both return one result. Fixed in
`client-inbox.ts`: the role is checked before the row is consumed, never after (a role that
changed first leaves the row for the new writer; a role that changes after the deletion leaves
the bytes with the caller), and one consumer per command. Tests (`inbox.test.ts`): `a dismissal
consumed before a takeover keeps its bytes with the caller` (pause after the deletion commits,
take over, the original call returns the exact bytes, the successor finds nothing, only the next
intent replays); `overlapping follower dismissals consume a completed result once`. Inbox,
outbox, custody, and recovery files 72/72; runtime 84778 gzip (ceiling 85,000).

## Fix round r5 (orchestrator)

Codex r5 (`reviews/succ-r5-codex.md`): the r4 guard was one client's memory, so two follower
tabs, or a follower and the writer's recovery, could both consume one completed dismissal —
the carrier's deletion reported nothing. Fixed: `InboxConnection.take(key)` and the backend's
`inboxTake(key)` read and delete the row in one carrier transaction and return the row actually
consumed; the follower (`OfflineRuntime.takeInboxRow`) and the writer's recovery
(`OutboxLedger.dismiss`) both consume through it and return only what they took. Tests
(`inbox.test.ts`): `two follower tabs consume a completed dismissal once`; `a writer's recovery
and the follower's consumption return one result between them`; the takeover and overlap tests
from r4 rehooked onto the take. Inbox, outbox, custody, recovery, and local-data files 85/85;
runtime 84832 gzip.

## Fix round r6 (orchestrator)

Codex r6 (`reviews/succ-r6-codex.md`) found a new defect in the A2 repair paste: the fill
argument was typed by the successor's domain, so a mixed change such as `enum('a','b')?` →
`enum('b','c')` pasted `value: enum('b','c')`, which the predecessor schema the job runs under
refuses. Fixed: `fill_type` types the argument by the cases both schemas accept (through
optional and list wrappers; a smaller maximum is already accepted), and when no case survives
both the paste says to apply the widening first. Test
`a_mixed_enum_change_types_its_fill_by_the_cases_both_schemas_accept` (mixed enum, no
overlap, list of enums, widening that becomes required). The overlap test now barriers both
callers at the take for the same command (codex/grok material); LLP 1018.004's amendment says
the carrier transaction decides consumption. Narrowing/evolution units 24/24, inbox 14/14,
compiler 295/295; runtime 84832 gzip.

## Fix round r7 (orchestrator)

Codex r7 (`reviews/succ-r7-codex.md`): `fill_type` intersected enum cases but kept the successor's
maximum, so `[enum('a','b')] <=2 ?` → `[enum('b','c')] <=3` pasted `[enum('b')] <=3`, which the
predecessor refuses; likewise a `text <=10 ?` → `text <=20` fill. Fixed: list, text, bytes, and
json maxima take the smaller of the two bounds; the test covers both shapes. The two-tab
consumption test now barriers both tabs at the take for one command (codex material). Narrowing
and evolution units 24/24, inbox 15/15, compiler 295/295.

## Fix round r8 (orchestrator)

Grok r7 (`reviews/succ-r7-grok.md`, LAND WITH FIXES): the staged paste said "keep the predecessor
schema" right after telling the operator to widen it — it now says "keep that widened
declaration"; the mixed-enum paste is pinned to the compiler-lowered fixture (the `tier` change
in the fixture test is now mixed: `pro` removed, `team` added, required), so `repairs.q` unchanged
proves the intersection-typed fill compiles under the predecessor `schema.q`. Residual (ticket at
landing): the Rust positional-Get test does not run the checker; the owner test does.

## Fix round r9 (orchestrator)

Codex r8 (`reviews/succ-r8-codex.md`): two more shapes of the fill-type hole — image/video maxima
were not intersected, and a staged (disjoint-enum) paste inside a list lost the smaller list
bound. `fill_type` now returns the type and a `staged` flag: every bound is the smaller of the
two (text, bytes, json, image with the predecessor's `once`, video, list), enum cases are those
in both, and when none survive the successor's cases are kept with `staged` set, so wrappers keep
their bounds. Tests: `image <=10 ? → image <=20` fills `image <=10`; `[enum('a')] <=2 ? →
[enum('c')] <=3` is staged with `[enum('c')] <=2`. Material: the successor report is logged
before the build cache is published, so a publication failure never hides the regroup line.
Narrowing/evolution 24/24, writer units 43/43. The remaining answer to this class is a ticket:
every generated paste should be bound by the compiler in the engine's own test, not string-matched.
