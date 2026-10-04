# SX — catalog inspection and sync-window clarity

2026-10-04, eb1000, branch `sb4-intent/sx-sql-inspection`.
Completed 2026-10-05 in Europe/Berlin (2026-10-04 UTC).
Baseline: `a8762e0556` (origin/main when this worktree was created).
Calibration evidence: the Grok cal30 `lane-essay.md`, `lane-diary.md` and
`lane-run-log.md` under
`benchmarks/runs/2026-10-03-snapback4-clique-grok-0.4.12/grok/`.

## Result

`snapback4 sql '\dt'` and `snapback4 sql '.tables'` list application
tables, public maintained views and ephemeral declarations. They show the
active schema generation and bounded stored row counts. Counts through
10,000 are exact; larger tables report **at least 10,001**, explicitly marked
`exact: false` in JSON. Ephemeral counts are unavailable because those rows
belong to the serving process's memory. Counts describe physical stored rows,
not an authorization-filtered or expiry-filtered application query.

`snapback4 sql '\d messages'` and `snapback4 sql '.schema messages'`
describe columns with Quarry types and nullability, maintained columns,
indexes and unique keys, including implicit `id`. Public maintained views
name their source. Lookup is case-insensitive. Qualified names do not apply:
Quarry table identifiers cannot contain `.`, so `\d scope.messages` is refused.
`--release dir` and `--json` work for all four spellings. There is no SQL REPL.
CLI addressing remains the persisted dev store or a release; the memory-store
proof exercises the catalog directly through `Store::memory()`.

Catalog JSON contains `header`, `generation`, `tables` and
`ruleFiltered: false`. Each table has `name`, `kind` and
`rows: { count, exact }`; an unavailable count is null with a reason.
Descriptions add `columns`, `indexes` and, for a maintained view,
`maintainedFrom`. Displayed compiler-owned indexes keep their complete public
keys with `name: null` and `generated: true`; authored names remain intact.
Authored unnamed unique keys have `name: null` and `generated: false`.
Generations predating the authored-index record report `generated: null`, hide
unverified names and explain that provenance is unavailable until adoption
with a current compiler; inspection itself never adopts or recompiles source.
Indexes depending on hidden bookkeeping columns are omitted as a whole.
The implicit id key is
listed once, and calendar keys include duration/offset arguments. This is a
CLI inspection result, not a client wire change.

The catalog comes from the persisted compiled schema and Snapback's row
keys in one deferred read-only snapshot. It never compiles/adopts the local
source, reserves a writer lock, exposes SQLite metadata or lists private
maintained targets. Meta-command arguments are matched against application
schema names, not executed as SQL. SELECT's existing authorizer and bounds
remain in place. Internal-table refusals now print the exact alternative:
“`\dt` lists tables; `\d messages` describes one”.

The openings of `guide sync` and `guide reads`, plus the chat/Expo and social
starter schema comments, explain that `last N` bounds the device working
set, while cursor queries page server history beyond it; offline reads use
only acquired data. `guide sql`/`from-sql`, `guide inspect`/`personas`, CLI
help and the operations reference explain catalog inspection. All guide
caps are retained.

`check` emits `N_SYNC_WINDOW_SIZE` only when a new/changed window encounters
an existing table with at least ten times its window size. Its message
explicitly counts **all groups**, says the window is per group, and points
to the opening sentence of `guide sync`; it does not infer a per-group
overflow or advise increasing the window. The probe visits at most 10,000
keys per changed table. Windows above 1,000 rows, unchanged windows, ephemeral
tables, missing stores and stores without an adopted schema stay quiet.
The same pending change can be noted again until adoption; no compiler note
is emitted on every compile and no durable warning state is added.

## Governing context and review

The scoped `llp-orient` pass used Snapback 4's AGENTS/NOT-DOING/JOURNAL,
LLP 3000's fence and engine/client contract, LLP 2000.000's partition model,
LLP 3000.007 §8 and §18.3, LLP 3000.021 §3.1, the current sync/reads/inspection
cards and the operations reference. These preserve developer-only read-only
inspection, active-generation defaults, and ordinary history's server
fallback beyond device coverage. LLP 3000.007 §8.8 is updated with the
catalog and bounded advice decisions; the existing code references still
apply. No core schema, client contract, sync protocol or device implementation
changed. No independent agent review is claimed.

## Verification

All execution is local to this worktree on eb1000. No remote host, sibling
worktree or sibling process was used or modified. Dependencies were installed
with `bun install --frozen-lockfile`. Rust builds use eight jobs, no incremental
cache, and no dev/test debug information to keep disk use bounded; wasm's
profile is unchanged. Node is 24.13.1 and Bun 1.3.14.

- Final SQL catalog Rust tests: **4 passed**. Both `Store::memory()` and file-backed
  SQLite are populated with **10,025 messages** and a maintained aggregate;
  they verify count bounds, types, nullability, keys, views, ephemeral count
  unavailability, generation and internal-name refusal. Catalog reads also
  execute under SQLite `query_only` and preserve the connection's write count.
  The social starter's generated timeline is identified, internal timeline
  slots are hidden, and named/unnamed, calendar and word keys are described.
- Sync-window tests: **2 passed**. A held WAL writer permits the note, database
  and WAL bytes remain identical, the note disappears after adoption, and
  nearby/large windows and unadopted/missing stores remain quiet. Both pass
  again from their final `check::sync_window` module after the final CLI rebuild.
- CLI unit/check targets: **288 + 88 passed**, four existing unit ignores,
  before the additional empty-store regression (which then passed above).
- Guide tests: **112 passed**, including every Quarry example, diagnostic
  definition/action, word budget and card line cap. Wording was condensed
  within existing budgets; no cap or retained-fact baseline was relaxed.
- Affected clients: six files, **203 tests**. The first run had one new test
  assertion mistake: the chat fixture's `body` is optional, while the assertion
  expected required. After correcting that assertion, all **22 periphery
  tests passed**. The other five files passed: social starter, maintained
  columns, ordinary history, retained history and horizon boundaries. The
  maintained-column file then passed **all four tests again** with explicit
  catalog privacy/parent-column assertions. Final rebuild: periphery plus
  maintained columns **26/26 passed**, including the final key presentation.
- Full `bash snapback4/scripts/test.sh`: **exit 1 in 2,557 s**; its Rust inventory
  is **299 binaries / 1,012 executions**. The Rust stage found two frozen
  receipt-corpus source mismatches caused by the starter comment, plus the
  blocked-stderr test described below. All **313 client files passed**:
  **6,212 passed / 11 skipped / 0 failed**. Both serial model files passed
  **79 tests**. Workspace doctests, nine fixture tests, all build/typecheck,
  docs-budget and release-guard stages passed.
- Both receipt-corpus generators were rerun with `UPDATE_RP_WASM_CASES=1`:
  **2 tests passed**. `fixture-diff.json` confirms only the new comment changed
  in 14/22 and 1/23 fixture cases respectively; every non-source field is
  identical. Their generated records are included in this commit.
- `blocked_stderr_cannot_block_responses_or_later_mutations` failed in the
  full run with `dropped: 0` and only request IDs 9–40 in a purported
  post-drain recovery record. The same compiled test binary passed an isolated
  rerun in **2.15 s**. A new `add39` can match an old `add39` record; this is
  a likely observation race, not a proven production failure or established
  infrastructure cause. [Follow-up ticket](../../../issues/20261004-snapback4-blocked-stderr-recovery-observation.md).
  The full run remains red; the isolated pass does not replace it.
- `./ref-check --verbose`: **527 LLPs, 10,364 refs, zero errors/unchecked**.
  `git diff --check` and the 1,500-line source-file cap also pass.

Focused logs are retained alongside this report. Intermediate guide failures
identified budget/definition pins while wording was being fitted; the final
guide log is green. No affected product failure was dismissed as infrastructure.

## Wasm and disk

The baseline web artifact is **2,116,457 B raw / 639,750 B gzip**,
SHA-256 `de4877c28435db4e5ba9e501399eee2af6e8b02b97d1252b7932a103ae5effc1`.
The wasm budget is **639,887 B**, unchanged. The full-suite rebuild is
byte-identical; `wasm-before.sha256`, `wasm-after.sha256` and
`wasm-comparison.json` record the comparison. Gzip uses the same `gzip -9c`
command and artifact filename as `build-wasm.sh`. All implementation changes
are outside wasm's source closure; the receipt-corpus JSON changes are source
comments only.

Initial worktree size was 3.0 GiB; pre-suite size was 5.4 GiB. The full suite
runs on CPUs 24–47, with eight Rust test processes and eight client files at
a time; its inventory and work counts are unchanged. Full-suite scratch used
the isolated `/tmp/sb4-sx.fH2KuN` directory. Scratch and the one failed
intermediate catalog-test store were removed after the suite exited. Final
allocation is **14,713,782,272 B**, also the largest sampled allocation
(under **14.72 GB**); earlier samples include scratch. `disk-usage.jsonl`
records the measurements against the **40 GB** ceiling. No sibling worktree
or process was modified, and nothing was pushed.

## Final verification record

The final catalog/presentation edits are covered by four SQL unit tests,
two sync-window integration tests and 26 rebuilt-CLI client tests. The final
guide wording passes all 112 guide tests. These scoped checks verify edits made
after the full run started; no second full run or all-green suite claim is made. The unrelated
stderr test's unresolved full-run failure remains in the linked issue.

Reproduce from `snapback4/` with the build environment above:

```sh
cargo test -p snapback4 --bin snapback4 verbs::sql
cargo test -p snapback4 --test check sync_window
cargo test -p snapback4-lang --test guide
cargo build -p snapback4
node scripts/run-client-tests.mjs 2 files packages/snapback4/test/periphery.test.mjs packages/snapback4/test/maintained-columns.test.mjs
bash scripts/test.sh
```

`verification-summary.json` records the stage results; compressed logs retain
the full failures and successful controls separately. `catalog-example.json`
and `sql-help.txt` show the final CLI output. This commit includes the code,
guide and starter changes, the comment-only fixture regeneration, governing
LLP update, journal entry and follow-up issue, with the requested co-author
trailer. Local commit only; no push.

## Round 1 — generated indexes and private-target descriptions

Base: `98d09e2ebd`. Both round-0 reviews were **READY WITH CHANGES**:
[Astra review and evidence](../../../../reviews/sx-r0.astra.evidence/REVIEW.md),
[Grok review](../../../../reviews/sx-r0.grok.md) and
[Grok probe evidence](../../../../reviews/sx-r0.grok.evidence/probe-summary.json).
These are the received reviews of round 0, not reviews of this revision.

The scoped context remains LLP 3000.007 §8 (active-generation, read-only
developer inspection) and LLP 3000.007.001 §3.2 (private-target refusals name
the parent column). No new design ruling or review hand-off is needed.

1. Every displayed `$`-prefixed index identity is now `name: null` with
   `generated: true`, including sequence and timeline follower indexes.
   Index visibility uses the same column visibility as the column list,
   including calendar and word-index inputs. An index containing a hidden
   bookkeeping input is omitted entirely, including `$expiry` over `$deadline`
   and `$children` over a captured deadline. This preserves complete keys;
   it does not present a shortened tuple as the actual index or unique key.
   Authored keys, public generated keys, and existing calendar arguments remain.
2. Both `\d` and `.schema` resolve known private maintained targets
   case-insensitively before ordinary table lookup and return
   `E_MAINTAINED_COLUMN_PRIVATE`. The message retains SELECT's public parent
   column and repair, adds the catalog hint, and never echoes the private name.
   No SELECT authorizer or store-opening code changed.
3. The result section above now says that case-insensitive lookup works and
   qualified names do not apply. A regression explicitly refuses
   `scope.messages`; the parser accepting one token does not make it a valid
   Quarry table name.

Tests exercise the actual social/chat starter schemas, extended only in the
test input with sequence and expiring read-through declarations. They verify
`$intent`, `$sequence:ordinal`, `$expiry`, `$children`, and timeline follower
indexes, preserving authored names and full public keys. The maintained-column
client tests exercise both aliases, original/uppercase private names and both
JSON/text output, comparing their refusal with SELECT's parent-column message.
The first new SQL test run had a mistaken assertion that the sequence lookup
index was unique; corrected against the compiled schema before the passing run.

Round-1 verification, all passing:

- SQL verb: **7 tests**, including populated memory and SQLite stores.
- Complete `check` integration target: **89 tests**.
- Guide target: **112 tests**, with unchanged card budgets.
- Six affected client files: **203 tests**, zero failures/skips, using the
  rebuilt CLI and two concurrent files on CPUs 24–47. These are periphery,
  social starter, maintained columns, ordinary/retained history and horizon
  boundaries, matching the round-0 review scope.
- **18 CLI probes** record human/JSON catalog and refusal output in
  `r1-catalog-examples.json`.
- Reference audit: **527 LLPs / 10,365 refs**, zero errors/unchecked;
  `git diff --check` passes.

`r1-*.log.gz` preserves the test/build logs, including the initial assertion
mistake; `r1-verification.json` records the totals and disk accounting. Build
limits remain eight Cargo jobs, no incremental cache or dev/test debug info.
The existing wasm artifact hash still matches round 0 exactly; no wasm source
changed and no rebuild is claimed. Own probe/client scratch was removed.
Sampled allocation stayed below **14.84 GB**, within the **40 GB** limit.

No full-suite rerun was required for this catalog-and-tests-only runtime
change. Round 0's recorded full-suite Rust red remains unchanged. The report
and journal are updated with this local commit and the requested co-author
trailer; nothing pushed.

## Round 2 — source provenance for every index

Base: `19f492f247`. Grok marked round 1 READY; [Astra's review](../../../../reviews/sx-r1.astra.evidence/REVIEW.md)
identified compiler-created non-dollar names still marked authored, including
`followingFeed.byReaderPage` and `$ownKeys:likes.byGroup`. This round replaces
the name-based origin test rather than enumerating more generated families.

The compiled schema now records `authored_indexes`, collected from the original
table and maintained-view index/unique declarations before any binder expansion.
It persists with the active generation on the server, is absent from device
projections and is excluded from the wasm build. Catalog provenance tests set
membership, independent of the index's spelling or generator. Consequently
intrinsic id, timeline/feed, own-key and maintained-view bookkeeping indexes
are generated, as are sequence, expiry, children and intent-planner indexes.
An unnamed source `unique` remains authored; its synthetic spelling stays hidden.
Generated indexes have no displayed name, and the complete-public-key/hidden-
bookkeeping policy from round 1 remains intact.

Legacy schemas deserialize with no record. The catalog returns an unknown
origin (`generated: null`) and a short explanation, never a guessed boolean.
The next ordinary adoption records provenance in the new schema generation;
inspection does not write metadata or use the possibly broken working source.
The record changes server schema serialization and its generation hash, but
does not change any physical index definition, query plan or device projection.
LLP 3000.007 §8 now documents this policy; LLP 3000.013 §2.1 still governs the
unchanged planning semantics.

The new census walks **every physical index** of the unmodified social and chat
starters, including intrinsic/private/hidden indexes, and compares its origin
with declarations parsed from the original source. It repeats after schema
serialization and store persistence. Output checks pin the two review examples
and maintained-view `byGroup`; other tests cover authored unnamed unique keys,
authored maintained-view indexes, device projection and legacy missing metadata.
The durable-byte compatibility test strips only this newly documented metadata
field before comparing its existing frozen runtime bytes; no fixture was replaced.

Round-2 validation passes: **9 SQL, 89 check, 112 guide, 10 schema-capability,
2 receipt-corpus and 1 durable-byte compatibility tests**. Four CLI probes
confirm both review examples through both aliases with broken local source;
see `r2-catalog-examples.json`. The source census supersedes round 1's
prefix-limited classification. The CLI builds, reference audit and whitespace
check pass. No full-suite or client-suite rerun is claimed for this round.

The wasm rebuild is **2,116,457 B raw / 639,751 B gzip**, within the unchanged
**639,887 B** cap. It is **not byte-identical**: exactly three bytes in the data
section record the four-line shift of three panic source locations in
`schema.rs`; the instruction and all other sections are identical. This adds
**1 B gzip**. `r2-wasm-comparison.json` records offsets, source lines and hashes;
the new hash is `a2922caee398df1a5379742ad9dde6655653ae5202ca06ec7e500d85ed300a26`.
No wasm metadata field, runtime instruction, budget change or native-device
format change is introduced.

`r2-*.log.gz` and `r2-verification.json` retain the results. Probe scratch was
removed; final sampled allocation is **15.09 GB**, below **40 GB**. All work
remained on eb1000 in this worktree. Local commit with the requested co-author
trailer; nothing pushed. Round 0's full-suite red remains recorded separately.
