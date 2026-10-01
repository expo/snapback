# RY round 4 — every authored accounting read defers prediction

Date: 2026-10-01. Branch: `sb4-intent/ry-receipts-allocation`.
Read all round 0–3 prompts/reports and both complete round-3 reviews (copies
here, trailing whitespace normalized). Merged `origin/main`
`91a111cd85044176ebcc7200449e16e968d276f5` first, in
`82a5797a6811790fb6b1d910751d0c74c89a0b94`. Preserved both journal histories,
RY allocation/custody, PR audience metadata and GQ guide improvements.
Nothing pushed or published.

## Result and review disposition

Any authored mutation read of receipt-owned or transitively derived state now
sets one sticky observation. The final prediction boundary demotes both
**success and refusal**: the existing host transaction rolls back all predicted
changes, retains the original intent and reports `predictable: false`.

- **Astra P1 and Grok High:** a successful residual ordinal comparison cannot
  bypass admission. Whole-row gets and scans observe their table conservatively,
  including misses, empty ranges and loops over any index. Direct key reads,
  residual probe equalities, rule terms and field expressions use the same
  schema-derived dependency map. Aliasing a row or selecting through a
  non-receipt index does not change custody. The separate receipt write-target
  refusal policy has been deleted.
- **Astra P2:** schema preparation computes a fixed point over maintained
  predicates, keys and contributions, their aggregate rows and mirrored parent
  columns, plus recorded/inherited captures. A tainted aggregate's existence,
  keys and values all count. The metadata survives public projection, which
  removes private maintained-column derivations, and wire round-trip. A read
  of `shelves.total` therefore queues even when its device value is zero and
  the server will accept the follow-up.
- **Additional consumer audit:** assigned insert-result fields and conditional
  update old-row fields carry typed source provenance. Whole-record, array and
  nested-record comparisons also observe their consumed rows. These consumers
  cannot evade the rule by avoiding a fresh lookup. Null tests inspect presence.

Allocator storage probes and engine image/index bookkeeping do not evaluate
application reads. Removed the old raw-store touches rather than disabling
all sends. Ordinary sends, creates, joins, direct-id edits, text-only conditional
edits and reaction upserts remain eligible. Reading an inserted row's id is
safe; reading its ordinal/count is not. Authored receipt-dependent maintenance
also counts, even when the first local contribution fits. In projected schemas
where private maintenance runs only on the server, a plain send can still
predict; a later read of its maintained parent column queues.

Ordinary `sequence by` retains its precise provisional/refusal behavior. The
receipt v4 recipe, fingerprint domain and capability are unchanged. The new
schema metadata is omitted when empty; no-clause schemas keep their serialized
shape. No new queue, retry protocol, SDK field or promotion-after-acquisition
behavior. The social starter remains 223 lines (231 before RY). No contract.ts,
meter, timeout, worker policy or count change.

## Generated regressions

The existing 382 scenarios remain, with maintenance assertions updated to the
stronger read rule. The extension adds **322 admission/settlement scenarios**
on memory and SQLite, plus two ordinary-control sequences and a schema unit:

| Family | Cases | Coverage |
| --- | ---: | --- |
| Loops and filters | 256 | Four indexes (`.id`, sender, ordinal, timestamp) × first/last × full/horizon × update/delete × residual if/where × same mutation/follow-up × two stores |
| Aliased selections | 16 | Ordinal 1/2 × full/horizon × same mutation/follow-up × two stores; local success/server MISSING and the reverse |
| Maintained parent columns | 32 | Recipient sum/filtered count × full/horizon × locally true/false × require/after-insert hook × two stores; projected, serialized device schema |
| Direct after-insert hooks | 8 | Ordinal/recipients × locally true/false × two stores; no body lookup supplies the observation |
| Conditional updates | 4 | Stable-id writes with ordinal 1/2 conditions × two stores, including server E_CONFLICT |
| Whole values | 6 | Record, list and nested-record comparisons × two stores |

That is **704 generated admission/settlement scenarios**, plus the two control
sequences and one schema unit, in **25 Rust tests**. The complete declarative
receipt target has **140 tests**. Loops cover all five Grok shapes, including
`last 20 by bySender` under its horizon and comparisons that are true on the
device. Both stores queue without applying a local edit/delete, persist across
reopen, then match the authoritative message rows after settlement. The server
edits/deletes `m1`, not the device's newly allocated row. Aliases preserve the
server's MISSING outcome instead of predicting a rejected edit.

Ordinary controls exercise sends, id edits, reaction upserts, inserted-row id
reuse and text-only conditional updates. An unrelated `ROLLBACK` after internal
allocation stays terminal and does not acquire an outbox entry. Existing
create/join, allocation, ownership and custody controls remain. The schema unit
checks transitive closure using synthetic metadata; it explicitly does **not**
claim the language admits aggregate cascades it currently rejects.

## Orientation and scoped documentation audit

Applied `llp-orient` read-only. Snapback 4's fence, RULES, NOT-DOING, LLP 3000 and
brief LLP 2000.000 govern. LLP 3000.022 §14.3 owns this rule; §§14.1–14.2 retain
allocation, ownership, compaction and replay invariants. LLP 3000.015 §2 governs
ordinary sequences; LLP 3000.031 keeps pending/existence meaning. Read the
compiled receipts and maintained-column guide surfaces. Updated §14.3 and the
receipts guide in this change, and appended one journal entry. No new LLP,
capability, gate, application workaround or cross-lane hand-off. Snapback 1–3
bootstrap/inventory checks are outside this fence. Fleet inventory is absent
on this host; local toolchain details are in `toolchain.json`.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Final receipt target | 140 passed, 0 failed | `receipts-final.log.gz` |
| Whole guide and preceding receipt pass | 110 + 140 passed, 0 failed | `lang-composite-final.log.gz` |
| Language affected targets before final consumer refinements | 382 passed, 1 existing ignore | `lang-final.log.gz` |
| Device delivery, complete device target, read authority, sequence/disclosure, recorded and row-keyed views | 611 passed, 1 existing ignore | `device-affected.log.gz` |
| Core maintained-column review, schema capabilities and sequence/disclosure | 59 passed, 0 failed | `core-affected.log.gz` |
| Reference validation | 525 LLP docs, 10,056 refs; 0 errors/unchecked | `ref-check-final.log.gz` |

The final conditional-row provenance refinement is covered by the final
140-test receipt run and the subsequent full suite. The guide also runs again
in that suite. Broader earlier checks are not represented as final-source runs.

Negative control: disabling **only** `runner.tx.observe_receipts(schema)`
produces **3 pass / 8 fail** in the then-current round-four extension. Each loop
stops at its first admission failure; this is eight detecting tests, not a
claim that every generated negative case executed. The ordinary controls and
schema test pass. Source bytes were restored in `finally`; the restoration
hash is in `negative-control.json` and belongs to that earlier development
snapshot. Later final-source checks include the additional condition and
whole-value coverage. `whole-values-negative.log.gz` separately preserves the
two-store whole-value escape before its fix; the final six cases pass.

Ran `bash scripts/test.sh` **exactly once**, exit 0. Exact summary:

```text
== 0 failure(s) in 1305 s
```

All thirteen stages pass. Cargo workspace: **4,533 passed / 33 existing
ignores**; docs-budget checks also run one passing Rust test. Whole guide:
**110/110**. Client pool: **5,727 passed / 10 existing skips**, no failures or
cancellations. Fixture wrappers: **9/9**. Serial models: **79/79**, including
5,000 online and 5,000 local session sequences, no failures/cancellations/skips.
Builds, app checks, typechecks, docs budget and release guard pass. The inherited
nominal 60-second suite budget is exceeded; no timeout, worker policy, count
or meter ceiling was relaxed, and no worker was interrupted.

**Full-suite failures: none — ours 0, baseline 0, environmental 0.** Existing
ignores/skips and intentional fault-model refusal logs are not test failures.
`full-suite.log.gz` retains all output; `full-suite-summary.json` records every
stage and count; `full-suite-run.json` records start/end/exit. All **2,335**
captured source/manifest hashes match before/after and at report capture.
No product source changed after the run. The suite independently rebuilt the
same raw/gzip sizes and SHA-256. `logs.json` records the uncompressed size and
SHA-256 of every compressed log.

## Development failures

Every failed development test and compiler diagnostic is listed in
`development-failures.json`, with retained logs. All are **ours, resolved**;
none is attributed to baseline or environment. They include old maintenance
expectations under the stronger rule, an explicit-id fixture adjustment after
a join stops predicting, two helper compile mistakes, an unclosed delimiter,
a nonuniform test index spelling, the whole-value consumer escape, the three
measured intermediate budget overruns and command/path corrections. Eight
intentional observer-negative failures are also retained. No assertions,
runtime budgets, test counts, concurrency policy or timeouts were relaxed.

## Wasm

Merge-only: **2,011,439 B raw / 604,295 B gzip**, identical to RY round 3.
The incoming main guide changes add no device runtime bytes; both histories
and all existing budget reasons are preserved.

Final: **2,017,966 B raw / 605,913 B gzip**, SHA-256
`4751efdc088de8abe01838faa59aacb631fd655566c794029e4e9c82a6af05c0`.
The complete change adds **6,527 B raw / 1,618 B gzip (0.27%)** over the merged
baseline. This is a whole-artifact measurement, not per-feature attribution.
It covers schema dependency closure/projection metadata, unconditional
prediction demotion and typed/composite read observation while removing the
old raw-store and separate receipt target policies. The final ratchet is exactly
**605,913 B**, with no slack, using the script's `gzip -9 -c <path>` method.
The budget, commit and journal record the reason. The full suite independently
rebuilt the same artifact and passed the budget check. `artifacts.json` retains
size/method/digest; intermediate over-cap logs remain as development evidence.
