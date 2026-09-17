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
