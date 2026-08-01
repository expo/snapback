# A1 local-first floor — Firebase reference observations (PROBE)

**Probe:** LLP 0137 Stage 3 competitor probe, contract `a1-field-notebook.v1`
slice A1-05..A1-09. **Reference observations only — no ranking claims; not a
championship arm.**
**Provider path:** official modern Firebase web — `firebase` 12.17.0 modular
SDK, `initializeFirestore` + `persistentLocalCache` +
`persistentSingleTabManager`, Auth anonymous provider; official Emulator
Suite (`firebase-tools` 15.25.1, `demo-snapback-probe` project id, Firestore
127.0.0.1:8181, Auth 127.0.0.1:9199) after the live-project setup
observation below. Real Chrome via `playwright-core` persistent profiles;
offline = all emulator routes aborted at the browser while the page origin
stays reachable (the same offline shape as the Snapback A1 arm).
**Justification (probe rule 2):** no frozen evidence covers A1's local-first
floor as a contract; findings 0137-a1-f4/f5/f6 and 0137-a1expo-f2/f3/f7 need
a what-does-good-look-like reference.
**Capsule:** `run-capsule.json`. **Raw data:** `evidence/observations.json`.

## Setup observations

- Live project `snapback-probe` (client config from the keys file):
  Anonymous auth **enabled** (REST signUp mints an idToken), Firestore
  **enabled** — but security rules are **locked** (authenticated read
  returns `PERMISSION_DENIED`) and rules deployment needs owner
  credentials the probe does not hold. Recorded as the console-side
  enablement gap; the probe fell back to the official Emulator Suite under
  the `demo-` prefix (guaranteed no live-project contact). Hosted /
  production-backend behavior is therefore **not** probed (G2-style gap).
- No system Java: the Firestore emulator ran on Android Studio's bundled
  JBR. `firebase-tools` does not surface the dependency until start.
- Getting the floor demonstrable took ~9 active minutes from `npm install`
  to all legs green — the SDK's offline surface is one construction option
  plus per-snapshot metadata.

## Observations per floor dimension

### Cold-boot retained render (A1-05 shape)

A genuinely cold Chrome relaunch (new process, same profile) with every
backend route aborted rendered **all 3 protected rows `fromCache: true` in
26ms**, and the anonymous auth uid was restored from IndexedDB without
network. Retained render is the default once `persistentLocalCache` is
configured — no per-query opt-in exists (contrast: Snapback's undocumented
three-flag opt-in, finding a1-f4).

**Caveat observed (not in the happy-path docs):** when the persistence
lease was still held by a dying predecessor process, the SDK silently fell
back to an **empty in-memory cache** — first snapshot `rows: 0,
fromCache: true`, no error, no degradation fact anywhere. The fix is
`persistentSingleTabManager({ forceOwnership: true })` for restart-shaped
lifecycles. A field app that missed this renders an empty notebook offline
with no way to tell. (Snapback's `rqsStoreInfo`/`retention` facts are the
refuse-with-clarity contrast.)

### Retained protected reads and freshness honesty (A1-06 shape)

The entire honesty surface is one boolean per snapshot:
`snapshot.metadata.fromCache` (true offline, false once server-synced).
There is no retention fact, no refusal contract, and **no custody
boundary**: protected rows are cold-retained for whoever holds the device
profile, and security rules are not re-evaluated for cached reads offline.
Firebase's answer to "retained protected reads" is *always yes, custody =
the device*; Snapback's is *never without lease custody, refusal on the
handle*. These are opposite design postures; the reference fact is that
Firebase ships the product outcome (offline protected render) with a
thinner honesty/custody story.

### Queued writes rendered WITH cached rows, durable across restart (A1-07 shape)

The floor fact the Snapback D3 rule forecloses is real here:

- Offline create + update rendered **immediately beside** the 3 cached rows
  (4 rows, `pending: true`, 68ms after init).
- After a **full browser restart while still offline**, the first snapshot
  (24ms) rendered **4 rows from cache with the queued write still marked
  pending** — cached rows and durable queued intent together.
- The second client saw exactly 3 committed rows until reconnect (honest
  no-remote-commit).

The queue itself is opaque: no enumerable outbox, no client-visible intent
identity or sequence, no failed-intent ledger — `hasPendingWrites` booleans
are the entire surface. (Snapback's enumerable `outboxRecords()` with
minted ids/sequences is richer evidence; Firebase's is the better default
render.)

### Reconnect settlement and conflicts (A1-08/A1-09 shape)

Reconnect rendered cache-first (25ms, 4 rows pending), then flushed and
settled (`hasPendingWrites: false, fromCache: false`) by 75ms. Exactly one
document existed for the queued create — but only because the probe chose
deterministic doc ids (`setDoc(doc(col, key))`); idempotency is the
author's job, not a settlement-ledger property, and there is no
receipt/changed-count/version envelope to assert against. The
offline-vs-online same-field conflict settled deterministically in
server-apply order — the reconnecting client's queued update landed after
the online edit and won the field — silently: blind last-write-wins, no
revision check, nothing surfaced to either client. Both clients converged
to the byte-identical final value.

### Second-client convergence

The online second client observed the flushed queue and the conflict
outcome live via its own `onSnapshot`; both clients' final `r1.notes`
values were identical (`conflictOutcomeIdentical: true`).

## Reference summary for the Snapback design decisions

- **For a1-f6 (D3 pending-outbox blank):** the reference behavior renders
  cached rows + durable queued writes together after an offline restart.
  Firebase achieves it with blind overlays and silent LWW; a Snapback
  answer can keep its honesty invariant (retained-marked rows + explicit
  pending-intent facts, no fabricated overlay) and still match the render.
- **For a1-f4 (retainability opt-in):** the reference default is
  retain-everything-once-persistence-is-on; whatever Snapback documents,
  the discoverability bar is "one construction decision".
- **For a1-f5 / a1expo-f3 (React/Expo offline surface, durable store):**
  the reference exposes offline state to UI as per-snapshot metadata on the
  same subscription objects apps already hold — no separate machinery.
- **What the reference lacks that Snapback already has:** retention/refusal
  facts, degradation facts (the silent empty-cache fallback), enumerable
  outbox, settlement envelopes/receipts, revision-visible conflicts, and a
  custody boundary for protected data at rest.

## Cleanup

`probeRecords` deleted through the SDK (4 docs; second client observed 0
rows), emulators + static server stopped, ports 8181/9199/4610/4400
verified free, browser profiles (the IndexedDB holding cached and queued
probe data) deleted, live project never written.
