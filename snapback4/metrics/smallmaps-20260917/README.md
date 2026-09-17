# S2 small ordered maps — 2026-09-17

Base: `70a663c22285dc3a5278ca9ac13db01bbe05446b`. This lane changes S2 only. No commit, push, tag, or publication was made. Commands below run from `snapback4/` unless identified as repository-root commands. JavaScript commands use `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.

## Retained changes and size

The new `SmallMap` stores sorted `Vec<(K, V)>` entries. Already sorted input appends; unsorted input binary-inserts without a generic slice sort. `SmallSet` uses the same machinery. Serde emits the same sorted map/sequence representation. Duplicate values are last-wins; a regression test also preserves BTreeMap's distinct equal-key representative behavior between insert/extend/deserialize and its bulk constructor. Lookup accepts borrowed keys. All hosts share the implementation.

Rows retain Arc sharing and copy-on-write. Their heap charge remains **40 + sum(80 + key capacity + nested value heap)**; array accounting still uses the unchanged `Value` layout. No meter ceiling or wire/durable/public TypeScript format changed. Large row-id stores, random mutation maps, runner-created-row maps, and large sets remain B-trees.

`bash target/d2/measure.sh LABEL` is a copy of `scripts/measure-wasm.sh`, preserved here as `measure-wasm.sh`. It uses the same wasm profile/features, wasm-bindgen, wasm-opt candidate selection, system gzip-9 and Brotli-11; it writes isolated artifacts, never `metrics/wasm.jsonl`. `wasmOpt=false` on every measured variant. Both baseline and candidate glue are 11,325 raw / 3,047 gzip / 2,700 Brotli bytes, with matching SHA-256. Artifact identities and every size are in `measurements.json`.

| Label / conversion order | Raw B | Gzip B | Brotli B | Gzip saving from preceding retained group |
| --- | ---: | ---: | ---: | ---: |
| before | 1,891,742 | 520,557 | 394,881 | — |
| g1-fields (partial family probe) | 1,870,785 | 519,201 | 394,538 | 1,356; completed the shared Value family before deciding |
| g1-value-family: rows, arguments, environments | 1,862,547 | 517,522 | 393,369 | 3,035 |
| g2-schema-ir: IR and schema maps | 1,797,995 | 508,542 | 388,098 | 8,980 |
| g3-plans: pages, admission, prefetch, presence, per-run sets | 1,690,759 | 491,040 | 377,779 | 17,502 |
| g4-device: programs, history, dispatcher/install metadata | 1,673,480 | 487,284 | 375,360 | 3,756 |
| g8-held-tables: small outer held/joined table maps | 1,663,533 | 485,032 | 373,101 | 2,252 |

Final reduction: **228,209 raw / 35,525 gzip / 21,780 Brotli bytes**. This is materially below the estimated 100 KB gzip. B-tree machinery compresses well already; replacing 347,877 symbol-attributed B-tree bytes introduces 116,729 SmallMap-named bytes (739 items), retains necessary large maps, and saves much less gzip than the raw symbol sum suggests. These name-based categories overlap and must not be added as disjoint contributions.

## Census

The lane's independent census is `census.py`; `before-census.json` and `after-census.json` preserve every key/value pair and sort element-type total, including an unresolved bucket. An item is charged to its first meaningful B-tree key/value pair. Counts include named wrappers and visitors, so they are broader than the brief's roughly 960 balancing items.

```sh
CARGO_PROFILE_WASM_STRIP=none cargo build -p snapback4-device --no-default-features --features web --profile wasm --target wasm32-unknown-unknown --target-dir target/wasm-sym
twiggy top -n 1000000 --format json target/wasm-sym/wasm32-unknown-unknown/wasm/snapback4_device.wasm > target/d2/STAGE/twiggy.json
python3 target/d2/census.py target/d2/STAGE/twiggy.json > target/d2/STAGE/census.json
```

| Name predicate | Before bytes / items | After bytes / items |
| --- | ---: | ---: |
| B-tree | 505,002 / 2,712 | 157,125 / 891 |
| Slice sort | 107,923 / 402 | 42,588 / 161 |

Most remaining B-tree bytes belong to row storage, staged images, outbox/base/meta, row-created bookkeeping, serde_json's dynamic map, and large sets. Leading final pairs include String sets (19,510 B), `(String, String) -> Value` (13,486), `String -> (String, String)` (13,373), serde_json fields (12,712), and memory index entries (11,136). The remaining unresolved bucket is 14,280 B.

## Rejected sort experiments

All sort helpers and their call-site changes were removed. Original stable ordering remains.

| Probe | Raw / gzip / Brotli B | Gzip win against g4 | Decision |
| --- | ---: | ---: | --- |
| g5-value-sort: one non-generic Value sort | 1,668,861 / 486,696 / 374,761 | 588 | Below 1 KB; large total sort also about 15% slower |
| g6-index-sort: stable index permutation shared across element types | 1,660,537 / 485,254 / 373,439 | 2,030 | Rejected: keyed sort at 1,000 elements 218,987 vs 189,024 ns (1.159x) |
| g7-collector-outbox: index sort without runner changes | 1,669,251 / 486,783 / 375,333 | 501 | Below 1 KB; collectors 1.12–1.17x and outbox 2.6–3x slower |

The probes used seven alternating pairs in a release scratch crate (`cargo run --offline --manifest-path target/d2/bench/Cargo.toml --target-dir target/d2/bench-target --release`). Their numbers are preserved in the `*-cost*.txt` files. `rows::index_write` already sorts `usize` indexes and was left alone. Removing BTreeMap bulk builders accounts for the retained sort-code reduction.

## Map crossover and separate byte accounting

`construction_crossover` is an ignored test beside the map tests. The identical extracted measurement (`map-crossover.rs`) was run using the scratch-crate command above; `crossover.txt` and `crossover-final.txt` contain all N=7 medians. The first run crosses between 16 and 32 shuffled String/Value fields (1.07x at 32; 3.78x at 1,024), with sorted construction faster through 4,096. The later shared-load repeat is noisier (1.12x at 32; 4.32x at 1,024). This is why large random maps remain B-trees.

`node target/d2/measure-client.mjs` copies the existing client byte pipeline without appending its metric history. SDK JavaScript is 33,149 raw / 9,977 gzip / 8,883 Brotli bytes online and 88,213 / 24,866 / 21,771 local-first. The existing local-first tier measurement includes bundled glue; do not add the standalone glue numbers to that tier a second time. SDK sources and glue are unchanged. That script's Node-zlib wasm gzip differs from system gzip; the shipped pipeline table above is authoritative for wasm.

`D2_BACKEND_IMAGES=$PWD/target/d2/backend-images cargo test -p snapback4-core --test ordered_identity -- --nocapture` writes generation-1 backend envelopes. System `gzip -9 -c` / `brotli -q 11 -c` measure Chat at 18,472 / 2,911 / 2,515 B and Interview at 38,635 / 4,270 / 3,679 B. `backend-images.json` records hashes. Schema/program bytes match the B-tree pins. Device Following cold payloads are unchanged: 2,600 rows / 250,482 row-JSON bytes for 5 follows; 3,095 / 335,403 for 500. These are row payloads, **not total network transfer**. Actual Chromium cold-open/acquisition/offline-reopen timings and total transfer remain the lead's witness qualification.

## Pinned identity and limitations

The baseline executable was built before representation edits and preserved. It produced `crates/snapback4-core/tests/ordered_identity.json`: 294 corpus case digests plus eight reference-app pins (schema/program backend, schema hash, api.ts and wire programs for each app). Re-running the preserved executable reproduced that file byte-for-byte. Interview's three Quarry files are a frozen reference-app snapshot under the test fixtures; Chat uses its repository source.

The brief's assumption that every raw Snapback 2 program decodes directly is false at the verified base: seven Program decodes already refuse `invalid value: map, expected map with a single key`. The test reports these refusals and pins their exact failure plus original JSON, rather than skipping them or claiming successful reserialization. The existing corpus adapter suite executes the translated corpus and passes 18 tests.

The old ignored `following_candidates_at_scale` performance entry point also fails at the preserved base with `E_ADOPT` (0 passed; 1 failed; 92 filtered out). Its failure is not attributed to this lane. The first storage pilot failed readiness during the environment stalls; the isolated-temp retry succeeded. Early disk-full linker/SQLite failures and a missing installed `openid-client` were environment obstacles; six locked packages were restored with `bun install --frozen-lockfile`. No dependency manifest or lockfile changed.

## Performance pairs

Preserved pre-change executables were used for every baseline sample; no branch switch or rebuild of baseline source occurred. `python3 target/d2/paired.py server`, `device`, and `sqlite` alternate AB/BA order for seven pairs each. The first native candidate launch took 233 s (server) / 184 s (device) before normal execution; all wall samples are retained, and medians, not those first-launch outliers, are reported. These are debug engine tests on a shared Apple M5 Max, not production-throughput claims.

| Workload / metric | Before median | After median | After / before |
| --- | ---: | ---: | ---: |
| server: wall_s | 3.866 | 2.992 | 0.774 |
| server: server/5/p95_ms | 2.193 | 1.980 | 0.903 |
| server: server/500/p95_ms | 2.119 | 1.941 | 0.916 |
| device: wall_s | 12.644 | 12.092 | 0.956 |
| device: memory/5/p95_ms | 1.938 | 1.731 | 0.893 |
| device: memory/500/p95_ms | 1.860 | 1.487 | 0.799 |
| device: sqlite/5/p95_ms | 3.101 | 3.137 | 1.012 |
| device: sqlite/500/p95_ms | 3.287 | 3.575 | 1.088 |
| sqlite: wall_s | 8.346 | 6.653 | 0.797 |
| sqlite: sqlite/5/p95_ms | 3.093 | 3.762 | 1.216 |
| sqlite: sqlite/500/p95_ms | 2.968 | 2.195 | 0.740 |

The first SQLite batch had a 500-follow p95 regression; the repeated SQLite-only batch reversed it while the 5-follow value moved the other way. Those inconsistent results are retained, not silently discarded.

`python3 target/d2/storage-pairs.py` runs the existing `scripts/measure-storage.mjs` default workload (4 groups × 100 messages × 4 members; 420 seed records), with only its output path and import location changed in `target/d2/measure-storage.mjs`. It uses `SNAPBACK4_BIN=target/d2/before/snapback4` versus `target/debug/snapback4`, Node 24.18.0, and `TMPDIR=/private/tmp/snapback4-d2-70a663c22`. No published metric history is appended. Each of three batches contains seven alternating pairs and each workload measures 20 requests after three warmups. JSON files retain every binary/source/seed digest and measurement.

### First HTTP batch

| Workload | p50 before → after (ms) | p95 before → after (ms) |
| --- | ---: | ---: |
| httpPoint | 3.069 → 3.275 | 6.157 → 4.823 |
| httpThread | 4.181 → 3.723 | 5.185 → 5.044 |
| httpNextPage | 4.170 → 4.441 | 4.728 → 6.885 |
| httpInbox | 3.026 → 2.876 | 4.955 → 3.752 |
| httpFeed | 4.610 → 4.347 | 6.076 → 7.393 |
| httpSend | 6.122 → 6.071 | 52.853 → 58.148 |
| httpEdit | 3.949 → 3.284 | 7.019 → 9.749 |

### Second HTTP batch

| Workload | p50 before → after (ms) | p95 before → after (ms) |
| --- | ---: | ---: |
| httpPoint | 3.321 → 2.963 | 6.959 → 6.520 |
| httpThread | 4.569 → 4.464 | 8.343 → 8.741 |
| httpNextPage | 4.905 → 4.668 | 8.337 → 5.951 |
| httpInbox | 3.485 → 3.446 | 9.469 → 5.617 |
| httpFeed | 4.429 → 4.343 | 9.659 → 7.357 |
| httpSend | 5.231 → 6.474 | 39.888 → 39.719 |
| httpEdit | 4.618 → 4.325 | 47.077 → 19.774 |

### Third HTTP batch

| Workload | p50 before → after (ms) | p95 before → after (ms) |
| --- | ---: | ---: |
| httpPoint | 2.704 → 2.849 | 3.530 → 3.709 |
| httpThread | 4.079 → 4.182 | 4.780 → 4.901 |
| httpNextPage | 4.392 → 4.226 | 5.339 → 4.946 |
| httpInbox | 2.895 → 3.052 | 3.539 → 3.736 |
| httpFeed | 4.291 → 3.961 | 5.087 → 5.209 |
| httpSend | 5.991 → 5.690 | 15.030 → 18.256 |
| httpEdit | 3.651 → 3.469 | 10.037 → 6.383 |

`python3 metrics/smallmaps-20260917/summarize.py` pairs each before/after trial before pooling all 21 pairs. Median paired p50/p95 ratios are:

| Workload | p50 ratio | p95 ratio |
| --- | ---: | ---: |
| httpPoint | 0.987 | 1.021 |
| httpThread | 1.025 | 1.040 |
| httpNextPage | 1.003 | 0.975 |
| httpInbox | 0.931 | 0.985 |
| httpFeed | 0.930 | 1.013 |
| httpSend | 1.006 | 1.036 |
| httpEdit | 0.932 | 0.635 |

No pooled median paired ratio exceeds 1.05. Individual batches do cross 5%, notably point, inbox and send tails; shared-host variability means this is not proof that every server path is unaffected. The raw data and those concerns remain available for lead qualification.

The large native acquisition diagnostic ran once per binary, with `TMPDIR=/private/tmp/snapback4-d2-70a663c22 target/d2/{before,after}/tests/device-995533f915d1acea following::calibration::w8b_wired_calibration_acquisition_on_server_and_both_stores --exact --nocapture --test-threads=1`. Both passed. For 139,413 rows / 17,876,585 row-JSON bytes: server snapshot 5,141.163 → 4,692.693 ms; memory apply 12,104.303 → 10,407.668 ms; SQLite apply 23,070.943 → 21,075.628 ms; scenario wall 100.17 → 86.59 s. These **single diagnostic observations are not N=7 qualification** and do not substitute for the lead’s Chromium scale witness.

## Validation

Validation (Node commands used the required Node 24 PATH; cargo/bun ran from `snapback4/`):

- `cargo test -p snapback4-core --test smallmap --test ordered_identity --test corpus --test meter`: corpus `18 passed; 0 failed`; meter `8 passed; 0 failed`; identity `1 passed; 0 failed`; map `6 passed; 0 failed; 1 ignored`. `D2_BACKEND_IMAGES=... cargo test -p snapback4-core --test ordered_identity -- --nocapture` independently passed again with the final args representation.
- `cargo check -p snapback4-core --features postgres`: finished successfully. `cargo test --workspace --no-run --message-format json`: all 69 executable targets compiled. The full workspace runtime run aggregated **1,303 passed, 0 failed, 5 ignored** across 74 result summaries, including doctests. The main device suite was `188 passed; 0 failed` and the simulator's main suite `92 passed; 0 failed; 1 ignored`.
- Repository-root `bash snapback4/scripts/test.sh` first returned `== 5 failure(s) in 419 s`: disk-full Rust linking, missing installed `openid-client` blocking package typecheck/build, and downstream missing built wasm glue in client tests. Disk space was recovered by removing only this lane's unused temporary executable copies; `bun install --frozen-lockfile` restored six locked packages without changing manifests/lockfiles. A retry was interrupted during long stalls. The completed retry was `TMPDIR=$PWD/snapback4/target/d2/suite-tmp bash snapback4/scripts/test.sh`, with `-- ok: cargo test (2183 s)` and `== 1 failure(s) in 2192 s` (`client tests`). All build/typecheck/chat/fixture steps passed. The client step reported `ℹ tests 542`, `ℹ pass 538`, `ℹ fail 2`, `ℹ skipped 2`: Chromium SIGABRT and the managed-policy scratch check correctly rejecting this deliberately isolated temporary directory inside Git.
- `TMPDIR=/private/tmp/snapback4-d2-70a663c22 node --test --test-name-pattern='managed-policy scratch parent' packages/snapback4/test/identity-organizations.test.mjs`: `ℹ tests 1`, `ℹ pass 1`, `ℹ fail 0`. No policy implementation changed.
- `node --test --test-concurrency=2 'packages/snapback4/test/*.test.mjs'`: `ℹ tests 542`, `ℹ pass 537`, `ℹ fail 3`, `ℹ skipped 2`. Besides Chromium, two acknowledgement/cursor cases hit 20-second deadlines under load. `TMPDIR=/private/tmp/snapback4-d2-70a663c22 node --test --test-concurrency=1 packages/snapback4/test/transport-http.test.mjs` then reported `ℹ tests 6`, `ℹ pass 6`, `ℹ fail 0`; both timeout cases passed. Chromium remains an outside-sandbox lead check, not a passed witness.
- `./ref-check --verbose` at repository root: passed; the literal final counts are recorded in test-summaries.txt. `git diff --check` passed. Every changed code file is under 1,500 lines (maximum 1,488). No bare cargo fmt ran.

The literal summary lines and commands, including initial failures, are preserved in `metrics/smallmaps-20260917/test-summaries.txt`. Neither browser qualification nor a combined S1/S2 artifact is claimed. The only product failure described as verified at the unchanged base is the ignored E_ADOPT performance entry point; the seven legacy Program refusal pins were likewise captured from that preserved B-tree build. Environment failures are reported as such, not casually labelled pre-existing product failures.

The file manifest is `files.txt`. Changes outside the core/device modules are only compiler/server/test type-boundary adaptations and measurement evidence. Published README/guide and TypeScript files are unchanged. The baseline remains `70a663c22285dc3a5278ca9ac13db01bbe05446b`; no commit was made.

## D2-R1 review correction — 2026-09-17

This round starts at `109efbf4b3c37b4e4a2e853d009240a0bdd506d2`. Everything above is the retained round-1 record. The rule is now explicit in `smallmap.rs`: only authored schema/program cardinality or a small fixed constant qualifies. History's inner group map and presence dependencies return to B-trees. The transient filter row has its own runner slot, including borrowed field/scalar access, nested filters, lowered helpers, shadowing, and restoration after error. The complete [conversion audit](./r1/conversion-audit.md) found one additional data-sized family: arbitrary JSON `Value::Map` keys. Those now use shared B-tree `MapFields`; `ObjectFields` for schema-shaped rows still dereferences to `SmallMap`. The shared image wrapper retains Arc/COW and the same logical meter charges. Rust callers that copy validated rows use `to_row`; dynamic objects use `to_map`. These are internal representation changes with unchanged serialized enum tags, JSON objects, wire envelopes and durable images.

The lead's dispositions take precedence over the reviews' alternatives: the runner environment stays small, identity is proved by dual construction rather than a provenance prerequisite, Chromium witnesses remain the lead's, and the S0 budget ratchet remains D1's. No README/guide authoring surface, client contract, ceiling, corpus case, or device web/call/memory serde plumbing was changed.

### Updated shipped bytes and attribution

Each line uses `bash target/d2/measure.sh LABEL`, the same preserved shipped pipeline as round 1. Labels are the first column. `r1-verified` includes the String-to-key conversion sites needed for the test-only comparison counter; production keys remain String. Every variant chooses `wasmOpt=false`. Hashes are in [r1/measurements.json](./r1/measurements.json).

| Label / correction | Raw B | Gzip B | Brotli B | Gzip change |
| --- | ---: | ---: | ---: | ---: |
| round-1 final / `g8-held-tables` | 1,663,533 | 485,032 | 373,101 | — |
| `r1-history`: restore group B-tree | 1,668,521 | 485,879 | 374,539 | +847 |
| `r1-presence`: restore principal dependencies | 1,674,286 | 487,290 | 374,800 | +1,411 |
| `r1-filter`: dedicated filter slot | 1,674,556 | 487,468 | 376,596 | +178 |
| `r1-dynamic`: restore dynamic JSON B-trees | 1,704,694 | 495,035 | 379,337 | +7,567 |
| `r1-final`: direct field access / row clone and one iterator enum | 1,699,553 | 493,279 | 377,995 | −1,756 |
| `r1-verified`: comparison-test key boundary | **1,699,569** | **493,286** | **377,960** | +7 |

The final giveback is **36,036 raw / 8,254 gzip / 4,859 Brotli B**. S2 still saves **192,173 raw / 27,271 gzip / 16,921 Brotli B** against the original `70a663c22` shipped baseline. Dynamic maps cost **5,811 gzip B net** after removing avoidable wrapper iteration overhead. Standalone glue remains **11,325 / 3,047 / 2,700 B**, byte-identical to round 1. SDK JavaScript is unchanged; its prior separate accounting remains above, with bundled glue counted once. This is S2 alone, not a combined S1/S2 claim.

Updating the earlier per-group accounting by assigning each measured correction to its original conversion family gives the following. Attribution is sequential and shared code makes it order-dependent; these are not independent rebuilds of each family.

| Family | Round-1 gzip saving | R1 giveback | Updated allocated saving |
| --- | ---: | ---: | ---: |
| g1 value/arguments/environment | 3,035 | 5,989 (dynamic maps 5,811; filter slot 178) | −2,954 |
| g2 schema/IR | 8,980 | 0 | 8,980 |
| g3 plans/presence | 17,502 | 1,411 | 16,091 |
| g4 device/history | 3,756 | 854 (847 restoration; 7 key boundary) | 2,902 |
| g8 held-table outer maps | 2,252 | 0 | 2,252 |
| Total | 35,525 | 8,254 | **27,271** |

The symbol-bearing census repeats the exact earlier build command, writing `target/d2/r1/twiggy-verified.json`, then `python3 target/d2/census.py target/d2/r1/twiggy-verified.json`. The [verified census](./r1/census-verified.json) contains every pair, sort type and unresolved bucket. Name predicates still overlap.

| Census | Original baseline bytes / items | Round-1 bytes / items | R1 bytes / items |
| --- | ---: | ---: | ---: |
| B-tree | 505,002 / 2,712 | 157,125 / 891 | **199,204 / 1,126** |
| Slice sort | 107,923 / 402 | 42,588 / 161 | **51,728 / 192** |

Toolchain: `rustc 1.97.0 (2d8144b78 2026-07-07)`, `cargo 1.97.0 (c980f4866 2026-06-30)`, Node `v24.18.0`, wasm-bindgen `0.2.127`, wasm-opt `132`, Brotli `1.2.0`. No sort funnel was added.

### Scale and identity regressions

`cargo test -p snapback4-device --lib history_groups_scale -- --nocapture` applies reverse and seeded-shuffled scope events through `history::events`, verifies all memberships, joins a left group again, and reloads the persisted image on both memory and SQLite. At 1,000 / 8,000 groups, reverse insertion makes **3,270 / 34,869 comparisons (10.663×)** and shuffled insertion **12,678 / 142,094 (11.208×)** on both stores. The measured wall medians were memory **2.157 / 20.022 ms reverse**, **2.636 / 23.581 ms shuffled**; SQLite **2.466 / 18.699**, **2.526 / 22.933 ms**. Earlier wall-ratio-only versions flaked under shared load (26.658× and 40.325×), so wall time remains reported evidence, not the gate. The final gate combines counted comparison growth with an exact B-tree representation assertion: comparison counts alone would miss a vector's uncounted shifts. The instrumented key exists only in native unit tests and preserves String ordering and serialization.

`cargo test -p snapback4-core --lib smallmap_scale -- --nocapture --test-threads=1` measures 8,192 rows/principals. The filter test's deterministic shift counter changes **12,582,912 → 0** entries; the final 8-/768-binding medians are **19.630 / 20.792 ms (1.059×)**. The ordinary loop is **1.667 / 2.273 ms (1.363×)** with **8 / 768 total shifts**. Untaken-arm restoration is **19.093 / 47.774 ms (2.502×)** with the explicitly bounded **1,536 shifts = 86,016 bytes per transient name per row** at width 768. The distinct-principal case retains all 8,192 shuffled dependencies at **2,490,368 charged heap bytes**, **25.566 ms** in this run. Every ceiling remains unchanged.

`cargo test -p snapback4-core --test smallmap reversed_thousand_programs -- --nocapture` uses seven alternating pairs. Reversed construction of 1,000 actual Programs measured **1.711 ms SmallMap / 0.326 ms BTreeMap (5.255×)** in the final loaded run; the initial run was **0.873 / 0.238 ms (3.659×)**. The absolute construction cost remains below a few milliseconds, so there is no new sort helper or B-tree reversion for program dispatch.

The row-sharing test now statically requires `Deref<Target = SmallMap<String, Value>>`. Every pinned subject is serialized with a test serializer that preserves struct/enum order and rebuilds every map recursively through both BTreeMap and SmallMap from identical entries in reverse insertion order. It checks byte identity, equal SHA-256, and equality with production serialization. Context arguments also deserialize directly into both collection types, and the B-tree output supplies the pin. All **302 existing digests are unchanged**. The pin file has a JSON `$comment` header with the exact tested capture command:

```sh
D2_IDENTITY_CAPTURE=$PWD/crates/snapback4-core/tests/ordered_identity.json cargo test -p snapback4-core --test ordered_identity -- --nocapture
```

The randomized Entry differential now exercises `and_modify` as well as `or_default`, `or_insert` and `or_insert_with`. Negative controls deliberately remove `and_modify`, reverse SmallMap serialization, and feed an Arc<BTreeMap> to the row type assertion; each is rejected. Those controls address coverage gaps in behavior that was already correct at the base, rather than inventing a baseline product failure. The initial relative capture path failed because Cargo runs the test from the crate directory; the recorded absolute command corrects that test-command error.

### Repeated performance probes

`TMPDIR=/private/tmp/snapback4-d2-r1 python3 target/d2/r1/paired-final.py server` and `device` each run seven alternating AB/BA pairs of the wired Following scenarios. The saved before executables are from this round’s base `109efbf4b`; binary hashes are in `r1/identities.json`. Every scenario sample passed. The first final-code batch and server repeat are both retained; earlier intermediate-code batches are also retained, not pooled into final-code results.

| Batch / metric | Before | After | Ratio |
| --- | ---: | ---: | ---: |
| server first: wall_s | 4.391 | 4.589 | 1.045 |
| server first: server/5/p95_ms | 2.947 | 3.051 | 1.035 |
| server first: server/500/p95_ms | 3.341 | 4.297 | 1.286 |
| server repeat: wall_s | 18.794 | 20.200 | 1.075 |
| server repeat: server/5/p95_ms | 8.753 | 20.460 | 2.337 |
| server repeat: server/500/p95_ms | 30.949 | 59.273 | 1.915 |
| device: wall_s | 13.217 | 12.546 | 0.949 |
| device: memory/5/p95_ms | 3.129 | 2.127 | 0.680 |
| device: memory/5/cold_rows | 2600.000 | 2600.000 | 1.000 |
| device: memory/5/cold_bytes | 250482.000 | 250482.000 | 1.000 |
| device: memory/500/p95_ms | 2.635 | 1.736 | 0.659 |
| device: memory/500/cold_rows | 3095.000 | 3095.000 | 1.000 |
| device: memory/500/cold_bytes | 335403.000 | 335403.000 | 1.000 |
| device: sqlite/5/p95_ms | 5.495 | 4.523 | 0.823 |
| device: sqlite/5/cold_rows | 2600.000 | 2600.000 | 1.000 |
| device: sqlite/5/cold_bytes | 250482.000 | 250482.000 | 1.000 |
| device: sqlite/500/p95_ms | 6.861 | 7.251 | 1.057 |
| device: sqlite/500/cold_rows | 3095.000 | 3095.000 | 1.000 |
| device: sqlite/500/cold_bytes | 335403.000 | 335403.000 | 1.000 |

The repeated server p95 regressions are **unresolved qualification evidence**. Removing avoidable borrowed-image iterator overhead improved the implementation and reduced gzip bytes, but it does not explain or clear every server tail. Both before and after binaries slowed substantially in the repeat (wall medians 18.794 / 20.200 seconds versus 4.391 / 4.589 in the first batch). Shared load makes attribution uncertain; no general performance-neutrality claim is made, and this stage is not marked performance-qualified. Controlled outside-sandbox confirmation belongs in the lead’s acceptance record.

`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH; python3 target/d2/r1/storage-pairs.py` runs seven alternating HTTP pairs (three warmups, then 20 requests per workload; 4 groups × 100 messages × 4 members, 420 seed records). The preserved HTTP before executable is the **original pre-S2 `70a663c22` binary**, not `109efbf4b`; no round-1 CLI executable was retained. The current candidate is `target/debug/snapback4`. This comparison measures cumulative S2 behavior. The JSON retains every executable/source/seed digest.

| HTTP workload | p50 before → after (ms) | p95 before → after (ms) | p50 / p95 ratio |
| --- | ---: | ---: | ---: |
| httpPoint | 3.242 → 3.283 | 4.668 → 5.421 | 1.013 / 1.161 |
| httpThread | 4.897 → 4.553 | 7.207 → 10.547 | 0.930 / 1.463 |
| httpNextPage | 4.797 → 4.963 | 6.105 → 7.543 | 1.035 / 1.236 |
| httpInbox | 3.816 → 3.534 | 6.273 → 5.712 | 0.926 / 0.911 |
| httpFeed | 5.155 → 4.728 | 7.024 → 5.822 | 0.917 / 0.829 |
| httpSend | 4.867 → 4.306 | 13.850 → 5.690 | 0.885 / 0.411 |
| httpEdit | 3.654 → 3.865 | 4.841 → 4.747 | 1.058 / 0.981 |

Several HTTP tails likewise exceed 5%; all data is retained and no neutral-performance claim is inferred from the improved workloads. Following payload counts remain 2,600 rows / 250,482 row-JSON bytes at five follows and 3,095 / 335,403 at 500 follows. Browser cold-open/acquisition/offline-reopen is explicitly outside this lane.

### Review dispositions and test transitions

Full literal commands and summary lines are in [r1/test-summaries.txt](./r1/test-summaries.txt). The initial red tests ran against base `109efbf4b` with only their tests/instrumentation added. The history guard and comparison counter were subsequently made deterministic under load; the initial runtime ratio was not treated as reliable evidence by itself.

| Disposition | Files | Red before / green after |
| --- | --- | --- |
| 1. Data-sized history groups | `device/history.rs`, `device/snapshot.rs`, `tests/support/history_scale.rs` | `FAILED. 0 passed; 1 failed` → `ok. 1 passed; 0 failed` (both stores inside the test). |
| 2. Principal dependencies | `engine/presence.rs`, `tests/support/smallmap_scale.rs` | Initial core scale batch `FAILED. 1 passed; 2 failed` (principal representation and filter shifts) → final `ok. 5 passed; 0 failed`. |
| 3. Transient filter slot | `engine/{runner,read,prediction}.rs`, same scale tests | Same red/green core batch; additionally tests nested filters, lowered helpers, `$filter` shadowing, borrowed access, and error/depth restoration. |
| 4. Complete audit / dynamic JSON | `value.rs`, `value/fields.rs`, schema/wire and row-copy callers, `tests/smallmap.rs` | `FAILED. 0 passed; 1 failed` → integration batch `ok. 8 passed; 0 failed; 1 ignored`; program construction `ok. 1 passed; 0 failed`. |
| 5. Representation / context arguments | `tests/{smallmap,ordered_identity}.rs`, `tests/support/identity_maps.rs` | Deliberate Arc<BTreeMap> row replacement fails to compile with E0271 → `ok. 1 passed; 0 failed`; reverse-order serialization mutation `FAILED. 0 passed; 1 failed` → identity `ok. 1 passed; 0 failed`. |
| 6. Self-proving pins / Entry API | Same identity tests, `ordered_identity.json`, `tests/smallmap.rs` | No-op `and_modify` mutation `FAILED. 0 passed; 1 failed` → randomized differential passes in the eight-test integration batch. Pins are built both ways, then checked against unchanged digests. |
| 7. Re-measure | `metrics/smallmaps-20260917/r1/`, this README and JOURNAL | Measurements completed; performance and environment-dependent qualification limitations are explicit, not a green acceptance claim. |

### R1 validation and remaining acceptance work

All Cargo/Bun commands ran from `snapback4/`; Node/Bun commands used `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`. Exact commands and every literal summary line, including negative controls and both full suites, are in [r1/test-summaries.txt](./r1/test-summaries.txt).

- Targeted `cargo test -p snapback4-core --test smallmap --test ordered_identity --test corpus --test meter`: corpus 18 passed; meter 8 passed; identity 1 passed; SmallMap 8 passed, 1 ignored; no failures. Final core scale 5 passed, history scale 1 passed, reversed-program construction 1 passed, identity capture 1 passed, and the row representation test 1 passed. The test files contain positive behavior and exact state checks, not just refusal assertions.
- `cargo check -p snapback4-core --features postgres` and `cargo test --workspace --no-run` completed successfully. Final `./ref-check --verbose` at the repository root: `ref-check: ok — 481 LLP docs, 9057 refs in 24167 files, 0 errors, 0 unchecked`. `git diff --check` passes; all changed code files are below 1,500 lines, maximum 1,330 (`schema.rs`).
- Repository-root `TMPDIR=/private/tmp/snapback4-d2-r1 bash snapback4/scripts/test.sh`: `-- ok: cargo test (16177 s)`, `== 1 failure(s) in 16215 s`. Computed Rust aggregate across 74 literal result lines: **1,311 passed, 0 failed, 5 ignored**. This run experienced roughly a four-hour execution gap; client totals were `ℹ tests 542`, `ℹ pass 535`, `ℹ fail 2`, `ℹ cancelled 3`, `ℹ skipped 2`.
- Repository-root `TMPDIR=/private/tmp/snapback4-d2-r1 RUST_TEST_THREADS=2 bash snapback4/scripts/test.sh`: `-- ok: cargo test (1856 s)`, `== 1 failure(s) in 1917 s`. Rust again totals **1,311 passed, 0 failed, 5 ignored**; main device `188 passed; 0 failed`, main simulator `92 passed; 0 failed; 1 ignored`. Build, wasm, package/chat/Expo typechecks, package build, chat check, and fixture wrapper steps all passed (fixtures 9/9). The only failed step was client tests: `ℹ tests 542`, `ℹ pass 537`, `ℹ fail 3`, `ℹ cancelled 0`, `ℹ skipped 2`. The failures were Chromium SIGABRT and wasm/native maximum-pending-id acknowledgement deadlines.
- `TMPDIR=/private/tmp/snapback4-d2-r1 node --test --test-concurrency=2 'packages/snapback4/test/*.test.mjs'` first reported tests 542 / pass 537 / fail 3 / cancelled 0 / skipped 2. `TMPDIR=/private/tmp/snapback4-d2-r1 node --test --test-concurrency=1 packages/snapback4/test/transport-http.test.mjs` passed all six tests: `ℹ tests 6`, `ℹ pass 6`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0`.
- The repeated concurrency-two client run reported tests 542 / pass 534 / fail 4 / cancelled 2 / skipped 2, adding HTTP-bounds parent deadlines. The isolated `TMPDIR=/private/tmp/snapback4-d2-r1 node --test --test-concurrency=1 packages/snapback4/test/http-bounds.test.mjs` still timed out: `ℹ tests 10`, `ℹ pass 6`, `ℹ fail 2`, `ℹ cancelled 2`, `ℹ skipped 0`. This remains a failed environment-dependent validation; it is not called a proven pre-existing product failure. Failure excerpts are retained in `r1/client-failures.txt`.

No R1 failure is claimed pre-existing without a test at the exact base; no such claim is made here. Browser qualification and the still-elevated server/HTTP tails remain unresolved acceptance work. The HTTP comparison uses the explicitly identified pre-S2 binary rather than pretending it is a `109efbf4b` CLI build. The brief's three named problems were not exhaustive: arbitrary JSON object fields were the additional data-sized conversion. The nominal 60-second full-suite estimate did not hold on this host.

Outside the named core/device implementation files, the only code edits are minimal `.to_row()` test adaptations in simulator `common/merge_cursor.rs`, `maintain_measurement.rs`, and `read_cut/disclosure.rs`. The requested evidence/README/JOURNAL updates are also included. The working tree is left uncommitted. The existing round-1 evidence above is unchanged.
