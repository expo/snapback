# Diary 0043: A1 offline field notebook — improvement-sweep arm

**Application:** A1 offline field notebook (LLP 0137 contract `a1-field-notebook.v1`)
**Arm:** snapback-web, external consumer, public `@expo/snapback-*` 0.1.7 closure
**Date:** 2026-08-01
**Builder:** Claude (Fable 5), second diaried sweep arm after A2
**Capsule:** `demos/improvement-sweep/arms/a1-snapback-web/run-capsule.json`
**Result:** 10 pass / 1 GAP / 1 expected-refusal / 1 fail / 0 Stop, expectedChecks=13 enforced

## 2026-08-01 — the arm

### Setup and posture

Clean external directory in the session scratchpad, npm-installed 0.1.7
closure (13 packages, ~5s), `snapback new notebook-app --template react`,
then the frozen neutral-web shell merged in with only the notebook view
wired. Sessions mode again, for the same reason as A2: dev mode's
client-asserted `userId` would make every negative check vacuous. The offline
legs run as genuinely cold child node processes sharing one arm-owned durable
store directory (`SNAPBACK_CLIENT_RQS_DIR`), which is as close to "quit the
browser, reopen it in a tunnel" as a headless harness gets. Zero posture
breaks; four assistance events, all packaged-bytes reads (each filed as a
finding so the guide absorbs it), plus reuse of A2's persona recipe (f6 cited,
not re-filed).

### What felt easy or genuinely good

- **Install → authoritative first read in about ten minutes**, including
  authoring five tables and fourteen operations. The membership declaration
  from A2 transplanted to workspaces without thought (bootstrap host seat,
  invite, self-accept, self-leave — same grammar, same three-line handlers).
- **The offline core is real, and it is genuinely good.** The durable outbox
  worked the first time I called it, under real sessions custody (external
  bearer): a connectivity-refused `createRecord` returned
  `{ queued: true, clientMutationId, sequence: 1 }`, the queued update took
  sequence 2, both survived killing the process while the server stayed down
  (a second cold process read them back from the store's own
  `outboxRecords()`), and after the server returned,
  `replayQueuedMutations()` drained `{replayed: 2, failed: 0, remaining: 0}`
  in order, exactly once, with a no-op second drain. The second device
  watched the replayed record arrive over its live handle. No frozen arm —
  Firebase and InstantDB included — surfaced settlement evidence this
  machine-checkable.
- **Cold-boot retained render works as documented** — once you find the
  opt-in (below). The genuinely cold process with the transport refusing
  rendered the three seeded sites with `freshness: 'retained'`,
  `connection: 'stale'`, and `retention.reason: 'offline boot from verified
  persisted entry'`. Nothing was relabeled live. The honesty axis is the best
  I have seen on any backend; Firebase's `fromCache` is a boolean by
  comparison.
- **Refusal quality.** The protected records handle carries a frozen
  `retention` fact naming the exact code, a prose reason, and the resolved
  store — and the sentinel grep proved the durable store never held one byte
  of protected data through warm subscribe, cold boot, revocation, and
  logout. That is a defensible privacy posture Firebase simply does not have
  (it happily persists protected rows in IndexedDB).
- **The versioned-seed reset finally paid off.** A2 hit the raw-reset wedge
  (f7); this arm used `resetInstallVersionedSeed` instead: receipted,
  predecessor-stream-gated, restored the literal seed (deleted exactly the
  arm's 10 rows), and the next `snapback dev` accepted the database. This is
  the cleanup story every acceptance loop wants — once you discover the
  custody recipe (finding f9).
- **Iteration speed.** The final 13-check suite — two server stop/start
  cycles, five cold child processes, a destructive receipted reset — runs in
  6.6 seconds. The dev lifecycle (ready descriptor, `snapback.dev.v1`
  events, stdin-close stop) makes the suite own its server without a single
  log parse.
- **Deterministic export for free:** byte-identical `sha256` across reruns
  and across a full reset/reseed/replay cycle.

### What felt hard, surprising, or bad

- **The asset story on 0.1.7 is broken end to end for its actual purpose.**
  Three findings stack: an `assetRef` field makes its table unqueryable
  (f1 — the result-contract compiler has no AssetRef mapping, so both
  declarative and JS queries over the records table refused at codegen);
  the packaged `SnapbackAssetClient` sends no bearer and no protocol offer,
  so sessions-mode uploads die at attempt creation (f3); and — the arm's
  only check-level FAIL — `ctx.assets.attach` admission never reaches the
  commit validator, so every admitted `assetRef` write refuses with
  `SNAPBACK_ASSET_REF_UNVERIFIED` (f2; isolated across four variants
  including a minimal single-write mutation). Upload, strict delivery,
  content-hash integrity, outsider denial, and deletion all verified over
  authenticated raw HTTP — the server lifecycle is solid — but **no
  application can attach an asset to a row on the public closure**, which is
  what attachments are for. Two papercuts rode along: a schema-module
  `defineAssetUpload` export is silently dropped (f8), and a `text/plain`
  accept entry can never finalize because plain text byte-detects as
  octet-stream (f10).
- **The offline floor defaults to OFF in a sessions app** (f4). Until you
  declare `auth: 'public'` + `authorityIndependent: true` (+ `retainable`)
  on a query, everything — including a public reference table — is
  authority-scoped, nothing persists, and the shipped cold-boot claim never
  engages. The offline page teaches the behavior but not the declaration;
  I found the flags in packaged `define.mjs` bytes. One paragraph of docs
  fixes this.
- **The D3 rule makes offline capture and retained render mutually
  exclusive** (f6, the arm's most product-shaped observation). The moment
  anything is queued, an offline relaunch renders *nothing* — the same sites
  query that had just cold-booted retained threw the raw connectivity error
  once two intents were pending. For a field notebook this is close to a
  contradiction: capturing offline is the whole point, and doing so blanks
  the next offline boot. The rule is documented and honest (the arm has no
  local execution, so it refuses to fabricate an overlay); the frozen bar
  disagrees with the outcome anyway — Firebase and InstantDB both rendered
  cached rows *plus* queued writes after relaunch (Diary 0027). This needs a
  designed answer, not a workaround.
- **React cannot see any of it** (f5). The React arm exposes rows, status,
  and the connection axis — no freshness, no retention fact, no queued
  count. My shell's "Fresh/Stale" chip is wired to connection status with a
  finding comment, because that is all a first-party React consumer can
  render honestly today. The substrate has every fact; the projection is
  simply missing.
- **`authLogout` is custody-gated in a way the guide never states:**
  external-bearer clients refuse it ("requires AuthCoordinator custody"),
  and the coordinator flow is constructible headless only after reading
  `@expo/snapback-contract` types (AuthCoordinator + memory custody
  storage). Once constructed, logout was flawless — exact 204, handle
  blanked, probe denied.
- **Small semantic split** (f7): declarative `membership:` predicates filter
  (outsider resolves with zero rows) while `requireRole` denies. Neither
  discloses, but the idioms silently give different outsider contracts. I
  chose `requireRole` so Mallory's checks assert a named refusal.
- **Codegen diagnostics were mostly excellent again**, with one regression
  from A2's experience: the result-contract refusals name the function but
  not the schema field that caused them, and the asset-intent drop (f8) is
  silent — the outlier in an otherwise fail-closed surface.

### Modeling, type flow, auth, offline, settlement — quick verdicts

- *Modeling:* tables + membership + a position/tiebreak ordering convention
  covered the notebook in 90 schema lines; the wart was the attachment side
  table forced by f1.
- *Type flow:* generated types flow exactly through the React hooks
  (readonly branded rows), and mutation results arrive unwrapped. Two casts
  were forced by the known named-type-import gap (A2 recorded it; the
  packaging fix lane appears to be landing `.d.mts` parity on origin as this
  arm records).
- *Auth:* the four-custody model (dev, external bearer, coordinator,
  agent) is coherent once mapped, but the map lives in package bytes;
  each custody unlocks different capabilities (queue: yes for external
  bearer; logout: coordinator only; versioned seed: external bearer +
  admin) and nothing in the guide says so.
- *Offline:* the M2 outbox and retained boot are real, honest, and fast;
  the protected-retention GAP (A2 f8, cited) plus f4/f5/f6 are what stand
  between this arm and the frozen Firebase/InstantDB bar.
- *Settlement:* envelopes plus queue identity made every idempotency and
  duplication assertion one line; the settlement ledger returned the
  original result on re-drain without ceremony.

### Differentiator watch (against the frozen evidence)

The frozen bar for A1's dimension is Diary 0027: **Firebase and InstantDB
both passed durable cold offline boot of protected data, queued offline
create/update, and exact reconnect settlement.** Where Snapback stands:

- **Behind the bar:** retained protected reads (explicit GAP, refuse-with-
  clarity), retained render with pending intents (D3), React offline
  projection (none).
- **At or above the bar:** queued durability + ordered exactly-once replay
  (richer settlement evidence than either), freshness honesty (retained vs
  current as a first-class fact), privacy custody (no protected bytes at
  rest without lease custody — Firebase persists them), revocation-active
  live barriers, receipted deterministic cleanup, and suite speed.
- **Must not regress while the gaps close:** the retention refusal contract,
  queue identity + ordered drain, the reset receipt, non-disclosing uniform
  denials, and the 6.6-second full-suite loop.

A fresh Firebase or InstantDB A1 probe is pre-justified by the plan (no
frozen evidence covers this exact contract), but Diary 0027's offline facts
were sufficient to place every gap this arm found; I did not spend arm
budget on a probe.

### Would I choose this backend for this app?

**For the offline notebook's data core: yes** — sessions auth, membership,
ordering, conflicts, queued replay, export, and cleanup were all faster and
more evidence-rich here than the frozen alternatives, and the honesty
contract (freshness, retention refusals, settlement) is unmatched.
**For the offline notebook as a product on 0.1.7: not yet**, for three
reasons in order: protected rows cannot render offline (the known lease-
custody gap), any queued capture blanks the next offline boot (D3), and the
React arm cannot express what the client knows. Attachments are a fourth,
independent blocker (f1+f2+f3). None of these is architectural; every one
has a small coherent fix, and the substrate underneath them is the best
local-first floor I have tested.

### Lessons for Snapback (concrete)

1. Fix the attach admission (f2) and add the AssetRef result-contract
   mapping (f1) with one packaged-closure conformance test that uploads,
   attaches, queries, and delivers — that single test would have caught
   f1, f2, f3, f8, and f10 before publication.
2. Document the retainability opt-in (f4) and project freshness/retention/
   outbox into the React hooks (f5) — the floor exists; let apps stand on
   it.
3. Decide D3's product answer (f6): retained-rows-plus-pending-intent
   presentation, or a documented exclusion.
4. Write the custody capability map into the guide (which custody unlocks
   queue, logout, versioned seed) — f9 and the authLogout surprise are the
   same missing page.

## 2026-08-01 — Track B: the same contract on Expo iOS (snapback-expo arm)

**Arm:** snapback-expo, expo-ios, external consumer, public 0.1.7 closure
**Capsule/receipt:** `demos/improvement-sweep/arms/a1-snapback-expo-ios/`
**Result:** 7 pass / 2 GAP / 1 fail / 0 Stop, expectedChecks=10 enforced
(EXPO manifest, a1 applicability); android = honest not-run (no JDK on this
host, so `expo run:android`/gradle cannot execute; emulator binary and one
AVD exist). Simulator receipt; physical-device remains a separately reported
production gate, not-run.

### Setup and the G3 pin

Pinned before any arm work: the frozen neutral-expo shell's exact versions
(Expo SDK 57.0.9 / RN 0.86.2 / React 19.2.3), the guide's documented RN path
(`clients/react-expo.md`: same `@expo/snapback-client` + generated refs +
`@expo/snapback-react` hook as web; an **Online** surface, local target
only), and a native **release** simulator build (`expo run:ios
--configuration Release`) — the page's own evidenced carrier mode. Clean
external directory again; the backend (schema/functions/seed) adopted
verbatim from this diary's web arm records (assistance event, cited), because
Track B's job is the carrier, not re-authoring the notebook. Harness = the
guide's own acceptance shape: a loopback director/witness collector the app
polls, plus `simctl` for install/launch/terminate/keychain/screenshots.
Sessions mode; alice's email-code entry runs ON the device.

### What felt good

- **Metro ate the closure with zero configuration.** The packaged client is
  deliberately bundler-safe (no static `node:` imports in the index graph —
  rqs-store-file.mjs documents the lazy-import design), so the release
  bundle built on the first attempt. No resolver shims, no metro.config.
- **The generated-refs + hook surface transplants cleanly.** The same
  `api.mjs`, manifests, `prepareReactBinding`, `SnapbackProvider`,
  `useSnapbackQuery(ref, args)` wiring as web ran unchanged on Hermes once
  crypto existed (below). Type flow through the `.mjs` import worked under
  the shell's tsconfig with only the known cast papercuts.
- **Realtime to a phone-shaped carrier is genuinely fast:** bob's host-side
  commit rendered on-device in **33–42ms** end-to-end, witnessed through the
  collector against the settlement envelope.
- **Uniform denials held on-device** (outsider read/subscribe, post-rotation
  successor, post-logout probe), and the receipted versioned reset-install
  cleanup worked identically from the mobile harness. The full 10-check
  on-device suite: **61 seconds**.
- **Honest nonclaims are honest in practice:** cold offline relaunch renders
  a truthful "backend unreachable" state (no fabricated cache), and the app
  self-healed into the notebook the moment the origin returned.

### What felt bad — the mobile floor findings (f1–f7)

- **f1: you cannot even sign in without undocumented archaeology.** RN has
  no `globalThis.crypto`; the client needs `subtle.digest`,
  `getRandomValues`, and `randomUUID`. `prepareReactBinding` dies with
  `Cannot read property 'subtle' of undefined`, nothing names the
  prerequisite, and the fix (an expo-crypto WebCrypto shim) is consumer
  homework the guide never assigns.
- **f2: the offline queue can NEVER engage on this carrier.** The M2
  connectivity classification demands `instanceof TypeError`; Expo's fetch
  rejects with a plain `Error` ("Could not connect to the server",
  ExpoModulesCore), so `offlineQueue: true` surfaces raw transport errors
  and queues nothing. A node control with identical options and an explicit
  memory store queued `{queued:true}` against the same stopped server — the
  error class is the entire story. For a *field notebook on the platform
  where people are actually offline*, this plus f3 is the product gap.
- **f3: there is no durable on-device store arm at all.** The default ladder
  is browser IndexedDB → node file → memory; RN silently gets
  `durable:false` memory. LLP 0129's "persists across cold boots BY
  DEFAULT" simply does not reach the mobile carrier. The web arm's retained
  cold boot — the best thing about this whole contract — does not exist here.
- **f4 (found here, carrier-agnostic): downgrade rotation wedges the
  client.** `replaceBearerToken` to a lesser-privileged principal throws
  `AggregateError: … completed with lifecycle failures` (inner error = the
  *expected* denial), the denial never appears on the query/hook, and
  rotating back never re-subscribes: on the React provider path the whole
  connection stays `disconnected` until process restart; on node the public
  handle ends `live`-labeled with zero rows. The web arm never exercised
  in-place rotation, so Track B caught it.
- **f7: the RN connection axis is broken at steady state.** Live for
  ~200ms, then `stale`, then a ~2s reconnect loop forever; the retainable
  public query blanks permanently after the first cycle (sites: `ready (0)`
  in every screenshot while node holds 3 rows stable). Deliveries still land
  in 33–42ms — the socket works when it matters — but the chips say `stale`
  and the reference list is empty. This is the difference between "demo
  works" and "carrier is production-shaped".
- **f5/f6:** no hosted mobile story at all on 0.1.7 (explicit GAP, local
  bridge used per the frozen rule), and the react-expo guide page's only
  snippet is a checkpoint-era API that does not exist in the package (plus a
  lifecycle helper the documented path cannot reach).
- Harness honesty note: expo-secure-store keychain entries **survive app
  uninstall** on the simulator — pre-run hygiene needs `simctl keychain
  reset`; the in-run logout evidence is app-mediated and clean.

### Differentiator watch (mobile edition)

At/above bar: delivery latency, uniform non-disclosing denials on-device,
receipted deterministic cleanup from a mobile harness, bundler-safe
packaging, no protected bytes at rest by construction. Behind bar (Firebase
RN as reference): everything offline — retained cold boot, engaged queue,
durable store — plus steady-state connection stability and rotation
lifecycle. Must not regress while fixing: the 33–42ms push, refuse-with-
clarity retention honesty, blank-before-successor rotation ordering, and the
61-second receipt loop.

### Would I choose this backend for this app on mobile?

**Not on 0.1.7.** The A1 contract is the local-first floor, and on the
documented Expo path that floor is absent: no durable store (f3), a queue
that cannot engage (f2), an entry path that requires an undocumented
polyfill (f1), and a connection axis that misreports steady state (f7). The
data core underneath — sessions custody, membership, settlement envelopes,
denial uniformity, live delivery — carried over beautifully, which is
exactly why the carrier gaps read as finishable engineering rather than
architecture: f1/f2 are small classification/primitive fixes, f3 is one
store arm implementing an already-defined contract, f4/f7 are lifecycle
conformance work. The web arm's verdict ("best local-first floor I have
tested, not yet a product") becomes, on mobile: **the floor hasn't shipped
to this carrier yet — and the receipts now say precisely what's missing.**

## 2026-08-01 — PROBE: Firebase on the same floor (Stage 3 reference)

**Probe, not an arm.** Reference observations only — no ranking claims.
Capsule: `demos/improvement-sweep/probes/a1-firebase-web/run-capsule.json`;
observations: `probes/a1-firebase-web/reference-observations.md`.
Justification is probe rule 2: no frozen evidence covers this contract's
floor, and findings a1-f4/f5/f6 plus the Expo arm's a1expo-f2/f3/f7 needed a
what-does-good-look-like reference.

The official modern path (firebase 12.17.0 modular SDK,
`persistentLocalCache`, anonymous Auth) against the official Emulator Suite
under a `demo-` project id, driven through real Chrome persistent profiles
with backend routes aborted for the offline legs. The live `snapback-probe`
project turned out half-enabled — anonymous auth and Firestore on, security
rules locked, rules deployment owner-credentialed — recorded as the setup
observation; the emulator fallback also keeps the probe aligned with the
frozen Diary 0027 Firebase practice. No system Java: the Firestore emulator
ran on Android Studio's bundled JBR.

What the reference showed, in one run (~7s, five browser relaunches):

- **Cold-boot retained render:** 3 protected rows `fromCache:true` in 26ms,
  anonymous uid restored offline from IndexedDB. No per-query opt-in exists
  — persistence is one construction decision (the discoverability bar for
  our a1-f4 fix).
- **The D3 contrast fact is real:** offline create+update rendered
  immediately beside the cached rows, survived a full browser restart while
  still offline (first snapshot: 4 rows from cache, queued write still
  pending, 24ms), and the second client honestly saw only committed rows
  until reconnect. This is exactly the render Snapback's LLP 0090 D3 rule
  forecloses (a1-f6) — achieved with blind overlays and silent LWW, which
  is the part a Snapback answer should not copy.
- **Reconnect:** cache-first render, flush and settle by 75ms; exactly one
  doc for the queued create, but only because I chose deterministic doc
  ids — idempotency is the author's job here, there is no settlement
  envelope, receipt, or changed-count to assert against.
- **Conflict:** offline-vs-online same-field edit settled deterministically
  in server-apply order (the reconnecting client won), silently — no
  revision surface, nothing shown to either client; both clients converged
  byte-identically.
- **The honesty gap runs the other way:** the entire offline surface is one
  `fromCache` boolean. No retention facts, no refusal codes, no enumerable
  outbox, no custody boundary (protected rows are cold-retained for whoever
  holds the device; rules are not re-evaluated offline) — and one sharp
  trap: with the persistence lease briefly held by a dying predecessor, the
  SDK **silently fell back to an empty memory cache** (`rows:0,
  fromCache:true`, no error anywhere) until
  `persistentSingleTabManager({ forceOwnership: true })`. An app that
  missed that renders an empty notebook offline with no way to tell.
  Snapback's `rqsStoreInfo`/`retention`/receipt surfaces are ahead of this
  reference on every evidence axis.

Net reference for the design decisions: match the render (cached rows +
durable queued intent together after an offline restart, one-decision
retainability, offline state on the objects apps already hold), keep the
honesty (facts, refusals, receipts, custody) the reference lacks. Cleanup
proven: probe docs deleted through the SDK (second client observed zero),
emulators and static server stopped, ports verified free, browser profiles
deleted, live project never written.
