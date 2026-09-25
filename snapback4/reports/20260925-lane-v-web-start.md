# Lane V — synchronous web admission and acquisition

Date: 2026-09-25. Branch: `sb4-intent/v-web-start`, based on `a52b48cad`.
Scope: LLP 3000.013, Lane V for 0.4.2. No push or package publication.

Implementation commits: `26ad8a083` (admission/progress), `65231c446`
(IndexedDB packing/benchmark) and `a04b83063` (ephemeral-provider refusal).
All carry the requested co-author footer.

Browser mutations now synchronously journal their intent or return an already
failed promise with `E_ADMISSION`. `useAcquisition()` reports committed snapshot
progress without blocking server-backed reads. Packing IndexedDB row images
reduces the measured cold acquisition from **93.581 s to 18.386 s** (median of
three after runs, **5.09×**); the slowest after run is still **4.73×** faster.

## Diagnosis and reproduction

The generated API in `crates/snapback4-lang/src/emit.rs` emits operation
descriptors; it does not await readiness. The actual intervening await was
`guardClient.mutate` in `app-client.ts`: it awaited the locked session epoch
check before calling the local client's synchronous journal. A hard navigation
could destroy the document at that await. `webDevice()` already claims its
store exclusively. `createApp()` without `device` selects the online tier and
therefore has no web journal. A genuinely fresh device also lacks its server
store identity until sync identifies it. Those are separate refusal conditions.

Calibration #20's `src/client.ts` explicitly supplies both `webDevice()` and
`localStorageSessionStore()` on web. Its failing removal trace already contains
sync requests with a known `store_id`. Thus neither defaulting to the online
tier nor missing the first store identity explains that acquired-page failure;
the pre-journal asynchronous guard is the reproducible gap there.

The regression uses a real generated API, authenticated admin membership,
non-idempotent removal audit, actual Chromium, and `location.assign`. It holds
IndexedDB admission and the asynchronous session lock so the old guard cannot
race through by luck. Injecting the guard from `a52b48cad` produces:

```json
{"oldGuard":true,"synchronousJournalRecords":0,"mutationRequests":0,"removalsAfterReopen":0}
```

The same journey on the new guard captures one journal record in the click's
stack, reopens it under the same identity, sends the original mutation ID, and
increments the audit exactly once. A second journey captures while a restored,
identified device's initial sync is held. Before session restoration or first
store identification, accepting the write cannot safely bind it to its eventual
account/store; the specified synchronous refusal is used instead.

Reproduce from `snapback4/` after building the binary, wasm and package:

```sh
node --test packages/snapback4/test/web-start.test.mjs
SNAPBACK4_WEB_START_OLD_GUARD=1 node --test packages/snapback4/test/web-start.test.mjs
```

The second command intentionally fails. Evidence:
[old guard](20260925-lane-v-evidence/old-guard-navigation.log),
[fixed browser and React tests](20260925-lane-v-evidence/browser-react.log).

## File map

All paths below are relative to `snapback4/`.

| File | Change |
| --- | --- |
| `packages/snapback4/src/admission.ts` | Private synchronous admission and persisted-session reader registries; named refusals; fulfilled failed promises with immediately readable fields. |
| `packages/snapback4/src/auth.ts` | Registers the builtin localStorage session store's synchronous reader without changing the SessionStore interface. |
| `packages/snapback4/src/app.ts` | Refuses unbound startup writes; validates the durable epoch synchronously before admission; retains locked authorization on transport. |
| `packages/snapback4/src/app-client.ts` | Removes the browser mutation's pre-journal await; forwards acquisition through the revocable app facade. |
| `packages/snapback4/src/client.ts` | Refuses public bare online browser writes without synchronous custody; keeps private replay custody and nonbrowser behavior. |
| `packages/snapback4/src/contract.ts` | Adds optional synchronous failure fields via `MutationPromise`, preserving the awaited Write union. |
| `packages/snapback4/src/local.ts` | Captures intents before its first await; publishes progress after durable apply; resets it on acquisition/store changes. |
| `packages/snapback4/src/local-device.ts` | Extracts and reexports existing device interfaces to keep `local.ts` below 1,500 lines. |
| `packages/snapback4/src/web-journal.ts` | Refuses unavailable identity/storage, quota and bounded-journal exhaustion in browsers instead of silently falling through. |
| `packages/snapback4/src/web.ts` | Registers synchronous capture, refuses the ephemeral browser provider and consumes each prepared record once; delegates IndexedDB storage. |
| `packages/snapback4/src/writes.ts` | Exposes immediate input refusals, releases an unadmitted ID for same-ID repair/retry, and settles in-flight identity bookkeeping before awaited receipt recovery. |
| `packages/snapback4/src/acquisition.ts` | Immutable progress snapshots and subscriptions, source-table counts and facade fencing. |
| `packages/snapback4/src/react.tsx` | Exports `useAcquisition()` and its type; keeps `useAcquired()`. |
| `packages/snapback4/src/web-idb.ts` | Packs new stores' row images into 256 buckets per row store; applies the complete delta in one strict atomic transaction; reads/writes legacy stores unchanged. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Compiled mutation/refusal and nonblocking acquisition recipes, progress semantics, journal contract and persistence format. |
| `crates/snapback4-lang/src/guide/codes.rs` | Registers `E_ADMISSION` and its recovery explanation. |
| `crates/snapback4-lang/src/guide/writes.rs` | Documents progress and synchronous admission/refusal, including bounded storage and recovery conditions. |
| `crates/snapback4-lang/src/diag.rs` | Routes `E_ADMISSION` to the writes card. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pins the new refusal's definition. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pins its concrete recovery and storage-clearing boundary. |
| `packages/snapback4/test/web-start.test.mjs` | Real-browser startup/navigation/refusal/progress tests plus packed/legacy transaction rollback tests. |
| `packages/snapback4/test/react.test.mjs` | Updates unsafe online-browser admission expectations; preserves online receipt/observation hook tests through their private custody fixture. |
| `packages/snapback4/test/page-observation.test.mjs` | Gives the real browser fixture durable session stores. |
| `packages/snapback4/test/fixtures/page-observation.mjs` | Gives its seed writer a device on browsers; preserves the actual core identity when instrumenting calls. |
| `witness/lib.mjs` | Allows a test schema, entry module and explicit old-source overrides in the Chromium harness. |
| `witness/navigation-immediate.mjs` | Repairs its pre-existing stale Quarry probes to the current named-key form so all ten navigation cases run. |
| `witness/idb.mjs` | Inspects logical persisted rows through the provider and keeps its initial-save fault after format creation. |
| `witness/clique-acquisition.mjs` | Reproducible frozen-corpus benchmark, phase timings, packed/legacy selection, and fresh-document offline reopen checks. |
| `reports/20260925-lane-v-web-start.md` and evidence directory | This report and measured browser/suite evidence. |
| `JOURNAL.md` | One appended dated implementation/measurement entry. |

## Compiled and running forms

No Quarry syntax changes belong to this lane; no language-card form was added.
These TypeScript/React recipes compile in the client reference's existing test:

```ts
const app = createApp({ url, device: webDevice(), sessionStore: localStorageSessionStore() });
await app.ready;
const id = mintId();
const write = app.mutate(api.removeMember, { room: "room0", principal: "user:other" }, { id });
if (write.state === "failed") showError(write.why);
else location.assign("/members");
```

The generated operation descriptor also works with
`app.client.mutate(api.removeMember, args, { id })`. Both forms run in the
navigation test. The journal keeps ID, operation, immutable arguments, generated
row IDs and original store binding. A failed synchronous admission admits no
new intent, so the caller can repair the condition and retry that same ID.

```tsx
function Inbox() {
  const { acquired, rows, tables } = useAcquisition();
  const read = useQuery(api.inbox, {});
  return <>
    {!acquired && <p role="status">Preparing offline: {rows} rows across {Object.keys(tables).length} tables</p>}
    {"data" in read && <ul>{read.data.map(room => <li key={room.conversationId}>{room.conversationId}</li>)}</ul>}
  </>;
}
```

`tables` maps source names to committed snapshot row counts; `rows` is their
sum. These count this runtime's current acquisition, not an estimated total or
authorization to read an incomplete local partition. Warm offline reopen can
be acquired with zero newly received rows. Server fallback remains available
while preparing offline access; `held` queries retain their existing boundary.

## Acquisition measurement

Host: expo-build-1000, Linux x86_64; real Chromium 151.0.7922.34, debug server,
Node 24.13.1, Rust 1.97.0. The before run used the original per-row provider;
the after numbers below are the middle of three independent fresh-device runs.
This is an acquisition measurement, not calibration #20's whole 42.3 s UI flow.

The public fixture has exactly 50,228 posts, 1,004 reposts, 5,921 follows and
1,008 profiles. It also supplies 5,008 likes; two derived count tables add 2,011
rows. Every run acquires all **65,180** rows. The scale.log SHA-256 is
`b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`.

| Measurement | Before | After, median-wall run |
| --- | ---: | ---: |
| Total cold acquisition | 93,580.9 ms | 18,385.7 ms |
| Snapshot HTTP responses | 3,187.3 ms | 2,786.6 ms |
| Wasm apply calls | 3,239.6 ms | 3,100.1 ms |
| All Wasm calls, including apply | 3,742.3 ms | 3,567.8 ms |
| IndexedDB save waits | 85,111.3 ms | 10,572.3 ms |
| Requested page size | 4,000 | 4,000 |
| Snapshot pages / final catch-up | 17 / 1 | 17 / 1 |

Snapshot HTTP time includes server snapshot execution, serialization, loopback
transport and reading the response body; pure server CPU was not instrumented.
Apply time is a subset of Wasm time. Startup, fetches other than snapshot,
JavaScript decoding and coordination also contribute to total wall time.

The three after wall times are **15.553 / 18.386 / 19.782 s**. The corresponding
IndexedDB waits are **6.950 / 10.572 / 12.174 s**. The shared host was running
other lanes and qualification; these are observations, not a latency SLA.
The >=3× target is met by every measured after run against the before run.

A repeat using the final provider's retained legacy format took **76.250 s**,
including **70.490 s** in IDB saves, **3.024 s** in Wasm apply and **0.858 s**
in snapshot HTTP responses. It too recovered all rows offline. Even comparing
this faster legacy control with the slowest packed run gives **3.85×**. This
repeat makes the old representation reproducible without checking out old code.
Raw measurements: [before](20260925-lane-v-evidence/acquisition-before.json),
[three after runs](20260925-lane-v-evidence/acquisition-after.json), and
[legacy repeat](20260925-lane-v-evidence/acquisition-legacy-repeat.json).

The dominant cost was 195,725 individual logical persistence changes. New
stores pack only row stores `r`, `s`, `b`; all metadata, outbox and transfer
markers keep their existing representation. Bucket read/modify/write happens
inside the same strict transaction as the complete delta. There is no weakened
durability mode, delayed watermark, increased page/engine limit or removed
authorization check. All three after runs reopen in a fresh document offline,
recover the profile query with `fresh: false`, report acquired, and contain all
65,180 logical rows. Reopen times: **2.540 / 2.266 / 2.193 s**.

Commands (fixture/schema paths may be overridden using `CLIQUE_FIXTURES` and
`CLIQUE_SCHEMA`):

```sh
RUNS=3 OUTPUT=/tmp/acquisition-packed.json node witness/clique-acquisition.mjs
ROW_FORMAT=legacy RUNS=1 OUTPUT=/tmp/acquisition-legacy.json node witness/clique-acquisition.mjs
```

The benchmark projects starter-m1, starter-m2 and scale action logs into the
calibration schema. It uses personas, deterministic timestamps and null media
slots, and removes the Following timeline in the temporary schema because the
seed verb correctly refuses timeline imports. Public tables/read rules remain.
It does not claim to replay effects, assets or the application UI. The supplied
target-clique.q belongs to the other authoring lanes; this lane exercises its
public corpus and the actual calibration schema instead of changing its forms.

## Verification and failure accounting

New browser subtests prove:

- Generated API admin removal survives immediate navigation with its original
  ID, including a held session lock and IndexedDB admission.
- A restored identified device admits while its first sync is still held.
- Restoring session, no device, no provider claim, an ephemeral device, storage full and unknown
  first-sync identity each return `state: failed` / `E_ADMISSION` immediately,
  with no journal entry accepted.
- Repairing storage permits retrying the refused ID successfully.
- `useAcquisition()` publishes intermediate committed pages and final exact
  table counts, agreeing with `useAcquired()`.
- Bare online browser transport refuses without sending a request.
- Packed and legacy IDB aborts roll back rows, metadata and outbox together;
  successful update/delete and reopen preserve all logical values.

Focused checks: browser plus React **35 passed / 0 failed**; write-ID and
two-device page tests **20 passed / 0 failed**; guide **80 passed / 0 failed**;
immediate-navigation witness **10 passed / 0 failed**; IDB witness `ok: true`.
Package build/typecheck and compiled reference recipes run in the full suite.
`ref-check --verbose` passes: 509 LLP docs, 9,282 refs in 26,101 files,
zero errors and zero unchecked references.
Wasm remains **1,775,799 B raw / 495,258 B gzip**, under the unchanged 496,000 B
budget. The largest modified source is `local.ts`, 1,465 lines.

The first complete suite reported `== 2 failure(s) in 653 s`. All its failures
were mine and were fixed:

- Rust: definition census, dedicated-section census, doctor renderer and why
  renderer lacked the new E_ADMISSION routing/pins. Added them and kept its
  complete actionable definition within the selected paragraph.
- Client: malformed caller IDs in online/web/native returned an invalid ID in
  the newly immediate refusal. Restored the existing sanitized empty ID.
- Client: web/native sequential same-ID retries saw the just-finished in-flight
  promise for one extra microtask. Clear it in the first settlement handler,
  so an awaited retry recovers the receipt without a historical result.
- Client: the two-device browser page fixture used an online seed writer and
  memory-only sessions. It now uses durable web devices/sessions, while the
  native fixture retains its previous behavior.

The standalone navigation witness initially refused its unchanged, stale
positional/ambiguous key probes. This was a pre-existing witness defect; the
fixture now uses the supported named-key form and all ten cases pass.

Focused development failures also exposed the intentionally changed online
browser React expectations, a swallowed double-abort in the IDB fault fixture,
an initially overlong why excerpt, and a wrong argument in the revised session
fixture. Each was corrected; none is waived. Injecting the old guard remains
an intentional failing regression demonstration.

The second complete run reported `== 1 failure(s) in 466 s`. Its client tests
exposed an intermittent failure in the
unchanged `local-e2e.test.mjs` test `a device restores its session on its own`:
the raw server probe after best-effort logout lacked the expected E_AUTH.
It passed in the first complete run and immediately in isolation with unchanged
code ([rerun](20260925-lane-v-evidence/session-restoration-rerun.log)). Classified
as environmental/intermittent, with the precise cause unproven; it is not one of
the supplied baseline failures and is not waived. The final run uses the suite's
existing serial-client-files mode, retaining every test and all model counts.
Reproduce the focused test with:

```sh
node --test --test-name-pattern='a device restores its session on its own' packages/snapback4/test/local-e2e.test.mjs
```

The supplied host baseline reports `== 1 failure(s) in 276 s`, with four Rust
failures: legacy recorded/timeline inference, compiled search fixtures,
authoring census and why-operation output. These did not recur in my first
complete run. I did not change those areas or treat my failures as baseline.

The final serial client stage has **1,520 passed / 0 failed / 10 skipped**.
The skips are one macOS-only test, two opt-in managed-fixture tests and seven
published-binary compatibility tests. No new skip was introduced.
All **78 model tests** pass, including 5,000 online session sequences, 5,000
real-wasm local session sequences and 3,000 online-client interleavings.
[Final suite summary and skip names](20260925-lane-v-evidence/suite-final.log).
Final complete suite result: **`== 0 failure(s) in 1373 s`**, exit 0.
Command: `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh`.
[Attempt 1](20260925-lane-v-evidence/suite-attempt-1.txt) and
[attempt 2](20260925-lane-v-evidence/suite-attempt-2.txt) preserve their exact
stage summaries and failure names.

## Engineering decisions, deviations and limits

- The brief permits synchronous refusal during startup. Unknown identity is
  refused instead of guessing an account/store or creating an unbound queue.
- Browser online-only and memory/custom asynchronous session-store writes now
  refuse synchronously. This is a deliberate behavior change required by the
  admission promise. The test-only memoryPersistence provider also refuses on
  browsers: otherwise it could transfer the journal into memory and erase the
  only durable copy. Node/native callers retain their existing behavior.
- `MutationPromise` is an additive contract extension specifically to expose
  the requested synchronous failed state. The awaited Write union is unchanged.
  This exception to the ordinary lane contract fence is recorded for supervisor
  review; no extra public admission method was introduced.
- Progress resets per acquisition and counts committed source rows; it is not
  a total estimate. `useAcquired()` remains supported.
- Larger pages and streaming apply were unnecessary once measured IndexedDB
  cost was fixed. Page size and all engine meters remain unchanged.
- Existing per-row databases are supported without migration and do not gain
  the packing speedup. Reproduce with `ROW_FORMAT=legacy` above. New packed
  databases require this provider; rollback to a pre-packing client against
  those databases is not qualified. Do not erase a store with pending writes.
- Clearing browser storage after admission can erase it, as with the previous
  persistence contract. Private/incognito/browser-specific quotas can yield
  an explicit E_ADMISSION; no infinite-retention guarantee is claimed.
- Browser evidence is Chromium/Linux. Safari/Firefox, pure server CPU,
  application-wide cold UX, native simulators and package publication were not
  qualified in this lane. There is no unresolved failure in the focused checks;
  full-suite disposition is recorded above.
