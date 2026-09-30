# BN round 4 — preserve simulator lookup diagnostics

Astra's round 3 P2 is fixed. App-container lookup now returns the underlying
`simctl` diagnostic unchanged: a timeout remains `E_WITNESS_TIMEOUT` with
`--timeout` advice, interruption remains `E_WITNESS_INTERRUPTED`, spawn errors
remain `E_WITNESS_PROCESS`, and unsuccessful simulator commands remain
`E_WITNESS_SIMULATOR`. Argument values and tool output remain excluded.

Read rounds 0–3 prompts/reports and the complete reviews, including
[Astra round 3](astra-round3.md). [Scoped context](CONTEXT.md).
Started at `69a12dcceacf7ec05f6271ba237f53dcba595dc5`, fetched and merged
`origin/main` at `0dad042375057d2dad8c429424713986581432e7` first, in
`e112fb6e11b8f7fe7425d74e5bcbdfa4eb6fc642`. Only the journal conflicted;
both append histories were kept. No code conflict required resolution.
[Merge record](merge.txt). Nothing pushed or published.

## Correction and audit

The only production behavior change removes the unconditional “app is not
installed” mapping. The lookup is extracted into `installed_app` so the same
production path can be tested without a macOS platform bypass. Its caller
still propagates the returned error into the existing failed manifest/stderr.
A nonzero simctl exit cannot reliably distinguish an uninstalled application
from an unavailable simulator. Both retain the helper's safe simulator error,
which names `--bundle-id`, `--udid` and the simulator/runtime; the wrapper no
longer invents a cause or recommends rebuilding after a timeout. The existing
Darwin missing-app assertion was aligned with this underlying diagnostic.

Audited the other witness wrappers:

- Data-container lookup, installation and container collection already
  propagate the safe simctl error. Launch retains timeout/interruption through
  `status?`; raw launch prose goes only to its existing log.
- Simulator-list preflight explicitly preserves timeout and interruption.
  Its existing conversion of other tool-availability failures to the documented
  Xcode/runtime setup message is intentional and unchanged.
- Backend and proof context wrappers retain the underlying cause in their
  message. They do not discard it as the app lookup did.
- Native preparation's subprocess wrapper deliberately maps untrusted tool
  output to fixed command-authored reasons; it preserves interruption and
  reports its own preparation deadline. Acquisition retains its existing
  command-error allowlist and distinct query-refusal diagnostics.

No additional timeout-discarding wrapper was found. No SDK, engine, device,
wire or compiler implementation was edited this round; incoming main changes
were kept by the merge. No new LLP decision or guide claim was needed.

## Detecting test and verification

The new Rust regression runs the actual app lookup and subprocess driver in
isolated test children. A fake xcrun supplies six cases: success, timeout,
interruption, unavailable simulator, missing application, and failed spawn.
It checks safe categories/advice and excludes argument/tool-output markers.
The timeout case uses a test-only zero deadline against a sleeping child;
existing product/test deadlines and workloads are unchanged.

Before removing the mapping, moved round 3's expression unchanged into the
helper and ran the test. All five refusal cases failed with `E_WITNESS_APP`;
the successful lookup passed. This is an executable control of round 3's
unchanged behavior, with only the test extraction applied, not a claim that
the old tree already contained this test. [Extraction patch](round3-test-extraction.patch),
[failure log](round3-rust-control.log), [exit 101](round3-rust-control.exit).
The same regression passes after the one-expression correction.

| Check | Result | Evidence |
| --- | --- | --- |
| Node witness acquisition/helper/preparation/native-smoke | **77 passed / 2 failed**, zero cancelled/skipped; 83.709 s | [Log](witness-node.log), [exit 1](witness-node.exit) |
| Rust witness units | 14 passed, 207 unrelated filtered | [Log](witness-rust.log) |
| Portable Rust witness integration | 13 passed, no failures/ignores | [Log](witness-integration.log) |
| Whole guide | 107 passed, no failures/ignores | [Log](guide.log) |
| SDK and CLI builds | Passed on merged source | [SDK](sdk-build.log), [CLI](build.log) |
| Reference validation | 525 LLPs / 10,001 refs; zero errors/unchecked | [Log](ref-check.log) |

All command exit statuses have adjacent `.exit` files. [Failure ledger](FAILURES.md).

**The Node run is not green.** The incoming KA transport's reused-socket retry
interacts with the unchanged acquisition attempt recorder. `more-then-drop`
records four `/sync` attempts while the proxy observes five; `dropped-first`
records three while the proxy observes four. Both runs still refuse and retain
a failed receipt, but the recorder misses the transport's internal retry.
This violates the existing every-attempt requirement; the assertions were not
weakened. The acquisition helper and its test are byte-identical to round 3.
Classification: **ours 0 / incoming-main integration 2 / environmental 0**.

The [focused merged-transport run](merged-transport-focused.log) reproduces
both failures. Keeping the same final binary, helper, tests and all other SDK
modules, a [test-only load hook](round3-transport-control.mjs) substitutes
[round 3's transport](round3-node-fetch.ts), with types stripped into the
[preserved JS](round3-node-fetch.js). Both tests then pass **2/2**:
[control log](round3-transport-focused.log). No product source or built artifact
was changed for this control. This isolates the retry/accounting interaction;
it does not qualify the final transport as passing. A transport/witness
follow-up is needed before claiming every actual HTTP attempt is recorded.
It is left outside the user's “change nothing else” scope.

All 160 token-echo invocations, distinct query-refusal checks and the remaining
Node witness checks passed. No complete Node or full suite was rerun to hide
the failures. To repeat the two transport checks from `snapback4/`:

```sh
node --test --test-name-pattern='reconnect proof rejects (more-then-drop|dropped-first)' packages/snapback4/test/witness-acquire.test.mjs
NODE_OPTIONS="--import=$PWD/reports/20260930-bn-envelope-proof/round4/round3-transport-control.mjs" node --test --test-name-pattern='reconnect proof rejects (more-then-drop|dropped-first)' packages/snapback4/test/witness-acquire.test.mjs
```

Rust integration repeats some unit protocol cases; these are not 27 unique
tests. The new subprocess regression ran on Linux. Darwin-only driver cases
are cfg-excluded here, including the updated missing-app assertion. No actual
simulator, Xcode build, native UI or physical device was qualified.

**Full suite not run**, as explicitly requested for round 4. No fresh heavy
timing claim; prior receipts and the NA-owned apply-performance defect remain.
Existing wasm was hashed and measured, **not rebuilt**: **1,978,828 B raw /
593,233 B gzip**, identical to round 3 and **486 B** below the unchanged
**593,719 B** ratchet. No budget change. [Artifact identities](artifacts.json).

Reproduce from `snapback4/`, with Node 24 on PATH:

```sh
bun run --cwd packages/snapback4 build
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 cargo build -p snapback4
node --test --test-concurrency=3 packages/snapback4/test/witness-acquire.test.mjs packages/snapback4/test/witness.test.mjs packages/snapback4/test/witness-preparation.test.mjs packages/snapback4/test/native-smoke.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4 --bin snapback4 witness
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4 --test witness
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4-lang --test guide
```

One appended journal entry and a local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` record this round.
Nothing pushed or published.
