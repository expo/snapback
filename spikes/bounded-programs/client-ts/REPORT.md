# S3 report — TypeScript client evaluator and WASM measurement

## Verdict

**PASS for D-A's TypeScript twin.** The frozen corpus contains 75 cases, the
hand-written TypeScript evaluator is byte-identical to the Rust expectations on
all 75 cases in Node and JavaScriptCore, and a deliberately corrupted hydration
receipt takes the `replay-mismatch` fallback and serves only the shipped result.
There is no program-name branch or operation-specific opcode in the evaluator.

The measured WASM artifact does not justify replacing TypeScript on web. Even a
size-optimized, read-only Rust hydration-replay subset is 14.0× larger gzip and
1.83× slower to first replay than the complete TS evaluator in this measurement.
The full S1 Rust client remains coupled to SQLite and does not directly build for
`wasm32-unknown-unknown`; that failed build and the narrower successful artifact
are distinguished below.

## What ran

- Rust 1.97.0 on macOS 26.6.2 arm64 generated the corpus with
  `cargo run --bin export_corpus`. The native S1 crate still passes all 7 tests,
  and native plus WASM-target Clippy pass with warnings denied.
- The TS evaluator implements the externally tagged IR over receipt-seeded,
  range-indexed in-memory tables. It explicitly checks i53 arithmetic, compares
  strings by Unicode codepoint, uses a private stable mergesort, and uses ordered
  `Map` state for tables, bindings, deletion counts, and rule memoization.
- Receipt coverage, one-row halo consumption, computed-site `partial`, scoped
  hidden-input verdicts, and eviction-on-rehydrate run through generic read/write
  sites. S3 also corrected the Rust `ClientStore` to consume shipped hidden-input
  verdicts rather than looking for hidden rows during replay.
- `bun src/test.ts` ran every case and the negative hydration check. Strict
  TypeScript checking (`tsc --noEmit`) passed.
- The cross-engine bundle ran under Node 25.9.0 and the macOS system
  JavaScriptCore helper. No `hermes` executable existed on `PATH` or under local
  `node_modules`, so Hermes did not run; nothing was installed system-wide.
- `cargo build --target wasm32-unknown-unknown --release --lib` first failed on
  the direct S1 client because bundled `libsqlite3-sys` requires `stdio.h`, which
  this target does not provide. A target-gated, in-memory Rust replay kernel then
  built from the same IR, value, and schema modules with a raw exported function
  and no `wasm-bindgen` shim. It replays the frozen `scenario-hydrate` case during
  the measured call. This is a real generic read-side hydration replay, but it is
  not the complete mutation/receipt-store interpreter and its size is therefore
  a favorable lower bound for a full Rust/WASM client.

## Corpus and engine coverage

The corpus has **75 cases**: 17 named programs, 6 receipt-store scenarios, 12
explicit value/coverage edges, and 40 deterministic randomized
`(program, args, seed)` cases from fixed seed `0x5eed032901400003`. The 75
individual pretty JSON files total 1,783,026 bytes; the compact embedded manifest
is 731,838 bytes. Every individual file carries the schema, program IR, principal
and pinned context (`now`, `new_ids`, and `read_time`), closure receipt, expected
result/state/range stops, canonical result bytes, and SHA-256 digest.

| Engine / path | Cases passed | Cases failed | Notes |
|---|---:|---:|---|
| Rust corpus generation/local expectation | 75 | 0 | Reference results and states |
| Bun 1.3.12 test path | 75 | 0 | Plus 1 deliberate mismatch test |
| Node 25.9.0 | 75 | 0 | Cross-engine IIFE bundle |
| JavaScriptCore, macOS system helper | 75 | 0 | Same bundle, byte-identical |
| Hermes | — | — | Not present locally |
| Rust/WASM first hydration replay | 1 | 0 | Read-only measured subset, not corpus coverage |

The edge cases cover the UTF-16/codepoint discriminator (`U+E000` versus
`U+10000`, plus combining marks), both i53 boundaries and refused add/multiply
overflow, negative `divmod` with positive and negative divisors, stable sort ties,
`Map` round-trip ordering, empty pages, and `limit`/`hasMore` evidence at the
bound. The client scenarios cover initial hydrate, local send, one delete using
the halo, the second delete becoming `partial` at `thread.messages`, a first
mention becoming `partial` only at `thread.mentionUser`, and revocation rehydrate
evicting 7 rows.

## Divergence and hydration fallback

No semantic divergence was found in any non-corrupted case on either engine.
The exact negative case is `scenario-hydrate`: changing one shipped message body
after export changed the replay digest from
`a8a2a9e27cbb2dc435eb3b9c273d1b1cd4db6a2d36d39ee6c7d5cf45444b382d` to
`5179f8db1fab44306ad391d5f5198ddd80604eacd0469602b3848f4c2e9dfbe8`.
The plan became `replay-mismatch`, emitted a diagnostic, and returned the original
shipped result rather than the recomputed value.

## Size and cold start

Both bundles use size optimization. TS is the minified neutral ESM evaluator
without the corpus. WASM uses Cargo `opt-level = "z"`, LTO, one codegen unit,
abort-on-panic, and stripping. Gzip is `gzip -9`. Cold timing is 30 fresh Node
processes and includes artifact read/import, case parse, instantiate where
applicable, and first hydration replay; the table reports median and p95.

| Evaluator | Raw bytes | Gzip bytes | Cold first replay median | p95 |
|---|---:|---:|---:|---:|
| TypeScript | 20,826 | 7,794 | 3.210 ms | 3.481 ms |
| Rust/WASM read-side subset | 405,991 | 109,024 | 5.877 ms | 6.849 ms |

Relative to TS, the narrower WASM artifact is **19.5× raw**, **14.0× gzip**, and
**1.83× slower** at median first replay. The WASM result is not available in
Hermes in any event, matching D-A's mobile constraint.

## Recommendation on D-A

Adopt D-A's assumed default: keep Rust as the authoritative reference semantics
and ship the generated/hand-written TypeScript evaluator on every client arm,
guarded by this frozen result corpus and hydration replay fallback. The complete
TS evaluator passed 150/150 required Node+JSC case executions at 20,826 raw /
7,794 gzip bytes and 3.210 ms median cold replay; the favorable, incomplete
Rust/WASM comparison was already 405,991 / 109,024 bytes and 5.877 ms. Do not ship
the measured WASM path. Reconsider WASM on web only after a full non-SQLite Rust
client reaches corpus parity and a size gate materially closer to the TS numbers;
the hydration check should remain even then.
