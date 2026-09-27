# Lane DC — delivery client implementation, 2026-09-27

Status: **not ready to land**. The client-half implementation is committed for
review. The fixed wasm budget is exceeded; no budget or meter was raised.
The unchanged request interface also cannot fence server execution across a
mutation name rebound to another tracked table. This report distinguishes
that from the implemented fence on stale client callbacks.

Branch: `sb4-intent/dc-delivery-client`, base `3369ae543`.
Implementation commits: `8efcfbb66` (device), `9eac9e44c` (queue/clients),
`38a19ec97` (bounds, lifecycle fixes and additional witnesses).
No push and no package publication.

## Files

All paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/schema.rs` | Optional `Schema.delivery` and the shared binding re-export for the agreed producer/consumer interface. No compiler implementation. |
| `crates/snapback4-core/src/schema/delivery.rs` | Shared `DeliveryBinding`, split out to keep `schema.rs` at 1,497 lines. |
| `crates/snapback4-core/src/schema/capabilities.rs` | Defaulted/omitted empty delivery field in the existing schema codec. |
| `crates/snapback4-device/src/call.rs` | Internal `delivery` operation and effective local time handoff. |
| `crates/snapback4-device/src/device.rs` | Candidate collection around publication and all committing restore/replay paths; effective delivery time. |
| `crates/snapback4-device/src/device/delivery.rs` | Viewer metadata, bounded group/interval state, final row eligibility, queue compare-and-swap, binding reconciliation, first-activation cursor/done per binding. |
| `crates/snapback4-device/src/device/deferred.rs` | Accepted-put candidates, deferred install candidates, and private leave markers applied only at publication. |
| `crates/snapback4-device/src/device/store_identity.rs` | Clear current viewer delivery state in the transaction detecting restore/replacement. |
| `crates/snapback4-device/tests/delivery.rs` | Sixteen memory/SQLite fixture tests. |
| `packages/snapback4/src/delivery-state.ts` | Interval union/subtraction, exact manifest decoding, binding/group identity, state caps and refused tombstones. |
| `packages/snapback4/src/delivery.ts` | Four-slot scheduler, fairness, persisted attempts, deadline/backoff, outcome classification, parked wakes and callback fences. |
| `packages/snapback4/src/local-delivery.ts` | Serialized CAS storage, bounded activation scheduling, local direct transport and per-call restore captures. |
| `packages/snapback4/src/online-delivery.ts` | Memory queue transport using captured credential revision and read floor. |
| `packages/snapback4/src/backend.ts` | Compiled delivery binding types. |
| `packages/snapback4/src/local-device.ts` | `LocalOptions.onDeliveryRefused`. |
| `packages/snapback4/src/local.ts` | Register the queue, keep dispatch behind restore witnessing and idle serial network work, collect fallback answers, publication wakes and lifecycle fences. |
| `packages/snapback4/src/local-query.ts` | Carry manifests and credential revisions through fallback/composition; persist at acceptance. |
| `packages/snapback4/src/client.ts` | Online queue, current-credential manifest acceptance, generation/viewer/store fences, bounded sign-out drain; export callback type. |
| `packages/snapback4/src/app.ts` | Forward the callback to the online tier; local options already propagate. |
| `packages/snapback4/test/delivery.test.mjs` | Queue and interval-state fixtures. |
| `packages/snapback4/test/delivery-clients.test.mjs` | Online home-screen reporting, out-of-order response floors, local persistence/dispatch/restore integration. |
| `packages/snapback4/test/delivery-web.test.mjs` | Real wasm persistence and prediction-withdrawal witnesses. |
| `packages/snapback4/test/delivery-crash.test.mjs` | SIGKILL/reopen witness for wasm publication debt and the uncertain attempt id. |
| `packages/snapback4/test/delivery-outbox.test.mjs` | Real local client/server: 21 queued writes stay ordered and precede delivery dispatch. |
| `packages/snapback4/test/helpers/delivery-crash-worker.mjs` | Child host with atomic filesystem persistence, killed without close. |
| `packages/snapback4/test/helpers/delivery-fixture.mjs` | Shared compiled binding, rows and publication fixture for wasm tests. |
| `packages/snapback4/test/react.test.mjs` | Update intentionally changed card tests: no delivered mutation/progress subscription/page walk; retain seen retry/remount/viewer tests. |
| `crates/snapback4-lang/src/guide/receipts.rs` | Remove delivery reporting from the hook; retain `seen` debt, add a member-only query, document SDK reporting and callback. DS still owns the clause and `RUNS_FULL` body change. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Public callback, collection, retries, bounds, identity, and lifecycle contract. |
| `reports/20260927-dc-delivery-client/comparative.patch` | Reviewable four-file adaptation of the actual comparative, kept inside this lane's fence. |
| `reports/20260927-dc-delivery-client/comparative-source.sha256` | Source identities for that patch. |
| `reports/20260927-dc-delivery-client/rebinding-counterexample.mjs` | Executable transport-boundary reproduction of the rebinding limitation. |
| `JOURNAL.md` | One append-only dated lane record after verification. |

## Forms exercised

Compiled backend fixtures now deserialize and run on memory, SQLite and wasm:

```json
{"delivery":[{"table":"messages","group":"conversation","position":"ordinal","mutation":"delivered","args":["conversation","from","through"]}]}
```

That object is the backend's `schema` fragment. DS supplies its Quarry
producer; this lane does not claim the new Quarry clause compiles without DS.

Both clients consume successful accepted answers carrying, for example:

```json
{"delivery":[{"table":"messages","mutation":"delivered","args":["conversation","from","through"],"rows":[["c",41],["c",42],["c",44]]}]}
```

This produces direct `/m/delivered` requests for `[41,42]` and `[44,44]`,
never for missing position 43:

```json
{"id":"00000000000000000000000001","args":{"conversation":"c","from":41,"through":42},"store_id":"S"}
```

The public callback is an **option**, preserving the existing `Client`
contract and `onWrite`/outbox semantics:

```ts
createClient({
  url, session,
  onDeliveryRefused: ({ table, group, from, through, why }) => {
    console.log(table, group, from, through, why.code);
  },
});
```

The same option is accepted by `createLocalClient` and `createApp`.
`DeliveryRefused` is exported as a type from `snapback4/client`.

## Tests and evidence

Targeted device run: **16 passed, 0 failed**. Each scenario runs once on
memory and once on SQLite:

- `publication_*`: no staged collection; terminal promotion; exact gaps;
  no collection of put/delete, expired or numerically unsafe positions; CAS conflicts cannot
  overwrite publication debt; restart durability; scope drops debt.
- `activation_*`: a 500-raw-row page yielding no eligible rows still advances;
  restart resumes the cursor; the second binding enumerates independently;
  the done marker prevents another scan.
- `settlement_*`: activation excludes a pending edit; withdrawal collects its
  confirmed image; settlement and dequeue collect only restored identities.
- `saturation_*`: saturated state survives reopen and ignores new rows.
- `horizon_*`: an ordinary put rejected by the acquisition floor creates no debt.
- `bounded_attempt_*`: evicting lowest debt also discards its persisted uncertain
  attempt, so an old callback cannot restore the evicted interval.
- `deferred_retarget_*`: publication retargeting exposes and collects the old
  prediction base; private deferred rows collect only at installation; a row
  installed and deleted by that terminal page is absent from debt.
- `retained_*`: a text-only staged row kept with `acquired: true` but now Left
  does not collect; retained `acquired: false` replacement copies do not collect.

Targeted queue/client run: **44 passed, 0 failed**. The 40 queue cases cover
both refusal envelopes, exact intervals, argument names, two tables sharing
coordinates, four slots, one per group, fairness, backoff slot release,
same-id restart, recorded conflict with a new id, deadlines, both auth cases,
missing heads, offline retry accounting, refused suppression/eviction,
saturation, leave/rejoin callbacks, online collection versions, generation
and viewer callback fencing, eight retries, multiple exhausted attempt ids,
coalesced wakes, the slow timer and owed-work priority. The final cases exercise
CAS retries abandoning stale refusal/auth/offline effects, debt splits at the
cap, uncertain-attempt eviction, and pre-transport gate races without retry use.
The four client cases prove home-screen manifest reporting without a user
mutation, out-of-order heads checked against their own floors, and local
acceptance persistence plus witness/outbox gates and restore clearing, and
synchronous sign-out while its active report receives the bounded drain.

The two real wasm host tests pass atomic row/debt persistence, failed-save
rollback, reopen recovery, provisional exclusion and withdrawal collection.
They use the actual wasm adapter and its persistence batch. The additional
SIGKILL test uses that adapter with atomic filesystem persistence: a second
process recovers debt and retries the same attempt id. This is not an IndexedDB
browser witness. The additional outbox test uses the real local client, wasm
store and live server, injecting DS's compiled binding and successful delivery
response; all 21 user writes arrive in order before the first report.
The four wasm/crash/outbox tests pass on the final artifact.

The whole guide passes **86/86**, routes **9/9**, updated React recipes **45/45**.
The affected client recheck ran 187 tests: 186 passed and one new drain test
incorrectly required an already completed request's signal to be aborted. That
assertion was removed; the 44-case queue/client recheck then passed. All nine
full-suite client failures listed below have passing affected rechecks.

Required full command: `scripts/test.sh`, run once with eight Cargo jobs,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`, `CARGO_INCREMENTAL=0`
and `ulimit -n 65536`. Exact summary (exit 1):

```text
== 3 failure(s) in 1586 s
   wasm build
   cargo test
   client tests
```

Every failure is **lane-owned**; none is classified baseline or environmental:

| Gate / failing test | Cause and final disposition |
|---|---|
| wasm build | Initial full-run artifact 591,775 B gzip exceeded 572,841. Final artifact is 592,035 B; still blocked. |
| cargo: `snapback4-lang::routes::generated_route_handlers_typecheck_against_the_real_runtime` | `DeliveryGroup` inference depended on `noUncheckedIndexedAccess`; explicit optional type fixes it. All 9 route tests pass. |
| client: `wasm: a paged upgrade restore halts follow and flush` | Wrapping the serial network promise in `finally` changed its completion ordering. Preserve the original returned promise and observe its settlement separately. Native and wasm affected rechecks pass; the unmodified base also passed, confirming this was ours. |
| client: `closing a pending watch prevents its response from scheduling expiry or rerunning dirty work` | Queue armed the ten-minute timer even without delivery state. Arm when state exists/arrives. Affected recheck passes. |
| client: `README first account: online, generated API, password, avatar, reopen and denied read` | Same optional-type inference as route typing; recheck passes. |
| client: `README first account: local, generated API, password, avatar, reopen and denied read` | Same optional-type inference; recheck passes. |
| client: `online: keep remount lifetime, isolation, last subscriber and sign-out` | Awaiting delivery before ending credentials delayed synchronous sign-out. Begin the bounded drain, then end credentials/ordinary work immediately. Recheck passes. |
| client: `online: dispatch subscriber signOut prevents the POST` | Same synchronous sign-out regression; recheck passes. |
| client: `react.test.mjs` module setup | Recipe extraction required removed `runsOf`; assertions also required hook delivery. Updated deliberately with the changed card. All 45 React tests pass. |
| client: `web-reachable typed JSON calls all use the codec funnel` | New device conversion sites used the restricted `to_value` adapter. Route them through existing `encoded`/`decoded` text codecs; recheck passes. |
| client: `census kills parse, encoded, MQ components and container regressions` | Same two codec sites polluted mutant counts; recheck passes. |

Client models passed in the full run (312 seconds). After fixing the failures,
only affected checks were repeated; **the full-suite red is not relabeled green**.
The nine-case focused lifecycle recheck passes. The subsequent 187-case affected
run passed every pre-existing test, and its one new test assertion was corrected
and rechecked as described above. Final package build and `git diff --check`
pass. All changed source/test files stay below 1,500 lines (local client 1,478;
React tests 1,441). Evidence logs are under `target/lane-dc/` (ignored output).

## Wasm

Same source path, same toolchain and build command, `CARGO_INCREMENTAL=0`:

| Artifact | Raw bytes | Gzip bytes |
|---|---:|---:|
| Clean base `3369ae543` | 1,981,512 | 572,053 |
| Current implementation | 2,044,359 | 592,035 |
| Delta | +62,847 | +19,982 |

Budget remains **572,841 B**; the implementation is **19,194 B over**.
`bash scripts/build-wasm.sh` reproduces the failing budget gate.
The baseline was rebuilt from the base's tracked Rust files temporarily at
the same path, with all lane source bytes restored in a `finally` block.
A separate archive-path build was discarded as a delta baseline because
embedded source paths changed its bytes.

## Decisions, deviations and open work

- The internal device/host API uses opaque JSON metadata plus compare-and-swap.
  This was unspecified by the RFC. Publication and callback writes cannot
  silently replace each other's debt. The schema's optional Rust field is the
  minimum shared representation needed before DS lands; integration should
  keep one definition of `DeliveryBinding`, with the agreed field names.
- JavaScript queue arguments use numbers. Coordinates outside
  `[-9007199254740991, 9007199254740991]` are omitted, rather than rounded to an
  unfetched position. This numeric limit was unspecified by the RFC. Reproduce
  with `cargo test -p snapback4-device --test delivery publication_`: the
  publication includes position `9007199254740993`; it produces no debt for
  that position. Supporting every i64 coordinate needs a separately agreed
  exact-number wire/host representation; this lane preserves the given wire.
- `onDeliveryRefused` is a construction option, not a new `Client` method.
  The event carries binding argument **names**, plus group/from/through and
  the server refusal. It does not mint an outbox entry or invoke `onWrite`.
- The fixed wasm budget is unmet. This is a lane-owned landing blocker, not
  an environmental failure. No engine meter was weakened to fit it, and no
  budget increase is proposed by this implementation.
- The specified binding generation fence protects callbacks, but cannot
  prevent an already accepted server request executing a rebound mutation.
  Reproduce with:
  `node reports/20260927-dc-delivery-client/rebinding-counterexample.mjs`.
  It dispatches a report for fetched `messages/c/41`, changes the definition
  of `delivered` to report `photos`, fences the client generation, then lets
  the accepted request execute. Its body has no table or generation, so the
  simulated writer records `photos/c/41`, although no photo was fetched.
  This is a transport-boundary counterexample, **not a DS server E2E test**.
  The current server resolves `engine.mutate(op, ...)` under the writer after
  its request preflight (`serve.rs`); the existing wire cannot distinguish
  those two bindings. I stopped at the agreed callback fence rather than
  inventing a request field or weakening the report-only-fetched contract.
- DS's compiler, wire manifest production, `RUNS_FULL` and receipt-only no-op
  are absent from this lane's base. Tests use their agreed fixtures. The
  full comparative choreography and the unfetched-middle control remain
  integration work. The patch removes the shell `DeliveryAck`, the screen's
  delivered mutation and `progress` subscription, gets `seenOrdinal` from
  `conversationById.me`, keeps `seen` and the `progress` query, and adds the
  clause and `RUNS_FULL` guard. `git apply --check` passes against the named
  comparative checkout. That external app was not modified or run.
- The device path matrix is most complete on memory and SQLite (16 tests).
  Wasm has publication rollback, restart, prediction/withdrawal, killed-host
  debt/attempt recovery and real-client outbox witnesses. A full mirror of every
  memory/SQLite path on wasm, a native process-kill witness and an IndexedDB
  browser crash witness remain unclaimed. DS's comparative choreography and
  unfetched-middle controls also remain unrun.
- Existing React tests deliberately changed because they extracted `runsOf`
  and required the removed hook-owned delivery/catch-up loop. They now extract
  `Viewed`/`useReceipts`, assert only `seen`, no `progress` and no automatic page
  walk, and retain the view retry/remount/viewer isolation checks.
