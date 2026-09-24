# LLP 3000.013 lane D — work without author bounds

Worktree: `lane-d`, branch `sb4-intent/d-work`, base `6d9f3e001`.
Implements §5 and both binding supervisor addenda. No publication or push.

## Behavior and engineering decisions

- Direct domain `count`, `sum` and prefix `exists` consume the existing Scan
  IR through its existing authorization, expiry, filter and coverage path.
  Each fetched row uses the store's prepaid allocation accounting. Only the
  fetched row/lookup scratch and optional-field materialization charge are
  released when that row is dropped. Cursor images, retained state and filter
  allocations remain charged. Query exhaustion or unknown coverage unwinds
  the scalar result to `null`, incomplete; aborting transactions refuse.
- The binder relaxes only direct aggregate positions and job loop domains.
  All mutation structural checks remain in place, including the expiring-scan
  refusal from LLP 3000.007 §21.9. Explicitly paged aggregates retain their
  materialized behavior. Bare tables select `byId`; ordinary lexical names
  still win over table names.
- Top-level job `for` uses `LoopDomain::Page` with `Bound::Meter`; explicit
  `chunk` continues to use its literal bound. No aggregate or sweep IR variant
  was added. New sweeps start at 64 and keep the last successful size, halving
  only after a meter refusal and a complete savepoint rollback. There is no
  speculative growth. K=1 refusal parks; other refusals park immediately.
- Automatic sweeps use the existing immutable/id index admission. Evaluated
  prefix/seek expressions and the initial upper key survive retries and are
  committed with the cursor and writes. The prelude replays with fresh state
  on every attempt; prelude locals modified by the sweep are refused. The next
  sweep starts again at 64. `break` ends a sweep and `return` ends the job.
- `once` is an optional Emit field with serde default/skip-none, preserving old
  Emit bytes. Its key is canonical JSON of the Value array `[effectName, keys]`.
  SQLite stores it under a unique `(effect, key)` independently of `_outbox`.
  The evaluation PostgreSQL adapter implements the same transactional claim.
  A new key costs one metered write; duplicates do not. A key and its enqueue
  or replay suppression count share the transaction. Device prediction never
  claims keys. No emit means no key. This deduplicates enqueue, not completion
  or the worker's external delivery.
- Job telemetry persists `chunk_size`, total `retries`, and maximum metered
  `heap_peak`, including refused attempts. `run` prints camelCase JSON fields;
  `doctor` prints their text equivalents. Runtime ceilings are unchanged.

## Forms

These use today's indexed spelling; predicate-read parsing belongs to lane A.
Compiled, executable context is in `tests/work_intent.q` and the guide cards.

```text
n = count(messages[m.conversationId, at >= periodStart, at < periodEnd] by byConversationTime where .senderId != p.principal and .ordinal > m.readOrdinal and not .tombstone)
amount = sum(messages[c] by byConversationTime, .ordinal)
present = exists messages[c] by byConversationTime where not .tombstone

job daily(periodStart: time, periodEnd: time):
  for p in profiles:
    unread = 0
    for m in members[p.principal] by byPrincipal:
      unread = unread + count(messages[m.conversationId, at >= periodStart, at < periodEnd] by byConversationTime where .senderId != p.principal and .ordinal > m.readOrdinal and not .tombstone)
    if unread > 0:
      emit push { recipient: p.principal, unread } once [p.principal, periodEnd]
```

## File-by-file changes

Paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/ir.rs` | Optional backward-compatible Emit key; read-site and scan walkers include it. |
| `crates/snapback4-core/src/rows.rs` | Transactional lifetime-key operation on the store interface. |
| `crates/snapback4-core/src/store.rs` | Independent key table, atomic insert-or-ignore and job-progress column migration. |
| `crates/snapback4-core/src/meter.rs` | Transient row-charge release and heap high-water measurement. |
| `crates/snapback4-core/src/engine/runner.rs` | Streaming builtin dispatch, incomplete-scalar unwind and transactional key admission. |
| `crates/snapback4-core/src/engine/read.rs` | Shared scan consumer, per-row transient accounting, complete-total checks and evaluated sweep bounds. |
| `crates/snapback4-core/src/engine/job.rs` | Adaptive atomic retries, durable frozen domain/cursor, fixed-chunk compatibility and telemetry. |
| `crates/snapback4-core/src/engine/admission.rs` | Key expressions participate in read/emit-only analysis; scan admission is unchanged. |
| `crates/snapback4-core/src/engine/prediction.rs` | Key expressions participate in prediction analysis. |
| `crates/snapback4-core/src/engine/prefetch.rs` | Key expressions participate in optional PostgreSQL prefetch analysis. |
| `crates/snapback4-core/src/engine/postgres/store.rs` | Independent PostgreSQL key table and transactional claim. |
| `crates/snapback4-core/tests/corpus.rs` | Existing corpus walker visits optional keys. |
| `crates/snapback4-core/tests/presence/setups.rs` | Old test Emit construction explicitly has no key. |
| `crates/snapback4-device/tests/prefix_reads/mod.rs` | Incomplete plain-domain existence returns null rather than false. |
| `crates/snapback4-device/tests/readauth/census.txt` | Add the new compiled effects-card context; leave inherited census drift untouched. |
| `crates/snapback4-lang/src/ast.rs` | Optional source Emit key. |
| `crates/snapback4-lang/src/parser.rs` | `emit … once [keys]` parsing. |
| `crates/snapback4-lang/src/parser/expr.rs` | Domain `exists` supports filters and seeks, still refuses page clauses. |
| `crates/snapback4-lang/src/parser/programs.rs` | Top-level `for` job sweeps. |
| `crates/snapback4-lang/src/bind/program.rs` | Existing stable sweep admission; preserve scan admission by program kind. |
| `crates/snapback4-lang/src/bind/program/control.rs` | Bind keys, reject loop-carried sweep locals, recognize bare table domains. |
| `crates/snapback4-lang/src/bind/program/expr.rs` | Direct count/sum Scan lowering. |
| `crates/snapback4-lang/src/bind/program/prefix.rs` | Aggregate-only cap relaxation and uncapped job loop domains. |
| `crates/snapback4-lang/src/bind/program/returned_shapes.rs` | Key expressions participate in returned-shape analysis. |
| `crates/snapback4-lang/src/bind/mod.rs` | Key expressions participate in the AST walker. |
| `crates/snapback4-lang/src/bind/aggregate_provenance.rs` | Key expressions retain aggregate provenance checks. |
| `crates/snapback4-lang/src/bind/residency.rs` | Key expressions retain residency checks. |
| `crates/snapback4-lang/src/bind/residency/horizons.rs` | Key expressions retain horizon checks. |
| `crates/snapback4-lang/src/bind/residency/presence.rs` | Key expressions retain presence checks. |
| `crates/snapback4-lang/src/recipe.rs` | Recipe expression expansion traverses keys. |
| `crates/snapback4-lang/src/guide/language.rs` | Compiled examples of all new forms. |
| `crates/snapback4-lang/src/guide/jobs.rs` | Membership-scoped streaming digest and adaptive-sweep contract. |
| `crates/snapback4-lang/src/guide/effects.rs` | Compiled once example; lifetime/replay/enqueue semantics. |
| `crates/snapback4-lang/src/guide/bounds.rs` | Aggregate/job admission, transient heap and incomplete scalar behavior. |
| `crates/snapback4-lang/tests/guide.rs` | Include the fourth compiled language-card block. |
| `crates/snapback4-lang/tests/prefix_reads.rs` | Deliberately update old refusals for job inner domains and filtered exists. |
| `crates/snapback4-sim/tests/digest_count.q` | Add a streaming job alongside unchanged historical paged controls. |
| `crates/snapback4-sim/tests/digest_count.rs` | Run that job on the original retained recipient-heavy fixture. |
| `crates/snapback4-sim/tests/prefix_reads/mod.rs` | Direct cut existence has no scalar verdict; retain outer-page retry tests. |
| `crates/snapback4-sim/tests/work_intent.q` | Digest acceptance forms with no marker table. |
| `crates/snapback4-sim/tests/work_intent.rs` | Twelve engine/device/durability/admission tests described below. |
| `crates/snapback4/src/verbs.rs` | Run/doctor chunk size, retries and peak heap. |
| `crates/snapback4/tests/run_admission.rs` | Real CLI assertions for the telemetry. |
| `metrics/wasm-budget.json` | Measured device byte-budget ratchet; runtime ceilings unchanged. |
| `JOURNAL.md` | One dated append-only lane entry. |
| `reports/20260924-intent-work.md` | This implementation and verification record. |

## Tests and evidence

`work_intent` adds:

1. Recipient-heavy 5,000-candidate/4,900-hit count, one job chunk under 16 MiB;
   sum correctness and same-period rerun suppression.
2. Variable item cost halves a chunk, then reopening resumes exactly once.
3. One impossible item parks at K=1 while preserving 64 earlier commits and
   admitting none of the failed item's effects or keys.
4. Frozen upper key excludes a later insertion; `break` and `return` match
   explicit chunks; fixed chunks refuse without halving or partial enqueue.
5. Scheduled digest combines a 10,000-message busy chat, 5,000 period candidates,
   50 active users, and the probe user's 100 memberships. It retries, reopens
   after a committed chunk, and emits exactly 50 correct digests. An inactive
   user emits nothing. Same-period schedule admission and manual rerun add none.
6. Replay suppression consumes keys across reopen, separate effect names have
   separate domains, duplicate emits are no-ops and other writes continue.
7. Evaluated seek bounds survive reopen while `now` in the prelude reevaluates.
8. Mutable sweep indexes and carried locals refuse; a constraint parks without
   retrying smaller.
9. Read-rule/filter/expiry behavior, exact query totals, meter-cut null results,
   mutation atomicity and unchanged nonuniform/expiring mutation refusal.
10. Device count/sum require coverage; a held witness proves exists; covered
    expiry updates totals; prediction does not attempt to claim durable keys.
11. Canonical object key order, ordered/typed array values, atomic key rollback
    on injected outbox failure and unchanged old Emit serialization.
12. An inner 9,000-row job domain is not silently truncated at the query's
    8,192-row allowance.

The historical `digest_count` test still exercises all ten original controls
and its two decode-only batch experiments. The additional job uses the same
stored recipient-heavy rows, including omitted nullable media fields.

Final metered measurements, from `cargo test -p snapback4-sim --test
digest_count -- --nocapture` and `cargo test -p snapback4-sim --test
work_intent -- --nocapture`:

| Case | Result |
|---|---|
| Original retained fixture: 5,000 candidates, 4,900 hits, 50 recipients per row | One job chunk; **4,102,784 B peak heap**, unchanged **16,777,216 B** ceiling. |
| Digest version with ordinal predicate and permanent effect key | One job chunk; **4,104,585 B peak heap**, one enqueue. |
| Scheduled scale: busy chat with 10,000 rows, 5,000 period candidates; probe has 100 memberships | Exactly **50 effects**, **26 chunks**, final **K=2**, **5 retries**, **13,188,641 B peak heap** including refused attempts. Probe count 5,395 across 100 chats; other 49 users each count 5,000 across one chat. |
| Variable-cost first chunk | Retries 64 to **32**; **137,081 B peak heap**; restart yields exactly one visit and effect per item. |
| Historical retained decode-only experiment | The original cumulative decoded-row accounting still reaches **22,940,000 B**; explicitly paged controls still refuse as before. |

The original fixture's streaming run allocates **48,089,110 B cumulatively**
according to its existing Rust allocation counter. That is allocation churn,
not simultaneous retention or RSS. This lane claims the measured metered-heap
envelope, not elimination of decoding, an RSS limit, or an optimization of
SQLite seek time. A transient decoded row is prepaid and then released; the
engine's other retained/cumulative charges still bound the transaction.

The final web artifact is **1,712,075 B raw / 475,001 B gzip**. The same-host
baseline is 1,707,362 / 472,890: +4,713 raw / +2,111 gzip. The existing
474,000-byte ratchet could not contain the lane. Following `AGENTS.md`'s
explicit byte-budget policy, it is now **476,000**, with 999 bytes of
headroom. This is a whole-lane measurement, not per-component attribution.
No runtime ceiling was raised.

Additional checks: 55 guide tests; 10 language prefix-read tests; 18 core
corpus tests; 40 frontend regression tests; 64 aggregate-copy tests with 4
existing ignores; 9 language presence tests; 4 time-index tests; 14 device
prefix tests; 12 server prefix tests; device presence and real CLI telemetry
tests all pass. PostgreSQL feature compilation passes. `ref-check --verbose`
reports **504 LLP docs, 9,211 refs in 25,443 files, 0 errors, 0 unchecked**.

## Complete suite and open baseline problems

The final `scripts/test.sh` invocation, from `snapback4/`, exits 1 and prints
exactly:

```text
== 1 failure(s) in 194 s
   cargo test
```

Every remaining failure is listed in `~/sb4-intent/BASELINE-FAILURES.md` and
the unmodified `~/sb4-intent/baseline-test.log`:

| Classification | Failing test | Reproduction from `snapback4/` |
|---|---|---|
| Baseline | `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` | `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` |
| Baseline | `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| Baseline | `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| Baseline | `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

The new effects-card block adds 27 census rows (its mutation and the language
fixture used to compile the fragment). Those rows are recorded separately;
the remaining missing/extra sets exactly match the baseline census difference.
No inherited product failure was repaired. No environmental failure remains.
Full final log: `/tmp/lane-d-final-test.log`.

The first full invocation printed `== 2 failure(s) in 1027 s`: `wasm build`
and `cargo test`. Both were **ours, resolved**: the measured byte-budget
overrun and a boolean-return typo in the corpus test walker. Its client tests
passed (1,028 executed, 10 skipped), running serially under the host's high-load
policy. The second full invocation above includes all compatibility fixes.
An intervening complete Rust run exposed, and affected checks verified fixes
for, range prelude classification, guide block ordering, paged existence retry,
and stable-index diagnostic compatibility. Two old tests intentionally change
their expected direct existence result from false to null under a cut or
unknown coverage, per the supervisor addendum. No lane regression remains in
the final full run.

## Scope and limitations

No design refusal was necessary. The only resource-budget deviation is the
documented WASM byte ratchet; author-visible runtime bounds and engine ceilings
are unchanged. Streaming targets the table/prefix domains in this brief;
full-text matching retains its existing admission and merge consumer.
Predicate-read parsing, other lanes' forms,
full target-clique integration, PostgreSQL service execution, worker/provider
delivery, packages and publishing are outside this lane. PostgreSQL support is
compile-checked; durable execution evidence uses SQLite and memory devices.
The scale test extracts the requested digest scenario rather than restating
other lanes' target-clique forms. Existing fixed chunks and explicitly paged
counts retain their semantics. Guide edits are limited to the new forms;
older bounded digest recipes remain for the separate guide lane to revise.
All diagnostic codes already exist in `guide::CODES`; no new code was needed.
The local `llp-orient` skill link points into an absent vendor checkout;
orientation used the mandated LLPs and source/card reads directly.
