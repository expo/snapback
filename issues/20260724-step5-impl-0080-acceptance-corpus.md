# 0080: acceptance corpus (0080 half of the coupled suite)

**Status:** Open — callable-query half landed 2026-07-25; projection/rebuild
half lands with Phase B
**Severity:** P2
**Systems:** Testing, Query planning, Authorization
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0080 §Acceptance, LLP 0063 WS6
**Marker:** step5-impl

Build the §Acceptance suite: cross-evaluator byte-identical corpus per the
pinned target manifest; comparator adversarial cases; instrumented sparse
examined-entry fixture; duplicate-order-key + uniqueness fixture; paired-
database noninterference (results, cursors, codes, transport, inspection);
public-read and owner-derivation negatives incl. the left-join refusal;
pagination fixtures incl. all-omitted windows and the six cursor refusals;
obligation-fault live tests; fan-out fixtures at 0/1/1023/1024 with
disclosure behavior; two-writer and activation races; key-move union
counting; filtered-out-root scan bound; chain/diamond refusal; opaque-read
refusal; projection >1024-root materializeAll equality; rebuild crash
fixtures; Exact/Contract typing; the Step 5 fixture rerunning cumulative
gates. Gates 0080 Implemented via the coupled suite. L-sized.

## Callable-query half (landed 2026-07-25) — item → witness

The corpus is data: `tests/conformance/relational/corpus.v1.json` (schema,
seed rows, closed plans, pinned `RelationalResultEncodingV1` bytes; regen
via `SNAPBACK_UPDATE_RELATIONAL_CORPUS=1 cargo test --test
relational_corpus_v0`), executed by `tests/relational_corpus_v0.rs`.

- **Byte-identical execution across claimed evaluators** —
  `corpus_executes_byte_identically_across_local_lanes`: every case runs
  through the storage executor, the serialized write lane, and the
  lock-free read lane with byte-equal `RelationalResultEncodingV1`
  output pinned in the committed corpus. Claimed arms today are the
  local lanes; hosted targets report the `relational_query_v1` gap and
  join the corpus before they are claimed.
- **Joins/keys/refusals** — corpus cases: inner/left, compound keys,
  boolean+integer exactness, null and compound-null keys (never match;
  left nulls the leaves), below-constraint duplicate injection
  (`SNAPBACK_RELATIONAL_DUPLICATE_UNIQUE_KEY`), plan-shape refusals.
  Cross-type/cross-domain key refusal is generation-time
  (`relational-authoring.test.mjs`); the runtime corpus cannot express
  it.
- **Comparator corpus** — NFC/NFD spellings and case-variant slugs stay
  distinct end to end (escape-pinned in the fixture bytes). Unpaired
  surrogates are structurally impossible in Rust strings and refused by
  serde at the JSON layer before any plan runs.
- **Duplicate-order-key + uniqueness** —
  `large_sparse_and_duplicate_key_fixtures_stay_correct_and_stable`
  (3,000-row fixture: `_id` tie-break totalizes a shared order key,
  byte-stable across evaluations) plus the corpus tie-break case;
  `declared_unique_index_refuses_duplicates_at_seed` proves the declared
  unique index refuses duplicates at the storage boundary.
- **Paired-database noninterference** —
  `paired_databases_keep_missing_and_invisible_indistinguishable`:
  results, continuation posture, and cursor refusals byte-identical
  across the missing/invisible pair, page by page.
- **Cross-user negatives** — corpus cases: root visibility before the
  window (another owner's earlier-sorting roots occupy no slot), joined
  predicate before projection, cross-user empty results,
  anonymous-equals-authenticated public-read bytes.
- **Pagination** — corpus take:0 case plus the unit witnesses
  (`relational_keyset_pages_without_skip_or_duplicate`,
  `relational_cursor_pages_and_refuses_end_to_end`,
  `relational_keyset_bound_survives_concurrent_mutations`,
  `cursor_negatives_hold_under_sessions_authorities`).
- **Live** — both-tables replacement, absent-unique-lookup direction,
  and the no-`live_delta` claim are witnessed by
  `relational_live_replaces_on_both_tables_and_never_claims_delta`.

**Residuals (callable half):**

- the instrumented examined-entries assertion for the index-served root
  bound: the large sparse fixture asserts window correctness, not scan
  counts — needs a `#[cfg(test)]` examined-rows counter on the
  root-window query path;
- authority-rotation fencing and the obligation-fault e2e for relational
  subscriptions (LLP 0053 machinery exists and is tested generically;
  the relational-specific fixture lands with the coupled suite);
- transport-surface byte-equality (HTTP envelope) for the paired fixture
  — current witness compares at the invocation boundary;
- owner-derivation/left-join generation negatives are codegen-side
  (`relational-authoring.test.mjs`) — corpus references them.

Everything under fan-out, projections, materializeAll, rebuild, and the
Step 5 fixture remains the Phase B half.
