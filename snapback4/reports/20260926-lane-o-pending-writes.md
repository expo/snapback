# Lane O — pending writes, 2026-09-26

Implemented LLP 3000.019 §3.3 part 4 on `sb4-intent/o-pending-writes`,
starting at `99153132b`. The supervisor retains design/integration custody.
No push or package publication was performed.

Implementation commits: `93ed30240` (device metadata), `6f8def90c`
(client, React, documentation and integration tests), and `834d5f851`
(online flush completion and the snapshot witness). All end with the
requested GPT-6 Astra co-author trailer.

## Public forms

```ts
const pending = await client.pendingWrites();
// [{ id, op: "send", args: { conversationId, body },
//    state: "queued" | "sent" | "held", reason?, predicted: ["messages/id"] }]

const stop = client.onPendingWrites(() => {
  void client.pendingWrites().then(renderPending);
});
stop();
```

```tsx
const all = usePendingWrites();
const sends = usePendingWrites(api.send); // sends[i].args has api.send's argument type
```

The list’s `sent` is unconfirmed dispatch, not a `Write.sent` receipt. A
settled write disappears from the list and still reaches `onWrite`. A retryable
hold does not settle the write or allow a successor to bypass it. Terminal
refusals, result-free receipt recovery, prediction replay and original ids
retain their existing meaning. Predicted entries name `table/id` keys, never
row bodies or historical mutation results.

## File-by-file changes

Paths below are relative to `snapback4/`. Existing Rust constructors need the
new optional member explicitly because they use struct literals. Persisted
JSON remains compatible through serde’s default/skip-when-absent behavior.

| File | Change |
| --- | --- |
| [`crates/snapback4-device/src/call.rs`](../crates/snapback4-device/src/call.rs) | Dispatch keyed begin_send and hold_write; keep the old unkeyed form. |
| [`crates/snapback4-device/src/device.rs`](../crates/snapback4-device/src/device.rs) | Optional durable dispatch metadata and outbox_status capability; send status shares the existing send-revision transaction. |
| [`crates/snapback4-device/src/device/predictions.rs`](../crates/snapback4-device/src/device/predictions.rs) | Update only an existing outbox entry’s status, preserving its order, ids, prediction and receipt fields; bound saved refusal codes to 128 characters. |
| [`crates/snapback4-device/tests/device.rs`](../crates/snapback4-device/tests/device.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/device_scenarios/mod.rs`](../crates/snapback4-device/tests/device_scenarios/mod.rs) | Add the status/reopen/FIFO/late-hold scenario on both device stores; initialize the new field in older constructors. |
| [`crates/snapback4-device/tests/disclosure.rs`](../crates/snapback4-device/tests/disclosure.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/ephemeral.rs`](../crates/snapback4-device/tests/ephemeral.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/expiring_counts.rs`](../crates/snapback4-device/tests/expiring_counts.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/extrema.rs`](../crates/snapback4-device/tests/extrema.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/language/mod.rs`](../crates/snapback4-device/tests/language/mod.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/maintains/columns.rs`](../crates/snapback4-device/tests/maintains/columns.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/maintains/mod.rs`](../crates/snapback4-device/tests/maintains/mod.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/maintains/recorded.rs`](../crates/snapback4-device/tests/maintains/recorded.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/maintains/recorded_membership.rs`](../crates/snapback4-device/tests/maintains/recorded_membership.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/maintains/review.rs`](../crates/snapback4-device/tests/maintains/review.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/native.rs`](../crates/snapback4-device/tests/native.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/papercuts/mod.rs`](../crates/snapback4-device/tests/papercuts/mod.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/prediction_write_set.rs`](../crates/snapback4-device/tests/prediction_write_set.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/prefix_reads/mod.rs`](../crates/snapback4-device/tests/prefix_reads/mod.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/presence/effect_reads.rs`](../crates/snapback4-device/tests/presence/effect_reads.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/presence/mod.rs`](../crates/snapback4-device/tests/presence/mod.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/repair_b.rs`](../crates/snapback4-device/tests/repair_b.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/repair_b/resumption.rs`](../crates/snapback4-device/tests/repair_b/resumption.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/repair_b_boundaries.rs`](../crates/snapback4-device/tests/repair_b_boundaries.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/repair_b_counterexample.rs`](../crates/snapback4-device/tests/repair_b_counterexample.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/repair_b_round2_counterexample.rs`](../crates/snapback4-device/tests/repair_b_round2_counterexample.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/repair_b_round3_counterexample.rs`](../crates/snapback4-device/tests/repair_b_round3_counterexample.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/row_keyed_views.rs`](../crates/snapback4-device/tests/row_keyed_views.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/row_view_disclosure.rs`](../crates/snapback4-device/tests/row_view_disclosure.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/sequence_by.rs`](../crates/snapback4-device/tests/sequence_by.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/sequence_disclosure.rs`](../crates/snapback4-device/tests/sequence_disclosure.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/server_clock.rs`](../crates/snapback4-device/tests/server_clock.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/time_indexes/mod.rs`](../crates/snapback4-device/tests/time_indexes/mod.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/trending/lanes.rs`](../crates/snapback4-device/tests/trending/lanes.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/trending/mod.rs`](../crates/snapback4-device/tests/trending/mod.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/upsert/mod.rs`](../crates/snapback4-device/tests/upsert/mod.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/upsert/proof.rs`](../crates/snapback4-device/tests/upsert/proof.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/write_authority.rs`](../crates/snapback4-device/tests/write_authority.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-device/tests/written_by.rs`](../crates/snapback4-device/tests/written_by.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4-lang/src/guide/codes.rs`](../crates/snapback4-lang/src/guide/codes.rs) | Extend the existing E_DEVICE_VERSION explanation for outbox status support; no new diagnostic code. |
| [`crates/snapback4-lang/src/guide/writes.rs`](../crates/snapback4-lang/src/guide/writes.rs) | Document list fields, state meanings, subscription, hooks, persistence and legacy behavior. |
| [`crates/snapback4-sim/tests/common/write_observation.rs`](../crates/snapback4-sim/tests/common/write_observation.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`crates/snapback4/tests/expiry_writes/devices.rs`](../crates/snapback4/tests/expiry_writes/devices.rs) | Initialize dispatch: None in existing Queued test constructors; assertions and tested behavior are unchanged. |
| [`packages/snapback4/CLIENT-AND-OPERATIONS.md`](../packages/snapback4/CLIENT-AND-OPERATIONS.md) | Document the public list and a typed React example. |
| [`packages/snapback4/src/app-client.ts`](../packages/snapback4/src/app-client.ts) | Fence pending reads and notifications across account lifetime changes, including an in-flight listing. |
| [`packages/snapback4/src/app-journal.ts`](../packages/snapback4/src/app-journal.ts) | Persist and validate holdReason; clear it when the next dispatch begins. |
| [`packages/snapback4/src/app-online.ts`](../packages/snapback4/src/app-online.ts) | Project the existing durable online journal, overlay live dispatch status, notify changes, and hide stopped/account-mismatched custody. |
| [`packages/snapback4/src/client.ts`](../packages/snapback4/src/client.ts) | Expose the in-memory FIFO; track dispatch and HTTP 409/503 holds, omit settled entries before onWrite, and install the flush owner before dispatch callbacks can reenter. |
| [`packages/snapback4/src/contract.ts`](../packages/snapback4/src/contract.ts) | Export PendingWrite<A>; add async pendingWrites() and onPendingWrites() to Client. |
| [`packages/snapback4/src/local-exit.ts`](../packages/snapback4/src/local-exit.ts) | Report retryable keepalive responses without changing keepalive receipt settlement. |
| [`packages/snapback4/src/local-native.ts`](../packages/snapback4/src/local-native.ts) | Extract the unchanged native installer closure to keep local.ts below 1,500 lines. |
| [`packages/snapback4/src/local-sync.ts`](../packages/snapback4/src/local-sync.ts) | Refuse a device missing outbox_status using the existing E_DEVICE_VERSION rewrite. |
| [`packages/snapback4/src/local-types.ts`](../packages/snapback4/src/local-types.ts) | Describe the device’s optional dispatch metadata. |
| [`packages/snapback4/src/local.ts`](../packages/snapback4/src/local.ts) | Expose the durable list, notify changes/close/sign-out, record ordinary and exit holds, and honor the head’s retry backoff. |
| [`packages/snapback4/src/mock.ts`](../packages/snapback4/src/mock.ts) | Implement the new Client methods for the existing delayed-commit mock. |
| [`packages/snapback4/src/online-dispatch.ts`](../packages/snapback4/src/online-dispatch.ts) | Private hook to persist a retryable online hold. |
| [`packages/snapback4/src/pending-writes.ts`](../packages/snapback4/src/pending-writes.ts) | Shared notifications and a local projection of existing custody; omit terminal receipts and qualified success entries. |
| [`packages/snapback4/src/react-pending-writes.ts`](../packages/snapback4/src/react-pending-writes.ts) | Subscription resource with stable snapshots, effect cleanup and revision fencing of obsolete asynchronous reads. |
| [`packages/snapback4/src/react.tsx`](../packages/snapback4/src/react.tsx) | Export usePendingWrites(op?) with inferred argument types when filtered. |
| [`packages/snapback4/src/web.ts`](../packages/snapback4/src/web.ts) | Record keyed exit dispatch; persist status-only changes without waking delivery or the suspended-page sender. |
| [`packages/snapback4/src/writes.ts`](../packages/snapback4/src/writes.ts) | Read the receipt window once for a whole listing, including unpersisted terminal custody and excluding nonauthoritative local admission failures. |
| [`packages/snapback4/test/client-lifecycle.test.mjs`](../packages/snapback4/test/client-lifecycle.test.mjs) | Update supported-device fakes and add missing/false outbox_status startup refusal cases. |
| [`packages/snapback4/test/following-routing.test.mjs`](../packages/snapback4/test/following-routing.test.mjs) | Have the supported-device fake advertise outbox_status: true; existing assertions are unchanged. |
| [`packages/snapback4/test/local-signout.test.mjs`](../packages/snapback4/test/local-signout.test.mjs) | Have the supported-device fake advertise outbox_status: true; existing assertions are unchanged. |
| [`packages/snapback4/test/online-session.test.mjs`](../packages/snapback4/test/online-session.test.mjs) | Have the supported-device fake advertise outbox_status: true; existing assertions are unchanged. |
| [`packages/snapback4/test/pending-writes.test.mjs`](../packages/snapback4/test/pending-writes.test.mjs) | 17 new cases: four client forms × two retryable HTTP statuses; six durable reload cases; raw-online lifetime, subscriber reentrancy and account fencing. |
| [`packages/snapback4/test/prediction-routing.test.mjs`](../packages/snapback4/test/prediction-routing.test.mjs) | Have the supported-device fake advertise outbox_status: true; existing assertions are unchanged. |
| [`packages/snapback4/test/query-publication-session.test.mjs`](../packages/snapback4/test/query-publication-session.test.mjs) | Have the supported-device fake advertise outbox_status: true; existing assertions are unchanged. |
| [`packages/snapback4/test/react.test.mjs`](../packages/snapback4/test/react.test.mjs) | Actual React/Chromium case for filtering, queue/sent/held/settled updates, stale responses, remount and StrictMode cleanup. |
| [`packages/snapback4/test/repair-b-round7.test.mjs`](../packages/snapback4/test/repair-b-round7.test.mjs) | Have the supported-device fake advertise outbox_status: true; existing assertions are unchanged. |
| [`packages/snapback4/test/repair-b-round8.test.mjs`](../packages/snapback4/test/repair-b-round8.test.mjs) | Have the supported-device fake advertise outbox_status: true; existing assertions are unchanged. |
| [`packages/snapback4/test/repair-b.test.mjs`](../packages/snapback4/test/repair-b.test.mjs) | Have the supported-device fake advertise outbox_status: true; existing assertions are unchanged. |
| [`packages/snapback4/test/server-clock-regressions.test.mjs`](../packages/snapback4/test/server-clock-regressions.test.mjs) | Have the supported-device fake advertise outbox_status: true; existing assertions are unchanged. |
| [`packages/snapback4/test/session-security.test.mjs`](../packages/snapback4/test/session-security.test.mjs) | Have the supported-device fake advertise outbox_status: true; existing assertions are unchanged. |
| [`packages/snapback4/test/timeline-delivery.test.mjs`](../packages/snapback4/test/timeline-delivery.test.mjs) | Keep the snapshot witness equal for every original intent field while allowing the new dispatch status to advance during retry. |
| [`packages/snapback4/test/web-navigation.test.mjs`](../packages/snapback4/test/web-navigation.test.mjs) | Add keepalive status/hold evidence; narrow one existing persistence gate to admission because dispatch now also saves the outbox entry. |
| [`JOURNAL.md`](../JOURNAL.md) | Append this lane’s dated implementation and measurement entry. |
| This report | Record files, evidence, decisions, limits and reproduction commands. |

## Tests and what they prove

- `pending-writes.test.mjs`: **17 cases**. FIFO order even when ids sort in the
  reverse order; copied arguments cannot mutate intent; predictions name rows,
  and nonpredicting writes remain visible. Online, createApp’s online custody,
  wasm and process clients transition through queued/sent/held/settled on both
  HTTP 409 and 503. Holds emit no terminal event; retries preserve the head.
  Local and durable-online reloads preserve both sent/unknown and held heads
  plus queued tails; replay commits the same ids once. Another account sees
  no intent. Raw online reload retains no fabricated durable queue. A callback
  can admit another write without redispatching the head. A fenced facade
  withdraws an outstanding list and unsubscribes.
- `react.test.mjs`: one additional Chromium/React case. All/operation-filtered
  lists update at each state, older async reads cannot regress a newer list,
  and StrictMode/unmount/remount release subscriptions and fence old lifetimes.
- `web-navigation.test.mjs`: one additional case. A pagehide send notifies the
  list, a retryable exit response persists a held reason, and the intent stays
  pending. The existing admission-save test now gates only its first outbox
  commit: dispatch status deliberately adds a later save to that same entry.
- `device_scenarios::outbox_status_survives_reopen_without_changing_intent_or_order`:
  one scenario on memory and SQLite. Legacy JSON still loads, send/hold survives
  reopen, all other outbox fields and order stay equal, the old unkeyed
  begin_send retains its meaning, and a late hold cannot resurrect settlement.
- `client-lifecycle.test.mjs`: missing/false outbox_status fails startup with
  E_DEVICE_VERSION, so an older native module cannot silently supply an
  unsupported status API. Other protocol fakes only gain the capability bit.

## Validation and measurements

The baseline wasm was rebuilt from `99153132b` using this host/toolchain before
measuring the lane. The output is generated, not committed.

| Device wasm | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| Rebuilt baseline | 2,021,689 | 581,094 |
| This lane | 2,023,103 | 581,523 |
| Delta | +1,414 | +429 |

The unchanged budget is **582,094 B gzip**, leaving **571 B**. Engine meter
ceilings are unchanged. The largest changed source is `local.ts`, 1,482 lines;
its native installer was extracted rather than exceeding the 1,500-line cap.

- Package typecheck/build passed.
- Full guide target passed: **85 passed; 0 failed; 0 ignored**.
- Affected client/React run passed: **107 tests, 107 pass, 0 fail, 0 skipped**.
- Repair verification passed: **109 tests, 109 pass, 0 fail, 0 skipped**,
  including all nine initial full-suite failures and the pending-write suite.
- Final navigation suite passed: **16 tests, 16 pass, 0 fail, 0 skipped**.
- Targeted device scenario passed on both hosts.
- `git diff --check` passed; README remains 300/300 lines.
- Required full `scripts/test.sh`: `== 1 failure(s) in 1520 s` (exit 1; client tests only).
- The full run’s client models passed: **78/78**, including all 5,000-seed
  session models and the 3,000-seed online interleaving model.
- Post-repair online models: **35/35 passed**: nine online-session cases including 5,000 seeded
  sequences, then all 26 raw/createApp model cases including 3,000 seeded
  interleavings.

The full script was run once. Its main client invocation reported 2,152 tests:
2,133 passed, nine failed and ten were skipped by their existing host gates.
All nine failures are individually recorded below with their repairs; this
report does not describe the original full run as green.

Logs are retained locally under `snapback4/target/lane-o-evidence/`.

## Engineering decisions, deviations and limits

The supplied design was implemented without changing its execution model.
These choices fill unspecified API details:

1. `pendingWrites()` is asynchronous to read durable device/journal custody.
   `onPendingWrites()` is the corresponding invalidation subscription. The
   hook initially returns `[]`, then publishes its first read; an I/O failure
   keeps its last successfully read list rather than claiming settlement.
2. `op` is the mutation’s name; hook filtering accepts its generated Mutation
   object and narrows `args`. Held reasons keep only the refusal code, not
   potentially stale authorization details. The device bounds it to 128 chars.
3. Dispatch is persisted before the request can be sent; a crash between that
   commit and the network call can therefore display `sent`. It remains an
   unknown outcome and never a success receipt. A retryable response, including
   HTTP 503, becomes held; transport failure alone remains sent/unknown.
4. Raw online custody remains in memory, as specified. The existing createApp
   journal also supplies the public list so an online app can recover it on
   reload. App facades and the mock implement the same additive Client surface.
5. The local flush loop honors an already scheduled retry instead of using a
   concurrent admission to bypass backoff. Web status-only commits update the
   snapshot without triggering another send. Neither change reorders writes.
6. Older native modules must be rebuilt; the existing version diagnostic now
   checks outbox_status as well as receipt_outcomes. No new code or why entry
   was introduced. All existing language forms remain unchanged.
7. The `llp-orient` link here was broken. The matching installed skill in
   `lane-z/vendor/llp/skills/llp-orient/SKILL.md` supplied the read-only workflow.
   The scope followed LLP 3000, LLP 2000.000, LLP 3000.001’s replay repair,
   LLP 3000.007’s receipt/recovery boundaries, LLP 3000.013 §6 and the supplied
   LLP 3000.019 §3.3. The supervisor-owned RFC was not rewritten.

**Legacy status limitation:** a pre-0.4.4 device record without dispatch metadata
cannot reveal whether an unacknowledged POST once started. It is listed queued
unless retained sequence evidence proves dispatch; this fallback is documented.
Reproduce with an old client: hold a POST response before it reaches settlement,
close, upgrade, and inspect the restored outbox before replay. The old entry has
neither dispatch metadata nor a receipt, just like a never-sent entry. No past
send event can be reconstructed from those bytes. New writes persist status and
are covered by the held/sent reload tests. This does not permit fresh ids,
reordering or additional execution; replay retains the existing idempotent id.

Other than that historical-information limit, no known product problem remains
in this lane’s implemented scope. Parts 1–3 of §3.3, the other release lanes,
calibration, package versions, publication, Expo binary packaging and budget
changes were not performed.

## Failures encountered and disposition

- Initial local hold tests failed because an admission’s flushAgain flag could
  bypass backoff. Fixed by respecting a scheduled retry; all four client forms
  pass the lifecycle cases.
- The new exit-hold case exposed a feedback loop from status-only outbox saves
  to delivery. Fixed by suppressing delivery wakeups for those saves.
- The existing admission-persistence witness stalled on a later status save
  because it gated every outbox write. It now gates admission only; its original
  durability assertions remain. The final complete navigation suite is green.
- Full-suite failures/classification: nine client tests, all ours and all fixed; no baseline or environmental failures.

The following nine initial full-suite failures are **ours**, all fixed in
`834d5f851` and passing in `full-suite-repairs.log` (109/109). None is attributed
to the baseline or the environment:

| Test file | Failed case | Cause and resolution |
| --- | --- | --- |
| `client-seams.test.mjs` | W6d online: input key order is immaterial and an evicted receipt never readmits on the same client | The reentrancy guard released the flush after its completion promise resolved; an immediately admitted successor could join a finished drain. Release inside the drain’s finally. |
| `client-seams.test.mjs` | online: immediate lost first acknowledgement preserves the same-id replay receipt | Same flush completion race; fixed. |
| `client-seams.test.mjs` | online: queued lost first acknowledgement preserves the same-id replay receipt | Same flush completion race; fixed. |
| `online-store-order.test.mjs` | replayed mutation cannot lower the query floor | Same flush completion race; fixed, original assertion unchanged. |
| `online-store-order.test.mjs` | replayed mutation cannot lower the observation floor | Same flush completion race; fixed, original assertion unchanged. |
| `online-store-terminal.test.mjs` | replayed receipts verify their current head without lowering the historical commit fence | Same flush completion race; fixed, original assertion unchanged. |
| `online-store-terminal.test.mjs` | a replayed historical receipt cannot authorize a later sequence-1 read | Same flush completion race; fixed, original assertion unchanged. |
| `write-authority.test.mjs` | replay card: online keeps a lost response's same-id receipt and fresh result | Same flush completion race; fixed, original assertion unchanged. |
| `timeline-delivery.test.mjs` | oversized historical timeline commit recovers by snapshot with pending writes on both hosts | The existing deep equality included the deliberately added presentation status, which advances from sent to held during retry. Compare every original intent field; status transitions have their own lifecycle tests. |

Reproduce the initial failures by checking out `6f8def90c`, rebuilding the
package and running the corresponding test files. Run the same files at the
final lane head to verify the repairs. No Rust input changed after the full
suite’s passing 937 Rust executions and workspace doctests; only the repaired
client tests and affected online models were rerun.

## Round 1 — 2026-09-26

Both blind reviews were read in full. All four findings are accepted and fixed;
neither review is disputed. This section supersedes round 0's statement that
only historical records had an exit-dispatch information gap.

### Integration and commits

Fetched origin and merged the requested `992cec75c` before making round-1
repairs. Merge commit `b3c95fee9` preserves both journal histories and combines
`MutateOptions.waitSeconds`, saved argument identity, drafts/known outcomes,
and the pending-write methods. Conflicts in `client.ts`, `app-online.ts`,
`local.ts`, `mock.ts`, `react.tsx`, `react.test.mjs` and `JOURNAL.md` keep both
features. `contract.ts`, `writes.ts` and the guide/doc edits merged normally.
The merged tree passed package typecheck/build and 68 targeted tests before
review fixes began.

Implementation commits, each ending with the requested co-author trailer:

- `1bd762f0a`: pending reasons, restore halts, custody/transport regressions.
- `c0df67fe3`: shared journal invalidations and shared-hook/known-outcome tests.
- `515a96082`: synchronous exit-dispatch evidence, recovery and cleanup tests.

### Findings, file by file

Paths are relative to `snapback4/`.

| Finding | Files and repair |
| --- | --- |
| Astra: first exit dispatch reopened as queued | `packages/snapback4/src/web-journal.ts` records a store-bound, id-only dispatch marker synchronously in the existing browser journal; `src/web.ts` requires that capture before permitting keepalive. Opening/recovering a device updates only the original outbox row through keyed `begin_send`. A host `j` acknowledgement shares its status commit, then removes the synchronous marker. Failed cleanup keeps that acknowledgement, so a leftover marker cannot overwrite a later hold. Settlement never recreates an entry. |
| Astra: shared online journal notifications were instance-local | New `src/journal-changes.ts` shares subscribers by journal key and broadcasts invalidations, containing no arguments, across browser tabs. `src/app-online.ts` publishes after journal commits, reads dispatch/hold status from that shared journal, and detaches at custody pause; the last local subscriber closes the channel. A paused owner's already-running save can still notify active peers. |
| Grok: sent writes carried queued prediction reasons | `src/pending-writes.ts` computes state first: only queued entries receive prediction sentences; held entries receive refusal codes; sent entries omit reason. `crates/snapback4-lang/src/guide/writes.rs` and `packages/snapback4/CLIENT-AND-OPERATIONS.md` state this distinction. |
| Grok: restore-halted local client still listed writes | `src/local.ts` invalidates on restore halt and includes `E_STORE_RESTORE` in the list's pre/post-await availability checks. It returns `[]` without changing the stored outbox. |
| Custody integration | The merge keeps each tier's bounded settlement wait. `CLIENT-AND-OPERATIONS.md` states that a pending custody return retains the entry's actual queue state. `test/pending-writes.test.mjs` covers zero/clamped waits through send, dropped connection, hold, retry and settlement; `test/app-online.test.mjs` verifies a known terminal outcome leaves the list even if its receipt save fails and durable replay custody remains. |

### Public forms and regression evidence

No new public spelling is introduced in round 1. The merged forms compile and
run together:

```ts
const admitted = await client.mutate(api.send, { conversationId, body: "hello" }, {
  id: savedId, waitSeconds: 0,
});
const pending = await client.pendingWrites();
// If admitted is pending, the saved id stays listed as queued, sent or held.
const stop = client.onPendingWrites(() => { void client.pendingWrites().then(render); });
stop();
```

```tsx
const sends = usePendingWrites(api.send); // args retain api.send's type
const all = usePendingWrites();
```

These are the regression additions/strengthenings:

- `test/web-navigation.test.mjs`: two first-dispatch reproductions block
  ordinary `begin_send`, trigger pagehide, stall the status save after the
  keepalive starts, and reopen independent copies of both persisted stores.
  The copies must list `sent`; the original persisted outbox is still queued
  before its blocked commit. After releasing that save, the keyed status must
  be durable and the marker cleaned. The second case blocks marker removal,
  commits a later hold and requires reopened `held`; eventual cleanup works.
- `test/react.test.mjs`: A's mounted hook sees B's admission; A unmounts and
  remounts while B is sending, then clears on B's settlement. Run with two
  clients in one page and with two actual Chromium pages sharing localStorage.
  Pausing A detaches its notifications. Existing StrictMode/filter/read-fence
  tests remain unchanged.
- `test/pending-writes.test.mjs`: four added cases, one per raw online,
  journaled online, wasm and process tier, exercise `waitSeconds: 0` and a
  fractional value clamped to zero with the original id and arguments. The
  merged client-seams cases also verify nonzero bounded waits on all tiers. A rejected transport
  promise (no HTTP response) must leave sent/unknown, followed by an HTTP hold,
  same-id retry and settlement. Eight existing lifecycle cases now assert an
  online-only mutation has no reason once dispatched.
- `test/store-reset-reconnect.test.mjs`: both real local hosts retain a sent
  write while a same-store lower head causes `E_STORE_RESTORE`; the list clears,
  a listener is invalidated, and every stored outbox field remains equal.
- `test/app-online.test.mjs`: six existing known-outcome cases (success/refusal
  through mutate/lookup/background) now assert list/custody agreement even
  while receipt persistence fails.

Both requested mutation trials ran against the final implementations through
Node module-loader substitutions, leaving source/build artifacts unchanged:

- Remove `id` from only `web.ts`'s exit `begin_send`: **0 pass / 2 fail**;
  each fails because persisted dispatch is absent instead of `""` after the
  status save. The interrupted-save recovery assertions themselves still pass.
- In online `sendPost`'s transport catch, call `hold(entry, "E_OFFLINE")`:
  **0 pass / 2 fail**, raw and journaled online, on actual `held/E_OFFLINE`
  versus required `sent` without a reason.

Unmutated verification:

- Merged tree before fixes: **68/68** targeted client/navigation/React tests.
- Affected integration run: **224/224** (pending writes, navigation, React,
  restore/reconnect, journal model, custody and client seams).
- Final navigation/journal/restore run: **92/92**, including the additional
  cleanup-failure case and the latest restore invalidation path.
- Known-outcome custody run: **12/12**.
- Final exit-only run after the last decoder guard: **2/2**.
- Package typecheck/build and `git diff --check` passed.

### Measurement, deviations and open problems

The full script rebuilt wasm at **2,023,103 B raw / 581,523 B gzip**, identical
to round 0. The budget remains **582,094 B**, with **571 B** headroom. No engine
meter, Rust runtime, package version or budget changed in round 1. The largest
changed source remains `local.ts`, at 1,485 of 1,500 lines.

There is no scope deviation and no unfixed review finding. The synchronous
marker is acknowledged in the existing host journal namespace rather than
adding a second outbox; it contains no operation arguments and grants no
permission to create or retry an intent. Shared browser notifications use
BroadcastChannel and carry only invalidation. Raw online queues remain in
memory. The previously documented pre-0.4.4 legacy-information limit remains:
an old outbox without dispatch/sequence evidence cannot distinguish a past
unacknowledged send from a never-sent write. Reproduce with the old client as
recorded above; the new first-exit-dispatch path is now covered separately.

The scoped orientation used the installed `llp-orient` fallback already named
in round 0. Binding context is LLP 3000's fence, LLP 2000.000 §7's durable
outbox/identity rules, LLP 3000.013 §6's admission/store custody, LLP 3000.007
§17/§20.4's result-free receipt and browser recovery boundaries, the supplied
LLP 3000.019 §3.3 part 4, and merged LLP 3000.008.002.000 §3's bounded custody
waits. Only the guide's relevant write semantics and this report/journal need
updates; the supervisor-owned design is unchanged.

### Required full script

Round 1 ran `bash scripts/test.sh` **once** at implementation commit
`515a96082`, with implementation source unchanged throughout. Its literal
summary is **`== 1 failure(s) in 1017 s`**, exit **1**. The failed script step
is `client tests`; there are two failed test cases, listed below. No complete
suite rerun was performed.

- Rust targets and workspace doctests passed (530 s), including the full
  guide target: **86 passed / 0 failed / 0 ignored**.
- Builds, wasm budget, release guard, docs budget, fixture wrappers and both
  app typechecks passed.
- The main client invocation: **2,196 tests; 2,184 pass; 2 fail; 10 skipped**
  by existing optional/host gates (193 s).
- Client models: **78/78 passed**, including their unchanged seeded counts
  (261 s).
- Both failed cases rerun in isolation on the lane: **2/2 passed**. An isolated
  package build from `992cec75c` also passes those two normally. Controlled
  scheduling reproduces both exact failures on that baseline: **0/2 pass**.
  This comparison uses the baseline client sources and unchanged assertions,
  with this lane's same server binary/wasm and host/toolchain.

| Failed case | Classification and concrete reproduction |
| --- | --- |
| `identity.test.mjs`: invocation lifetime releases provider and private-core fetch and body stalls without late identity effects | **Baseline timing-sensitive test.** At `provider-token-body`, the test expects one token request but observes zero. Its cancellation status arrives after a fixed interval; it marks the phase entered before the network request/body actually arrives. On the `992cec75c` package, delay fetch of `/token` by 150 ms: cancellation wins and the identical `0 !== 1` assertion fails. Identity/provider/server code and this test are unchanged by lane O. |
| `local-e2e.test.mjs`: a device restores its session on its own | **Baseline timing-sensitive test.** The immediate old-token query expects `E_AUTH` but the response has no denial yet. `signOut()` deliberately starts logout without awaiting the remote request, on both main and this lane. On the `992cec75c` package, delay fetch of `/auth/logout` by 1,000 ms: the unchanged immediate assertion fails with `undefined !== 'E_AUTH'`. The sign-out code and this test are unchanged by lane O. |

Neither failure is attributed to a lane-O product change; neither test was
weakened or edited. These two baseline scheduling assumptions remain open for
the owning integration program. No additional environmental failure occurred.
The full run remains recorded as red despite passing isolated reruns.

Reproduction commands (from `snapback4/`, with the documented toolchain PATH):

```sh
node --test --test-concurrency=1 \
  --test-name-pattern='invocation lifetime releases|a device restores its session on its own' \
  packages/snapback4/test/identity.test.mjs packages/snapback4/test/local-e2e.test.mjs
node --import ./target/lane-o-r1-evidence/baseline-timing.mjs --test --test-concurrency=1 \
  --test-name-pattern='invocation lifetime releases|a device restores its session on its own' \
  target/lane-o-r1-evidence/baseline-992cec75c/snapback4/packages/snapback4/test/identity.test.mjs \
  target/lane-o-r1-evidence/baseline-992cec75c/snapback4/packages/snapback4/test/local-e2e.test.mjs
```

The baseline is a `git archive 992cec75c` of the package and chat schema with
shared dependencies and the same binary/wasm; it was built with the ordinary
package build. The timing preload wraps `globalThis.fetch`, delays only the
named paths above, then calls the original fetch with the original input and
signal. It changes neither product code nor assertions. Evidence, baseline
source, mutation preloads and exact logs remain under
`target/lane-o-r1-evidence/` (`full-test.log`, `full-test.exit`,
`failed-cases-isolated.log`, `baseline-failed-cases.log`, `baseline-timing.log`).
No push or publication has been performed.
