# RY round 3 — storage custody for receipt-dependent predictions

Date: 2026-10-01. Branch: `sb4-intent/ry-receipts-allocation`.
Read all round 0–2 prompts/reports and both complete round-2 reviews (copies
here; trailing whitespace normalized). Merged `origin/main` `096a1b78ef9ebceedf936b2293e253e0870c9e03`
first, in `093c98c0a8`. Preserved both journal histories and both wasm reasons.
Nothing pushed or published.

## Result

Prediction enables one sticky receipt-state observation in the shared
`GuardedRows` storage facade. Whole images, cached/absent lookups, key-only
probes, scans, counts, metadata access and writes that feed index/aggregate
maintenance use the same observation. The state-owning tables are the mapped
scope, messages, members and runs, plus stored views over them and one-hop
recorded captures. This is deliberately conservative at table granularity;
it does not depend on whether the row containing a counter is provisional.

The single prediction admission boundary converts every subsequent refusal,
including final constraints and output charging, to `Prediction`: the existing
host transaction rolls back, and the original write stays in the outbox with
`predictable: false` and no predicted changes. No reader-specific receipt flag
is necessary. Removed receipt fields and settlement nulls from the precise
sequence flag; kept that mechanism for ordinary `sequence by` tables.
Successful ordinary sends, scope creation and joins continue to predict.

Delete, update and upsert addressed by a key containing **any clause-owned
field** defer before evaluating/resolving the target, on hits and misses,
with or without pending rows or a sync horizon. Authored mutation selections
by such indexes also defer: saving a selected row in a local and later writing
by its id cannot bypass the rule. The allocator's internal suffix probe still
predicts positions. Stable-id writes retain ordinary eligibility.

This answers both Astra P2s and Grok's High structurally. The confirmed counter
can remain unchanged after a pending send; it still counts as receipt storage.
Write-side aggregate predicates, keys and contributions are covered before a
provisional image can overflow. Neither a successful ordinal-key match nor a
proven local miss is an authoritative write target.

The conservative boundary intentionally changes round 2's terminal control:
a loaded receipt-family row followed by `require false` now queues, even if a
later receipt expression is short-circuited. A wholly untaken receipt read
followed by an unrelated refusal stays terminal. Both behaviors are tested.
The server may ultimately refuse a queued write; that final decision still
removes it through ordinary settlement. No new queue or retry protocol.

Allocation, join floors, recipient index-count snapshots, write-id replay,
settled projections, SDK delivery exclusion, ownership, meter ceilings and v4
recipe/fingerprint are unchanged. The social starter remains **223 lines**,
versus 231 before RY. No contract.ts change.

## Generated regressions

The new generated module compiles each case's Quarry and runs on memory and
SQLite, asserting outbox custody, no predicted changes, persistence across
reopen, then the authoritative server outcome using the original write/row ids.

- 224 read cases: seven fields/states (counter, ordinal, recipient count, join
  floor, receipt projection, delivered watermark, seen watermark) × eight
  contexts (require, rule, rule probe, lookup, aggregate filter, aggregate key,
  after-insert hook, builtin) × same-transaction/follow-up × both stores.
- Six write-side maintenance cases: filter and group-key overflow from two
  provisional contributions near the integer limit, and recipient-count sum
  contribution checks. Server sends succeed; key cases have different
  authoritative recipient buckets.
- 120 ordinal-target cases: delete/update/upsert × ordinal 1/2 × horizon/full
  sync × both stores, for direct/aliased targets in the same transaction or a
  follow-up, plus targets with only confirmed rows and no pending predecessor.
  The competing writer owns server ordinal 1; the device's send receives 2.
  Final rows prove exactly which message the server edited/deleted.
- 30 additional owned-key cases: counter, count, floor and both watermark keys
  × three write verbs × both stores. Scope deletion is queued then correctly
  refused by server ownership; lawful cases settle successfully.
- Two conservative-touch controls: a real server refusal after a whole-row
  touch queues locally, then leaves the outbox on final refusal.

**382 generated scenarios in ten Rust tests**, in addition to the existing
49 dependency tests and allocation/prediction/accounting models. The existing
terminal controls now put the entire receipt read in the untaken branch.

## Orientation and scoped documentation audit

Applied `llp-orient` read-only. The Snapback 4 fence, adopted RULES, NOT-DOING,
root LLP 3000 and brief LLP 2000.000 govern this work. Current LLP 3000.022
§14.3 owns prediction/receipt custody; §§14.1–14.2 keep allocation, ownership,
compaction and replay invariants. LLP 3000.015 §2 governs ordinary provisional
sequences; LLP 3000.031 keeps pending/existence meanings. The compiled receipts
guide is the authoring surface. Updated §14.3 and that card in this change.
No new LLP, capability, field, recipe, gate, runtime ceiling or application
workaround. The Snapback 1–3 bootstrap and inventory gates do not apply.
The fleet inventory is absent on this host; checks run locally on the pinned
Node 24.13.1, Bun 1.3.14, Rust 1.97.0, wasm-bindgen 0.2.127 and Binaryen 132.
Hand-off: none.

## Verification

Final affected checks before the full suite:

| Check | Result | Log |
| --- | --- | --- |
| Language receipts/guide/delivery/sequence/recorded/maintained/row-keyed targets | 315 passed, 1 existing ignore | `lang-final.log.gz` |
| Declarative receipts (included above) | 125/125, including 59 dependency tests | same |
| Whole guide (included above) | 107/107 | same |
| Device delivery, complete device target, read authority, sequence/disclosure, recorded and row-keyed views | 611 passed, 1 existing ignore | `device-affected-corrected.log.gz` |
| Core sequence/disclosure | 46/46 | `core-affected.log.gz` |
| Additional owned-key fixture recheck | 2/2 (30 scenarios) | `owned-targets-corrected.log.gz` |
| Reference validation | 525 LLP docs, 10,057 refs; 0 errors/unchecked | `ref-check.log.gz` |

The negative control restores **all six changed core files** from the initial
main merge `093c98c0a8`, leaving the new tests intact. **0 pass / 10 fail**, all
at their intended admission assertions, with no compile errors. Each generated
loop stops at its first failure; this proves ten detecting tests, not 382
individually executed negative cases. `merged-round2-negative.log.gz` preserves
the failures; `negative-control.json` records the baseline and final restored
hashes. Restoration is in `finally` and checked byte-for-byte. The final
315-pass language check above follows restoration. Receipt-specific precise
flags are absent from the final code, so those passes exercise storage custody.

An isolated admission-order probe copies the existing retained-history fixture
outside the workspace, leaves a group, then returns an oversized value only
in the retained local branch. The server takes the empty branch and succeeds;
both memory and SQLite queue rather than terminally refuse. Both cases also
pass with all advisory operation classifications removed. This checked the
output-charge ordering concern without changing the suite's frozen source.
Exact source, matching cached-library command and result are retained in
`output-order-probe.rs.gz`, `output-order-probe.json` and
`output-order-runtime-probe.log.gz`. This is two additional passes, outside
the ordinary suite counts.

Ran `bash scripts/test.sh` **exactly once**, exit 0. Exact summary:

```text
== 0 failure(s) in 1323 s
```

All thirteen stages pass. Cargo workspace: **4,515 passed / 33 existing
ignores**; docs-budget checks also run one passing Rust test. Client pool:
**5,727 passed / 10 existing skips**, no failures or cancellations. Fixture
wrappers: **9/9**. Serial models: **79/79**, including 5,000 online and 5,000
local session sequences, no failures/cancellations/skips. Builds, both app
checks, typechecks, docs budget and release guard pass. The inherited nominal
60-second suite budget is exceeded; no timeout, test count, worker policy or
meter ceiling was relaxed, and no worker was interrupted.

**Full-suite failures: none — ours 0, baseline 0, environmental 0.** The existing
ignores/skips are not newly introduced failures. `full-suite.log.gz` retains
all output; `full-suite-summary.json` records every stage and exact counts;
`full-suite-run.json` records start/end and exit. All **1,851** captured
source/manifest hashes match before/after the run and again at report capture.
No product source changed after the run. The suite independently rebuilt wasm
with the same final raw size, gzip size and SHA-256 below. `logs.json` records
the uncompressed size and SHA-256 for each compressed log.

## Development failures

All development failures are **ours, resolved**; none is classified baseline or
environmental. `development-failures.json` records every failed test, compiler
and fixture diagnostic, command correction and budget refusal:

- Two old terminal controls reflected round 2's narrower dependency contract;
  the new conservative-touch and wholly-untaken-read controls cover both rules.
- Two maintenance-key fixture compile failures omitted the conversation
  authority key; added it while preserving the overflowing provisional bucket.
- One Rust compile error used `WriteState::Refused` instead of `Failed`.
- Two additional-key fixture compile failures introduced ambiguous positional
  key arities; distinct-arity keys preserve the same receipt-field assertions.
- Two Cargo commands named nonexistent integration targets; corrected names,
  including running the complete device target for its maintenance module.
- The merge/final wasm builds exceeded prior caps by 2,019/647 B respectively;
  exact measured budgets now retain both implementation reasons and no slack.
- Read-only/path/context mistakes are listed in the inventory. They made no
  unintended product changes.
- Ten intentional negative-control failures are retained as detecting evidence.
- The isolated probe initially linked an incompatible cached serde_json library;
  the matching library resolves its duplicate-serde compile errors.

No failing affected product check remains. The full suite has no failures;
its original result is preserved without a full rerun.

## Wasm

Merge-only measurement: **2,009,398 B raw / 603,648 B gzip**, +2,019 B above
RY round 2's 601,629 and +5,247 B above incoming main/PR's 598,401. Both receipt
allocation/dependency handling and PR's private query audience dependencies
are retained. These are whole-artifact integration deltas, not per-feature
attributions. The merge commit set the ratchet exactly to that measurement.
Final guard measurement: **2,011,439 B raw / 604,295 B gzip**, SHA-256
`d3cd964f028196ad4212044e75a965e0d584e21762c2744c810b595e3196b244`.
The structural touch and server-resolved key guards add **2,041 B raw / 647 B
gzip (~0.11%)** above the merged baseline. Final increase over RY round 2 is
2,666 B gzip; over main/PR, 5,894 B. The ratchet is exactly **604,295 B** with
no slack. Both original RY/PR reasons and these merged/final measurements are
retained in `metrics/wasm-budget.json`, the commit and journal. The initial
merged and final builds deliberately report their respective old-cap overruns;
the full suite rebuilt against the final ratchet and passed with the identical
artifact. No meter, timeout, concurrency policy or test count was relaxed.
