# Device bundle diet — 2026-09-25

Baseline: `sb4/diet-20260925` at `0badac98728367b29993211987ddfe8af80628c6`. Production build: **2,009,397 B raw / 577,221 B gzip**, ratchet 578,207. Rust 1.97.0, wasm-bindgen 0.2.127, Node 24.18.0, twiggy 0.8.0 (`cargo install twiggy` confirmed installed). wasm-opt 132 is present; the unchanged script tries -Os and rejects its larger gzip. Every measurement uses scripts/build-wasm.sh the same way.

## Attribution and initial priority

00-top.json, 00-dominators.txt and 00-monos.txt are the post-bindgen symbol-bearing census, built using the existing attribute-wasm.mjs path (CARGO_PROFILE_WASM_STRIP=none, target/wasm-sym). The code section is 1,909,323 B versus production's 1,908,035 B: named shallow sizes are a proxy, not exact production offsets. Gzip shares a dictionary across functions and cannot be attributed additively; successive production builds measure component deltas.

| Priority | Candidate | Baseline raw evidence |
|---:|---|---:|
| 1 | Generic monomorphization | Sorts 128,581 B / 506 items; six duplicated stream helpers 22,104 B; prepaid_scan 8,692 B / 20 instantiations |
| 2 | Row-view server branches | 25,849 related B including preparation below; row_view_member 6,400, row_view_source closure 5,378 |
| 3 | Witness / aggregate / point duplication | 16,611 related B; probe_witness_uncached 5,843, live_aggregate_inner 2,167; lifetime work inlined |
| 4 | Work-schema preparation | prepare_row_views 2,202 B; 3,141 including contribution preparation/helpers |
| 5 | Predicate walker | 1,012 B: ordinary 455, row-key evaluator 431, operand 126 |
| 6 | Test / fixture / guide / diagnostic text | No lang/test/fixture/guide symbols; rodata 90,206 B total |

Categories overlap; these are inspection priorities, not removable-byte promises. Larger contributors outside the candidates: row_changed 27,934; statements closure 26,043; insert_attempt 19,381; call closure 13,988; merge_with_words 12,887. They implement required device behavior. Family/absence checks pass: core prefetch, admission, log-event modules, recount chunks, adoption rebuilds, Postgres and Unicode normalization tables are absent.

## Governing context (llp-orient)

Scope: device transaction helpers, row views, predicate evaluation, witness/aggregate/point reads and wasm evidence. The Snapback 4 fence applies; foundation/current contain no governing Snapback 4 entries. Governing references: LLP 3000 §4/§7; LLP 3000.002#proposed-device-representation-and-codec-redesign; LLP 3000.015 §§1–3; LLP 3000.013 §13; LLP 3000.016 §§2.1a/2.2; LLP 3000.014 §5. Read the maintains guide card for the current paved form.

Preserve fixed reservations and sealed disclosed-result pricing, the physical authorization walk allowance, complete-rule lifetimes, coverage, private recount traffic, inherited expiry, stored/wire/schema forms, event slots and whole-query withholding. No runtime ceiling changes. Generic sharing must preserve call order, errors and meter restoration. Device preparation must preserve stored backend identity. Larger representation/format changes from the previous diet are outside scope. Append measurements to JOURNAL; no new LLP needed (hand-off: none).

# Baseline top 40 retained items

Post-bindgen symbol-bearing wasm; shallow raw bytes, excluding custom metadata. Gzip is not additive per function. Production: 2,009,397 raw / 577,221 gzip.

| Rank | Raw bytes | Symbol |
|---:|---:|---|
| 1 | 90,206 | `data segment ".rodata"` |
| 2 | 27,934 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::row_changed` |
| 3 | 26,043 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::statements::{closure#0}` |
| 4 | 19,381 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::insert_attempt` |
| 5 | 13,988 | `snapback4_device[8f7c857490dbb8ed]::call::call::<snapback4_device[8f7c857490dbb8ed]::memory::MemoryStore>::{closure#0}` |
| 6 | 12,887 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::merge_with_words` |
| 7 | 11,534 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::scan_consumed` |
| 8 | 11,286 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::expr` |
| 9 | 10,346 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::builtin` |
| 10 | 10,120 | `<snapback4_device[8f7c857490dbb8ed]::device::Device<snapback4_device[8f7c857490dbb8ed]::memory::MemoryStore>>::apply_publication_inner` |
| 11 | 9,077 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::merge_lazy` |
| 12 | 8,785 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::get_prepared` |
| 13 | 8,019 | `<&mut serde_json[dd3362440e211cd9]::de::Deserializer<serde_json[dd3362440e211cd9]::read::StrRead> as serde_core[5f3b46e8c74a7549]::de::Deserializer>::deserialize_struct::<<snapback4_device[8f7c857490dbb8ed]::device::StreamPage as serde_core[5f3b46e8c74a7549]::de::Deserialize>::deserialize::__Visitor>` |
| 14 | 6,812 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::discover_words` |
| 15 | 6,546 | `<&mut serde_json[dd3362440e211cd9]::de::Deserializer<serde_json[dd3362440e211cd9]::read::StrRead> as serde_core[5f3b46e8c74a7549]::de::Deserializer>::deserialize_struct::<<snapback4_core[5b242d0750e21f6a]::schema::Maintain as serde_core[5f3b46e8c74a7549]::de::Deserialize>::deserialize::__Visitor>` |
| 16 | 6,400 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::row_view_member` |
| 17 | 6,211 | `<alloc[46d95d5090e9754d]::vec::Vec<snapback4_core[5b242d0750e21f6a]::ir::Stmt> as core[7d5f0a2ba6a62c33]::clone::Clone>::clone` |
| 18 | 6,141 | `<&mut serde_json[dd3362440e211cd9]::de::Deserializer<serde_json[dd3362440e211cd9]::read::StrRead> as serde_core[5f3b46e8c74a7549]::de::Deserializer>::deserialize_struct::<<snapback4_core[5b242d0750e21f6a]::schema::Table as serde_core[5f3b46e8c74a7549]::de::Deserialize>::deserialize::__Visitor>` |
| 19 | 6,075 | `<&mut serde_json[dd3362440e211cd9]::de::Deserializer<serde_json[dd3362440e211cd9]::read::StrRead> as serde_core[5f3b46e8c74a7549]::de::Deserializer>::deserialize_struct::<<snapback4_core[5b242d0750e21f6a]::ir::Scan as serde_core[5f3b46e8c74a7549]::de::Deserialize>::deserialize::__Visitor>` |
| 20 | 5,963 | `<&mut serde_json[dd3362440e211cd9]::de::Deserializer<serde_json[dd3362440e211cd9]::read::StrRead> as serde_core[5f3b46e8c74a7549]::de::Deserializer>::deserialize_struct::<<snapback4_core[5b242d0750e21f6a]::schema::timeline::Timeline as serde_core[5f3b46e8c74a7549]::de::Deserialize>::deserialize::__Visitor>` |
| 21 | 5,881 | `core[7d5f0a2ba6a62c33]::num::imp::flt2dec::strategy::dragon::format_shortest` |
| 22 | 5,843 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::probe_witness_uncached` |
| 23 | 5,518 | `snapback4_device[8f7c857490dbb8ed]::device::store_identity::observe::<snapback4_device[8f7c857490dbb8ed]::memory::MemoryTx>` |
| 24 | 5,378 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::row_view_source::{closure#2}` |
| 25 | 4,915 | `core[7d5f0a2ba6a62c33]::num::imp::flt2dec::strategy::dragon::format_exact` |
| 26 | 4,798 | `<&mut serde_json[dd3362440e211cd9]::de::Deserializer<serde_json[dd3362440e211cd9]::read::StrRead> as serde_core[5f3b46e8c74a7549]::de::Deserializer>::deserialize_struct::<<snapback4_device[8f7c857490dbb8ed]::device::Queued as serde_core[5f3b46e8c74a7549]::de::Deserialize>::deserialize::__Visitor>` |
| 27 | 4,693 | `<dlmalloc[34d9e156da7ff0eb]::dlmalloc::Dlmalloc<dlmalloc[34d9e156da7ff0eb]::sys::System>>::malloc` |
| 28 | 4,648 | `snapback4_device[8f7c857490dbb8ed]::device::snapshot::retain::<snapback4_device[8f7c857490dbb8ed]::memory::MemoryTx>` |
| 29 | 4,645 | `snapback4_device[8f7c857490dbb8ed]::device::deferred::stage::<snapback4_device[8f7c857490dbb8ed]::memory::MemoryTx>` |
| 30 | 4,534 | `sha2[9a1323bf65730311]::sha256::compress256` |
| 31 | 4,450 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::maintain::{closure#1}` |
| 32 | 4,426 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::word_bounds` |
| 33 | 4,419 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::check_constraints` |
| 34 | 4,257 | `<snapback4_device[8f7c857490dbb8ed]::memory::MemoryStore as snapback4_device[8f7c857490dbb8ed]::store::DeviceStore>::install` |
| 35 | 4,218 | `<&mut serde_json[dd3362440e211cd9]::de::Deserializer<serde_json[dd3362440e211cd9]::read::StrRead> as serde_core[5f3b46e8c74a7549]::de::Deserializer>::deserialize_struct::<<snapback4_core[5b242d0750e21f6a]::schema::capabilities::Wire>::deserialize::__Visitor>` |
| 36 | 4,189 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::parent_verdict` |
| 37 | 4,174 | `<snapback4_core[5b242d0750e21f6a]::engine::runner::Runner>::domain` |
| 38 | 4,122 | `<snapback4_device[8f7c857490dbb8ed]::device::Device<snapback4_device[8f7c857490dbb8ed]::memory::MemoryStore>>::open_store_mode` |
| 39 | 4,108 | `snapback4_core[5b242d0750e21f6a]::engine::local::observe_query` |
| 40 | 4,073 | `<&mut serde_json[dd3362440e211cd9]::de::Deserializer<serde_json[dd3362440e211cd9]::read::StrRead> as serde_core[5f3b46e8c74a7549]::de::Deserializer>::deserialize_struct::<<snapback4_core[5b242d0750e21f6a]::ir::MergeLane as serde_core[5f3b46e8c74a7549]::de::Deserialize>::deserialize::__Visitor>` |

## Candidate 6: cold generic stream application

| Probe | Raw | Gzip | Gzip saved from baseline |
|---|---:|---:|---:|
| Full DeviceTx borrowed object | 1,992,319 | 577,222 | -1 |
| Narrow rows/metadata StreamTx (retained) | 1,991,416 | 576,762 | 459 |
| Plus shared prepaid-scan entry/exit (discarded) | 1,988,815 | 576,956 | 265 |

The narrow interface shares the real/recording applicator, history, boundaries and media metadata helpers. It allocates nothing and preserves call order and storage operations. Full DeviceTx retained unused vtable methods. The additional authorization refactor saved raw bytes but inflated gzip by 194, so it was reverted. The large sort census is mostly distinct element types and closure comparators. Erasing it wholesale would require changing containers/collection algorithms in runtime paths; the prior LLP 3000.002 S2 investigation documents the complexity/performance risk and remains shelved. Three bounded generic probes are complete; no such algorithm change is retained.

## Candidate 2: compile-time server row-view boundary

576,762 → **574,735 B gzip** (1,991,416 → **1,985,947 B raw**): **2,027 B gzip saved**. Server work deletion/updating, basis timestamps and cursor-prefix subtraction now require the SQLite feature. The bounded writer scan, public reservations and covered device recount remain. Native devices still compile the server feature but keep their runtime device checks; server execution is unchanged. The separate work-schema preparation candidate remains present at this stage.

## Candidate 4: witness / aggregate / point consolidation

574,735 → **574,660 B gzip** (1,985,947 → **1,985,645 B raw**): **75 B gzip saved**. One authorized-point completion tail and event-slot check; one contribution-selection predicate shared by lifetime and aggregate paths. An initial extra source lookup measured 574,699 and was removed. The two-seek server branch was already cfg-gated. The remaining decode loops differ materially: lifetime probes aggregate the latest alternative deadline and use physical authority work; scalar recounts charge ordinary examined/step work, authorize provisional candidates and accumulate totals. Their common selection is shared without merging those policies.

## Additional contributor: immutable descriptor cloning

The baseline's largest functions (`row_changed`, `insert_attempt`, parent authorization) exposed cloned table/maintain/timeline definitions. Runner holds an immutable schema reference for the whole call, so borrow the descriptors instead. Preserve explicit charges and every runtime value copy.

| Component | Raw | Gzip | Gzip saved from prior stage |
|---|---:|---:|---:|
| Write and maintain descriptor borrows | 1,983,713 | 573,820 | 840 |
| Plus read-through, write targets, Following transitions/slots | 1,982,094 | 573,320 | 500 |

Combined **1,340 B gzip saved**. No new representation, format or algorithm. Matching declarations stay in schema order; cloned filter iterators repeat only immutable schema comparisons. This removes allocations but no quantitative latency claim is made.

## Candidate 1: replica index preparation

573,320 → **571,850 B gzip** (1,982,094 → **1,976,372 B raw**): **1,470 B gzip saved**. `prepare_row_view_indexes` is shared; `prepare_row_view_work` requires SQLite. All lookup/lifetime/predicate indexes remain. Existing work-schema entries survive reopening unchanged; the new regression compares exact serialized schemas after index rebuilding and legacy preparation. Public backend wire serialization and the serde schema representation are unchanged. New web installations no longer synthesize private server tables. Their names still occur in the artifact because `is_recount_work` must refuse attempts to read engine-owned state.

## Candidate 3: one predicate walker

571,850 → **571,669 B gzip** (1,976,372 → **1,975,906 B raw**): **181 B gzip saved**. Shared evaluation takes an optional member for comparison operands. Bare boolean fields still refer to the source; null fallback, operator interpretation, short-circuit order and step pricing remain unchanged. Serialization is untouched.

## Candidate 5: text and dependency audit

571,669 → **571,525 B gzip** (1,975,906 → **1,975,265 B raw**): **144 B gzip saved**. `07-dependencies.txt` is the normal web graph: no lang crate. `07-includes.txt` and `07-test-gates.txt` record fixture includes and their test gates. No test/fixture/guide/explanation symbols survive. Shared RuntimeError still contained action/route classification and the structural-admission rewrite despite their producers being excluded; match-arm cfgs now follow those producers. Already-serialized server refusals use Refusal, not RuntimeError, and are unchanged. All emitted web error rewrites remain.
