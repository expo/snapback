# RY round 1 — predicted history with settled receipt accounting

Date: 2026-09-30. Branch: `sb4-intent/ry-receipts-allocation`.
Round 0: `f8598a7f7dacf932570ff67f190a489894fd95ed`.
Merged `origin/main` at `0b8ac4ab8884f5d5948696d31ced4891707ae602` first,
in merge commit `910b9b90ee`. The only conflicts were the LLP 3000.028 revision
header and appended journal text; both sides are preserved. Round 0's prompt
and this round's prompt are retained here. Nothing pushed or published.

## Result

Ordinary history once again contains offline/unsettled sends immediately, with
`pending: true`. A provisional position is above the greater of the held group
counter and the highest held message position, including prior predictions.
The existing ordered SDK outbox, persisted base images and replacement rules
preserve compose order, survive reopen, withdraw refusals and replace positions
at settlement. Another member's earlier commit can move a row. No application
replacement outbox or history merge was added.

Server allocation, transactional rollback, write-id replay, membership-index
recipient snapshots, join/rejoin floors and run retirement remain intact.
Provisional inserts never advance the scope counter. Their count is a zero
placeholder and their join floor is provisional; neither is receipt evidence.

A compiler-only, table-typed `ReceiptSettled` primitive checks overlay provenance,
including rows newly written in the same interpreter invocation. The generated
projection returns null for a pending message and skips pending recipients.
`receiptMember`/`progress` return null for a pending membership; progress excludes
pending messages from its ahead page. The existing SDK collector excludes all
predicted rows. Accounting therefore cannot consume a guessed ordinal or member
floor even if a caller directly queries a projection or queues a report.
Provisional accounting fields use the existing sequence-dependency tracking, so
a refusal depending on a guess does not become a terminal local rejection.

Scope creation predicts the conversation and creator membership together;
member insertion and sends into a predicted conversation also predict with the
ordinary acquired-coverage and authority proofs. These cases keep durable
queue custody without a predicted row:

- Missing acquisition/authority witnesses: the device cannot justify a row.
- No representable safe-integer position above held ordinals.
- Existing membership updates/removals: predicting them would change the settled
  recipient requirements of old messages.
- Delivery, compaction and seen: these must only change settled receipt state.
  The runtime enforces this independently of advisory classification metadata.

Seen intent still queues durably. Pending row metadata and LLP 3000.031's existing
existence classifier remain unchanged. Nonempty predicted history is present;
pending membership nulls cannot prove settled absence. Generated receipt
projection/progress result types now include null for those provisional cases.
The capability and fingerprint domain advance to `declarative-receipts-v4` /
`receipts.v4`; manual/no-clause behavior stays compatible.

The social starter schema remains **223 lines**, down from **231 before RY
round 0** (8 lines removed), and from the pre-RX manual recipe's **294**. Its
allocation/count/floor code remains removed. The round 0 resolver's durable
pending-list restoration guard remains useful when creation cannot predict.

## Orientation and scoped corpus audit

Applied `llp-orient` from `skills/llp-orient/SKILL.md`, read-only before editing.
The root/brief are LLP 3000 and LLP 2000.000. Applicable source refs and current
LLPs: 3000.022 §§2–6/14 (success is coverage, accounting ownership and bounded
compaction), 3000.001's replacement/replay rule, 3000.015 §2 (provisional sequence
semantics), 3000.028 §8 (DM custody), and 3000.031 §1.1 (existence).
No Snapback 1–3 bootstrap/inventory/proof gates apply inside this fence.

Updated LLP 3000.022 §14, LLP 3000.028 §8, and the compiled receipts/social guides
with the implementation. The receipts card is 313/350 lines. The read-authority
census changes only the receipts card's add/send eligibility and seen/leave
server classification; runtime read-authority tests remain intact. The report
does not claim arbitrary forged raw-IR descriptor admission or large-backlog
throughput qualification. Hand-off: none. The fleet inventory was absent on
this host; checks ran locally on the pinned tools.

## Verification

Affected commands run from `snapback4/`:

| Check | Result | Log |
| --- | --- | --- |
| Declarative receipts | 66 passed | `receipts-guide-final.log.gz` |
| Whole guide | 107 passed | `receipts-guide-final.log.gz` |
| Device delivery, read authority, sequence and disclosure | 127 passed | `device-final.log.gz` |
| Core sequence and disclosure | 46 passed | `core-affected.log.gz` |
| Language delivery, clause, integration and replay conversion | 27 passed, 1 existing ignore | `lang-final.log.gz` |
| Final social starter | 10 passed | `starter-final.log.gz` |
| Social starter and real-browser routes | 34 passed | `starter-browser-second.log.gz` |
| CLI build, SDK build, docs budget | Passed | retained logs |
| `./ref-check --verbose` | 525 LLP docs, 10,025 refs in 30,696 files; 0 errors, 0 unchecked | `ref-check-final.log.gz` |

The existing 2,560-transition server/device allocation model and eight-thread,
80-message concurrent-writer test still pass. The new model adds **960
transitions** (8 seeds × 60 steps × 2 stores), retaining multiple provisional
sends while applying remote sends, out-of-order deliveries and seen reports.
After each step it compares member/progress and settled projections with the
server, asserts null receipts on predicted messages, verifies compose order
above committed history and inspects actual SDK debt. Two-device offline
witnesses now require immediate prediction, persisted prediction after reopen,
interleaved reconnection using the original minted row IDs, server write-id
replay, exactly-once convergence and final read receipts.

Both stores also exercise server refusal after offline membership revocation:
the predicted message disappears at settlement, and messages, runs, counter,
member progress and SDK debt leave no trace. Creation/join witnesses require
immediate conversation/creator membership, pending-message history in the new
scope, null provisional member/progress reads, and unchanged settled receipts.
Removing all advisory classifications still permits sends and refuses predicted
receipt reports. Template-call capture controls include the new settlement
primitive. Manual receipts retain their prior prediction behavior.

The added social starter wasm scenario reads **ordinary `api.history`** while
fully offline, checks pending metadata and `existence: present`, then lets
another member win ordinal 1. Reconnect yields exactly `[remote, first, second]`
at positions `[1,2,3]`, all settled with one recipient each. Real SDK delivery and
seen reporting turn the two offline messages delivered then read. Existing
native/web DM tests require predicted creation, and assert a pending
`receiptMember` null has `existence: partial`.

## Wasm

**2,001,463 B raw / 600,268 B gzip**, SHA-256
`ad8eef28221cd21bcecda73e6b8d88f674e3973d56c8fc99e4bfd7ca57a98332`.
Rust 1.97.0, wasm-bindgen 0.2.127, locked Binaryen 132.0.0; Node 24.13.1,
Bun 1.3.14. `artifacts.json` retains the measurement. Gzip uses the build script's
`gzip -9 -c <filename>` invocation.

The inherited 597,386 B ratchet requires **+2,882 B**, set exactly to measured
600,268 B without slack. The device now executes provisional suffix allocation,
returns assigned insert fields, tracks provisional dependencies, checks receipt
settlement provenance and prevents provisional progress/member changes. Server
allocation and membership index counting stay server-only. This is a whole
artifact delta, not a per-feature byte attribution. No runtime ceiling, test
count, timeout or concurrency policy changed.

## Development failures

Every failed development check is **ours**, corrected. The complete per-log
inventory and reasons are in `development-failures.json`. It records the two
missing exhaustive compiler arms, the six initial new-fixture argument errors,
the obsolete prediction expectation, the receipt-only census update, the new
wasm fixture's missing explicit sync, two incorrect command names, two incorrect
output paths, and three intermediate over-budget wasm builds. No affected
check has an unresolved failure. Baseline/environmental classifications for the
full suite are recorded separately below.

## Full suite

`scripts/test.sh` ran **exactly once**, exit **0**, with no overrides. Exact
summary:

```text
== 0 failure(s) in 1324 s
```

Rust: **4,453 passed**, 33 existing ignores. Clients: **5,577 passed**, 10 existing
skips, no failures/cancellations. Fixture wrappers: **9 passed**. Serial client
models: **79 passed**, including both full **5,000-sequence** session walks.
Every stage passed. Full-run failure classification: **ours 0, baseline 0,
environmental 0**. The inherited nominal 60-second total suite bar remains
exceeded; no counts, timeouts or concurrency settings were changed.

`full-suite.log.gz` retains the complete output; `full-suite-summary.json`
records the counts and exact summary. All **1,698** executable-source/manifest
hashes match before and after the run (`suite-source-before.json`,
`suite-source-end.json`). The sole subsequent source-file change is a comment
in the inherited RX missing-run-coverage fixture, clarifying that v4 now queues
membership removal unconditionally. No executable statement or assertion
changed; `post-suite-source-delta.json` and `final-source.json` record it.
No runtime/wasm source changed after the suite. Its rebuilt wasm has the same
hash and byte count recorded above.

The scoped final documentation audit also removed the old LLP claim that member
removal predicts with complete run coverage. One journal entry was appended.
The commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
All requested changes are local; nothing was pushed or published.
