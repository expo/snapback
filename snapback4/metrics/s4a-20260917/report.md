# S4a handoff — stopped at boundary (a)

Base: `9aaa9d922f01340bbcfe827f005ba186d5caf5b4`. No commit, push, tag or publication.

## 1. Files changed

The Rust image-path probe saved 34,781 B gzip, below the 36,000 B stop rule. Only the tested compact codec and format-aware implementations remain.

Core:

- `snapback4/crates/snapback4-core/src/compact.rs`
- `snapback4/crates/snapback4-core/src/compact/de.rs`
- `snapback4/crates/snapback4-core/src/compact/ser.rs`
- `snapback4/crates/snapback4-core/src/ir.rs`
- `snapback4/crates/snapback4-core/src/ir/lane_source.rs`
- `snapback4/crates/snapback4-core/src/lib.rs`
- `snapback4/crates/snapback4-core/src/schema.rs`
- `snapback4/crates/snapback4-core/src/schema/json_contract.rs`
- `snapback4/crates/snapback4-core/src/value.rs`
- `snapback4/crates/snapback4-core/tests/compact.rs`
- `snapback4/crates/snapback4-core/tests/compact_defaults.rs`

Device tests:

- `snapback4/crates/snapback4-device/tests/backend_codec.rs`

Package tooling tests:

- `snapback4/packages/snapback4/test/wasm-budget.test.mjs`
- `snapback4/packages/snapback4/test/wasm-codec-census.test.mjs`

Measurement script:

- `snapback4/scripts/measure-wasm.sh`

Report-only budget:

- `snapback4/metrics/wasm-budget.json`

Documentation:

- `llp/3000.002-end-to-end-resource-bounds.research.md`
- `snapback4/AGENTS.md`
- `snapback4/JOURNAL.md`

## 2. Commands and verbatim summaries

Node commands use `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`; all Cargo and package commands below use `snapback4/` unless explicitly marked root.

**Targeted verification.** Commands below ran from `snapback4/`; full outputs are copied under `/tmp/s4a-stop/`. Each quoted line is verbatim. Core's first whole-crate run predates the second defaults test; the later focused run and blocking suite include both.

`cargo test -p snapback4-core`:

```text
test result: ok. 58 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.78s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.34s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.87s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.25s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`cargo test -p snapback4-device`:

```text
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.59s
test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 283 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 202.45s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 132.30s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.91s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.95s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.34s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`cargo test -p snapback4-lang --test guide --test components --test lowering`:

```text
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 47 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 95.85s
```

`cargo test -p snapback4 --test http`:

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.41s
```

`cargo test -p snapback4-core --test compact --test compact_defaults --test lane_source -- --nocapture`:

```text
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.42s
```

`cargo test -p snapback4-device --test backend_codec -- --nocapture`:

```text
test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.15s
```

`cargo test -p snapback4-core --test compact_defaults`:

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

`node --test packages/snapback4/test/wasm-*.test.mjs`:

```text
ℹ tests 40
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9465.304417
```

`bash scripts/check-release-guard.sh` exited 0: `release guard: ok (web-device-check refuses the wasm profile)`. `node scripts/attribute-wasm.mjs --families --check-families --check-absent` exited 0: `serde family check: ok`; `server-only absence check: ok`. No image-specific wasm tests were added because that path was withdrawn.

**Red before, green after.** Against the first codec with the original format-unaware implementations, `cargo test -p snapback4-core --test compact` was red; adding the format-aware implementations made the same four tests green (`cargo test -p snapback4-core --test compact --test lane_source`). These are regressions exposed by the new format, not claims of broken JSON at the base.

```text
test result: FAILED. 3 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
```

The empty-struct collection test was added before its encoding fix: `cargo test -p snapback4-core --test compact --test compact_defaults -- --nocapture` failed, then the corrected codec passed (`cargo test -p snapback4-core --test compact --test compact_defaults --test lane_source -- --nocapture`).

```text
test result: FAILED. 6 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
```

`node --test packages/snapback4/test/wasm-budget.test.mjs` with the new no-record regression and old production script reported `ℹ tests 2`, `ℹ pass 1`, `ℹ fail 1`; final wasm tooling reports `ℹ tests 40`, `ℹ pass 40`, `ℹ fail 0`. An intermediate census run reported 39/40 because its old LaneSource source-mutant matcher no longer matched the moved attribute; the matcher now targets the mirror and additionally proves that adding Deserialize to its untagged Text mirror refuses. Enforcement itself is unchanged.

**Blocking suite.** From the repository root, `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH; bash snapback4/scripts/test.sh` exited 1. Every Rust target passed, including lifecycle; all build/typecheck/guard/fixture steps passed. The client step selected serial execution under load and had exactly the sandbox browser failure plus four known worker assertions. Verbatim step and client summary:

```text
-- ok: cargo build (93 s)
-- ok: wasm build (5 s)
-- ok: release guard (9 s)
-- ok: package typecheck (2 s)
-- ok: package build (3 s)
-- ok: chat app check (2 s)
-- ok: cargo test (637 s)
-- ok: chat app typecheck (2 s)
-- ok: expo app typecheck (1 s)
-- ok: fixture wrapper tests (28 s)
-- FAIL: client tests (642 s)
== 1 failure(s) in 759 s
   client tests
ℹ tests 681
ℹ suites 0
ℹ pass 673
ℹ fail 5
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 641980.606792
```

`node --test packages/snapback4/test/react.test.mjs` rerun alone again failed at Chromium launch with SIGABRT; no product change is inferred from this sandbox artifact.

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ skipped 0
ℹ duration_ms 479.535667
```

The worker failures were verified against the exact base, not merely attributed to another lane. All five modified tracked core production files were temporarily replaced with `git show HEAD:<path>` contents; untracked compact files remained unreferenced by the base lib.rs. The first base `cargo build --manifest-path snapback4/Cargo.toml -p snapback4` was mistakenly invoked from the root; it built the fenced workspace, but violated the requested cwd rule. I then ran `cargo build -p snapback4` from `snapback4/`, copied that base executable to `/tmp/s4a-stop/base-verification/base-snapback4`, restored the final sources and rebuilt from `snapback4/`. No git checkout/reset/stash was used. `SNAPBACK4_BIN=/tmp/s4a-stop/base-verification/base-snapback4 node --test --test-name-pattern='lost effect lease on the wire|a service mints' packages/snapback4/test/worker.test.mjs`, from `snapback4/`, produced:

```text
ℹ tests 5
ℹ suites 0
ℹ pass 1
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 20290.769416
```

On base `9aaa9d922f01340bbcfe827f005ba186d5caf5b4`, the positive service/session/worker test passes and the queued/failed/sent/running cases all fail with the same actual text as the final full suite: `E_EFFECT_LEASE: effect effect-0000000000000001-0000000000000000 is not held by this live claim; claim it first and use its current token`, against expected `is <state> and not claimed by this worker`. This confirms the brief's known issue on this exact base. Chromium is reported separately as an environment failure, not as a base-verified product regression.


Final root checks: `./ref-check --verbose` exited 0:

```text
ref-check: ok — 483 LLP docs, 9100 refs in 24289 files, 0 errors, 0 unchecked
```

`git diff --check` exited 0 with no output. Changed code is at most 1,369 lines; prior journal bytes are preserved. Final native `cargo build -p snapback4` from the fenced workspace exited 0 after restoring the production sources.

## 3. Requested work not delivered

**Remaining work and lessons.** Boundary (b) image framing, identity API/equality/mismatch checks, store upgrade/retention tests and recoverable code; (c) authenticated/cached /schema negotiation and exposed headers; and (d) wasm/host integration, generation-race handling and web migration tests are not delivered. Neither the no-IR/schema-JSON artifact invariant nor its allowlist/tests ships. README, CLIENT-AND-OPERATIONS and guide codes remain unchanged because the wire did not change. A resumed image lane must explicitly document that a web runtime upgrade combined with a backend-identity change loses retained left history: old typed JSON cannot be decoded to justify retention without restoring the reader the lane removes. Same-identity upgrades must preserve rows/outbox/history; old offline stores need recoverable refusal. None of these migration behaviors is installed by this boundary.


No measured image-integrated SDK/glue artifact, actual IndexedDB disk-byte comparison, browser acquisition/cold-open measurement, or witnesses exist for the probe. String-storage and transfer estimates are explicitly labeled in section 6. The full suite is not green: see sections 2 and 5.

## 4. Out-of-scope touches

No out-of-scope production change remains. The discarded probe briefly touched server cache fields and initializers in `crates/snapback4/src/serve.rs` and `serve_tests.rs` beyond the permitted /schema arm; those changes were removed. The supporting `measure-wasm.sh --no-record` option, its regression test and AGENTS usage line remain. A baseline Cargo command was mistakenly run from root using `--manifest-path`; the fenced-workspace command was rerun correctly, as recorded in section 2. No corpus, contract, ceilings or other forbidden production area changed.

## 5. Verified pre-existing failures

The four lost-effect-lease worker assertions (queued/failed/sent/running) reproduce on exact base `9aaa9d922f01340bbcfe827f005ba186d5caf5b4`, with the same live-claim-token wording; positive worker test passes (1 passed, 4 failed). Base build and test logs are `s4a-base-build.log`, `s4a-base-build-workspace.log` and `s4a-worker-base.log`. Chromium SIGABRT reproduces alone but is reported as a sandbox launch failure, not a base-verified product failure. No other failure is claimed pre-existing.

## 6. Measurements and exact commands

**The measured stop.** `bash scripts/build-wasm.sh`, from `snapback4/`, on the base, then the Rust image-path probe, then the restored codec-only final tree, respectively:

```text
wasm 1531216 B raw, 451283 B gzip (budget 452000: ok)
```

```text
wasm 1365249 B raw, 416502 B gzip (budget 452000: ok)
```

```text
wasm 1532139 B raw, 451129 B gzip (budget 452000: ok)
```

The probe recovered 34,781 B gzip (raw reduction 165,967 B), below the commissioned 36,000 B stop threshold by 1,219 B. I stopped before TypeScript integration and preserved the probe instead of polishing it. This is a Rust-only probe, not a finished or qualified image lane: it included the image/device/wasm path and provisional server work but no completed host integration or image-upgrade scenarios. Its patch, new files, wasm and logs are in `/tmp/s4a-stop/`; `candidate.patch` and `candidate-files/` are review evidence, not intended working-tree changes. The final codec-only artifact is 154 B gzip smaller and 923 B raw larger than the base; that incidental change is not an image-path saving. SHA-256: probe `4598b16f7c3eae92a46b54bf2ce7b9d6e2ed2b00c7860fa3a0dd7ddf9e50cc41`, final `0c99fa131017d16ebcd6d6ed8d7493a51e4f6ff352ff92e9bc811984051f4c00`.

**Attribution.** `node scripts/attribute-wasm.mjs --families` before, on the probe, and on the final tree. The probe's temporary classifier recognized the compact reader and private Absent helper; its exact script is preserved with the probe. No new family exception or enforcement rule ships at boundary (a). Selected requested output follows; full logs retain every family.

Base:

```text
snapback4_core::ir::Expr deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (11744 B)
snapback4_core::ir::Expr serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (1778 B)
DUPLICATE snapback4_core::ir::Scan deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (5845 B), serde map replay (LaneSource first key) (4306 B)
snapback4_core::ir::Scan serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (560 B)
snapback4_core::ir::Stmt deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (31771 B)
snapback4_core::ir::Stmt serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (2371 B)
snapback4_core::schema::ColumnType deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (12317 B)
snapback4_core::schema::ColumnType serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (1527 B)
snapback4_core::schema::Table deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (4275 B)
snapback4_core::schema::Table serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (456 B)
```

Rust image probe:

```text
snapback4_core::ir::Expr deserialize: snapback4_core::compact::de::Deserializer (4068 B)
snapback4_core::ir::Scan deserialize: snapback4_core::compact::de::Deserializer (2319 B)
snapback4_core::ir::Stmt deserialize: snapback4_core::compact::de::Deserializer (12239 B)
DUPLICATE snapback4_core::schema::ColumnType deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (12317 B), snapback4_core::compact::de::Deserializer (5564 B)
snapback4_core::schema::ColumnType serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (1527 B)
snapback4_core::schema::Table deserialize: snapback4_core::compact::de::Deserializer (1857 B)
```

Codec-only final:

```text
&snapback4_core::ir::Scan serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (17 B)
snapback4_core::ir::Expr deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (11744 B)
snapback4_core::ir::Expr serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (1778 B)
DUPLICATE snapback4_core::ir::Scan deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (5845 B), serde map replay (LaneSource first key) (4306 B)
snapback4_core::ir::Scan serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (560 B)
snapback4_core::ir::Stmt deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (31771 B)
snapback4_core::ir::Stmt serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (2371 B)
snapback4_core::schema::ColumnType deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (12317 B)
snapback4_core::schema::ColumnType serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (1527 B)
snapback4_core::schema::Table deserialize: serde_json::de::Deserializer<serde_json::read::StrRead> (4275 B)
snapback4_core::schema::Table serialize: serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>> (456 B)
```

The brief's site census missed `MemoryStore::install` hashing Schema; the probe removed that writer on wasm. `ColumnType` and `Order` also remain legitimately reachable through cursor tokens, independently of Backend: the probe has ColumnType JSON reader 12,317 shallow B / writer 1,527 B (compact reader 5,564 B), and Order JSON reader 730 B / writer 50 B (compact reader 242 B). A resumed lane needs precise cursor exceptions with attribution; changing cursor forms is outside S4a. No such exception is necessary or added to the current JSON artifact.

**Measurements.** All Node/Bun invocations used `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`. `bash scripts/measure-wasm.sh --no-record` passed, including family/absence checks, and emitted the line below without appending a dirty metrics row. The new option is strict, documented in AGENTS, and regression-tested; default recording is unchanged. The report-only budget stays at 452,000 B, the final 451,129 B gzip rounded up to 1,000 B.

```text
serde family check: ok
server-only absence check: ok
{"at":"2026-09-17T21:19:58Z","sha":"9aaa9d922f","dirty":true,"wasm":{"raw":1532139,"gzip":451129,"brotli":352192},"glue":{"raw":11325,"gzip":3047,"brotli":2700},"wasmOpt":false,"budget":452000,"over":0}
```

`S4A_ARTIFACT_DIR=/tmp/s4a-stop cargo test -p snapback4-device --test backend_codec paired_backend_decode -- --ignored --nocapture`, from `snapback4/`, used D1's seven alternating blocks of seven samples, 100 decodes per sample, debug native build. The JSON input has the proposed /schema shape (compiled execution facts, identity and native:null); compact decodes the equal Backend. This measures decode and drop, not acquisition or disk opening. Build contention delayed starting the benchmark; its timed section ran after that build completed.

```text
block 0: JSON 67.999 us/decode, compact 44.831 us/decode
block 1: JSON 61.923 us/decode, compact 49.337 us/decode
block 2: JSON 54.820 us/decode, compact 47.267 us/decode
block 3: JSON 58.391 us/decode, compact 37.950 us/decode
block 4: JSON 59.260 us/decode, compact 44.008 us/decode
block 5: JSON 65.081 us/decode, compact 44.056 us/decode
block 6: JSON 63.989 us/decode, compact 45.860 us/decode
paired median: JSON 61.923 us/decode; compact 44.831 us/decode; change -27.60%
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.53s
```

An earlier diagnostic invocation of the test executable used the smaller typed JSON input (18,472 B) and measured 66.051 / 56.053 us (-15.14%), including one noisy 307 us compact block; it is retained in `s4a-timing-direct.log` and is not substituted for the wire-shaped paired run above.

`python3 /tmp/s4a-stop/measure-transfer.py` uses system `gzip -9 -n -c`; raw/gzip bytes: proposed /schema JSON 23,923 / 3,096; probe image with five-byte frame 8,484 / 1,968; double transfer 32,407 / 5,064. Minimal typed Backend JSON alone is 18,472 / 2,901 and is not the proposed route transfer. Image metadata strings would be hex 16,968 ASCII bytes versus base64 11,312 (UTF-16 code-unit bytes 33,936 versus 22,624). These string sizes favor base64 in the discarded probe, but are not an IndexedDB disk-storage measurement. Browser disk bytes were not measured; no encoding choice ships.

`node /tmp/s4a-stop/measure-sdk.mjs`, from `snapback4/`, runs the existing measure-client logic without its metrics append and with wasm-bindgen glue externalized: online SDK JS 33,149 raw / 9,977 gzip / 8,883 brotli; local-first SDK JS excluding glue 83,981 / 23,484 / 20,578. Standalone wasm-bindgen glue from measure-wasm is 11,325 / 3,047 / 2,700. The SDK script uses Node's gzip and incidentally reports wasm as 455,209 gzip; the authoritative wasm bar uses system gzip and is 451,129. The compressor difference is not hidden or a second artifact. These JS numbers describe the codec-only final tree; no final image-integrated JS bundle exists. Toolchain: rustc 1.97.0 (2d8144b78 2026-07-07), wasm-bindgen 0.2.127, wasm-opt 132, twiggy 0.8.0, Node 24.18.0.


## 7. Incorrect or incomplete brief premises

The fixed-design details that needed correction were the missed schema hash writer, cursor-carried IR/schema types, serde's field-name list including aliases (so it is not the positional count), empty structures requiring an occupied byte for input-bounded collection lengths, and the Text.format helper. The brief's skip counts are broader than the actual backend-reachable IR/schema/maintain set; at this base Auth and Residency derive defaults from empty/false fields, while RouteSpec.wait_ms is a non-empty declared default but has no skip predicate. Tests still cover missing non-defaulted Option, actual and synthetic non-empty defaults, and all 42 predicates in scope. Seven frozen legacy programs are JSON refusals and cannot honestly be reported as JSON/compact successes. The useful outcome is the codec groundwork with explicit boundaries and a measured stop, not a claim that the web backend is now binary.

