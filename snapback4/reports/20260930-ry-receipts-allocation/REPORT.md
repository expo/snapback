# RY round 0 — automatic receipt allocation

Date: 2026-09-30. Base: `dcc785038a2fd64219839ae27b70cfa0ada8b77b`.
Branch: `sb4-intent/ry-receipts-allocation`. Nothing pushed or published.

## Result and decisions

The clause owns message ordinals, send-time recipient counts, member join
floors and the mapped scope counter. Applications omit all four from writes;
explicit values and patches refuse `E_RECEIPTS_OWNED`. Each successful message
insert increments its family's scope counter inside the writer transaction;
duplicates, refusals, failed final checks and meter aborts consume no ordinal.
Joins observe that counter without consuming a position. Rejoin gets a fresh
floor; duplicate joins preserve their original floor. Counts include current
members other than the message sender and remain fixed on the message.

Creating scopes, sending messages and joining groups queue offline without
predicted rows. Durable outbox state supplies pending-write UI. This is a
conscious tradeoff: no guessed local ordinal or stale recipient snapshot can
look like settled history or be collected as delivery. Server transaction order
becomes the final history order, with submission order retained within each
outbox. Retries use the existing write-id ledger; replay preserves the committed
sequence (the engine does not cache arbitrary mutation result payloads).

Allocation authorizes the insert before accounting reads. Sending also requires
the caller's current membership and a readable scope; joining requires a
readable or newly created scope. The engine changes only the counter and needs
no authored scope update grant. It preserves other scope fields, including
private values. Recipient capture reads capped membership **index counts**,
not member payloads: changing another member's private bytes cannot affect its
logical meter. Read/insert rules cannot depend on the assigned accounting
fields, and fields cannot have competing engine ownership. Separate families
need separate counters and floors. Generic `sequence by` counters are
independent. Receipt scopes cannot be deleted by application code, preventing
counter reset through delete/reinsert; archive them with ordinary application
state. Trusted administrative seed/restore operations preserve historical data.

The capability and fingerprint domain are now `declarative-receipts-v3` /
`receipts.v3`. The descriptor includes all allocation mappings; generated
primitive/helper custody, public names, no-clause serialization and manual
receipt behavior are preserved. RX's delivered runs, live blockers, bounded
compaction, removal retirement and no-invented-delivery rules remain in force.

The social starter schema is **231 → 223 lines (8 lines removed)**. This removes
the send allocator/count loop/counter update, the join-floor read, and explicit
floor values in create/direct-message inserts. Required column declarations
and the clause's explicit mappings remain. `starter-before.q` retains the input.

## Orientation and scoped corpus audit

Applied `llp-orient` from `skills/llp-orient/SKILL.md` after initializing the
small pinned `vendor/llp` submodule; no skills or hooks were changed. Scope:
receipt binding, core insert/result ownership, prediction classification,
receipt guide and social starter.

- Governing current LLP: 3000.022 §§2–6 and §14, especially success-is-coverage,
  complete membership, bounded compaction, binding/version fences and the
  explicit allocation follow-up in §14.5.
- Root/brief: LLP 3000, LLP 2000.000; Snapback 4 AGENTS/NOT-DOING and adopted
  RULES. The Snapback 1–3 proof/bootstrap/inventory gates do not apply here.
- Related rationale: LLP 3000.015 §2 and the sequence implementation establish
  why the shared parent sequence cannot own a receipt family's separate high
  ordinal. Existing core transaction, ledger, meter and device queue machinery
  supply atomicity and exactly-once commitment.
- Updates completed: LLP 3000.022 §14, its primary compiled receipts
  guide and the starter changed with the code. LLP 3000.028 §8 now describes
  queued DM creation and pending-write recovery without a predicted lookup row.
  Manual receipts remain unchanged.
- Remaining inherited scope: arbitrary forged raw-IR descriptor/program
  admission and migration tooling, and large-backlog throughput qualification.
  The current prototype makes no new claim for those.
- Hand-off: none. The machine-fleet inventory was absent on this host, so all
  checks ran locally using Node 24.13.1, Bun 1.3.14 and Rust 1.97.0.

## Verification

Affected checks (run from `snapback4/`):

| Check | Final result | Log |
| --- | --- | --- |
| `cargo test -p snapback4-lang --test declarative_receipts` | 60 passed | `receipts-guide-confirm.log.gz` |
| `cargo test -p snapback4-lang --test guide` (whole guide) | 106 passed | `guide-post-suite.log.gz` |
| Language delivery, clause, integration, replay conversion targets | 27 passed, 1 existing ignore | `affected-and-guide.log.gz` (its initial guide failure is classified below) |
| Device delivery, readauth, sequence_by, sequence_disclosure targets | 127 passed | `device-final.log.gz` |
| Core sequence_by and sequence_disclosure targets | 46 passed | `core-affected.log.gz` |
| `node --test packages/snapback4/test/social-starter.test.mjs` | 9 passed, no skips/cancellations | `starter-post-suite.log.gz` |
| CLI build, SDK typecheck/build, docs budget | Passed | `cli-starter-final.log.gz`, `sdk-final.log.gz`, `docs-budget.log.gz` |

`scripts/test.sh` ran **exactly once**, without count or timeout overrides,
and exited 1. Exact summary:

```text
== 1 failure(s) in 1311 s
```

Twelve stages passed; the client-test stage had one failure. Rust: **4,441
passed, 33 existing ignores**; clients: **5,351 passed, 1 failed, 10 existing
skips**; fixture wrappers: **9 passed**; serial models: **79 passed**, including
both full 5,000-sequence session walks. No cancellations. The inherited nominal
60-second suite bar remains exceeded; no timeout or count was relaxed.

**Every full-run failure:** `declarative full runs compact a long deleted hole
through the real SDK` — **ours**. Its v2 fixture wrote sparse historical ordinal,
count and floor values through an application mutation, now correctly refused
by v3. The test consequently received no `chat` result at `assert.ok(chat)`.
The correction restores the identical historical layout through administrative
`/seed`, retaining every original saturation, blocker, compaction and coverage
assertion. Its complete SDK integration file now passes **4/4** in
`delivery-integrated-final.log.gz`. Baseline failures: **none**. Environmental
failures: **none**. The suite was not rerun; this correction has its affected
recheck, and the exact red full-run result remains in `full-suite.log.gz` and
`full-suite-summary.json`.

The runtime/test source remained unchanged throughout the full run:
`suite-source-before.sha256` and `suite-source-end.sha256` match across **1,719
files**. Final starter recovery and fixture corrections were applied afterward;
their separate checks and source delta are recorded below. The receipt engine,
binder, allocation model and wasm are unchanged from the full-run snapshot.

The new reference model executes 16 schedules × 80 transitions × 2 store hosts
= **2,560 transitions**, comparing ordinals, counts, floors, seen positions and
all message receipt labels after each server step and device publication.
Its independent set model includes sends by different principals, joins,
leaves/rejoins, duplicate and out-of-order deliveries and seen updates.

An actual SQLite concurrency test uses eight connections/threads × ten sends;
each send is replayed with the same id. It verifies exactly 80 contiguous
positions and correct counts. Two-device offline tests on memory and SQLite
restart both queues, reconnect them in an interleaved order, replay submissions,
and verify identical authoritative history and final read receipts. Separate
cases remove classification metadata and still prove the runtime prediction
guard queues without any row.

Focused cases cover rollback after insertion, duplicate `if absent`, meter
abort after the counter write, generated insert results, explicit accounting
refusals, counter reset refusal, parent private-field preservation, independent
sequence/group counters, clause diagnostics and private-payload meter equality.
The existing RX suite continues to exercise authority, names, fingerprints,
64-run saturation, live holes, deleted/expired gaps and bounded compaction.
The public-client social starter scenario now also checks allocated ordinals,
recipient counts, initial floors and leave/rejoin floors with SDK delivery and
seen receipts on the wasm device.

## Wasm

Final `build-wasm.sh`: **1,992,140 B raw / 597,386 B gzip**. Locked Binaryen 132,
Rust 1.97.0 and wasm-bindgen 0.2.127; standard size-first profile.

The inherited ratchet was 597,247 B. The new descriptor mappings and device
ownership/queue enforcement require a measured **139 B** increase; the final
ratchet is exactly **597,386 B**, with no added slack. Allocation/counting are
server-only. This is a whole-artifact result, not a per-feature byte estimate.
No runtime ceiling, test count or timeout was relaxed.

## Development failures (all ours; corrected)

`development-failures.json` enumerates failed test names and compiler diagnostics
from every retained pre-suite log. The full-run failure is enumerated above; the
additional detecting browser control is recorded below. These are development failures, not inherited
baseline failures or environmental exclusions:

| Log | Failure and correction |
| --- | --- |
| `compile.log.gz` | Five Rust errors: two unsupported default `KeyProvenance` values, two unauthorized `Value::heap_bytes` calls and one `ObjectFields` conversion. Used explicit provenance, declared copy reservations and the row-field API. |
| `affected-first.log.gz` | Empty generic `object([])` lacked a key type; replaced with an empty typed row. |
| `affected-second.log.gz` | The v2 two-family fixture shared its counter and floor. V3 intentionally refuses competing ownership; the fixture now gives each family distinct fields and retains the same removal/isolation checks. |
| `affected-model.log.gz` | Six new model tests used an ambiguous inline object containing multiple Quarry scans; bound the scans to locals first. The same old two-family fixture also failed before its update. An isolated `failed_noop` probe reproduced that syntax failure. |
| `model-second.log.gz` | Both store models asked an ascending prefix past the declared suffix horizon and correctly got incomplete reads. Changed the model read to the covered suffix. Both offline tests and the threaded test also wrongly expected replayed mutation result payloads; they now compare the durable outcome sequence, replay flag and final stored state. |
| `model-third.log.gz` | Both models, both offline tests and the threaded test compared descending history with an ascending reference. Canonicalized actual rows by ordinal before comparison. |
| `allocation-guards.log.gz` | The unrelated sequence fixture omitted its insert grant. A scope-creation test also found the real insert-result authority regression: reading a newly inserted scope before its founding member returned NOT_FOUND. Fixed the engine to return assigned ints as part of the insert result, preserving ordinary read authority. |
| `allocation-final.log.gz` | The private-field fixture used an unsupported union sync audience. Made its scope public with private field authority so it isolates preservation of another owner's value. Ordinary private-group creation is checked separately. |
| `affected-and-guide.log.gz` | One whole-guide test requires the exact defining `E_RECEIPTS_OWNED` sentence. Restored that sentence and kept the new accounting explanation alongside it. |
| `device-affected.log.gz` | `census::authoring_census` retained the v2 receipt add/send prediction classification. Reviewed its precise diff: only those two operations change to never-predict, removing their old predicted private write sites. Updated the census; authority outcomes remain covered. |
| `starter-e2e.log.gz` | Native and web DM scenarios expected a predicted conversation/key. Updated them to assert durable custody with no predicted rows, then the same canonical resolution and authority after reconnect. The resolver also recovers an existing pending opening without requiring a predicted lookup row. |
| `wasm-first.log.gz`, `wasm-final.log.gz`, `wasm-confirm.log.gz` | Initial artifact exceeded the old budget by 302 B; after moving receipt result handling to the server path the final artifact exceeds it by 139 B. The authorized ratchet change is exactly that final 139 B. The full suite rebuild rechecks the final artifact against that budget. |

No test count, timeout or runtime meter ceiling was reduced to obtain a pass.
The model/corpus fixtures changed only to match the chosen v3 semantics or to
fix invalid test assumptions; the ordinal/floor/count/receipt assertions remain.


## Starter restoration correction after the full run

The audit found an introduced recovery race: `usePendingWrites` initially
returns `[]` while loading. With unpredicted receipt-scope creation, a complete
absent lookup could therefore submit another opening before the existing queue
loaded. The resolver now awaits `client.pendingWrites()` before creating; an
existing opening retains its original write and proposed conversation IDs.
The primary social guide and LLP 3000.028 §8 record this distinction.

The real-browser regression holds pending-write restoration while reopening an
offline DM. Against the pre-fix starter it fails with **3 opening attempts versus
2** (`pending-restoration-control.log.gz`: 0 passed, 1 failed). Classification:
**ours, deliberately retained detecting control**. It exercises the actual React
resolver, durable queue and navigation, without replacing their behavior.
The fixed browser run passes **8/8** including its route/receipt recovery
subtests (`pending-restoration-final.log.gz`). The complete starter file passes
**9/9** (`starter-post-suite.log.gz`) and the whole guide passes **106/106**
(`guide-post-suite.log.gz`). The rebuilt CLI is in `cli-post-suite.log.gz`. No skips,
cancellations, relaxed timeouts or reduced test counts in these rechecks.

Exactly five source files differ after the full run: the resolver, its compiled
social guide, the delayed-restoration browser harness/test and the historical
compaction fixture. `post-suite-source-delta.json` enumerates them;
`final-source.sha256` records the final source. LLP 3000.028, this report and the
journal also record the correction. No engine or wasm change followed the full
run, so their full-run evidence still applies.

Final hashes and byte counts are in `artifacts.json`; the full-run artifact
snapshot is retained in `suite-artifacts.json`. The wasm SHA-256 is
`0d03ed05b51d5e1bfb897eb10a514851f416fd165ad70e6e6233ff614d6ff84c`
in both snapshots. Gzip size uses the same GNU `gzip -9 -c <filename>` command
as the build script (toolchain in `toolchain.json`), not a different compressor.

All identified failures are corrected and their affected checks pass. This is
not a claim that the one full-suite run was green: its one failure and exact
summary are preserved above.

Final maintenance: scoped LLP/guide audit and `git diff --check` pass.
`./ref-check --verbose`: **525 LLP docs, 10,013 refs in 30,536 files,
0 errors, 0 unchecked** (`ref-check-final.log.gz`). One journal entry was appended.

The initial staged whitespace check flagged trailing spaces/blank lines in
verbatim tool output (ours, report packaging). Logs are retained byte-for-byte
as `.log.gz` files instead; `logs.json` records their uncompressed SHA-256 hashes.
The final staged whitespace check passes.
