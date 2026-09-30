# BN round 2 — allowlist witness output

Both Astra credential leaks are fixed. The acquisition witness no longer tries
to recognize token encodings: it emits a deliberately selected receipt and
command-authored diagnostics. **Server free text and server codes are dropped
entirely; no separate raw-text file is written.** Caller-supplied request labels
come from the caller's copy, never the server's reflection.

Base: `7d1d7dbc6e7ff851f205786378d4ada3d5f75304`, branch
`sb4-intent/bn-envelope-proof`. Read both prior prompts/reports and the complete
[Astra round 1 review](astra-round1.md). Governing constraints and scope are in
[CONTEXT.md](CONTEXT.md); the decision is recorded in LLP 3000.030 §14 and the
bounds guide. Nothing pushed or published.

## Corrections

**Astra P2, reflected encodings.** The receipt projection admits local elapsed
clocks, locally counted events, native SQLite residency measurements, booleans,
fixed command vocabulary and command-computed digests. HTTP status becomes
`ok`, `refused` or `unavailable`; arbitrary HTTP/server values are not copied.
Server refusal codes are dropped too, a stricter subset of the required
`^[A-Z][A-Z0-9_]*$` condition. SDK/native error prose is replaced with fixed
command errors; only errors constructed by the witness can carry its own prose.
Native child stderr remains suppressed. Missing/unknown query arguments never
print either the schema's field name or a caller argument value.

Receipt **format 2** makes the output boundary explicit:

- `principal`, URL, explicit query and args use the command's own caller input.
  Query execution gets a separate copy of the arguments. Automatic selection
  prints `automatic device query`, with a locally computed selection digest.
- `groupsByTable` and `residency.tables` use locally computed SHA-256 keys of
  UTF-8 `JSON.stringify(["witness-table", tableName])`. Hash the application's
  known table name to locate its count; table/group totals still are not chat
  counts. Table rows and bytes are computed by the local native inspection.
- Raw store identity, generation, watermark and server position stay private
  for the unchanged comparisons. Public state and position digests are computed
  locally with the domains documented in the LLP. Supplied hash fields are
  never copied.
- **Server-Timing, serverMs and serverSyncMs are removed.** Even a syntactically
  numeric server header can carry a reflected credential. This follows round
  2's rule that emitted numbers must be computed by the command and supersedes
  the original server-time reporting requirement. Local header/body clocks,
  acquisition, first answer and separate restart coverage timings remain.
- Unknown fields are absent from receipts. Failed proofs still save their
  partial run and attempted requests. Existing completion, native publication,
  offline equality and zero-event reconnect guards remain in place.

**Astra P2, credential-bearing flags.** Acquisition accepts `--token=VALUE`
(and equals spelling for every existing valued flag), including values with
additional `=` characters. Duplicate detection uses the canonical flag name.
Unsupported `--token-file` spellings are refused without values. Unknown flags,
positionals, missing values, duplicates and boolean-equals errors never quote
argument values. iOS still refuses equals spelling, now without reflecting it.
A raw bearer reused in a non-secret argument is refused before receipt creation.
Runtime refusal stderr also omits the caller's artifact path; it says that the
receipt was saved in the artifacts directory.

## Tests and detecting controls

The echo proxy obtains a **real session token** and exercises eight forms:
raw, lowercase hexadecimal, uppercase hexadecimal, base64, base64url,
uppercase percent escapes, lowercase percent escapes, and SHA-256.
For each form, ten scenarios run in JSON and text modes (**160 invocations**):

- A passing acquisition/restart reflects the token through the automatically
  selected query name, table names/keys, row content, store identity and extra
  response metadata. This reaches a real native SQLite store and produces a
  passing proof with one held row, so a generic early refusal cannot pass it.
- Missing schema argument names, mismatched probe viewer, malformed schema and
  sync metadata, malformed native acknowledgements, and supplied native hashes
  exercise the inspection/SDK/native error paths.
- Refusal envelopes at probe, schema and sync put each form in code, message,
  family, site, guide and rewrite. Extra principal/query/args/hash fields and
  keys are echoed on responses as well. A numeric sentinel in server timing
  and metadata must also disappear.

Every scenario checks stdout, stderr and acquire.json for every token form,
checks pass/fail, and confirms the artifacts directory contains only the
receipt. Separate checks preserve the caller's query/args/principal, authenticate
with equals-token syntax, and cover acquisition and all iOS flag refusals,
including token-file and positional values.

Using the exact round 1 helper from `git show 7d1d7dbc6e:...` and the preserved
pre-change debug binary, **all three primary detecting controls fail**:
uppercase-hex echo leaks to stdout, acquire equals-token refusal leaks to stderr,
and iOS equals-token refusal leaks to stderr. [Log](round1-controls.log),
[exit 1](round1-controls.exit). A fourth control independently detects the
artifact argument in runtime refusal stderr: [log](round1-runtime-control.log).
No real credential values are printed by the detecting assertions.

Final verification:

| Check | Result | Evidence |
| --- | --- | --- |
| Node witness acquisition, helper, preparation and native-smoke fixtures | **76 passed, 0 failed, 0 cancelled, 0 skipped**; 81.911 s | [affected-final.log](affected-final.log), [exit 0](affected-final.exit) |
| Rust witness units/protocol | **11 passed**, 0 failed; 207 unrelated tests filtered | [witness-rust.log](witness-rust.log) |
| Whole guide | **107 passed**, 0 failed, ignored or filtered | [guide.log](guide.log) |
| Reference validation | 525 LLPs / 9,997 refs, **0 errors, 0 unchecked** | [ref-check.log](ref-check.log) |
| Final CLI build | Passed | [build-final.log](build-final.log) |

The Node total includes all **40 acquisition cases** (27 existing and 13 added)
and 36 other witness cases. The final check uses the final helper, test and built
CLI; no implementation changed during it. The initial test harness error and
every expected red control are recorded in [FAILURES.md](FAILURES.md).

The full `scripts/test.sh` suite was **not run this round**, as authorized:
implementation changes are confined to the acquisition helper and the iOS
witness flag parser. Other edits are their test, guide, LLP, report and journal.
No shared engine, SDK, wire protocol, residency implementation or device code
outside the witness command changed. No heavy-account timing was repeated;
round 0/1's historical receipts remain unchanged format-1 evidence. The known
process-device apply performance defect and NA ownership remain documented.

## Wasm and reproduction

Existing wasm is **1,978,828 B raw / 593,233 B gzip**, SHA-256
`e0652576d56704990bf9cc8d745626de5219aa1c69d864623738888a77a93a50`, identical
to round 1. It was measured and hashed, **not rebuilt**: this round changes no
wasm inputs. The unchanged **593,719 B** ratchet leaves **486 B** headroom.
Source, test, current binary and control binary identities: [artifacts.json](artifacts.json).

From `snapback4/`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 cargo build -p snapback4
node --test --test-concurrency=3 packages/snapback4/test/witness-acquire.test.mjs packages/snapback4/test/witness.test.mjs packages/snapback4/test/witness-preparation.test.mjs packages/snapback4/test/native-smoke.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4 --bin snapback4 witness
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4-lang --test guide
```

The regression logs used a temporary copy of the round 1 helper inside the
package's bin directory so its relative SDK imports resolved, and
`SNAPBACK4_ACQUIRE_HELPER` pointed only the control invocations at it. The old
binary is `/tmp/bn-r2-round1-snapback4`. The temporary helper was removed; current
source was never reverted. All test backends/proxies/stores were owned by the
fixtures and cleaned up. No simulator or external application was operated.

One appended journal entry and a local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` record this round.
