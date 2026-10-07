# SN round 5: prediction replay and discovery refusals

2026-10-08. Base: `b651bcdb01` (round 4; reviewed product code from
`2baacccde1`). Work stayed in lane-sn on eb1000. Nothing pushed or published.

## Reproductions and disposition

Read [Astra's complete round-3 review and controls](/home/ccheever/sb4-intent/reviews/sn-r3.astra.evidence/REVIEW.md)
and [review summary](/home/ccheever/sb4-intent/reviews/sn-r3.astra.md).
Before edits, reran `prediction-replay.test.mjs` and `discovery-auth.test.mjs`
from that evidence directory, substituting only its checkout prefix into a
lane-owned `/tmp/sn-round5-reproductions` copy. The [baseline](baseline.log)
reproduced all four failures: wasm/process returned `predicted-profile` after
the device had rolled back and replayed the message as `Bob`; raw online/facade
published the earlier answer and remained online after real discovery 401s.
The two parked-custody E_AUTH controls already passed.

The original scripts are rerun unchanged after the fix in
[new-review-reproductions.log](new-review-reproductions.log). Portable permanent
regressions are `one-shot-prediction-replay.test.mjs` and
`one-shot-discovery-auth.test.mjs`. The replay regressions also distinguish a genuinely empty settlement transaction
from unchanged row images that still required prediction replay. The replay test delivers the adapter's
committed result exactly once before suspending the wrapper, including process
adapters that only return a result. It holds the POST's continuation through the
facade's final check and checks the real device image, final complete answer,
and transaction certificate. The auth tests also cover old-token 401s after and
during rotation, on both raw online and its facade: the successor stays online,
and query/discovery repeat under its credential.

## Complete settlement transaction, not a single operation

A settlement restores every prediction, changes one outbox entry, then replays
survivors. The settled operation's static write set cannot describe that whole
transaction. The existing `preserved` list certifies authority, not unchanged
values, so it cannot repair this gap either.

Reuse the existing bounded transaction recorder after `predictions::restore`,
`predictions::replay` and `delivery::publish`. A successful `settle` reply carries
`settlement_unchanged: true` only when no prediction rows were restored or
replayed, and that recorder is known with an empty complete net row footprint.
Even equal final rows cannot by themselves certify the overlay metadata used by
provisional reads, so any restore/replay activity stays unknown. All changed rows
are considered, including private maintenance and receipt effects; no public-table projection can drop an implicit
change. Recorder overflow or savepoint rollback is unknown and cannot certify.
This adds one transient boolean to the reply, not a schema, IR, persisted backend
or storage format field. Failed replies never carry an earlier certificate.

Only this exact true marker allows local publication to retain the settled
operation's static footprint, which still conservatively covers that operation's
custody/metadata effects. Otherwise settlement invalidation is unknown. Admission,
prediction discovery, store/generation and final facade fences remain independent.
This intentionally does not attempt to narrow a transaction with changed rows
or prediction activity; even disjoint prediction replay may spend a publication
round. It avoids claiming a complete queue/replay proof from the SDK's asynchronous outbox snapshot.
The compiler summary design is unchanged.

The SDK rejects missing, false, string and object markers in the additional
wasm/process controls in `one-shot-commit-evidence.test.mjs`. Ordinary unrelated
non-predicting settlements without an active overlay retain narrowing;
the existing six-tier aggregate, unrelated-commit and completing receipt-burst
regressions pass. Complete predicted device answers remain permitted online and
offline; dependent custody still waits by event and known-offline blockers refuse
promptly.

The published-device comparator explicitly permits only this affirmative
successful-settlement metadata member, with negative controls for wrong operations,
failed replies and malformed values. Its exact `ok` payload and all query data
remain pinned. The round-4 Linux compatibility witness still verifies the exact
3,100-byte backend pin, 1,359-byte stored schema and 2,389-byte typed device backend
on native and WASM; [fixture.log](fixture.log). No Darwin execution is claimed.

## Discovery is part of the credential protocol

Settlement discovery now captures `credentialRevision` with its dispatch floor,
passes the parsed refusal through the existing `obsoleteRefusal` handler, and
rechecks its read signal. Current non-retryable `E_AUTH` runs `endCredentials` and
retains DK's exact server reason. The shared terminal selector then overrides the
earlier ready candidate, including through the facade. Obsolete rotation refusals
are ignored after waiting for any active refresh. Successful optional metadata is
installed only while credentials remain live and the dispatch revision is still
current. Existing monotonic generation/store publication proofs remain in place.

LLP 3000.023 §11 and its Revised line document both corrections. The existing
client card and E_QUERY_RETRY text retain the same public meaning; neither the
prediction exception nor the exhaustion budget changed.

## Build, bytes and verification

`bun install --frozen-lockfile` completed without changes, then the dependency
check printed [deps-ok](deps.log) before rebuilding. Native and locked wasm builds,
SDK build and TypeScript typecheck passed. Rust commands used `CARGO_BUILD_JOBS=8
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
`local.ts` is **1,499 lines**, `client.ts` **1,341**.

Final Linux wasm: **2,135,891 B raw / 645,680 B gzip**, SHA-256
`6c8e6b709c9c7b8b8d5b6df82486e4276cfb44f3809e8c77a82607bc84bdacb4`.
This is **+277 raw / +182 gzip B** from round 3. Raised the recorded cap by
182 B to **646,180 B**, preserving **500 B headroom** over Linux for the author's
reported macOS difference up to 435 B. No macOS measurement or interpreter
resource ceiling change. [Measurement](wasm.json), [build](build-wasm.log).

Commands, durations and exit statuses are retained in
[client results](clients-results.json), [Rust results](rust-results.json) and
[model results](model-results.json). Ordinary clients use six file slots; the
full app-session model uses its separate serial slot after ordinary clients and
Rust finish. Stored logs omit trailing whitespace.

| Check | Result | Evidence |
| --- | --- | --- |
| All one-shot, dependency, publication-session, live-margin and sync-after-call files | 393 passed | [settlement](settlement.log) |
| Exact 18-file affected client batch, including wasm budget | 576 passed, 2 existing skips | [affected](affected.log) |
| Exact 12-file custody batch | 205 passed | [custody](custody.log) |
| DK session reasons plus app/app-state | 125 passed | [sessions](session-reasons.log) |
| Unchanged round-3 reviewer reproduction scripts | 6 passed | [review](new-review-reproductions.log) |
| Session security, prediction repair, row views and schema compatibility | 63 passed, 7 Darwin-only skips | [replay/compatibility](replay-and-compatibility.log) |
| Original round-0 reviewer scripts | 22 passed, 3 superseded assertions below | [historical reproductions](review-reproductions.log) |
| Device codec, delivery, prediction write sets, repair B and write authority | 164 passed | [device](device-replay.log) |
| Compiler settlement and guide | 6 + 113 passed | [compiler/guide](compiler-guide.log) |
| `serve::` | 194 passed, 4 existing ignores | [server](serve.log) |
| Bounded transaction recorder | 3 passed | [recorder](recorder.log) |
| Full app-session model, 5,000 sequences per tier | 52 passed | [model](app-session-model.log) |
| Exact backend/schema/device-persistence Linux witness | 1 passed | [fixture](fixture.log) |

`./ref-check --verbose` passed: 531 LLP documents, 10,566 references, zero errors
and unchecked references; [references](ref-check.log). The two affected skips
remain the opt-in Following measurement and the unavailable published 0.2.32
binary. Compatibility's seven skips require darwin-arm64; no skipped check is
counted as a pass. Server ignores are the four existing fixture cases.

Original round-0 scripts remain under `/tmp/sn-round2-reproductions`, with only
checkout imports changed. Three historical assertions were explicitly superseded
by round 1: mock complete predictions must block, and two replacement cases
require the new store image before its discovery despite a permitted complete
prediction. They are reported separately, never counted as passes. Corrected
permanent controls force discovery with non-predicting writes and test concurrent
mock admission. [Round-2 disposition](../round2/REPORT.md) explains each case.
[Grok's round-0 review](/home/ccheever/sb4-intent/reviews/sn-r0.grok.md) supplied no
separate executable: all files in its recorded compiler/server/client selection
are included here. Grok's round-3 review is pending with the author; this commit
makes no claim about that review's verdict.
