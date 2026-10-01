**NOT READY — one P1 and one P2 finding remain.**

**P1: Taint bookkeeping can terminally reject a valid write.** The new [wrapper charges](/home/ccheever/sb4-intent/review-ry-r5-astra/snapback4/crates/snapback4-core/src/value.rs:216) can exhaust the mutation’s heap budget before a consumer sets the receipt flag.

Reproduction: in an empty conversation with Alice and Bob, insert a message, then construct an array containing ten copies of `m.recipients` 8,000 times before `require m.recipients > 0`.

On **both memory and SQLite**:

- Device: terminal `E_BOUND` at the default 16 MiB heap ceiling; **outbox empty**.
- Server: accepts the identical mutation, using **8,215,124 heap bytes** and 184,030 steps.

[Array construction](/home/ccheever/sb4-intent/review-ry-r5-astra/snapback4/crates/snapback4-core/src/engine/runner.rs:783) charges the marked value without consuming its dependency on failure. Prediction therefore misses the dependency and drops the intent. This needs a resource-refusal boundary that preserves queue custody for taint bookkeeping failures. [Reproduction](/tmp/ry-r5-astra-arsa8f40/snapback4/crates/snapback4-lang/tests/declarative_receipts/review_r5.rs:27), [isolated-build results](/tmp/ry-r5-astra-arsa8f40/review-isolated-build.log:94).

**P2: Apps without receipts pay substantial, unmetered traversal costs.** [Taint discovery](/home/ccheever/sb4-intent/review-ry-r5-astra/snapback4/crates/snapback4-core/src/value/receipt_taint.rs:39) recursively walks clean collections. The [count path](/home/ccheever/sb4-intent/review-ry-r5-astra/snapback4/crates/snapback4-core/src/engine/runner.rs:1275) performs this repeatedly even when no receipt token exists.

An optimized device-interpreter query with **no receipts clause**, counting the same array 2,000 times, produced these paired medians:

| Array length | Round 4 | Round 5 |
|---|---:|---:|
| 500 | 0.71 ms | 12.03 ms |
| 1,000 | 0.73 ms | 23.50 ms |

Both versions charge **8,005 steps**. This turns constant-time counting into repeated linear traversal; it is not nearly free. Cache compound taint or provide a genuinely disabled path that preserves constant-time clean access. Such alternatives need measurement; I have not established their wasm size. [Benchmark](/tmp/ry-r5-astra-arsa8f40/bench/src/main.rs), [baseline results](/tmp/ry-r5-astra-arsa8f40/bench-paired-baseline.log), [round-5 results](/tmp/ry-r5-astra-arsa8f40/bench-paired-final.log).

The claim checks otherwise produced:

| Claim | Independent result |
|---|---|
| **1. Taint closes receipt-dependent outcomes** | **Refuted by P1.** Earlier reproduction families now pass, including Astra’s eight `share()` cases and compound `min`/`max`/`group` probes. Isolated helper, effect-payload, write and key probes defer correctly. |
| **2. Allocator exemption preserves ordinary prediction** | Confirmed for the exercised sends, creates, joins, stable-id edits, reactions and clean inserted-field controls. No additional over-tainting finding. |
| **3. Generated and suite evidence** | All **146 receipt tests**, including **6,344 new scenarios**, pass. Making `with_receipt_taint` an identity function makes **both generated tests fail immediately** with false successful predictions. The matrix misses P1’s resource boundary. |
| **4. Wasm and final refinements** | Rebuild matches **2,024,561 B raw / 609,750 B gzip and SHA-256**. Budget equals measurement; increases are **3,837 B over round 4** and **11,349 B over the recorded main baseline**. The byte increase itself is modest. |

I audited the retained **0-failure / 1,436-second** suite rather than rerunning it. All **2,339 final source hashes** and the documented ten-file post-suite delta match. Final affected checks passed: **179 core, 110 guide, 66 device and 10 social-starter tests**, alongside the receipt tests. Scratch setup/cache failures were separated from the findings; the new write-loss reproduction was confirmed with isolated build artifacts.

The review checkout is unchanged. Nothing was pushed.