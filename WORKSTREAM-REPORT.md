# Integration 8 — HS complete, with corroborated baseline browser red

Base: `f9e40ef515`; branch: `sb4-loop`. HS merge: **`3e0f0c3bfc`**,
conflict-free `git merge --no-ff sb4-w10-hs`. No origin push or publication.
Only the requested Mac verification ref is transferred; the reused Mac
worktree is `~/projects/snapback-integ6`. Other existing worktrees are untouched.
No simulator boot. A separate clean baseline checkout was created for the
explicitly permitted inherited-red comparison.

## Changes and commits

- `3e0f0c3bfc`: merge HS's crate-owned identity/stamp and pre-open headers,
  canonical admission/public compatibility metadata, DOM-free structural
  declarations, explicit starter Node types, and eight independent HS reviews.
- `2a82fb7cd8`: route both new typed header serializers through the existing
  core codec funnel. The full census found the real regression; all 27 codec
  checks now pass. No allowlist or runtime ceiling expansion.
- `d140a0b0d2`: verbatim independent Muse and fresh Codex high-effort codec
  repair reviews, both READY, with provenance under `llp/reviews/`.
- `b00a0452e2`: describe diagnostic sidecars in prose instead of bare suffixes
  misclassified as unshipped file references. Full executable Guide: 120/120.
- `17d1e6fa95`: update the budget test's bindgen double to emit declarations
  processed by HS. Keep all budget/optimizer/stamp assertions; additionally
  check that free() remains and optional Symbol.dispose is removed. Both tests pass.
- `dbb8cc5773`: measured budget **699,231 B = 698,731 B gzip + 500 B**.
- `28d890185f`, `9c04f722c6`: preserve unrelated loaded timing/browser failures
  in open tickets, with additional baseline evidence in the final records.

Orientation: LLP 3000 (fence and measurement/custody), LLP 3000.001.000
(crate identity, canonical stamp, auth-first predecode compatibility), and
LLP 3000.002 (shared codec and artifact census). The append-only JOURNAL
records every repair and the measured budget. No Draft RFC acceptance is asserted.

## Root dependencies and checks

Installed frozen root dependencies. The default isolated Bun layout exposed
workspace package-resolution failures; reinstalling with **Bun 1.4.2,
`--frozen-lockfile --linker hoisted`**, as used in Integration 7, resolved them.
Restored the five executable-mode changes Bun made. No root source repair
was necessary. `scripts/check-generated-artifacts` passes and populates ignored
legacy demo outputs. These Node-only checks need no root Rust or Ibex bootstrap.

- `node scripts/check-inventories.mjs`: **PASS** — 365 package tests,
  35 script tests, 31 demos/catalog entries, 487 publication leaves,
  162 Guide pages and 1,937 snippets.
- `node scripts/check-guide.mjs`: **22 PASS**, no failures/skips/preconditions;
  121 inherited warnings. No unresolved root red needs a baseline exception.
- `./ref-check`: **543 LLPs / 11,731 refs / zero errors or unchecked refs**.
- `node scripts/docs-budget.mjs`: **PASS**, README 320/320 and the exact
  first-screen test runs once.

## Linux qualification

The exact requested five-crate command passes with **RUST_TEST_THREADS=4**:
**5,852 captured passes / zero failures / 41 existing ignored**, across
369 summaries (including nested fixture output). Raw logs are authoritative.
The ordinary command was also run without that override. Initial merge source
failed only the sidecar-reference Guide test, subsequently repaired; the first
repaired-source default-thread run failed only a loaded timing assertion.
The final four-thread run retains every assertion, case and work count.

- Full executable Guide: **120/120 PASS** after the prose repair.
- Package setup, rebuilt repaired wasm, package build and typecheck: PASS.
- Fixture wrapper: **9/9 PASS**.
- Authoring census unchanged: **718 entries / 409 mutation occurrences /
  89 private write sites**.
- Delivery census unchanged: **213 sites**, exact classifications and await
  boundary match; complete delivery fault matrix passes in the client pool.
- Codec census: **27/27 PASS**. Strict serializer-family/absent-code audits PASS.
- Difftest `run --seed 0 --cases 20000 --workers 8`: **PASS**, 1,163,097
  executions, zero disagreements, unexpected errors or time-limited workers.

All **375 ordinary client files** ran twice at 24 slots, Node 24.13.1.
Initial pool: 373 files pass, two fail (stale budget fixture, quote-jump browser).
Corrected pool: **374/375 files pass**, 7,334 passed test records / 3 failed
records / 56 platform skips. Its sole red is the pre-existing quote-jump geometry
assertion described below; failed parents account for the three records.
The repaired budget file passes in this complete second pool.
Both full-default-count serial models pass: **81/81**, zero skips/failures.
No seed, work count, pixel, timing, arrival or guard bound was reduced.

## Mac qualification

Repaired runtime source **`d140a0b0d2`**, Node 24.19.0, default
`TMPDIR=/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/`,
ulimit **65,536**, requested
`SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33`:

- Frozen install, CLI/wasm/package builds: **PASS**.
- `bash scripts/build-xcframework.sh`: **PASS**. Both iOS slices export
  `sb4_engine_info`; `otool` and byte inspection confirm the wasm-only
  `snapback4.engine` section is correctly absent.
- Integration 6 Swift compile, generic iOS Simulator destination,
  `ARCHS=arm64`, Release, code signing disabled: **BUILD SUCCEEDED**.
  Compilation only; no simulator boot.
- `cargo test -p snapback4`: **PASS** with default TMPDIR and required limit.
- HS's four touched client files, plus schema-capabilities and worker-regressions:
  **6/6 files / 113/113 tests PASS**, zero skips/failures.

Initial merge qualification also passed; both runs are archived. Scoped Git
Rust/SDK-runtime/build inputs at the Mac source equal final integrated inputs
(**2,028 files**, digest in `runtime-input-equality.json`). Later differences
are prose, the budget test double, tickets and records; no native/SDK runtime
repair occurred after Mac qualification.

## Wasm

Final clean Linux artifact: **2,294,137 B raw / 698,731 B gzip /
528,123 B brotli**. Mac: **2,294,460 B raw / 698,592 B gzip**.
Linux gzip grew **345 B** versus Integration 7's 698,386 B; budget
**699,231 B** is the measurement plus the requested **500 B headroom**.
The budget's reason records this whole-artifact comparison without attributing
marginal bytes to individual features. The second clean measurement at
`b00a0452e2` confirms the same bytes against the new budget.

## Corroborated inherited failures and disposition

**Quote-jump browser remains open.** Both Linux pools reproduce the unchanged
online visible-position assertion: **296 versus 264**. The first pool also
observed a 122-second anchored-read timeout, which did not recur in the second.
The integrated full file passes alone, **38/38**.

A new clean detached **`f9e40ef515` checkout** passes that file alone, 38/38;
four concurrent complete copies reproduce exactly **296 versus 264**:
one failed copy, 149 passed / 3 failed records across four. Before/after tracked
status is empty. Baseline execution uses qualified **published 0.4.25** SDK,
wasm and Linux binary; Git proves publication source `a0bb11bde6` runtime/build
inputs equal `f9e40ef515`. Frozen baseline dependencies are installed. No
current-branch runtime artifact is used. Source equality, artifact hash, commands,
clean status and both runs are archived in `baseline-artifacts.json` and logs.
Leave `issues/20261013-snapback4-quote-jump-visible-position-flake.md` open.
The full pool is **not** relabelled green by the scoped passes.

**Loaded changes-latency assertion remains open.** One default-thread Rust
rerun observed 591.097 ms outside engine/wait against its 600 ms assertion.
Its unchanged test/implementation pass alone and in the complete bounded
battery. Preserve the real red under
`issues/20261013-snapback4-changes-latency-load-timing.md`; no bound is relaxed.

All requested work and execution is complete. Only these corroborated unrelated
follow-ups remain open. Superseded red runs and the preliminary driver result
are retained separately; `verification.json` names the qualified results and
known exception explicitly. Evidence: `snapback4/reports/20261013-integration8/`.
No full `scripts/test.sh`, origin push, publication, or other existing worktree
mutation. Cargo qualification commands disable incremental/dev/test debug output.
