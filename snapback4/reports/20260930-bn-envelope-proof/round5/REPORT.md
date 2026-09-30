# BN round 5 — record transport retries

The witness now records every attempt in KA's bounded retry path, with separate
failed and retried samples. Both requested regressions pass on the merged tree
and through the existing round-3 transport control hook. Nothing pushed or
published; full suite not run, as requested.

Base: `53054502fa2f3afca9ca2a17916cd610804d51f4`, branch
`sb4-intent/bn-envelope-proof`. This is round 4's already merged tree, including
KA from origin/main `0dad042375057d2dad8c429424713986581432e7`; no additional
merge or unrelated change was needed. Read rounds 0–4 prompts/reports and their
complete preserved reviews. [Scoped context](CONTEXT.md).

## Small correction

`defaultFetch` accepts a private third options argument with `onRetry`. After
KA's unchanged eligibility checks, it invokes this call's callback immediately
before its one fresh-connection retry. The callback receives no error, server
text, headers or credential values. The transport still uses `globalThis.fetch`
for both sends, snapshots the same request inputs, and never replaces the
process-wide dispatcher. Other callers provide no observer and create no
witness samples. No public client contract, wire, engine or device change.

The witness's initial recorder remains in place. The notification marks that
attempt failed and completes its local clock, latches the transport failure,
then opens a separate sample with:

```json
{"cause":"transport retry after reused-socket reset"}
```

The retry receives its own HTTP outcome and header/body clocks. The receipt's
existing allowlist admits this command-authored cause; remote prose remains
excluded. A successful retry cannot erase the first failure or yield a passing
proof. LLP 3000.030 §14 records this boundary. The guide's existing requirement
of no failed attempts still applies; no guide claim or authoring form changed.

## Detecting controls

Before edits, the two original tests reproduced round 4's failures, exit 1:
[baseline log](baseline-focused.log). Both refused correctly but undercounted.
The post-fix [focused run](focused.log) passes all eight selected checks,
including the transport callback's success/failure/no-retry cases and caller
isolation. The complete Node witness run independently passes the same faults.

| Transport / fault | Proxy observes | Receipt records | Result |
| --- | ---: | ---: | --- |
| KA, more-then-drop | 5 | 5 | Refused; both failed sends recorded |
| KA, dropped-first | 4 | 4 | Refused; both failed sends recorded |
| KA, drop-once | 4 | 4 | Refused despite validated/applied retry |
| Round 3, more-then-drop | 4 | 4 | Refused; no invented retry |
| Round 3, dropped-first | 3 | 3 | Refused; no invented retry |
| Round 3, drop-once | 3 | 3 | Refused; no transport recovery |

Round 3 uses the unchanged [round-4 control hook](../round4/round3-transport-control.mjs)
and [preserved transport](../round4/round3-node-fetch.js), with the current
helper, CLI and all remaining SDK modules: [control log](round3-transport-focused.log).
It ignores the optional third argument. No product file or built artifact was
swapped or reverted for this control. [Extracted receipt attempt samples](attempt-samples.json)
retain both transports' counters, outcomes, clocks and causes; these are samples
from the tests' receipts, not complete acquisition receipts or timing benchmarks.

The more-then-drop assertion now locates its successful `more: true` page before
all subsequent failed sends, instead of assuming it is penultimate. Equality
with the proxy count is unchanged. Added assertions check the failed original,
null header time, retry cause only on the additional send and separate clocks.
The new drop-once case proves a recovered reset still refuses. Transport tests
exercise real resets, callback counts on successful and failed retries, and
concurrent observed/unobserved callers. Host fetch instrumentation sees every
send, receives no private observer option, and the global dispatcher is unchanged.

## Verification

All post-fix checks pass, on unchanged implementation source throughout the
checks. The first Node runs overlapped Cargo rebuilding the CLI; final artifact
inspection disproved an initial assumption that its bytes matched round 4.
Those passing runs remain in the `*-initial.log` and `.exit` files. Node witness,
transport and both focused controls were then rerun after all builds ended,
against the stable CLI identified in artifacts.json. No Rust source changed.
Adjacent `.exit` files retain each command's exit status. Saved logs normalize
trailing whitespace only.

| Check | Result | Evidence |
| --- | --- | --- |
| Node witness acquisition/helper/preparation/native-smoke | 80 passed, zero failed/cancelled/skipped | [Log](witness-node.log) |
| Node transport, all keepalive and retry files | 127 passed, zero failed/cancelled/skipped | [Log](transport-node.log), [nine files](transport-files.txt) |
| Rust witness units | 14 passed, 207 unrelated filtered | [Log](witness-rust.log) |
| Portable Rust witness integration | 13 passed, no failures/ignores | [Log](witness-integration.log) |
| Whole guide | 107 passed, no failures/ignores/filters | [Log](guide.log) |
| SDK build / typecheck | Passed | [Build](sdk-build.log), [types](sdk-typecheck.log) |
| Reference validation | 525 LLPs / 10,002 refs, zero errors/unchecked | [Log](ref-check.log) |
| Round-3 transport control | All three selected faults pass | [Log](round3-transport-focused.log) |

The Node witness run includes all 160 real-token echo invocations and existing
query diagnostics, native module, coverage corruption and preparation controls.
The transport run includes all 18 keepalive retry cases, the Node QoS regression,
HTTP headers/TLS/held responses and headless Chromium's 72 idle-boundary reads,
as well as asset/upload/per-row/expiry retry files. The ordinary idle-retirement
case reports no selected-socket pause or error; real reset tests exercise the
retry itself. No claim that the ordinary idle test forced a reset.

Rust integration repeats some unit protocol cases; these are not 27 unique
tests. Tests ran on Linux, with the rebuilt, unchanged-source CLI (identity
in [artifacts.json](artifacts.json)). Darwin-only cases remain cfg-excluded;
mocked preparation is not a simulator or Xcode qualification. No native UI,
physical device, new heavy-account timing or complete-suite claim.

[Failure ledger](FAILURES.md) preserves the expected baseline reds and setup
lookup/path errors. Final test failures: **ours 0 / inherited 0 / environmental 0**.
No tests were removed, timeouts increased or workloads reduced. The full suite
was omitted by the explicit round-5 instruction despite the small shared Node
transport edit; no other shared implementation was changed.

Existing wasm measured and hashed, **not rebuilt**: **1,978,828 B raw /
593,233 B gzip**, SHA-256
`e0652576d56704990bf9cc8d745626de5219aa1c69d864623738888a77a93a50`.
It is identical to round 4, **486 B** below the unchanged **593,719 B** ratchet.
No wasm input or budget changed. Source, CLI, built transport, control and wasm
identities are in [artifacts.json](artifacts.json).

From `snapback4/`, with Node 24 on PATH:

```sh
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
node --test --test-concurrency=3 packages/snapback4/test/witness-acquire.test.mjs packages/snapback4/test/witness.test.mjs packages/snapback4/test/witness-preparation.test.mjs packages/snapback4/test/native-smoke.test.mjs
node --test --test-concurrency=3 packages/snapback4/test/node-transport.test.mjs packages/snapback4/test/keepalive*.test.mjs packages/snapback4/test/asset-retry.test.mjs packages/snapback4/test/expiry-retry-watch.test.mjs packages/snapback4/test/per-row-retry.test.mjs packages/snapback4/test/upload-retry.test.mjs
node --test --test-name-pattern='reconnect proof rejects (more-then-drop|dropped-first|drop-once)|socket reset:|retry observation' packages/snapback4/test/witness-acquire.test.mjs packages/snapback4/test/keepalive-retry.test.mjs
NODE_OPTIONS="--import=$PWD/reports/20260930-bn-envelope-proof/round4/round3-transport-control.mjs" node --test --test-name-pattern='reconnect proof rejects (more-then-drop|dropped-first|drop-once)' packages/snapback4/test/witness-acquire.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4 --bin snapback4 witness
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4 --test witness
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4-lang --test guide
```

Reference validation runs `./ref-check --verbose` at repository root. One
append-only journal entry and the local commit carry this round; the commit
includes `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing pushed or published.
