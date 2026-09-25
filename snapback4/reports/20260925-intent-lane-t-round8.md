# Lane T round 8 — inherited sync, devices and guide

LLP 3000.014 revision 8, increments 2 and 4. Based on round 7 at
`a26b2d9f8`, on `sb4-intent/t-read-through`. No push or publication.

Read-through children now sync under exactly their inherited audience, carry
their captures, resolve parent-pinned reads on devices, and predict covered
inserts. Unknown parent or child coverage never becomes a complete zero count.
Server fallback preserves the device's marked retained children. The device
publishes authoritative time atomically with its images and pending-write replay.

Both round-7 reviews returned READY. Their two nonblocking test gaps are also
covered here, with mutation witnesses.

## Forms that compile and run

```quarry
table folders:
  owner: principal
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  sync last 500 by .id
table documents:
  folder: folders
  body: text <= 200
  immutable folder
  read through .folder
  insert <- allow
  sync
query page(folder: folders):
  documents where .folder = folder first 20 by .id
mutation post(folder: folders, body: text <= 200):
  insert documents {folder, body}
view totals: count documents by .folder
query total(folder: folders):
  totals[folder]
```

- `read through .folder` with `sync` infers the captured owner audience.
- `documents where .folder = folder first 20 by .id` uses the shared parent
  resolver. A missing horizon parent requests server fallback.
- `insert documents {folder, body}` predicts when the live parent is covered,
  or was predicted earlier in the pending chain. Otherwise it queues without a row.
- `delete tasks[id]` predicts only with complete current coverage of every
  read-through child table and no blocking child; otherwise it queues or refuses.
- `totals[folder]` resolves the parent and requires complete current child
  coverage before deriving a count locally; scanning `totals` remains refused.
- `read through .message` on `receipts` and `reactions`, followed by `sync`,
  replaces their authored chat and copied-deadline columns.
- `view unread: count receipts where .state < 2 by .message.chat, .principal`
  derives its read rule and sync audience from the captured chat key. Receipts
  and reactions use `read through .message`, without authored chat/deadline copies.

The complete four-level and Clique programs are the new
`tests/fixtures/read-through-device.q` and `tests/fixtures/read-through-clique.q`
under `crates/snapback4-lang`. The rules card contains compiled issue-tracker
and Clique examples; the language card contains the small inherited-sync form.

## File-by-file changes

Paths below are relative to `snapback4/`.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/schema/through.rs` | Remove the temporary raw-schema sync prohibition; reserve retained output metadata for syncing delivered-history children. |
| `crates/snapback4-core/src/schema.rs` | Require exact inherited sync admission after service stripping; treat captured prefixes as total; validate maintained audience aliases against their source capture. Existing grant guards remain in force. |
| `crates/snapback4-lang/src/bind/through.rs` | Remove `E_READ_THROUGH_SYNC`; diagnose a column that conflicts with syncing delivered-history row metadata; keep server-only columns compatible. |
| `crates/snapback4-lang/src/bind/schema.rs` | Map a maintained view's named audience field back to its inherited capture when deriving sync. |
| `crates/snapback4-lang/src/bind/intent_sync.rs` | Strip complete service disjuncts when planning audience prefixes and inverse indexes. |
| `crates/snapback4-lang/src/bind/residency.rs` | Explain non-predictable child upserts/if-absent inserts; classify parent-key aggregates by their source coverage. |
| `crates/snapback4-core/src/rows.rs` | Add current-row/current-group coverage hooks, conservative by default. |
| `crates/snapback4-core/src/engine/through_read.rs` | Shared four-outcome resolver, metered capture matching over live current children, separate child coverage and maintained capture-alias coverage. |
| `crates/snapback4-core/src/engine/through.rs` | Capture predicted inserts through recorded-path coverage; require full current child coverage before predicting parent deletion. |
| `crates/snapback4-core/src/engine/read_auth.rs` | Expose the existing three-valued read-authority decision to the resolver. |
| `crates/snapback4-core/src/engine/read.rs` | Use parent resolution for ordinary and matching pages; exclude mismatched current children, preserve marked retained children, and keep existing provisional expiry ownership. |
| `crates/snapback4-core/src/engine/read_point.rs` | Extract point reads to stay below 1,500 lines; resolve inherited keyed aggregates and derive parent-key counts only from fully covered current children. |
| `crates/snapback4-core/src/engine/live_aggregate.rs` | Exclude retained source children from current totals; reserve source-batch scratch for non-expiring device recounts too. |
| `crates/snapback4-core/src/engine/runner.rs` | Preserve engine retention provenance through row shapes/spreads; reserve the transport mask’s heap and output bytes before construction. |
| `crates/snapback4-core/src/value.rs` | Transient retention provenance, separate from application fields and absent from durable decoding; derive the parallel transport mask. |
| `crates/snapback4-core/tests/pending_metadata_heap.rs` | Ordinary-field compatibility, nested metadata preservation, durable-decoding boundary and exact mask/projection heap limits. |
| `crates/snapback4-lang/src/bind/program/objects.rs` | Keep all spread bases when retained provenance may contribute; preserve historical lowering/meters for other schemas. |
| `crates/snapback4-lang/src/emit.rs` | Expose optional retained metadata in generated row/shape types without duplicating an ordinary application field. |
| `crates/snapback4-lang/tests/shape_overrides.rs` | Update the generated-type expectation for additive retained metadata. |
| `crates/snapback4-lang/tests/chat.rs` | Keep the exact chat API type assertion with additive retained metadata. |
| `crates/snapback4-lang/tests/frontend_regressions.rs` | Keep nullable row-array precedence assertions with additive retained metadata. |
| `crates/snapback4-core/src/engine/write.rs` | Queue child insert-if-absent prediction before choosing an arm. |
| `crates/snapback4-core/src/engine/write_target.rs` | Queue child upsert prediction before resolving an arm. |
| `crates/snapback4-core/src/engine/mod.rs` | Register the extracted reader and resolver modules. |
| `crates/snapback4-device/src/call.rs` | Send the separately metered `retainedRows` provenance mask only when actual retained rows are emitted. |
| `crates/snapback4-device/src/device/expiry_clock.rs` | Durable monotone authoritative-time floor, private snapshot staging and publication. |
| `crates/snapback4-device/src/device.rs` | Current-coverage hooks; optional sync-page time; atomic clock publication; query/prediction clocks use the later supplied or authoritative time. |
| `crates/snapback4-device/src/device/history.rs` | Expose held-row/range coverage and retain the existing retained-result flag when resolving individual rows. |
| `crates/snapback4-device/src/device/snapshot.rs` | Stage server time with private snapshot images. |
| `crates/snapback4-device/src/device/deferred.rs` | Stage/publish the clock through the existing deferred metadata transaction; invalidate expiring reads when time advances. |
| `crates/snapback4-device/src/device/predictions.rs` | Replay pending writes with the published expiry clock. |
| `crates/snapback4/src/sync_wire.rs` | Add pinned server `now` to snapshot and stream replies. |
| `crates/snapback4/src/serve_sync.rs` | Pin one time for each sync operation and its reply. |
| `crates/snapback4/src/serve_tests.rs` | Update exact wire/counting-writer witnesses for the added time field. |
| `crates/snapback4/tests/serve_sync/mod.rs` | Check per-request time bounds while comparing generation-independent page fields. |
| `crates/snapback4/tests/column_commit.rs` | Include authoritative time in the large maintained-column commit encoder fixture. |
| `crates/snapback4/tests/timeline/delivery_wire.rs` | Include the time floor in the legacy timeline delivery fixture. |
| `crates/snapback4-lang/tests/clique_03/transport.rs` | Carry each real snapshot/stream call’s pinned time in the existing Clique encoder fixture. |
| `crates/snapback4-lang/tests/derived_maintains/disclosure.rs` | Carry the pinned fixture time through the maintained-audience transport. |
| `packages/snapback4/src/local-sync.ts` | Describe the optional authoritative time on the sync transport. |
| `packages/snapback4/src/local-through.ts` | Compose server current pages with retained rows selected by the device’s separate provenance mask after a second local observation; application data cannot forge retention. |
| `packages/snapback4/src/local.ts` | Compose fallback with a second local observation; preserve incarnation, pending-write and offline checks. No clock site changed. |
| `crates/snapback4-lang/src/diag.rs` | Remove the retired temporary code from the read-through diagnostic family. |
| `crates/snapback4-lang/src/guide/codes.rs` | Retire the sync refusal; clarify the existing physical-child delete refusal's rewrite. |
| `crates/snapback4-lang/src/guide/rules.md` | Lead with inherited multi-level rules, issue tracker, Clique, lifetime, exact sync, coverage, retained fallback and prediction. |
| `crates/snapback4-lang/src/guide/language.rs` | Short inherited-sync addition to the existing read-through example. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Remove the retired-code fixture. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Remove the retired-code rewrite fixture. |
| `crates/snapback4-lang/tests/read_through.rs` | Remove the obsolete expectation that child sync refuses. |
| `crates/snapback4-lang/tests/read_through_sync.rs` | Exact inference, service strip, server-only narrowing, explicit/raw audience mismatch, maintained aliases and unchanged grant guards. |
| `crates/snapback4-lang/tests/fixtures/read-through-device.q` | Four-level expiring chain, page/search/count reads and prediction operations. |
| `crates/snapback4-lang/tests/fixtures/read-through-clique.q` | Syncing receipts/reactions and implicit-read unread view. |
| `crates/snapback4-device/tests/read_through.rs` | Nine memory/native scenarios, including shaped and spread retained rows, described below. |
| `packages/snapback4/test/horizon-boundary.test.mjs` | Validate public request-clock bounds and normalize that clock alongside store identity in private-world byte comparisons. |
| `packages/snapback4/test/read-through.test.mjs` | Six real-server wasm/native tests plus a provenance-mask fallback regression. |
| `crates/snapback4-lang/tests/read_through/review_predicates.rs` | Round-7 interrupted-predicate and kept-filtered-row expiry witnesses. |
| `crates/snapback4-lang/tests/read_through_review.rs` | Register both shared review scenarios on SQLite and memory. |
| `experiments/postgres/tests/read_through_review.rs` | Register the same two review scenarios on PostgreSQL. |
| `crates/snapback4-core/tests/read_verdict/expiry_candidates.rs` | Supply the table name to the shared prefix-resolver unit witness. |
| `metrics/wasm-budget.json` | Record the measured artifact increase and raise only its size ratchet to 510,000 bytes. |
| `../llp/3000.014-a-child-reads-through-its-parent.rfc.md` | Record the retained-marker provenance, metering and reserved-field implementation decision in §5. |
| `JOURNAL.md` | Append the dated round-8 implementation and measurement entry. |
| `reports/20260925-intent-lane-t-round8.md` | This report. |

## Tests and what they prove

`read_through_sync.rs`:

- `exact_audiences_and_service_strip`: public and captured-column inference,
  including a parent service disjunct and correctly prefixed horizon index.
- `narrower_rules_remain_server_read_and_mismatched_declarations_refuse`:
  non-invertible conjunctions remain server reads; incompatible declared and
  raw audiences refuse instead of widening or narrowing exact admission.
- `capture_alias_inherits_exact_sync_without_aggregate_read_rule`: unread's
  `chat` key maps to `$message.chat`, with its inherited rule and audience;
  a corrupted public audience fails schema validation.
- `delivered_history_reserves_its_marker_without_changing_ordinary_fields`: refuse a conflicting syncing delivered-history column with `E_READ_THROUGH`, validate the same raw schema, retain ordinary and existing server-only columns/types, and emit the optional metadata type.
- `grant_guard_stays_required_through_every_level`: removing the root grant
  guard refuses sync on all three descendant tables.

`snapback4-device/tests/read_through.rs`:

- `chain_memory`, `chain_sqlite`: all four levels sync; covered child prediction
  and keyed counts work; unheld parents are unknown; captures stay out of query
  rows; child upserts and if-absent inserts do not predict.
- `pending_chain_and_queue`: an unheld parent queues without a row; a predicted
  parent supports a dependent insert; it grants no child coverage; refusing it
  removes the dependent prediction during replay.
- `parent_delete_coverage`: a fully held empty child domain permits prediction;
  a horizon queues it and yields an unknown count; a live child refuses deletion.
- `inherited_expiry_and_monotone_clock`: expiry crosses a middle table without
  `expire at`, clock advancement invalidates reads, old local/server times do not
  revive children, and the floor survives reopening.
- `reused_parent_capture_and_retained_history`: a reused parent applied before
  old child tombstones causes unknown current pages/counts; retained children
  stay readable and marked. Ordinary, matching, shaped and multi-row-spread pages are exercised, including their separate transport masks.
- `clock_publication_and_replay_are_atomic`: staged time leaves visible
  predictions unchanged; publication advances time before replay; invalid time
  rolls back without changing the clock.
- `retained_parent_queues_without_a_row`: a retained-only parent cannot certify
  capture or turn the current child's page into a complete answer.

- `nonexpiring_parent_counts_reserve_source_scratch`: empty and occupied
  groups both become unavailable at the same heap cut, before examining rows,
  when their declared source batch exceeds the default ceiling. It failed before the final reservation fix.

All cases other than the two explicitly named chain tests run on both memory
and native SQLite within each test.

The six JS tests use the actual server and wasm/native devices. Each host proves:

- Clique's held groups, delivered IDs and query answers equal the flattened
  program; sync images contain captures; covered queries stay local; receipts
  and unread totals expire with messages.
- An unheld horizon parent triggers server fallback; replacing the server's
  current child preserves the device's separately marked retained child. Sync
  responses are explicitly held during the cross-partition interval, so this
  witness does not depend on background-poll timing.
- A four-level chain predicts on a held task, refuses local prediction on an
  unheld task, derives its local count, and expires even with a stale supplied
  clock after applying authoritative server time. The clock test runs before
  any sweep, with every row still physically present.

The seventh JS test gives an ordinary row and a retained row the same public
`retained: true` field. Only the separate device mask selects history during
fallback, including nested result objects; absence of a mask preserves no rows.

The new core metadata regression checks ordinary field projection/override,
nested retained shapes, metadata union from multiple spread bases, decoding
that cannot manufacture provenance, and exact heap charging: 512 bytes admit
the nested projection plus mask reservation, while 511 refuses with `E_BOUND`.

Round-7 review additions:

- `predicate_cut_discards_expiry`: private deadlines 300/500 are indistinguishable
  after a two-read predicate cuts; a previously emitted 250 deadline survives.
- `predicate_kept_row_expiry`: a kept row emits deadline 300 and disappears at
  300. A residual `slice` predicate prevents the planner from replacing the
  entire filter with an index prefix.

Mutation checks: publishing the predicate scope before its cut check fails the
first test; skipping candidate deadline inheritance when a filter exists fails
the second. Both mutations were restored. The initial simple equality test did
not kill the second mutation because planning removed its residual filter; the
final fixture closes that gap.

## Verification and measurements

- Focused guide: 80 passed, with no diagnostic or note in compiled card examples.
- Focused shared server review suite: 35 passed; original read-through suite:
  9 passed; new sync compiler suite: 5 passed.
- Core metadata suite: 4 passed; row-shape/join suite: 17 passed; historical
  lowering census: 11 passed with unchanged golden IR for existing forms.
- New native/memory device tests: 9 passed. New wasm/native client tests: 7 passed, including the mask-only regression.
- Existing internal read-verdict suite: 20 passed; HTTP unit suite: 96 passed.
- Generated chat/frontend regression suites: 44 passed after the additive
  metadata expectations were updated.
- PostgreSQL: 7 read-through and 30 shared review tests passed, including ignored
  adapter tests, before the final device-metadata-only correction. The lane’s
  isolated cluster was stopped afterward.
- Package TypeScript typecheck/build passed; every workspace Rust test target compiles.
- Existing horizon-boundary client suite: 82 passed after validating and
  normalizing the new public clock in byte-equivalence fixtures.
- `./ref-check --verbose`: 508 LLP documents, 9,292 references, 25,919 files;
  0 errors and 0 unchecked at the final implementation check.
- Final `scripts/test.sh`: **`== 0 failure(s) in 1130 s`**, exit 0.
  Rust: **3,042 passed, zero failed, 16 existing ignored**. Clients:
  **1,598 total, 1,588 passed, zero failed, ten existing skips**, no cancellations.
  The final run executes both earlier timing-sensitive cases successfully.
  Evidence: `/home/ccheever/sb4-intent/lane-t-r8-test.log`.

Two preliminary full-suite attempts were stopped after test compilation failed.
The first found an outdated internal `prefix_verdict` call (`E0061`, missing
table-name argument); its corrected 20-test module passed. The second found a
missing `StreamReply.now` initializer (`E0063`) in an older wire fixture. All four
remaining fixture files were updated, then `cargo test --workspace --no-run`
compiled every target before the final restart. Both failures were ours; neither
was attributed to the baseline. Neither interrupted compile attempt produced a final
`scripts/test.sh` summary. The host baseline's old cargo failure was read
before diagnosis and was not used to excuse these failures. A third run completed
Rust execution but failed three old full-reply equality checks: `stale_generation_engine_snapshot`,
`stale_generation_engine_stream`, and `stale_generation_reader_snapshot`. Each
compared requests with different pinned `now` values. These were ours. Their
shared fixture now checks monotone, request-bounded times and compares every
remaining page field; all 96 HTTP unit tests passed afterward. The third run was
also stopped before its client suite completed, then the complete suite restarted.
A fourth run completed all Rust targets successfully, then was stopped during
client tests when the final meter audit found the non-expiring recount scratch
gap. The added witness failed before the fix; qualification was restarted after
the fix. The fifth attempt reached client execution and found 11 horizon
wire-equivalence failures caused solely by differing request-clock values:
all four deleted/hidden floor variants, the written unselected round trip,
and all six scope/join membership-collision variants (null/put/del row event).
Each was ours. The exact failing client test names were:

- `wasm wire withholds a deleted floor's historical value`
- `wasm wire withholds a hidden floor's historical value`
- `wasm wire withholds a deleted floor's historical value with moved survivor (recheck)`
- `wasm wire withholds a hidden floor's historical value with moved survivor (recheck)`
- `wasm written unselected round trip hides pre-join key`
- `wasm membership collision scope row-event=null`
- `wasm membership collision scope row-event=put`
- `wasm membership collision scope row-event=del`
- `wasm membership collision join row-event=null`
- `wasm membership collision join row-event=put`
- `wasm membership collision join row-event=del`

The fixture now validates each clock against its request window
and excludes only that public clock plus independent store identity from byte
comparison; all 82 tests in that file pass. That attempt was stopped and the
full suite restarted. The sixth attempt completed successfully with
`== 0 failure(s) in 1146 s` (1,587 client passes, ten existing skips), before
the final provenance audit changes; the seventh run reached two stale generated-type assertions, both ours:
`the_chat_api_types_are_inferred` and
`generated_array_elements_preserve_union_precedence`. Their exact expected
strings now include `retained?: boolean`, preserving every other field and
precedence assertion; all 44 tests in those two files pass. The seventh run
was stopped before client completion, with no final summary. The eighth run completed with
`== 1 failure(s) in 225 s`: Rust passed, while the parallel client test
`unavailable server list responses end retention in both clients` saw a stale
remembered answer instead of `{loading: true}` at `page-ready.test.mjs:182`.
**Classification: provisionally environmental/timing-sensitive, not proven
baseline.** The test passed five consecutive isolated repeats without changing
its code or expectations. The ninth full run executed it successfully, with no assertion change. Before that run, the retained-name reservation was narrowed
to syncing tables so existing server-only spellings keep compiling; the
compatibility test passes and the wasm measurement is unchanged.
The ninth run finished `== 1 failure(s) in 232 s`, again with Rust green:
`a device restores its session on its own` expected `E_AUTH` at
`local-e2e.test.mjs:205`, but that observation had no denial code. This second
parallel-only observation is also provisionally environmental/timing-sensitive,
not proven baseline; its five isolated repeats passed unchanged. The final tenth
run restored serial client-file scheduling and passed both tests, finishing
`== 0 failure(s) in 1130 s`. Neither assertion was changed, skipped or waived.
That audit also caught and corrected two focused fixture issues, both ours:
a Python-style list comprehension refused by Quarry, and heap assertions that
needed to include the separately reserved transport mask (plus the transport
refusal rather than an evaluation-time cap). Development also caught
and corrected test-fixture issues (operation namespace, metadata namespace,
post-sweep unknown-parent expectations) and guide notes. Intentional mutation
failures are the witnesses above, not outstanding failures.

Wasm measures **1,824,505 bytes raw / 509,390 bytes gzip**, Rust 1.97.0 and
wasm-bindgen 0.2.127, without wasm-opt. Compared with the recorded round-7
1,799,206 / 503,057 build, the final whole artifact adds 25,299 raw / 6,333 gzip
bytes. This is not independent component attribution or a freshly rebuilt control.
The first round-8 build measured 1,819,254 / 508,262; the non-expiring recount
reservation measured 1,819,276 / 508,252. The final provenance/mask correction
adds 5,229 raw / 1,138 gzip relative to that preceding build. Its initial build
correctly failed the 509,000-byte artifact ratchet by 390 bytes. Following
`AGENTS.md`’s explicit artifact-budget procedure, the final ratchet is 510,000
bytes, with 610 bytes remaining. The rebuild passes. No runtime meter ceiling
was raised.

## Decisions, deviations and remaining work

- Point reads and the client fallback were split into their own modules to keep
  touched source files below 1,500 lines: `local.ts` is 1,499, `schema.rs` is
  1,443 and `engine/read.rs` is 1,297. The fallback extraction preserves its
  behavior and received a fresh typecheck, package build and six host tests.
- Parent-key counts derive locally from fully held source children; their
  generated parent-resolver rule need not itself be an invertible sync audience.
  Captured-field keyed views retain their exactly inferred sync audience.
- A child horizon remains unknown coverage for these parent counts. Parent
  authorization cannot stand in for source acquisition.
- The optional sync `now` field preserves decoding of older transports. Current
  HTTP snapshots/streams always send it. The chosen time pins the device’s
  read/prediction/replay context so authorization and lifetime checks share one
  instant. Lane Y's client clock sites are untouched.
- Guide examples use `online only` where horizonless sync or maintained-expiry
  notes would violate the guide's no-note contract. Separate executable fixtures
  exercise the corresponding syncing programs on devices.
- The previously accepted stricter physical-child deletion rule remains in
  force. Retained rows never certify a capture or contribute to a current count.
- Final audit found that copying a boolean `retained` field would change ordinary
  projection semantics and could make fallback preserve an application row as
  history. Retention now has transient engine provenance; the device sends a
  separate bounded mask, and fallback trusts that mask. Shapes/spreads preserve
  provenance. Syncing delivered-history read-through tables reserve the output name and
  diagnose conflicting application columns with a concrete rename. Ordinary
  tables, server-only read-through tables, and children without delivered history
  keep their columns. The compatibility boundary has a compiler regression.
  LLP §5 records this implementation decision; it does not change authorization.
- The artifact size ratchet is the only budget change, as documented above.
- The final full run uses `TMPDIR=/dev/shm/sb4-intent-lane-t-tests`,
  `CARGO_BUILD_JOBS=8`, `RUST_TEST_THREADS=4`,
  `SNAPBACK4_RUST_TEST_PROCESSES=8` under `taskset -c 32-47` to contain host
  contention. Earlier attempts used `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`;
  attempts eight and nine used the normal client sharding. The final run
  explicitly sets `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` again. No test is
  omitted or waived by these settings.

No requested increment is intentionally deferred. The lifetime and authorization
design remains unchanged; the metadata representation decision above fills the
brief’s transport detail. No requested implementation problem remains reproduced by the focused checks.
Two unresolved timing observations are the parallel `page-ready` and
`local-e2e` failures above. Their reproduction attempt is the full-suite command below **without**
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` (normal parallel client sharding), or
`node --test --test-name-pattern='unavailable server list responses' packages/snapback4/test/page-ready.test.mjs`;
the isolated command passed five times, as did the session-restore command
with `--test-name-pattern='a device restores its session on its own'` against
`packages/snapback4/test/local-e2e.test.mjs`. Both also passed in the completed serial full suite. Their parallel scheduling
failures remain recorded as unresolved environmental observations; no requested
implementation work is deferred and no failure was waived for qualification.

Full-suite command (run from `snapback4/`):

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
taskset -c 32-47 env TMPDIR=/dev/shm/sb4-intent-lane-t-tests \
  CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 \
  SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```
