# Device bundle diet — 2026-09-25

Final Rust device source commit: `855c778083`; qualification harness commits: `3fda44245b`, `804c2be2f7`, on `sb4/diet-20260925`; no push. **566,391 B gzip**, down **10,830 B (1.88%)** from 577,221. Raw wasm is **1,960,083 B**, down 49,314. The ratchet is **567,391 B**, exactly measured + 1,000. **The below-520,000 target remains unmet: another 46,392 B must be removed to reach 519,999.** The ticket stays open. All six candidates were investigated; retained changes preserve runtime ceilings, feature contracts and formats.

Blocking qualification: **passed — `== 0 failure(s) in 2304 s`** at source `804c2be2f7`; `./ref-check --verbose` also passed. Focused checks passed after each retained stage. This report and its evidence live in `snapback4/reports/20260925-diet/`; the requested handoff copy is `/Users/ccheever/projects/snapback-sb5-program/diet.final.md`.

## Measured reductions by commit

Every row uses the unchanged production build script and toolchain. These successive gzip deltas include optimizer interactions; they are the measured contribution of each change in this order.

| Commit | Component | Before gzip B | After gzip B | Saved B |
|---|---|---:|---:|---:|
| `b90140b8f1` | Cold stream application through a borrowed transaction interface | 577,221 | 576,762 | 459 |
| `cd768cd0e7` | Server row-view bookkeeping | 576,762 | 574,735 | 2,027 |
| `63cdd9fb78` | Point completion and live selection | 574,735 | 574,660 | 75 |
| `7a79ac7c98` | Borrow immutable execution descriptors | 574,660 | 573,320 | 1,340 |
| `ec7fc906c0` | Device indexes separated from server work schema | 573,320 | 571,850 | 1,470 |
| `4ea9436dbd` | Shared predicate evaluator | 571,850 | 571,669 | 181 |
| `c8808e02f2` | Server-only diagnostic branches | 571,669 | 571,525 | 144 |
| `855c778083` | Server upload/column ledgers and Following background work | 571,525 | 566,391 | 5,134 |
| `3fda44245b` | Isolate host timing targets in the test harness | 566,391 | 566,391 | 0 |
| `804c2be2f7` | Separate native fixture launch and execution deadlines | 566,391 | 566,391 | 0 |
| **Total** | | **577,221** | **566,391** | **10,830** |

The last size-reduction commit has two measured subcomponents: ledgers save 3,482 B, then Following work saves 1,652 B. Descriptor borrows likewise have measured write/maintain (840 B) and read/Following (500 B) stages. Per-component totals are repeated in the append-only journal and the ratchet explanation; substage measurements are preserved below and in the build logs.

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

## Baseline top 40 retained contributors

Post-bindgen symbol-bearing wasm; shallow raw bytes (custom metadata excluded). Production: **2,009,397 B raw / 577,221 B gzip**. Gzip is not additive per function. Rust crate hashes omitted for readability.

| Rank | Shallow raw B | Symbol |
|---:|---:|---|
| 1 | 90,206 | `data segment ".rodata"` |
| 2 | 27,934 | `<snapback4_core::engine::runner::Runner>::row_changed` |
| 3 | 26,043 | `<snapback4_core::engine::runner::Runner>::statements::{closure#0}` |
| 4 | 19,381 | `<snapback4_core::engine::runner::Runner>::insert_attempt` |
| 5 | 13,988 | `snapback4_device::call::call::<snapback4_device::memory::MemoryStore>::{closure#0}` |
| 6 | 12,887 | `<snapback4_core::engine::runner::Runner>::merge_with_words` |
| 7 | 11,534 | `<snapback4_core::engine::runner::Runner>::scan_consumed` |
| 8 | 11,286 | `<snapback4_core::engine::runner::Runner>::expr` |
| 9 | 10,346 | `<snapback4_core::engine::runner::Runner>::builtin` |
| 10 | 10,120 | `<snapback4_device::device::Device<snapback4_device::memory::MemoryStore>>::apply_publication_inner` |
| 11 | 9,077 | `<snapback4_core::engine::runner::Runner>::merge_lazy` |
| 12 | 8,785 | `<snapback4_core::engine::runner::Runner>::get_prepared` |
| 13 | 8,019 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_device::device::StreamPage as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 14 | 6,812 | `<snapback4_core::engine::runner::Runner>::discover_words` |
| 15 | 6,546 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::schema::Maintain as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 16 | 6,400 | `<snapback4_core::engine::runner::Runner>::row_view_member` |
| 17 | 6,211 | `<alloc::vec::Vec<snapback4_core::ir::Stmt> as core::clone::Clone>::clone` |
| 18 | 6,141 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::schema::Table as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 19 | 6,075 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::ir::Scan as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 20 | 5,963 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::schema::timeline::Timeline as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 21 | 5,881 | `core::num::imp::flt2dec::strategy::dragon::format_shortest` |
| 22 | 5,843 | `<snapback4_core::engine::runner::Runner>::probe_witness_uncached` |
| 23 | 5,518 | `snapback4_device::device::store_identity::observe::<snapback4_device::memory::MemoryTx>` |
| 24 | 5,378 | `<snapback4_core::engine::runner::Runner>::row_view_source::{closure#2}` |
| 25 | 4,915 | `core::num::imp::flt2dec::strategy::dragon::format_exact` |
| 26 | 4,798 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_device::device::Queued as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 27 | 4,693 | `<dlmalloc::dlmalloc::Dlmalloc<dlmalloc::sys::System>>::malloc` |
| 28 | 4,648 | `snapback4_device::device::snapshot::retain::<snapback4_device::memory::MemoryTx>` |
| 29 | 4,645 | `snapback4_device::device::deferred::stage::<snapback4_device::memory::MemoryTx>` |
| 30 | 4,534 | `sha2::sha256::compress256` |
| 31 | 4,450 | `<snapback4_core::engine::runner::Runner>::maintain::{closure#1}` |
| 32 | 4,426 | `<snapback4_core::engine::runner::Runner>::word_bounds` |
| 33 | 4,419 | `<snapback4_core::engine::runner::Runner>::check_constraints` |
| 34 | 4,257 | `<snapback4_device::memory::MemoryStore as snapback4_device::store::DeviceStore>::install` |
| 35 | 4,218 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::schema::capabilities::Wire>::deserialize::__Visitor>` |
| 36 | 4,189 | `<snapback4_core::engine::runner::Runner>::parent_verdict` |
| 37 | 4,174 | `<snapback4_core::engine::runner::Runner>::domain` |
| 38 | 4,122 | `<snapback4_device::device::Device<snapback4_device::memory::MemoryStore>>::open_store_mode` |
| 39 | 4,108 | `snapback4_core::engine::local::observe_query` |
| 40 | 4,073 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::ir::MergeLane as serde_core::de::Deserialize>::deserialize::__Visitor>` |

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

## Additional server-only paths reached through runtime checks

The baseline also names `with_asset_facts` (2,443 B), `reserve_columns` (839 B plus helpers), and `timeline_enqueue` (1,387 B); asset placement and birth work are partly inlined. The web MemoryTx uses Rows' `holds_assets = false`, and Runner's device path exits column birth/reservations and enqueue before doing work. Compile those same no-op choices into the web build. Preserve evaluated arguments, received asset facts, synchronized columns, own Following copies and every native path. The native feature still compiles the complete bodies.

| Component | Raw | Gzip | Gzip saved |
|---|---:|---:|---:|
| Authoritative upload ledger and private-column setup | 1,963,959 | 568,043 | 3,482 |
| Following background enqueue and server duplicate lookup | 1,960,083 | 566,391 | 1,652 |

Combined **5,134 B gzip saved**. Maintained-column guide/LLP 3000.007.001 §3.2 and the assets card explicitly place these ledgers on the server. LLP 3000.016 keeps background work server-owned while device source slots and own copies remain.

## Before/after component attribution

Same post-bindgen symbol census as the top 40; shallow raw bytes, not gzip estimates. Categories are exclusive; inlining moves source bodies between classes.

| Component | Baseline B | Final B | Reduction B |
|---|---:|---:|---:|
| serde deserialize | 426,287 | 426,283 | 4 |
| serde serialize | 66,158 | 66,158 | 0 |
| serde_json own code | 51,535 | 49,846 | 1,689 |
| std generics over Snapback types | 439,792 | 430,240 | 9,552 |
| B-trees over std-only types | 147,834 | 147,834 | 0 |
| snapback4-core own code | 486,614 | 465,731 | 20,883 |
| snapback4-device own code | 176,039 | 159,591 | 16,448 |
| .rodata | 90,206 | 89,478 | 728 |
| other | 126,250 | 126,240 | 10 |
| Total attributed | 2,010,715 | 1,961,401 | 49,314 |

Largest monomorphization families remain sorting and B-trees over different element types, plus typed serde visitors.

## Final top 40 retained contributors

Post-bindgen symbol-bearing wasm; shallow raw bytes (custom metadata excluded). Production: **1,960,083 B raw / 566,391 B gzip**. Gzip is not additive per function. Rust crate hashes omitted for readability.

| Rank | Shallow raw B | Symbol |
|---:|---:|---|
| 1 | 89,478 | `data segment ".rodata"` |
| 2 | 28,030 | `<snapback4_core::engine::runner::Runner>::statements::{closure#0}` |
| 3 | 25,140 | `<snapback4_core::engine::runner::Runner>::row_changed` |
| 4 | 17,489 | `<snapback4_core::engine::runner::Runner>::insert_attempt` |
| 5 | 13,987 | `snapback4_device::call::call::<snapback4_device::memory::MemoryStore>::{closure#0}` |
| 6 | 12,887 | `<snapback4_core::engine::runner::Runner>::merge_with_words` |
| 7 | 11,534 | `<snapback4_core::engine::runner::Runner>::scan_consumed` |
| 8 | 11,286 | `<snapback4_core::engine::runner::Runner>::expr` |
| 9 | 10,346 | `<snapback4_core::engine::runner::Runner>::builtin` |
| 10 | 10,150 | `<snapback4_device::device::Device<snapback4_device::memory::MemoryStore>>::apply_publication_inner` |
| 11 | 9,077 | `<snapback4_core::engine::runner::Runner>::merge_lazy` |
| 12 | 8,582 | `<snapback4_core::engine::runner::Runner>::get_prepared` |
| 13 | 8,019 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_device::device::StreamPage as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 14 | 6,812 | `<snapback4_core::engine::runner::Runner>::discover_words` |
| 15 | 6,546 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::schema::Maintain as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 16 | 6,442 | `snapback4_device::device::deferred::events_recording` |
| 17 | 6,211 | `<alloc::vec::Vec<snapback4_core::ir::Stmt> as core::clone::Clone>::clone` |
| 18 | 6,141 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::schema::Table as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 19 | 6,075 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::ir::Scan as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 20 | 5,963 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::schema::timeline::Timeline as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 21 | 5,881 | `core::num::imp::flt2dec::strategy::dragon::format_shortest` |
| 22 | 5,801 | `<snapback4_core::engine::runner::Runner>::probe_witness_uncached` |
| 23 | 5,518 | `snapback4_device::device::store_identity::observe::<snapback4_device::memory::MemoryTx>` |
| 24 | 4,915 | `core::num::imp::flt2dec::strategy::dragon::format_exact` |
| 25 | 4,798 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_device::device::Queued as serde_core::de::Deserialize>::deserialize::__Visitor>` |
| 26 | 4,693 | `<dlmalloc::dlmalloc::Dlmalloc<dlmalloc::sys::System>>::malloc` |
| 27 | 4,653 | `snapback4_device::device::snapshot::retain::<snapback4_device::memory::MemoryTx>` |
| 28 | 4,650 | `snapback4_device::device::deferred::stage::<snapback4_device::memory::MemoryTx>` |
| 29 | 4,534 | `sha2::sha256::compress256` |
| 30 | 4,426 | `<snapback4_core::engine::runner::Runner>::word_bounds` |
| 31 | 4,412 | `<snapback4_core::engine::runner::Runner>::row_view_member` |
| 32 | 4,396 | `<snapback4_core::engine::runner::Runner>::check_constraints` |
| 33 | 4,314 | `<snapback4_core::engine::runner::Runner>::maintain::{closure#1}` |
| 34 | 4,257 | `<snapback4_device::memory::MemoryStore as snapback4_device::store::DeviceStore>::install` |
| 35 | 4,218 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::schema::capabilities::Wire>::deserialize::__Visitor>` |
| 36 | 4,174 | `<snapback4_core::engine::runner::Runner>::domain` |
| 37 | 4,122 | `<snapback4_device::device::Device<snapback4_device::memory::MemoryStore>>::open_store_mode` |
| 38 | 4,108 | `snapback4_core::engine::local::observe_query` |
| 39 | 4,099 | `<snapback4_core::engine::runner::Runner>::parent_verdict` |
| 40 | 4,073 | `<&mut serde_json::de::Deserializer<serde_json::read::StrRead> as serde_core::de::Deserializer>::deserialize_struct::<<snapback4_core::ir::MergeLane as serde_core::de::Deserialize>::deserialize::__Visitor>` |

## Retained roots from twiggy dominators

| Retained root | Baseline raw B | Final raw B |
|---|---:|---:|
| `webdevice_call` export | 883,581 | 828,426 |
| Backend JSON deserializer | 353,547 | 356,192 |
| Schema JSON deserializer (inside Backend) | 188,398 | 191,045 |

These are retained subtrees, not exclusive shallow sizes: the Schema row is part of Backend, and changes in sharing alter which root dominates a helper. Do not add these rows or interpret the Backend increase as a codec regression. Name metadata is excluded here. Full trees are in `00-dominators.txt` and `09-dominators.txt`.

## Reproduction and artifact identity

Production measurements use `bash scripts/build-wasm.sh` in `snapback4/`, Rust 1.97.0, wasm-bindgen 0.2.127 and Node 24.18.0. The script tries installed wasm-opt 132 with `-Os` and rejects it because gzip is larger; no extra optimizer or profile changes were used. Final `bash scripts/measure-wasm.sh` also passed the existing serde-family and forbidden-code checks and recorded 566,391 B gzip / 429,066 B Brotli. JS glue is 14,057 raw / 3,497 gzip and is outside the wasm ratchet. `09-artifact.json` records the production wasm SHA-256: `57a9e12d1aa5903e59cef131c6712a179ca3e79248e420ffdda451d6096d3ca2`.

For names, `node scripts/attribute-wasm.mjs --families --check-families --check-absent` builds the same wasm profile into `target/wasm-sym` with only `CARGO_PROFILE_WASM_STRIP=none`. The final measure receipt has `dirty=true` because the lowered ratchet was not yet committed; executable source was already committed at `855c778083` and remains unchanged. Its pre-bindgen checks are saved in `00-families.log` and `09-measure.log`. Run wasm-bindgen with `--target web` on that symbol-bearing module, then `twiggy top -n 1000000 --format json`, `twiggy dominators`, and `twiggy monos` on the resulting `snapback4_device_bg.wasm`; the corresponding before/after captures are `00-*` and `09-*`. Top-40 and component tables exclude all custom metadata (including 265 B of producers/target-feature metadata) and remove crate hashes for readability. Component classification otherwise follows the existing `attribute-wasm.mjs` rules, on the post-bindgen captures.

The symbol-bearing retained census is 1,318 B larger than production at both endpoints; its code section alone is 1,288 B larger. The total raw reduction agrees exactly at 49,314 B. A symbol's shallow size is an inspection aid, never a claimed gzip price. Compression is shared across the whole module; per-commit production deltas are the gzip attribution.

Final symbols exclude work-schema construction, cursor-prefix subtraction, basis reads/writes, asset ledger enrichment, column reservations, adoption rebuilds and recount chunks. `timeline_enqueue` survives only as a 36-B no-op stub; its 1,387-B server body is gone. PostgreSQL seeks were already absent. Work-table name strings remain for engine-owned-table rejection, so their presence is not evidence of work-table construction.

## Verification and review

The focused evidence is recorded per stage:

| Stage | Passing focused checks |
|---|---|
| 01 | 42 device library tests |
| 02 | 10 core row-view tests; 23 device row-key tests; 10 expiry tests |
| 03 | 6 accounting and 3 witness tests; 6 event-slot and 10 device expiry tests |
| 04 | 127 core library tests (1 pre-existing ignored); 11 bounded Following, 6 event-slot and 23 row-key tests |
| 05 | 24 row-key tests including serialized projection/legacy-schema regression; 10 expiry tests |
| 06 | 6 accounting, 18 disclosure and 3 witness tests; 24 device row-key tests |
| 07 | 84 guide-contract tests; normal-dependency and test/include audits |
| 08 | 11 bounded Following, 1 column activation, and 435 device tests (1 pre-existing ignored) |
| 11 | 20 lifecycle tests; all 7 Swift media checks; negative probes confirm the 15-second execution timer and reject missing main markers / failed launches |

Initial native compilation mistakes during descriptor borrowing and an overbroad index-removal setup in the new schema test were fixed before their commits were finalized. The initial failure logs are retained (`04-native-initial.log`, `05-test-initial.log`); successful reruns are alongside them. No test was deleted or newly ignored.

Final blocking command, with Node 24 first on PATH, in `snapback4/`:

```sh
# Process-local scheduling only; default 18 Rust workers.
taskpolicy -B -t 0 -l 0 -p $$
unset SNAPBACK4_RUST_TEST_PROCESSES
env -u FORCE_COLOR CARGO_INCREMENTAL=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh
```

The full runs use `caffeinate -i` only to prevent idle sleep. The initial suite completed with **`== 2 failure(s) in 3025 s`**: the cargo and client groups failed; the seeded models passed. Its output is preserved in `blocking-suite-initial.log`.

| First-run test | Failure evidence | Unchanged focused recheck |
|---|---|---|
| `born_perf` | Row growth 14.4× under concurrent startup (87.3 ms → 1,255.8 ms), versus a 9× limit | Same binary passed three runs: row growth 4.2×, 3.3×, 3.5×; grants 3.8×, 3.7×, 3.5× (`09-born-perf-recheck.log`) |
| Native-query bounded Following | Fixture server did not listen within 90 s | Passed in 59.8 s (`09-native-following-recheck.log`) |
| Expo Swift media helper | Fresh helper exceeded its 15 s process deadline before application code | All seven checks passed; unchanged test passed in 7.0 s after process-local foreground scheduling (`09-expo-media-foreground.log`) |
| IndexedDB page observation | Browser test exceeded its 60 s deadline | Both native (6.2 s) and IndexedDB (7.2 s) cases passed unchanged under foreground scheduling (`09-page-observation-recheck.log`) |

The media-helper investigation sampled `_dyld_start` before any Swift code (`09-expo-media-sample.txt`). Identical bytes copied to a new path took 33.7 s to launch and pass, while an already-started copy passed all checks in 0.3 s. Normal I/O policy alone did not resolve it. `taskpolicy -B -p $$` changes only the task shell's Darwin background scheduling, inherited by its children; it changes no system settings. The retry began with that setting; persistent loader stalls led to also setting normal latency/throughput tiers (`-t 0 -l 0`) on its own process tree (`09-test-scheduling.log`). Built test executables were additionally listed with `--list --format=terse` in an eight-worker batch to warm loader caches (`09-test-prewarm.log`); this runs no test bodies and changes no inventory. The second attempt used the harness's existing `SNAPBACK4_RUST_TEST_PROCESSES=4` (first and final runs: default 18). No source, test, inventory, assertion, seed or timeout changes occurred between the first and second attempts.

The second full attempt, recorded in `blocking-suite-retry-interrupted.log`, passed the born-row target but failed `lifecycle` because its newly compiled abort probe did not reach `main` within the existing 30-second startup allowance. It was stopped with exit 143 after the Rust phase; no final full-suite verdict is claimed for that attempt. The earlier full run had passed that same test.

Commit `3fda44245b` therefore schedules `snapback4-core::born_perf` and `snapback4::lifecycle` beside the already isolated `snapback4::witness`, after the regular Rust pool drains. Test bodies, timeout values, seeds and the 220-binary / 932-execution inventory remain unchanged. This changes only verification scheduling. `10-build.log` measures the identical artifact: 1,960,083 raw / 566,391 gzip, **0 B change**. An earlier working hypothesis that native tests embedded the generated device wasm was not supported by the source and was discarded; the build script is unchanged.

Isolation did not eliminate loader delay: the abort probe again missed its pre-main deadline in `10-isolated-tests.log` and `10-abort-active-wait.log`. Fresh diagnostic copies subsequently produced the required main, panic and SIGABRT records after 35.5–87.0 seconds; explicit ad-hoc signing also varied from 6.1 to 35.1 seconds (`10-abort-probe-builds.log`, `10-abort-probe-signing.log`). No compiler/signing changes were retained.

Commit `804c2be2f7` therefore separates **test fixture startup allowance from execution deadlines**. The lifecycle pre-main allowance changes from 30 to 120 seconds; its existing 15-second readiness/exit limit after main remains. The Swift fixture emits an unbuffered main marker, with 120 seconds allowed before main and the original 15-second execution limit thereafter. Its unchanged 40-second compile bound plus these two phases require a 180-second outer Node test timeout (previously 60 seconds). These are test-only allowances; no product runtime ceiling or timeout changes. All test bodies, assertions and seeds remain, apart from the Swift main marker and the Node fixture process management. No test was deleted or newly ignored.

Focused validation passed all 20 lifecycle tests and all seven media checks. A deliberately stalled helper was killed after 15.2 seconds after emitting the main marker; zero exit without the marker and failed process launch were also rejected (`11-helper-timer-check.log`). `11-build.log` confirms the unchanged 566,391-B artifact. The final full run tests source `804c2be2f7` with the same 220-binary / 932-execution Rust inventory; the three timing-sensitive targets run after the regular pool drains.

Final full-suite result: **`== 0 failure(s) in 2304 s`**, exit 0 (`blocking-suite.log`). All 932 Rust executions plus workspace doctests passed; the regular client suite passed 1,998 tests with 9 pre-existing skips, 0 failures and 0 cancellations. All 78 model tests passed, including 5,000 online-session sequences, 5,000 local-session sequences and 3,000 client interleavings. Fixture wrappers, app/package checks, docs budget, release guard and the wasm budget all passed. The final wasm SHA-256 still matches `09-artifact.json`. Repository-root `./ref-check --verbose`: **passed — 510 LLP documents, 9,395 refs, 0 errors, 0 unchecked** (`ref-check.log`).

Self-review checked the full semantic diff: native bodies remain compiled; web exclusions match existing device/store no-op branches; borrowed descriptors remain under the runner's immutable schema lifetime; point expiry emission still consumes its scope at the same point; live selection keeps its short-circuit order; meter reservations and image copying remain explicit; event-slot validation and Following call arguments still run. Publication/application order, public projection and serde type definitions are unchanged. No quantitative latency improvement is claimed.

## Remainder and next work

**46,392 B gzip remains to reach a strictly below-520,000 result.** The measured six candidates were smaller than the required gap: much server code was already absent, the test/lang corpus was already gated, and gzip largely compresses repeated monomorphized bodies together. The full DeviceTx erasure probe grew gzip by 1 B; the additional prepaid-scan sharing probe grew it by 194 B versus the retained narrow interface. Raw-byte wins are not sufficient.

The final census still attributes 492,441 raw bytes to typed serde readers/writers, 430,240 to standard-library generic code over Snapback types, 147,834 to other B-trees, and 625,322 to the core/device implementations themselves. These raw buckets overlap semantically through inlining but are exclusive in the reported classification. There is no newly discovered removable server/test payload of the required size.

The next plausible route is a separately measured codec/container or executor redesign that still emits and accepts the exact current wire, stored and schema forms. For example, reducing typed visitor/container instantiations would require differential serialization and decode-error checks; replacing collection construction would need ordering, duplicate-key, metering and performance qualification. The older LLP 3000.002 S2/S4 probes are historical evidence of possible scale, not current-tree savings or permission to change formats. No current measured safe change guarantees the missing 46,392 B. Keep the ticket open and the 567,391 ratchet; do not raise a runtime ceiling or weaken authoring contracts to claim the target.
