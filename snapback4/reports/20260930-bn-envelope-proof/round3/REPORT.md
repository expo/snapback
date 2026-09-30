# BN round 3 — safe runtime refusals and useful query diagnostics

Both Astra P2 findings are fixed. Base: `9548d90434e3ce3c666d41841db58e9fc002a0cc`,
branch `sb4-intent/bn-envelope-proof`. Read the prior three prompts/reports and
[Astra's complete round 2 review](astra-round2.md). [Context](CONTEXT.md).
Nothing pushed or published.

## Runtime refusals

Unknown `--udid` and artifact-reservation errors name the flag and reason without
printing its value. The same audit covers app selection, simulator subprocess
failures/timeouts, project leases, port conflicts, output inspection and native
preparation. Known iOS flags with unsupported equals spelling name the flag;
unknown flags/positionals never reflect their spelling. Acquisition keeps its
existing value-free parser and runtime output, including unsupported --token-file.

Native preparation's own refusals also omit supplied targets, paths and values.
Unexpected Node setup exceptions become a command-authored error, without a
stack/path dump. iOS child-tool prose remains in its existing separate raw logs;
the Rust driver selects fixed diagnostic categories and never forwards that
prose into a refusal or manifest error. Acquisition continues to drop all server
free text entirely; it creates no separate raw server-text file.

The only diagnostic path exception is an output the user needs to find, labelled
**the command's own log or receipt path**. Reservation failures do not print
supplied paths. Existing iOS evidence inventories and raw tool logs remain
artifacts with their original purpose; this is not an acquisition-style
allowlist of all iOS application evidence.

The runtime controls use the actual production protocol functions on Linux.
They prove the unknown-device refusal and both reservation/input-path failures;
the successful device selection and first reservation remain positive controls.
No real iOS simulator or application was operated this round. The preparation
checks use the existing mocked toolchain fixture, not an Xcode qualification.

## Failed query receipts

The real fixture now distinguishes:

| Request/result | Command-authored advice |
| --- | --- |
| `byOwner(owner: principal)` with `{"owner":7}` | Query arguments rejected; check --args against --query argument types |
| A query whose `require` refuses | Query refused; check --query rules and requirements |
| `byOwner` with another owner's uncovered partition | Query coverage incomplete; choose --query and --args within held coverage |

Only validated codes select these messages: E_INPUT/E_TYPE/E_FIELD select argument
rejection, E_OFFLINE/E_PREDICT select incomplete coverage, and other denials select
query refusal. A read without complete data also reports incomplete coverage.
Malformed or unknown codes use the fixed query-refusal message. Codes themselves
and arbitrary message/family/site/guide/rewrite text are never emitted.

The receipt retains the command's own query name and argument object before the
query executes, including missing/extra arguments, nonexistent queries and other
preflight failures. Automatic selections retain the generated label and locally
computed selection digest. SDK calls receive a separate argument copy. Refusal
stderr still omits caller values; the failed receipt is the place to inspect them.

## Verification

Both requested detecting controls fail on round 2 before implementation edits:

- [Rust controls](round2-rust-controls.log), [exit 101](round2-rust-controls.exit):
  two new tests expose reflected UDID and artifact values. One unrelated existing
  test also selected by the filter passed.
- [Node control](round2-node-controls.log), [exit 1](round2-node-controls.exit):
  the wrong-type query still receives the old coverage advice.

Final checks:

| Check | Result | Evidence |
| --- | --- | --- |
| Node witness acquisition/helper/preparation/native-smoke | **79 passed**, zero failed/cancelled/skipped; 83.854 s | [Log](affected-final.log), [exit 0](affected-final.exit) |
| Rust witness unit tests, eight threads | **13 passed**, 207 unrelated filtered | [Log](witness-rust-verified.log) |
| Portable Rust witness integration/protocol tests | **13 passed**, zero failed/ignored/filtered | [Log](witness-integration-final.log) |
| Whole guide | **107 passed**, zero failed/ignored/filtered | [Log](guide-final.log) |
| Reference validation | 525 LLPs, 9,997 refs, **zero errors/unchecked** | [Log](ref-check.log) |
| Final CLI build | Passed | [Log](build-final.log) |

The Rust integration target includes the protocol tests again; these totals are
not 26 unique tests. Darwin-only driver tests are cfg-excluded on Linux; their
value-reflecting diagnostic assertions were updated but not executed here.

The Node run includes all **160** existing real-token echo invocations, the six
real query failure cases, eleven native refusal-code cases (valid, unknown and
malformed, with untrusted prose in every refusal field), and new native helper
input/exception controls. Successful acquisition/restart, incomplete reconnect,
native module and corrupt-retention checks still pass.

All expected and development failures, including old assertions that expected
reflected values and one exploratory lease-test failure, are retained and
classified in [FAILURES.md](FAILURES.md). No existing test was removed, no timeout
or workload was reduced. The final implementation was unchanged during final
Node verification. No baseline or environmental failure is claimed.

**Full suite not run**, per the round 3 instruction. Implementation edits are
limited to `verbs/witness.rs`, its `witness/` Rust/Node helpers and the packaged
`bin/witness-acquire.js`; the rest are tests/docs/evidence. No shared engine,
SDK, device, wire or compiler behavior changed. No heavy-account timing was
repeated; the earlier receipts and the NA-owned apply-performance defect remain.

Existing wasm was measured, **not rebuilt**: **1,978,828 B raw / 593,233 B gzip**,
SHA-256 `e0652576d56704990bf9cc8d745626de5219aa1c69d864623738888a77a93a50`,
identical to round 2. The unchanged **593,719 B** budget leaves **486 B** headroom.
The measurement uses the build script's `gzip -9 -c` command. No wasm input changed.
[Source/binary/wasm hashes](artifacts.json).

From `snapback4/`, reproduce with:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 cargo build -p snapback4
node --test --test-concurrency=3 packages/snapback4/test/witness-acquire.test.mjs packages/snapback4/test/witness.test.mjs packages/snapback4/test/witness-preparation.test.mjs packages/snapback4/test/native-smoke.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4 --bin snapback4 witness
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4 --test witness
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4-lang --test guide
```

LLP 3000.030 §14 and both relevant guide cards describe the final contract.
One appended journal entry and a local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` record this round.
