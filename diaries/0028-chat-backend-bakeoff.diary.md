# Diary 0028: Chat backend bakeoff

**Type:** Diary
**Status:** Active
**Systems:** Backend bakeoff, Chat, Realtime, Ephemeral state, Auth
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Related:** LLP 0102

## 2026-07-28 — Stage 0, protocol freeze

No provider arm has started. The frozen Chat materials separate durable
message delivery from typing/presence, require transport attribution, and test
membership removal with an already-connected client. Stable pagination,
concurrent ordering, unread state, reconnect, and offline history are separate
acceptance facts so one strong realtime demo cannot stand in for the whole
product.

## 2026-07-28 — Appwrite calibration arm

**Result:** complete — 12 pass, 3 explicit GAP, 0 fail, 0 Stop-class defects.
The verified capsule is
`demos/backend-bakeoff/arms/chat/appwrite/run-capsule.v1.json`.

### Target and implementation

I used the official Appwrite 1.9.6 web installer with its MongoDB profile,
Appwrite Web SDK 26.2.0, Node SDK 27.1.0, and CLI 23.2.0. The arm had one fresh
local project, three native Auth users, one private-channel Team, four channel
rows, separate permission-scoped public/private message tables, a private
per-user unread table, and exactly 125 messages in each channel.

Splitting public and private messages into separate TablesDB tables was not an
aesthetic choice. Appwrite table-level create permission cannot validate an
arbitrary `channel_id` foreign key, so one mixed table would have let a public
user attempt a private-channel create. The split lets the private table's
create permission be the Team itself. For sent-message authorship, the UI
renders the actor derived from the server-validated per-user update ACL; `$id`
and `$createdAt` provide server-assigned identity and order fields. The
client-supplied `author_label` remains convenience data and is not credited as
authority.

### What felt good

- Auth, Teams, row permissions, TablesDB, and Realtime compose into a credible
  private chat without a custom gateway.
- Mallory could sign in and use public channels, while private rows and even an
  explicit private-row subscription produced zero events. That is a clean,
  direct negative proof.
- Native Realtime WebSockets delivered Alice's private message to Bob with a
  117.127 ms median over the seven recorded samples.
- `Query.cursorAfter` kept two 25-row pages disjoint while Alice inserted a new
  message at the front.
- An authoritative unread marker naturally synchronized across two Bob
  browsers and reconnect.
- Team membership removal blocked the next protected event and denied the
  fresh channel/query. The established React view retained its 25 historical
  rows until reload, which is a coherent if application-visible retained-data
  contract rather than a disclosure of new data.
- The current Channel helper API made TablesDB, Team, and Presence subscription
  intent unusually legible.

### What felt bad, surprising, or frustrating

- The official installer again ended its event stream during account handoff
  after the stack was actually healthy. Recovery required recognizing the
  partial success instead of rerunning setup.
- CLI 23.2.0 still expected organization endpoints absent from self-hosted
  1.9.6. I used the older native Teams route for the initial console
  organization, then returned to `appwrite init project`.
- TablesDB's inline schema API accepted strings and integers but rejected an
  inline enum column. The first API key also needed both modern TablesDB scopes
  and legacy collection/attribute/document scopes, which the initial error
  revealed only incrementally.
- During CLI behavior probing, one disposable local API key was accidentally
  printed to the command transcript. I deleted it immediately, created a new
  key through a capture-without-printing script, and verified that neither key
  entered the repository or any receipt. The lost time and the incident remain
  part of the authoring record.
- The most important product mismatch was Presences. Current official Appwrite
  docs describe first-class short-lived presence and typing, SDK 26.2.0 exposes
  it, self-hosted 1.9.6 exposes the endpoint, and the project key had the
  presence scopes. Nevertheless, an authenticated Alice Web SDK call returned
  `401 user_unauthorized`, including attempts with default owner-only
  permissions. I did not replace it with a durable typing row. `CHAT-06` and
  `CHAT-07` are explicit GAPs for this tested target.
- Realtime query-refresh code initially resubscribed whenever the channels
  array was reloaded. Under the 20-message burst that created a missed UI
  observation. Stabilizing the subscription dependencies fixed the harness,
  but this is application glue that a query-native system avoids.
- The Appwrite Web SDK has no persisted TablesDB cache or offline outbox.
  Twenty-five loaded messages survived only in mounted React memory; an
  offline reload showed zero protected messages. `CHAT-09` is a GAP.
- The official self-host stack is operationally large for a local chat demo:
  the preceding image pull remained reusable, but the arm still managed the
  generated multi-container Compose lifecycle.

### Performance and footprint

The frozen loop used two warmups and seven recorded samples on the local
Docker Desktop target:

| Path | Median | Nearest-rank p95 |
| --- | ---: | ---: |
| Authoritative 25-row read | 78.664 ms | 85.673 ms |
| Twenty-message burst to origin | 2262.696 ms | 2282.756 ms |
| Committed message to Bob push | 117.127 ms | 118.527 ms |
| Browser reconnect and resubscribe | 479.916 ms | 496.425 ms |
| Production client build | 126.069 ms | 133.502 ms |

The retained dependency tree is 285,412,643 bytes. The inventory counts 739
authored-source lines and 2,073 test/harness lines. Retaining the Appwrite CLI
for reproducibility leaves 16 npm audit findings (3 low, 6 moderate, 7 high, 0
critical); the application-only dependency subset had no findings before the
CLI was retained.

### Glue inventory

The arm carries four material glue clusters:

1. official web-installer and generated-Compose lifecycle guards;
2. console-Team compatibility bootstrap plus redacted API-key custody;
3. split public/private TablesDB schema, permissions, and deterministic seed;
4. browser authority/realtime/offline/performance/inventory/cleanup harnesses.

Compared with Snapback, Appwrite supplied far more deployment and account
machinery but required more explicit resource and permission orchestration.
Compared with Convex, the message query does not stay live by construction:
Realtime tells the React app to issue another TablesDB query. Appwrite's strong
result is broad, inspectable backend primitives; its weak result here is the
amount of integration code between those primitives and the documented native
Presence path failing on the tested self-host target.

### Cleanup

Cleanup was exact and complete. It stopped only this arm's Vite listener and
official installer, ran `docker compose down -v` against the installer-generated
file, removed only the sole Appwrite CLI session after endpoint verification,
and removed the disposable browser/runtime directories. Ports 4186, 8090, and
20080 closed; matching Appwrite containers, volumes, networks, CLI preferences,
and runtime paths were absent. Docker images, dependencies, deterministic
source, and evidence were intentionally retained.

### 2026-07-29 Appwrite inventory erratum

The final cleanup-source correction added one harness line after the entry
above was recorded. The capsule-backed final inventory is 739 authored-source
lines and **2,074** test/harness lines, not 2,073. The preceding dated entry is
left intact.

## 2026-07-29 — Convex calibration arm

**Result:** complete — 12 pass, 3 explicit GAP, 0 fail, 0 final Stop-class
defects. Evidence confidence is 15/16. The verified capsule is
`demos/backend-bakeoff/arms/chat/convex/run-capsule.v1.json`.

### Target and implementation

I used Convex 1.42.3 with the official anonymous local backend
`precompiled-2026-07-21-82d5e9f` on the isolated Hetzner worker. The target
used ports 3310/3311 and namespace `llp0102-chat-convex-w2`. Anonymous local
development had no inbox-backed identity fixture, so the arm used Convex's
documented custom-JWT provider with a worktree-local development issuer for
Alice, Bob, and Mallory. The private key was runtime-only and removed during
cleanup.

The app modeled profiles, channels, memberships, messages, read markers,
typing, and presence. Every protected function derived the actor from
`ctx.auth.getUserIdentity()` and re-read membership. Server document ids,
`_creationTime`, and a transactional per-channel sequence supplied message
identity and deterministic order.

### What felt good

- Convex's schema and function model was compact and legible. It needed no SQL
  migration layer, policy DSL, or custom API server.
- Reactive queries were the standout. One indexed query covered initial read,
  native WebSocket push, reconnect, and authorization-dependent invalidation.
- `.paginate()` returned stable cursors; two 25-row pages remained disjoint
  under an intervening insert.
- Concurrent sends were pleasantly boring. Two authenticated clients crossing
  one `Promise.all` barrier committed two rows with distinct server sequences.
- Revocation was strong: Bob's established private query errored, a fresh
  query was denied, and Alice's subsequent private message was not delivered.
- Local startup required no provider account. Schema push, typed API
  generation, the local backend, and exact cleanup all fit inside the isolated
  worktree.
- Server errors named the function, request id, classification, source file,
  and line, which materially shortened diagnosis.

### What felt bad, surprising, or frustrating

- Authentication was the largest ceremony. The custom JWT issuer was a real
  Convex auth path, but it added JWKS generation, signing, configuration, and
  key cleanup that an ordinary hosted-auth quickstart would not.
- `ConvexReactClient` exposes `clearAuth()`, while the headless
  `ConvexClient` does not. The first harness treated a token fetcher returning
  `null` as the logout barrier and produced an alarming false Stop candidate.
  The client-class asymmetry made a security-sensitive lifecycle transition
  too easy to test incorrectly.
- Convex module filenames cannot contain hyphens. An initial auth-fixture
  filename was rejected, and a separate generator error emitted literal
  newline escapes. Both were builder mistakes, but an early deterministic
  validation command would have made them cheaper.
- The local beta path downloaded a roughly 204.8 MB backend plus dashboard.
  Inventory observed about 394 MB RSS for the CLI process and 256 MB for the
  backend; npm dependencies occupied 134.5 MB.
- The pinned frontend toolchain reported one high-severity Vite audit finding.
  It is not evidence of a Convex backend vulnerability, but it remains in the
  exact dependency inventory.
- No controlled browser was available on the worker. The React app received a
  production build and the headless clients provided direct authority and
  transport evidence, but rendered-browser evidence is not claimed.

### The logout Stop-class adjudication

The first `CHAT-12` run delivered a later private message after what the
harness called logout. Metric work stopped and the target was preserved.
Official API and pinned SDK inspection showed that the harness had used the
wrong client/lifecycle mechanism.

The corrected proof used `ConvexReactClient.clearAuth()`. The established
private watch immediately errored `UNAUTHENTICATED`; same-client and brand-new
anonymous private reads were denied. Alice then committed one uniquely named
private message, and Bob's already-connected watch received no event. The raw
false-positive receipt, read-only diagnosis, one-message rerun, and a label
erratum are retained rather than rewritten. This is a harness error with real
DX lessons, not a Convex disclosure.

### Realtime, offline, and ephemeral state

Durable realtime was excellent: second-client push, reconnect, unread markers,
logout invalidation, and membership revocation all had direct WebSocket
evidence.

Core Convex did not provide native ephemeral typing or presence for this app.
Durable TTL rows over reactive queries demonstrated the workaround and its
expiry behavior, but both scenarios are explicit GAPs. Cold-client offline
history is also a GAP: active query results existed in JavaScript memory, but
no provider-owned durable query cache restored them after a cold offline boot.
Unread state, by contrast, was straightforward durable application data and
remained correct across two Bob clients and reconnect.

### Performance, footprint, and cleanup

The frozen loop used two warmups and seven retained samples:

| Path | Median | Nearest-rank p95 |
| --- | ---: | ---: |
| Warm subscribed-client read | 0.019 ms | 0.034 ms |
| Two-client twenty-message burst | 179.0 ms | 250.5 ms |
| Native realtime delivery | 40.2 ms | 52.4 ms |
| Fresh authenticated reconnect/query | 4.56 ms | 5.25 ms |
| Production client build | 2256.5 ms | 2319.0 ms |

The read number is explicitly a warm client-cache measurement, not a backend
round trip. The app had 496 authored backend lines, 117 provider-specific
React/CSS lines, and 254 generated declaration lines. The acceptance harness
was 751 lines; the retained logout diagnostics added 273 lines.

Cleanup deleted only namespace-equal data, proved all seven table counts zero,
then stopped the exact dev session and removed only worktree-local Convex,
runtime, and isolated-home paths. Ports 3310, 3311, and 4288 were closed.

### Lessons for Snapback

- Match Convex's end-to-end reactive-query simplicity: one declared query
  should make initial read, push, reconnect, and authorization invalidation
  feel like one coherent feature.
- Make revocation and logout boring, awaitable, and uniform across every
  client arm. Completion should mean protected sinks are blank and fenced.
- Protect Snapback's native ephemeral-state advantage. Convex needed durable
  TTL rows and heartbeat/cleanup glue for typing and presence.
- Protect and prove cold offline history. Convex's online reactive cache was
  excellent but did not survive a cold offline boot.
- Provide equally direct stable-pagination helpers and machine-readable
  concurrency/settlement feedback through Snapback's own architecture.
- Keep local startup deterministic, noninteractive, and lighter than Convex's
  binary-plus-dashboard path.

For an online-first chat, Convex is a strong contender. Its durable realtime
and transactional correctness were preference-shaping. It is not an
unconditional winner when native ephemeral presence or durable offline history
is central.

## 2026-07-28 — Firebase, calibration, complete (15 PASS / 0 GAP / 0 FAIL)

### Environment and evidence boundary

This arm used Firebase JS SDK 12.16.0, Firebase CLI 15.24.0, Admin SDK
13.5.0, Functions 6.4.0, Firestore emulator 1.21.0, and Realtime Database
emulator 4.11.2 on the Apartment Air. The fresh local project was
`llp0102-chat-firebase-w1`; Auth, Firestore, RTDB, Functions, Vite, hub,
logging, and the Firestore websocket all had arm-specific ports.

This was local Emulator Suite evidence only. Hosted credentials were
unavailable, so hosted deployment, production latency and contention, region,
operations, usage, and cost remain unmeasured rather than being counted as
Firebase failures. The direct local evidence score was 16/16. The initial
timer was not persisted, which lowers confidence in authoring-time milestones;
the reconstructed timed window was about 39 minutes and the final clean
acceptance harness took 53.4 seconds.

### What felt good

- Firestore `onSnapshot` made durable push genuinely easy. A second client saw
  an authoritative message through WebChannel without polling or a custom
  subscription server.
- Firestore's browser persistence was the strongest offline result so far. A
  new Chrome page restored 25 private messages from IndexedDB with networking
  disabled, and snapshot metadata directly identified the cache origin.
- Native Auth personas plus Firestore rules covered ordinary reads and live
  listeners. Mallory's private read and subscription both failed directly.
- Document-snapshot cursors remained stable across a concurrent newer insert.
- Firebase's own documentation is admirably candid that Firestore does not
  provide presence and recommends RTDB `onDisconnect`. That composition
  produced a real server-observed online-to-offline transition.
- Emulator export, hub introspection, and rule-coverage endpoints made useful
  operational evidence possible.

### What felt bad or surprising

- A small chat needed four Firebase products: Firestore for durable data, RTDB
  for typing and presence, Functions for authoritative writes, and Auth for
  identity. It also needed two rule surfaces and a real browser for the offline
  proof.
- The Air had no usable Java on `PATH`. Installing OpenJDK 21 added roughly
  346.7 MB before the emulators could start. Root plus Functions dependencies
  occupied about 524 MB, and the frozen toolchain emitted version and runtime
  warnings even though it worked.
- A twenty-way counter test hit `ABORTED: Transaction lock timeout`; the
  callable client collapsed that useful diagnosis into `functions/internal`.
  The protocol's actual two-client, twenty-message burst passed but took
  28.489 seconds. The single transactional channel counter is a real hotspot.
- A parent ACL change did not by itself immediately terminate an established
  Firestore listener. The next protected message change triggered rules,
  failed the listener closed, and was not delivered.
- Revocation did not erase bytes already stored in Firestore's browser cache.
  Fresh reads failed, future delivery stopped, and the app cleared its rendered
  state, but the prior 25 rows remained in SDK-managed persistence. Firebase
  leaves sensitive-cache retirement to the application.
- The default minified Firebase bundle was 1.135 MB. The local suite was also
  operationally heavy even with its UI disabled.

### Modeling, realtime, and performance

Messages were written through a callable Function that derived the actor,
generated the id and timestamp, and transactionally allocated a channel
sequence. Direct client message writes were disallowed. Two simultaneous
actors committed adjacent sequences without loss; that same counter was the
contention point. Read markers were durable per-user documents, and a second
Bob client observed marker changes.

Typing used RTDB with application-authored 250 ms expiry glue. Presence used
native RTDB `onDisconnect`. Reconnect used Firestore
`disableNetwork`/`enableNetwork`; retained offline history used native
IndexedDB. Logout used an explicit application barrier. Membership revocation
failed fresh reads and future delivery closed, while retaining previously
authorized cache bytes as disclosed above.

Local medians after two warmups were 7.276 ms for a representative 25-row
read, 8.015 ms for a callable write, 10.597 ms for write plus second-client
push, 7.280 ms for reconnect plus authoritative read, and 2333.479 ms for the
production client build. These are emulator measurements, not hosted claims.

Cleanup exported evidence, removed only the exact project processes and
ephemeral export data, and proved all eight assigned ports closed. No hosted or
shared target was touched.

### Lessons for Snapback

- Match Firestore's ordinary-feeling IndexedDB history while preserving
  Snapback's stronger authorization lease and explicit retirement semantics.
- Preserve the single typed durable-plus-ephemeral model. Firebase's
  `onDisconnect` outcome is excellent, but needing a second database and rules
  tree is meaningful friction.
- Pave a deterministic ordered-append primitive so every chat does not invent
  a hot transactional counter.
- Match emulator rule coverage and request tracing, and do not erase useful
  backend conflict diagnoses at the client boundary.
- Make permission change, logout, listener fencing, rendered-state clearing,
  and protected retained-byte retirement one awaitable lifecycle.

I would choose Firebase for a web/mobile chat when mature retained offline
history is decisive. I would hesitate when one coherent backend model,
automatic protected-cache retirement, or contention-free authoritative append
matters more.

## 2026-07-28 — Supabase, calibration, complete (14 PASS / 1 GAP / 0 FAIL)

### Environment and evidence boundary

This arm used Supabase CLI 2.110.0 and `supabase-js` 2.111.0 in a fresh,
port-isolated local Docker project named `llp0102-chat-supabase-w3`. The
official profile ran twelve containers, three volumes, and one network,
including Postgres 17.6, GoTrue, Realtime, PostgREST, Kong, Studio, analytics,
Storage, and Mailpit. Hosted evidence was not attempted, so production
deployment, latency, operations, region, usage, and cost remain unmeasured.
Local evidence confidence was 14/16.

### What felt good

- The relational model was legible: channels, memberships, messages, and read
  markers, with stable paging expressed as ordinary indexed SQL ordering.
- Database defaults and RLS made server authority direct. The client supplied
  channel and body; Postgres assigned id, authenticated author, sequence, and
  timestamp. An Alice-as-Bob spoof was rejected.
- The same table policies governed direct reads and durable Postgres Changes.
  Mallory saw no private rows, and removing Bob's membership made his fresh
  query empty and prevented a later private message from reaching his existing
  durable subscription.
- Durable Changes, transient Broadcast, and Presence were separate, explicit
  mechanisms. Private topic authorization produced a crisp `CHANNEL_ERROR`.
- Auth setup through the local Admin API and ordinary email/password sign-in
  was predictable. Several lifecycle mistakes also produced actionable
  diagnostics rather than silently losing state.
- Local data paths were fast: 1.381 ms median for the representative read,
  1.624 ms for the two-client twenty-message burst, and 3.429 ms for fresh
  resubscribe plus authoritative read.

### What felt bad or frustrating

- The local stack was much larger than the app: twelve containers and roughly
  249.5 MB of installed Node dependencies before considering Docker images.
- Initial image acquisition hit an ECR 429. Colima then could not bind
  generated files from the assigned `/private/tmp` worktree, requiring an
  arm-specific runtime-only mirror under `/Users`. These environment problems
  dominated the 83-minute timed window before cleanup.
- `supabase start` printed privileged local development keys to the terminal.
  They were disposable and were not retained, but that default is poor for
  agent-driven evidence hygiene.
- With `auto_expose_new_tables = false`, the seed initially failed until
  `service_role` received explicit grants. The safer default is good; its
  generated-path discoverability could be better.
- Postgres Changes push measured about 524 ms median locally, surprisingly
  slower than the direct API paths.
- Durable table RLS, `realtime.messages` policy for Broadcast/Presence, and
  application lifecycle cleanup are related but distinct security surfaces.
  It is easy to configure only part of the complete boundary.

### Modeling, realtime, and performance

The database seeded four channels and 500 messages. A generated identity
sequence gave deterministic ordering, and two concurrent actors both settled
without loss. Cursor paging retained two non-overlapping pages across a newer
insert. Durable read markers synchronized across Bob's clients.

Postgres Changes provided native durable push. Broadcast handled typing with
application-authored display expiry, and Presence provided two-client
join/leave state. Reconnect combined native resubscription with a fresh
authoritative snapshot. Logout required `signOut()` followed by
`removeAllChannels()`. Revocation protected fresh durable reads and future
message delivery, although application memory still required explicit
clearing.

Cold offline history was the sole GAP. Bare `supabase-js` has no persisted
PostgREST query cache; a cold retained view would require app-authored
IndexedDB or SQLite storage and synchronization. The production build median
was 926.783 ms. Cleanup used exact project-bound `supabase stop --no-backup`,
proved no matching containers, volumes, or network remained, and proved all
assigned ports closed.

### Lessons for Snapback

- Match the inspectability of one relational authority: ordinary schema,
  policies, indexes, and data were easy to audit independently of the UI.
- Keep durable change push, ephemeral broadcast, and presence conceptually
  distinct while retaining one coherent authorization lifecycle.
- Match exact lifecycle diagnostics, such as telling the builder when a
  callback was registered too late.
- Differentiate through built-in cold retained history plus server-directed
  authorization invalidation and protected-state clearing.
- Keep local startup far lighter while preserving server-authoritative
  identity, deterministic order, and independent settlement evidence.

I would choose Supabase for a web-first chat whose team wants SQL, Auth, RLS,
and realtime in a mature ecosystem. I would not choose bare `supabase-js` as a
complete local-first chat path without budgeting a separate retained store and
explicit lifecycle work.

## 2026-07-28 — Snapback, calibration, complete (13 PASS / 1 GAP / 1 FAIL)

### Environment and evidence boundary

The Snapback arm ran from the frozen commit
`ed31c1dd428298dc7ab4734ee2e3c2354112ba1a` in the detached worktree
`/private/tmp/llp0102-chat-snapback`. Before authoring, I followed the Guide
from its index through schema/functions, queries and mutations, live queries,
ephemeral state, sessions, protected data, scoped roles, targets, React and
headless clients, presence, offline retention, and acceptance testing.

The arm used a fresh local target and native sessions, membership-gated
private channels, JavaScript live queries, typed ephemeral rooms, durable read
markers, and generated React/headless references. Evidence is local only. The
final acceptance run produced 13 PASS, one explicit GAP, one FAIL, and no
Stop-class defect.

### What felt good

- The durable and transient model remained coherent. Messages, channels,
  memberships, and read markers were ordinary durable declarations, while
  typing and presence used typed native ephemeral rooms rather than durable
  TTL tables or a second database.
- Server authority was strong. Message identity, principal, profile,
  sequence, and runtime timestamp were derived on the backend. The client
  supplied only the channel and body.
- A JavaScript live query gave initial data and native push through one
  declaration. Reconnect restored the complete 128-row view without
  duplicates.
- Stable sequence cursors made pagination correct across a concurrent insert.
- Durable read markers synchronized between two Bob clients and survived
  reconnect.
- Logout was a real barrier: the protected view blanked and a later message
  was not delivered. Fresh anonymous reads were denied.
- The generated React surface and headless acceptance surface shared the same
  function references and runtime contract.

### What felt bad or frustrating

- A clean checkout needed the Ibex runtime bootstrap. No prepared Hermes
  artifact was available, so the fallback built Hermes from source before
  Snapback could build and launch. The bootstrap eventually proved the
  runtime, but this was by far the most expensive prerequisite for a small
  demo.
- Code generation warned that ephemeral result-row introspection had degraded
  to `unknown`. The native feature worked, but the typing experience weakened
  exactly where Snapback should have an ergonomic advantage.
- `subscribeEphemeral(...)` did not itself establish a socket for a new
  connection label. The working sequence required obtaining the live-stream
  manager, awaiting readiness, then subscribing and attaching `onChange`.
  The reference app contains that sequence, but the Guide recipe did not make
  the prerequisite clear. Two failed attempts are retained, and a
  `guide-gap` filesystem issue records the documentation defect.
- One simultaneous send hit `SNAPBACK_AUTH_RESERVATION_STALE` with
  `effectCommitted: false`. A bounded retry succeeded, preserved both
  messages, and retained deterministic order, but application code should not
  have to invent this retry loop for an ordinary two-actor append.
- Redundant unsubscribe after logout produced
  `SNAPBACK_UNKNOWN_SUBSCRIPTION`. Cleanup should be idempotent or explicitly
  report that the authorization barrier already retired the handle.
- Protected JavaScript live queries are currently not retainable, so the cold
  offline-history scenario is an explicit GAP despite Snapback's broader
  local-first goals.

### Correctness and the revocation failure

The arm seeded two public and two private channels with 125 messages each.
Mallory could read the public channels and was directly denied private query
and subscription access. Alice's send produced server-owned fields, Bob
received native push, typing expired from the ephemeral room, and two presence
clients produced native change signals.

The serious failure was membership revocation. Bob removed his own private
channel membership. Fresh reads were denied and the established handle did not
receive a later forbidden message, so there was no post-revocation disclosure
and no Stop-class defect. However, the handle retained all 125 previously
authorized rows instead of blanking. This independently reproduces the defect
first found in the Todo arm; the existing P0 filesystem issue now links both
capsules. `CHAT-13-REVOKE` is therefore an honest FAIL.

Cold offline history was the sole GAP: the protected JavaScript live query
reported `localRunnable: false` and `retainable: false`, and a cold process
restored zero rows.

### Performance, footprint, and cleanup

After two warmups, retained medians were 16.12 ms for the representative
25-row read, 4889.57 ms for the two-client twenty-message burst, 148.155 ms
for native realtime delivery, 53.628 ms for reconnect, and 1461.345 ms for the
production client build. The burst's p95 was 7465.152 ms and includes the
bounded effect-free reservation retry, so it is both performance and
ergonomics evidence.

Cleanup removed the exact local runtime and persona material, proved source
and built bearer material absent, and preserved unrelated state. The final
capsule, failed attempts, performance samples, backup manifest, and cleanup
receipt remain under the arm.

### Lessons for Snapback

- Fix protected live-query shrink delivery before treating authorization
  invalidation as a differentiator. Stopping future events is necessary but
  retaining now-forbidden rows is still incorrect.
- Make cold retained history work for the protected JavaScript-query path, with
  explicit lease and retirement behavior rather than silent non-retainability.
- Turn ephemeral subscription into one typed, self-starting operation, or make
  stream readiness impossible to omit and diagnose the exact missing step.
- Remove `unknown` degradation from generated ephemeral rows.
- Make ordinary concurrent appends settle without application-authored
  reservation-stale retries, and preserve the useful `effectCommitted` detail
  when conflicts do occur.
- Make unsubscribe idempotent across logout and authorization-driven
  retirement.
- Keep the architectural advantage that Firebase and Supabase had to assemble
  from multiple products: durable live data, ephemeral typing/presence,
  sessions, scoped authorization, and client bindings in one model.
- Ensure a first build uses a prepared Ibex/Hermes artifact on supported
  machines; source compilation should be an explicit fallback, not the usual
  demo path.

Snapback's best moments were genuinely preference-shaping: one authoring
language covered durable data, live queries, ephemeral state, authority, and
both client arms. I would not rank it first for this chat today because the
revocation failure and protected offline GAP sit on its central promises, not
at the edge. Both appear repairable within the current architecture; this arm
does not show a need for a fundamental backend approach change.

## 2026-07-28 — SpacetimeDB, calibration, complete (13 PASS / 2 GAP / 0 FAIL)

### Environment and evidence boundary

This arm used SpacetimeDB 2.7.0 on the Apartment Air, with a fresh standalone
server on port 3312, Vite on 4291, and exact database
`llp0102-chat-spacetimedb-w1`. Schema, reducers, views, connection lifecycle,
React, generated TypeScript bindings, evidence, CLI configuration, and runtime
data were isolated to the arm. There is no hosted claim.

The implementation seeded four channels and 500 messages with three actors.
Private source tables fed caller-dependent views. Reducers derived message
author, timestamp, and monotonically increasing order. The final result was 13
PASS, two explicit GAPs, zero failures, and no Stop-class defect.

### What felt good

- The TypeScript schema/reducer-to-standalone-server loop was fast. Retained
  module builds were sub-second, and one source file expressed schema, server
  functions, views, and connection lifecycle hooks.
- Realtime felt like one system. A subscription seeded an in-memory relational
  cache and then delivered row changes over WebSocket without a separate cache
  or invalidation layer.
- Membership revocation was excellent. Removing Bob from a private channel
  recomputed the caller-dependent view, emitted deletions, and evicted every
  protected row from his already-subscribed cache. This is the exact
  authorization-sensitive outcome Snapback currently fails.
- `clientConnected` and `clientDisconnected` reducers made presence stronger
  than a heartbeat-only convention.
- Server-owned `ctx.sender`, `ctx.timestamp`, transactional reducers, and
  auto-increment IDs made actor attribution and deterministic concurrent order
  straightforward.
- Generated bindings kept browser and evidence code close to the server
  schema, with reducer arguments and subscribed rows discoverable.

### What felt bad or frustrating

- Fine-grained authorization constrained the data model. Public tables would
  disclose private messages, so source tables had to remain private and every
  client read had to use a caller-dependent view. Views require indexes,
  cannot scan tables, and cannot accept application parameters.
- The lack of view arguments made stable cursor paging awkward. The arm needed
  a reducer plus a durable identity-scoped `page_result` table and a view over
  those results. It is authoritative but adds conspicuous request/result and
  cleanup glue.
- There is no native ephemeral table or TTL path. Typing used a durable private
  row plus an explicit clear reducer, so CHAT-06 is a GAP. Lifecycle reducers
  made presence better, although presence rows are still stored data.
- The client cache is memory-only. A disconnected client may retain warm rows,
  but no provider-backed cache restores a cold offline client, so CHAT-09 is a
  GAP.
- Local identity was lower-level than a complete application-auth product.
  Server-issued connection identities plus an application reducer proved
  separation among Alice, Bob, and Mallory, but not email/password or social
  login ergonomics.
- Anonymous publish created a database owned by a generated identity whose
  token the CLI did not retain. A later exact delete silently used another
  identity and failed 403. Because the standalone server and data directory
  were fresh and arm-only, exact `server clear --data-dir` was safe and the
  post-clear lookup proved the database absent. The failed attempt remains
  evidence.
- CLI isolation was unintuitive: `--root-dir` controls installed binaries as
  well as mutable state, so the arm had to link the shared installed binary
  into its isolated root.
- Generated bindings ran through `tsx` and Vite but a strict standalone
  NodeNext `tsc --noEmit` reported extension and re-export errors.

### Correctness, performance, and cleanup

Private outsider subscription was directly refused. Native push, reconnect,
durable unread markers, concurrent ordering, logout, presence, and membership
revocation all passed. The two gaps are narrowly attributed to durable-row
typing glue and absent persistent cold offline history.

Cleanup first preserved the ownership-related 403. It then used the exact
fresh arm-only data directory, proved the database name absent after clear,
and proved ports 3312 and 4291 closed. No broad process, shared server, or
unrelated data operation was used.

### Lessons for Snapback

- Match the end-to-end result of caller-dependent live views that actively
  remove protected state on revocation.
- Keep generated schema/function bindings consistent across browsers, Node
  harnesses, and strict TypeScript configurations.
- Offer server connection/disconnection lifecycle hooks where they improve
  presence and cleanup without undermining typed ephemeral rooms.
- Preserve server-authoritative identity, time, and deterministic ordering as
  automatic mutation context.
- Keep parameterized stable cursor reads ordinary; do not force durable
  request/result tables.
- Protect Snapback's native ephemeral and persistent-offline ambitions—both
  are genuine differentiation opportunities if their default client path is
  complete.
- Make target ownership and exact cleanup foolproof, with a retained redacted
  ownership receipt and no silent identity changes during deletion.

SpacetimeDB is a serious option when transactional realtime state is the
center of the product. I would not yet make it my general backend default
because auth completeness, parameterized pagination, native ephemeral state,
persistent offline behavior, and local ownership lifecycle all need more work.

## 2026-07-28–29 — InstantDB, calibration, complete (13 PASS / 2 GAP / 0 FAIL)

### Environment and evidence boundary

This arm used InstantDB 1.0.52 in a fresh official hosted temporary app on the
free/temporary plan. The CLI created an isolated database and app-scoped admin
credential without an account. React 19 used `@instantdb/react` directly, and
the evidence harness used independent native guest principals for Alice, Bob,
and Mallory.

The app combined InstaQL, transactions, WebSocket subscriptions, cursor
pagination, room topics, room presence, durable unread markers, four channels,
and 500 messages. The final result was 13 PASS, two explicit GAPs, zero
failures, and no Stop-class defect.

### What felt good

- Temporary hosted apps are unusually agent-friendly. Once selected, the
  no-account path was much faster than trying unavailable Docker or an
  unhealthy shared credential.
- Schema as TypeScript was pleasant. Entities, links, indexes, cardinality,
  and room declarations lived in one readable file and flowed into React query
  and transaction types.
- Client-first realtime was extremely compact. `useQuery` and
  `subscribeQuery` were already live; no server function or subscription
  router was needed for ordinary collaborative data.
- Typing used native room topics and presence used native room presence.
  Neither needed a durable row, TTL sweep, or cleanup mutation, and disconnect
  removal worked.
- Guest auth made three real principals cheap. Logout blocked later private
  delivery, membership revocation evicted protected data, and cleanup user
  deletion invalidated Bob's prior token.
- Opaque cursor paging was first-class: the returned `endCursor` fed directly
  into `after`, and two 25-row pages stayed disjoint under a concurrent insert.
- The admin SDK supported direct counts, user deletion, impersonation,
  permission debugging, and exact target cleanup.
- Small hosted-workload medians were consistent: 117.7 ms read, 272.6 ms
  two-client twenty-message burst, 145.1 ms native delivery, 570.6 ms
  reconnect, and 3135.1 ms production build.

### What felt bad or surprising

- Permissions dominated the work. Terse CEL rules could pass CLI push and fail
  only at runtime; for example, create rules must use `data.ref`, not
  `newData.ref`, but deploy did not reject the invalid expression.
- Link writes authorize both sides. Creating a message linked to a channel
  needed a channel update rule, and unlinking Bob from `allowedUsers` needed
  visibility of the reverse `$users` side. A secure result required
  `request.modifiedFields`, a self-only email rule, `debugTransact`, several
  fixture resets, and retained failed attempts.
- Denying `$users.create` also disabled native guest sign-in, a reasonable but
  initially surprising coupling.
- Instant's implicit `serverCreatedAt` could order and page messages but was not
  exposed on the authoritative entity returned by the admin query. Author
  identity was server-enforced, but the required server timestamp/order field
  could not be shown on the row, so CHAT-03 is a GAP.
- The Node core client assumes a browser and skips reactor initialization
  without browser globals. Multiple simulated clients also shared Node's
  global `BroadcastChannel`, allowing one actor's logout to interrupt another
  actor's transaction. The harness disabled only that Node-only artifact while
  preserving separate native WebSockets.
- A controlled browser was unavailable on the remote host. Instant likely has
  relevant IndexedDB behavior, but a custom in-memory store is not direct
  provider evidence; CHAT-09 cold offline history is therefore a GAP.
- Temporary-app output mixed JSON with human prose. The first parser consumed
  too much and likely orphaned an empty auto-expiring app; the corrected parser
  extracts the first JSON object.
- The app-scoped token could not immediately delete the temporary app shell.
  Exact data and users were reduced to zero, Bob's token was invalidated, raw
  local credentials were removed, and schema/permissions remain only until
  the provider's documented automatic expiry after more than 24 hours.
- The frozen Vite dependency produced one high aggregate audit finding.

### Correctness, cleanup, and evidence

Native private reads and subscriptions denied Mallory. Native push, stable
pagination, room typing, room presence, reconnect, durable unread markers,
concurrent settlement, logout, and data-dependent membership revocation
passed. The two gaps are narrowly attributed to observable server-owned order
fields and directly proven cold offline cache.

Cleanup cleared exactly 4 channels, 696 messages, one read marker, and three
users to zero. It invalidated the old Bob token and removed local runtime
credentials. The residual temporary schema and permission configuration and
provider-managed expiry are disclosed in both capsule and cleanup receipt.

### Lessons for Snapback

- Match InstantDB's tiny path from typed schema to live React data and native
  ephemeral rooms. Snapback already has the underlying transient model; its
  authoring and connection lifecycle need to feel this direct.
- Statically validate authorization expressions and explain both sides of
  relationship authorization before runtime.
- Provide an authorization debugger that names each rule/dependency checked
  without leaking protected values.
- Keep server-owned identity, creation time, and deterministic order explicit
  and directly readable on committed rows.
- Make temporary dogfood targets one strict-JSON command with scoped
  credentials, immediate deterministic deletion, and a cleanup receipt.
- Provide first-class multi-principal clients with isolated auth stores and
  transports plus explicit disconnect, reconnect, and offline controls.
- Keep cursor-native pagination stable and opaque.
- Expose cache provenance—memory, durable local store, or authority—in tests
  and diagnostics.

InstantDB is a strong go-to candidate for collaborative client-centric apps.
Its native realtime and ephemeral model materially raises the authoring-speed
bar. Permission ergonomics and the weaker explicit server-invariant story keep
it from being my automatic backend choice today; those are areas where
Snapback's coherent, auditable authority can win.
