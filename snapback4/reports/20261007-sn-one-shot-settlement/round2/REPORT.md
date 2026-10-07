# SN round 2: publication proofs survive unrelated writes, not identity changes

2026-10-08. Round-1 base: `c6217f0eda`. Work stayed in the assigned lane-sn
worktree on eb1000. Nothing pushed or published. The compiler summary design
is unchanged. LLP 3000.023 §11 records the final ordering rules; the round-1
client card and `E_QUERY_RETRY` wording still state the corrected guarantee.

At successful publication, every admitted write whose operation may affect the
query has been observed or failed, or a predictable write is included in a
complete predicted device answer. Dependent custody waits on events online,
within the original 30-second timer, and refuses promptly when known offline.
Other unresolved publication races retain the four-round bound.

## Reviews and first run at the round-1 tip

Read both reviews and their evidence in full:
[Astra review](/home/ccheever/sb4-intent/reviews/sn-r0.astra.md),
[Astra evidence](/home/ccheever/sb4-intent/reviews/sn-r0.astra.evidence/REVIEW.md),
[Grok review](/home/ccheever/sb4-intent/reviews/sn-r0.grok.md), and
[Grok test record](/home/ccheever/sb4-intent/reviews/sn-r0.grok.evidence/test-results.txt).
Grok supplied no separate executable reproduction; its overlapping findings are
covered by Astra's reproductions and its listed client/compiler/server batch.

Before changing production code, copied Astra's four test scripts to
`/tmp/sn-round2-reproductions`, substituting only this checkout's import root.
The originals were not edited. [First-run log](reproductions-before.log):
**17 passed, 8 failed** out of 25.

| Case | Round-1 result |
| --- | --- |
| Facade approves an old candidate after generation-2 discovery | Failed: old answer published before the newly relevant write |
| Unrelated commit at aggregate publication, six tiers | Online arms passed; four local arms exhausted four rounds |
| Same-store POST/observation overlap, with and without generation deployment | All four passed |
| Relevant external commits; online dependent/gapped/replayed receipt controls | All ten passed |
| Compiler helper/branch/authorization closure | Passed |
| Mock malformed footprint | Failed the review's old “pending must block” expectation |
| Store replacement, wasm/process | Both returned a complete prediction before discovery, failing the review's old replacement-answer expectation |

The last three failures use expectations superseded by round 1. They are not
silently counted as passes. The [unchanged-script rerun](reproductions-after.log)
now has **22 passes and those same three obsolete assertions**. Permanent tests
preserve their intended hazards: the mock admits a concurrent write during final
approval; the replacement tests make the earlier write non-predictable and
release the POST after asserting adoption is held. Both binding and subsequent
read assertions run, without the review's early-return environment switch.

The exact 18-file Astra batch was also run at the round-1 tip:
[577 tests: 572 passed, 3 failed, 2 skipped](affected-before.log).
All fourteen prediction-lifecycle failures from round 0 were gone. The remaining
failures were empty-sync delivery and two prediction-replay cases whose parked
change stream reached its transport watchdog during the new custody wait.
File lists are retained in [affected-files.txt](affected-files.txt) and
[custody-files.txt](custody-files.txt).

## Corrections

**Generation and store.** Each online publication and custody predicate captures
installed facts and store identity, and checks the highest discovered generation
again at final publication, after facade approval. Discovery wakes waiters.
Old discovery responses cannot evict newer facts. Restore comparison uses the
request's dispatch floor. The facade interleaving and an independently held late
schema response are permanent `one-shot-generation` regressions.

**Late receipt custody.** Round 1's FIFO identity/schema-adoption guard remains.
The ordinary POST also carries its dispatch store into terminal receipt history,
through failed-save retry, history adoption and recovery, and into the device
settlement transaction. A success from A cannot become a receipt in B: foreign
settlement removes the queued prediction while preserving A's successful
history. The private binding is omitted from public write lookups, closing
results and notifications. Original success sequences and single delivery remain
covered by the overlap and custody suites. Wasm/process tests additionally adopt
a receipt window with an A binding into B and prove it neither changes B's rows
nor leaves a phantom dependency. Existing generation-overlap tests still require
adoption after the POST, and preserve its own success/refusal and receipt adoption.

**Field and authoritative commit evidence.** Admission/settlement and online
contiguous receipt fences preserve the compiler's fields instead of discarding
them. `/sync` and `/changes` reuse the existing bounded transaction recorder to
certify complete `{after, through, writes}` intervals. Updates name fields;
insert/delete effects cover the whole table. Private aggregate effects project
to public owner columns. Legacy, gapped, pruned, oversized or unmapped private
evidence remains unknown; private table names never cross the transport.

One-shots keep separate local-input, unsequenced-change and server-cut proofs.
Published normal sync may narrow by authoritative fields; extra touched tables,
joined scopes, acquisition markers, predictions and staging retain conservative
coverage. Whole server answers can cover relevant changes with their sequence;
composed answers must also retain their local proof. Retained-history routing
survives an unrelated watermark advance only when both proofs are disjoint and
the evaluated watermark covered publication at invocation. Server coverage alone
cannot renew retained rows. Observations retain their existing policy.

The tests cover bursts of five completing receipt commits against history on
all six tiers; field-disjoint changes within a membership table; missing and
gapped proof controls; the six-tier aggregate reproduction; and relevant online
and local server-answer controls.

**Mock and delivery.** Mock handler summaries use the shared validator. Malformed
read or write footprints cannot authorize a concurrent publication. Complete
mock predictions still settle with pending writes. Empty same-cut sync preserves
accepted one-shot delivery debt; a real relevant commit still cancels it. The
prediction-replay test advances the query's 30-second timer explicitly before its
separately parked transport watchdog, without changing product deadlines.

## Verification

Commands run from `snapback4/` unless noted. Client batches use the repository's
six-file runner and its owned-process cleanup. The compiler/guide build uses
`CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0`.

| Check | Result | Evidence |
| --- | --- | --- |
| All `one-shot*`, dependency, publication-session, live-margin, sync-after-call files | 368 passed | [settlement-verified.log](settlement-verified.log) |
| Exact 18-file Astra affected batch | 576 passed, 2 skipped | [affected-verified.log](affected-verified.log) |
| Exact 12-file custody batch | 205 passed | [custody-verified.log](custody-verified.log) |
| Discovery, adoption and ephemeral fencing | 20 passed | [discovery-client-final.log](discovery-client-final.log) |
| Final commit-evidence file, including five further retained review controls | 23 passed | [commit-evidence-final.log](commit-evidence-final.log) |
| Local read, online ordering, pending-write and mock support | 56 passed | [supporting-client.log](supporting-client.log) |
| Compiler settlement + guide | 5 + 113 passed | [compiler-guide.log](compiler-guide.log) |
| `serve::` including public projection and interval-gap regression | 191 passed, 4 ignored | [serve-final.log](serve-final.log) |
| Core revocation classifier | 3 passed | [revocation-final.log](revocation-final.log) |
| Device receipt history and write authority | 3 + 10 passed | [device-receipts.log](device-receipts.log), [write-authority.log](write-authority.log) |
| Typecheck and client build | Passed | [typecheck.log](typecheck.log), [client-build-final.log](client-build-final.log) |
| Wasm budget | 2 passed | [wasm-budget.log](wasm-budget.log) |
| Final rebuilt wasm: overlap, store binding and budget | 30 passed | [final-device.log](final-device.log), [wasm.json](wasm.json) |
| Root `./ref-check --verbose` | 531 documents, 10,553 references; zero errors/unchecked | [ref-check-final.log](ref-check-final.log) |

The two affected-batch skips are the opt-in Following shaped measurement and
an unavailable published 0.2.32 server (`SNAPBACK4_LEGACY_BIN`). The four server
ignores are the suite's existing ignored tests. No failing check is counted as a
pass. Intermediate failures are not qualification results. The private-column
transport regression and public receipt shape regression were found by the
requested broader batch and repaired before commit. Two stale intermediate runners were stopped by exact lane cwd and log
identity; their owned keepers handled cleanup. No other lane's process was touched.

## Wasm and scope

`bash scripts/build-wasm.sh` with locked Binaryen 132 measured **2,135,614 B raw /
645,498 B gzip**, versus round 1's 2,135,336 / 645,448: **+278 raw / +50 gzip**.
The cap is **645,998 B**, exactly **500 B above Linux**, accounting for the
requested headroom and the observed macOS difference of up to 435 B. The cap's
391-byte increase is 50 bytes of implementation plus restoration of 341 bytes
of missing allowance. No macOS build or measurement is claimed. No interpreter
resource ceiling, contract type, compiler summary, or observation policy changed.
`local.ts` remains below 1,500 lines.

Calibration evidence remains outside the repository and is cited in the
[parent report](../REPORT.md). Reviewer test cases were adapted into portable
regressions; builder files were not copied.
