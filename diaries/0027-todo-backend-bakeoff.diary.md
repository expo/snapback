# Diary 0027: Todo backend bakeoff

**Type:** Diary
**Status:** Active
**Systems:** Backend bakeoff, Todo, Offline sync, Realtime, Auth
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Related:** LLP 0102

## 2026-07-28 — Stage 0, protocol freeze

No provider arm has started. The neutral product prompt, UI shell, acceptance
identifiers, expected-check count, dataset, performance profile, and randomized
provider order live under `demos/backend-bakeoff/protocol/`.

The freeze intentionally treats retained offline data, queued writes,
reconnect settlement, conflict outcome, and logout cleanup as distinct facts.
Prior comparison demos showed that a pleasant rendered update can otherwise
hide polling, seeded state, or a client-only optimistic illusion. Missing
credentials or tooling will be recorded as readiness failures rather than
converted into product gaps.

## 2026-07-28 — SpacetimeDB, calibration, in progress

### Environment

SpacetimeDB CLI and TypeScript/React SDK 2.7.0, official `react-ts` template,
fresh standalone server on an arm-owned data directory, and a fresh local
database. Hosted Maincloud evidence is unavailable because no account session
is configured; this is an environment limitation, not a product failure.

### Milestones

- Official project initialization completed in 44 ms.
- The first owner-authoritative query proved exactly 100 private task rows
  roughly 4.4 active minutes after initialization.
- Three server-issued identities were created; the owner granted Alice and Bob
  membership while Mallory remained an outsider.
- Independent Alice and Bob browser clients each received 100 authorized tasks.
  Mallory's connected client cache remained empty.
- Bob observed Alice's insert and delete without refresh over the native
  SpacetimeDB WebSocket subscription.

### What felt good

The core model is unusually direct. TypeScript tables and transactional reducers
live together, `spacetime generate` produces a typed React client, and
`useTable`/`useReducer` made the online UI small. Caller-dependent public views
over private tables expressed the important authorization boundary without
shipping all rows and filtering in React. The local server starts quickly,
publishing and generated bindings are fast, and realtime arrived automatically
once the views were subscribed.

### What felt bad or frustrating

The installed build command accepts `--module-path`, while one quickstart-shaped
path suggested `--project-path`; the first build failed immediately. The
official authentication examples mention `Identity` alongside server imports,
but 2.7.0 does not export that type from `spacetimedb/server`; it must come from
`spacetimedb`. Binding generation also asked whether to remove stale generated
template files even though the surrounding workflow was intended to be
noninteractive, then exited successfully without removing them.

Publishing the first database with `--anonymous` created an owner identity whose
token the CLI did not retain. Owner-only administration was then inaccessible,
so the arm retained that failed attempt and published a second fresh database
after the CLI established a persistent local-server identity. This is a sharp
edge for an otherwise smooth local workflow.

### Modeling and correctness

Public tables would expose every workspace row to Mallory, so the safe design
uses private workspace, membership, list, and task tables plus four
caller-dependent views. Reducers re-check active membership transactionally.
Task revision increments document SpacetimeDB's serialized, last-committed
update outcome; the concurrent conflict and reorder scenarios still need their
dedicated barriers.

### Realtime, offline, and auth

Native realtime is excellent in the tested online case: Bob observed both sides
of Alice's create/delete transition through push, and the local caches returned
to exactly 100 tasks. Server-issued local identities plus owner-granted
memberships were sufficient for the three-persona authorization test.

The SDK's documented client cache is an in-memory subscription cache. No native
durable offline boot or queued offline mutation facility has been found yet;
those acceptance rows remain pending until the arm verifies whether they are
GAPs rather than adding a generic local queue that would disguise the product
boundary.

### Deployment and operations

An exact arm-owned data directory and explicit port make local cleanup
auditable. The first orphaned local database remains in that same isolated data
directory and will be included in the final cleanup receipt. Maincloud was not
attempted.

### Documentation and diagnostics

Compiler diagnostics were ordinary TypeScript errors and easy to act on.
The CLI's build-flag drift, server/client `Identity` import split, anonymous
owner-token behavior, and interactive stale-binding prompt each required
experimentation beyond the five-minute happy path.

### Glue and workaround inventory

- A small persona provisioner allocates server-issued identities, performs
  owner grants, and writes only ignored `0600` local tokens.
- A headless Chrome receipt script verifies Alice/Bob/Mallory caches and a
  two-client realtime transition through the rendered React surface.
- An owner SQL receipt records the authoritative private-table count.
- No portable backend adapter, poller, client-side authorization filter, or
  fake offline queue was introduced.

### Outcome

In progress. TODO-01, TODO-02, TODO-03, and TODO-05 have retained passing
evidence. CRUD breadth, offline behavior, reconnect settlement, conflict,
ordering, logout, revocation, performance, and cleanup remain.

### Would I choose it?

Too early for a rating. For an online realtime application with transactional
server logic, the first impression is strong. The missing durable offline-write
story may be decisive for this particular Todo workload.

### Lessons for Snapback

SpacetimeDB's generated bindings and tiny React hooks are the clearest positive
lesson so far: schema/reducer changes become client-visible types through one
obvious command. Snapback should match that end result while preserving its
stronger settlement and offline ambitions. Caller-dependent live views are also
a compelling authoring shape, though Snapback should keep authorization
obligations and retained-data behavior more explicit than a view alone can.

## 2026-07-28 — SpacetimeDB, calibration, completed

This entry continues—and, where noted, corrects—the in-progress entry above.
The final capsule passed 11 of 14 Todo scenarios and recorded three product
GAPs: retained offline boot, durable offline writes, and exactly-once
settlement of those offline writes. Evidence confidence is 16/16 because the
GAPs themselves were tested directly rather than inferred from an absent UI.

### The ordering defect was real

The first implementation stored a numeric `position` on each task and swapped
two task rows inside a transactional reducer. A two-client concurrent reorder
produced duplicate positions (`1, 1, 2, ...`). Transactional reducers prevented
partial writes, but they did not make a bad multi-row ordering representation
closed under concurrent operations.

The corrected design stores one ordered `taskIds` array on the parent list.
Each reorder reducer atomically changes that single list-owned sequence, and
the task view derives positions from it. After resetting only the disposable
local target and rerunning all evidence, concurrent reorders converged to the
unique permutation `0..24`. This is an important lesson for the whole bakeoff:
backend transaction support is not a substitute for choosing a concurrency-safe
data model.

### CRUD, conflict, logout, and revocation

The dedicated correctness barrier passed create, edit, complete, reopen,
reorder, and delete through two independent clients. Concurrent title edits
converged under the documented policy of transaction serialization with the
last committed reducer update winning.

Revoking Bob while his connection remained live removed all protected rows
from his cache, and a later Alice write was not delivered. Regrant restored
the view. Logout disconnected Alice, cleared the in-memory cache, removed the
locally stored identity, and a reload received a fresh unprivileged identity.
These were especially strong results: authorization changes became live-query
changes instead of requiring bespoke client invalidation.

### Offline behavior: a crisp product boundary

With the standalone server stopped, a warm React client's subscribed rows
cleared to zero. A cold browser boot also had zero retained rows. When the
server returned, both clients reconnected and resubscribed to exactly 100 rows.

So SpacetimeDB has good online reconnect behavior, but its React subscription
cache is not durable offline storage. The SDK can hold reducer calls made
before the initial connection is ready, but that is not a durable write queue,
and there is no retained task available for the required offline update. I did
not add IndexedDB or a generic mutation queue because doing so would test
custom application infrastructure instead of the backend's native product.

### Performance, with deliberately narrow claims

On this machine and the frozen small local dataset, seven recorded samples
after two warmups produced these medians:

- owner-authoritative CLI read: 15.440 ms
- reducer write to the origin view: 26.059 ms
- reducer write to the second client: 26.897 ms
- browser reconnect and resubscribe: 57.559 ms
- module build: 433.531 ms

The retained raw samples are useful for within-protocol comparison, not as a
production-scale benchmark. The local WebSocket path felt extremely fast.

### Final ergonomics assessment

What felt best was the short path from typed server tables and reducers to
generated client bindings and React hooks. Private tables plus
caller-dependent views made both subscription authorization and live revocation
compact. The runtime's transaction model is legible, local publishing is fast,
and the online realtime behavior required very little client code.

The rough spots remained CLI and lifecycle edges: a mismatched build flag,
split `Identity` imports, an interactive stale-binding prompt, and the
`--anonymous` publish that left an owner identity the CLI could not administer.
The first failed database therefore survived until exact-target cleanup. The
arm also needed substantial receipt glue because the provider's happy path does
not supply multi-persona barriers, browser cache inspection, or offline proofs.

### Cleanup and outcome

The exact arm-owned standalone data directory contained both local database
attempts and all disposable browser profiles. A target-bound cleanup guard
verified the owning process commands, stopped only ports 3102 and 4178, removed
that directory and the two ignored local credential files, then proved all five
targets absent. Those removed bytes are not recoverable; the deterministic
seed and source recreate the target. No shared or unrelated state was touched.

Final outcome: complete, 11 PASS / 3 GAP / 0 FAIL / 0 STOP.

### Would I choose it?

For an online-first realtime application with meaningful transactional server
logic, yes—SpacetimeDB is already a serious candidate. For a local-first Todo
application where retained offline data and durable mutation settlement are
requirements, no: those are fundamental product gaps, not polish issues.

### Lessons for Snapback

Snapback should try to match the end-to-end simplicity of generated bindings,
React subscription hooks, caller-dependent live views, and live authorization
revocation. It should also make the safe ordering shape obvious: either expose
an atomic sequence abstraction or document/test a canonical list-owned order
model so every app author does not rediscover the duplicate-position failure.

Snapback's opportunity to win this workload is precisely where SpacetimeDB
stops: durable retained state, queued offline mutations, and explicit
settlement. Those capabilities will only count if Snapback can expose them with
similarly small generated client APIs and equally legible authority boundaries.

## 2026-07-28 — Convex, calibration, in progress

### Environment and first read

Convex 1.42.3 is running as the official anonymous local deployment. This is
the provider's documented agent path: no account is required, the backend runs
as a `convex dev` subprocess, and state lives under the project's ignored
`.convex` directory. I chose it instead of the available shared deployment
because deploying this arm's function bundle would replace shared
deployment-level code; a data namespace alone would not isolate that mutation.

The first push seeded exactly four lists and 100 tasks. Convex Auth's anonymous
provider created three independent native users. An arm-local admin proof
granted Alice and Bob membership while Mallory remained authenticated but
unauthorized. After an initial provisioning correction, all three browser
profiles reopened with stable user IDs; Alice and Bob each received 100 tasks
and Mallory received zero.

### What felt good

The official agent-mode documentation is unusually practical. It explains the
local-vs-cloud choice, explicitly recommends `npx convex dev --once` for
ephemeral agents, and states where local state lives and how lifecycle works.
The local backend and dashboard binaries download automatically. Codegen and
function push are fast, and schema/index definitions plus generated React APIs
provide a compact, strongly typed path.

Convex Auth's anonymous provider is a good fit for deterministic test personas:
it creates real users and sessions without inventing email inboxes or smuggling
actor identity through query parameters. The server-side `getAuthUserId`
helper makes the authorization check plain.

### What felt bad or frustrating

The documented claim that a noninteractive shell defaults to local development
did not hold in the PTY used for this arm: the CLI asked two setup questions.
After that, it spent over a minute downloading the backend binary, including a
long pause around 81%. The next long-running start also downloaded the local
dashboard even though the arm did not ask to open it.

Installing the exact current Convex Auth setup pulled a dependency graph with
one npm critical-severity audit finding. I have not auto-applied an audit fix
because that could silently change the frozen provider version or auth
behavior; the final diary will distinguish whether the finding belongs to the
auth package, its transitive dependencies, or scaffold tooling.

The first persona provision revealed a session-lifecycle race: Bob's initial
anonymous user did not survive the first profile reopen, leaving a stale active
membership. Authorization failed safely—Bob saw zero tasks—but the database
contained an obsolete member. The provisioner now atomically activates the two
current browser identities and deactivates every stale membership, then proves
profile identity stability after a full close/reopen. The corrected
authoritative summary has exactly two active members.

### Modeling notes

As in the corrected SpacetimeDB arm, list order is one atomic `taskIds`
sequence owned by the list rather than independent numeric positions on task
rows. Convex mutations provide the transaction boundary. Queries check current
Convex Auth identity and active membership before returning any protected
workspace data.

### Outcome

In progress. The fresh local target, deterministic seed, three stable native
personas, member reads, and outsider refusal are working. Two-client realtime,
full CRUD, offline/reconnect behavior, conflict, ordering, logout, revocation,
performance, and cleanup still need retained barriers.

## 2026-07-28 — Convex correctness and offline continuation

The full online correctness barrier now passes. CRUD changes flowed through
reactive queries to the second client; concurrent title mutations converged to
the independently queried committed winner; and simultaneous reorder mutations
preserved the list-owned sequence as a unique `0..24` permutation. Revoking
Bob cleared his connected protected query and prevented delivery of Alice's
next write. Convex Auth logout removed the protected result and automatic
anonymous sign-in produced a different, unprivileged user.

The offline result is more capable—and more nuanced—than SpacetimeDB's:

- A warm Convex React page kept all 100 query rows in memory while the exact
  local backend process was paused.
- Closing and reopening a previously used browser profile while the backend
  was unavailable yielded no authenticated application shell and zero retained
  query rows. Durable offline boot is therefore a GAP.
- The warm page accepted one create and one update while disconnected. Its
  remote count remained 100, proving neither had committed.
- On resume, both calls settled: the update appeared, the created marker
  existed exactly once, and the cold client authenticated and resubscribed.
  Cleanup returned the authoritative count to exactly 100.

This is a strong result for intermittent transport within one running app
session, but it is not local-first durability across a process/browser restart.
The acceptance matrix is right to score those as separate facts.

The npm audit finding is specifically in the docs-required direct
`@auth/core@0.41.1` dependency: one critical Unicode email-normalization
advisory, plus high and moderate advisories. This arm uses only the anonymous
provider, so the critical email path is not exercised, but the setup's
prescribed version still creates security-review friction that belongs in the
holistic assessment.

## 2026-07-28 — Convex, calibration, completed

The final capsule passes 13 of 14 Todo scenarios with one product GAP: durable
cold offline boot. Evidence confidence is 16/16.

### Performance

Seven local samples after two warmups produced these medians:

- mutation to the origin query: 26.546 ms
- mutation to the second-client push: 27.778 ms
- browser reopen and full resubscription: 441.445 ms
- Vite production client build: 124.299 ms
- admin CLI authoritative query: 203.152 ms

The CLI number includes Node and CLI startup and should not be compared directly
with a resident-client read. These are small local-profile measurements, not
production latency claims.

### Final ergonomics assessment

Convex's best quality is coherence. Schema, functions, transactions, reactive
queries, generated types, React hooks, local deployment, and auth all feel like
parts of one product. The default mutation retry contract is unusually
valuable: the warm offline create and update settled without application queue
infrastructure and exactly one marker committed.

The main friction was around the beta edges. Anonymous local setup still
prompted in a PTY despite the agent-mode documentation, downloaded both backend
and dashboard binaries, and the first anonymous identity needed extra time
before it reliably survived browser-profile close/reopen. Correct persona
provisioning therefore required stale-membership reconciliation. Convex Auth is
also beta, provides no UI components, and its documentation-required direct
Auth.js version currently reports a critical npm advisory.

The arm used more test glue than the application itself: an admin-proof bridge,
persona lifecycle repair, two-client browser barriers, process-level offline
control, and scoped cleanup. Much of that is benchmark evidence machinery
rather than ordinary product code.

### Cleanup and outcome

The target-bound cleanup stopped only the arm-owned Convex backend/site proxy
and Vite process, removed the exact `.convex` deployment, disposable browser
profiles, `.env.local`, and admin-proof file, then proved ports 3210, 3211, and
4179 plus all four paths absent. Removed bytes are not recoverable; source and
the deterministic seed recreate the target. The available shared deployment
was never modified.

Final outcome: complete, 13 PASS / 1 GAP / 0 FAIL / 0 STOP.

### Would I choose it?

Yes. For this Todo application Convex is the current leader: the online
authoring model is compact, authorization is understandable, realtime is
automatic, transactions behaved well under concurrency, and warm-session
offline mutations retry with exactly-once execution. The absence of durable
cold offline state prevents it from being a complete local-first answer, but it
is a much narrower gap than SpacetimeDB's offline boundary.

### Lessons for Snapback

Snapback must match Convex's coherence, not merely its checklist. A schema
change should flow to generated client types; a query should become reactive
without transport plumbing; a mutation promise should embody retry and
exactly-once settlement; and local agent setup should have one documented,
noninteractive path.

Snapback can still win this workload if its durable retained state and
restart-safe offline queue remain real advantages while its surface becomes as
small and legible as Convex's. It should also make test-persona provisioning,
authorization changes, target identity, and scoped cleanup first-class agent
operations so bakeoff-style proof does not require a bespoke admin bridge.

## 2026-07-28 — InstantDB, calibration, in progress

### Environment and first read

InstantDB 1.0.52 is running from the official self-host images at upstream
commit `b5955b9042bd656d696dd3565a20b607f625b46b`. The shared-target credential
probe did not establish a usable hosted target, so this arm uses the frozen
fresh-local profile. The local target consists of Postgres, the Instant server,
MinIO, and a one-shot bucket initializer; the dashboard is deliberately omitted
because it is not needed by the app or acceptance tests.

The self-hosting documentation says to run the repository's default
`docker-compose.yml` and advertises dashboard port 3000 and server port 8888.
At the pinned upstream commit that default file exposes only Postgres; the
published images need an additional override to publish the dashboard/server
ports. A second `docker-compose.local.yml` exposes those ports but builds the
product from source. This documentation/repository drift cost real diagnostic
time.

### What felt good

Once the target was reachable, schema-as-code was expressive and compact.
Required attributes, unique/indexed fields, and typed one-to-many links fit in
one readable file. The permission language's relation traversal maps directly
to the model: workspace, list, and task access are all defined by whether the
current native user is linked through a membership. Schema and permission
pushes accepted the local API override and finished successfully.

Temporary app creation is a useful local isolation primitive. Guest auth is
also an excellent match for deterministic browser personas: each browser
profile gets a real Instant user without an email inbox or an application-level
identity shim.

### What felt bad or frustrating

The documented self-host launch initially attempted to pull five large images,
including a dashboard the arm did not need. Narrowing the launch to four
required services helped, but the first image pull and server start remained
heavy compared with Convex's single managed local process.

`instant-cli init --temp --yes` did not create an app in the self-host target.
It silently entered the interactive CLI-login polling path and waited for a
human to approve a browser login. Server logs were the only place that revealed
the reason. The newer `init-without-files --temp` path worked immediately, but
it prints the admin token by design and does not write the normal project env
file. The arm therefore uses a small, secret-safe wrapper around the same
public ephemeral-app endpoint and writes its credential file mode 0600.

The first schema push produced more than a thousand terminal lines while
background constraints and indexes progressed. The operation succeeded, but
the repeated spinner/status transcript is hostile to agents and makes the
useful result hard to find. The permissions model is promising; the setup path
around self-host discovery, noninteractive initialization, and output hygiene
needs consolidation.

### Outcome

In progress. The fresh target, isolated app, typed schema, relation-based
permissions, and native guest-auth strategy are ready. Deterministic persona
creation, seed, browser barriers, offline behavior, concurrency, performance,
and cleanup still need evidence.

## 2026-07-28 — InstantDB, calibration, completed

InstantDB passed all 14 frozen Todo scenarios with evidence confidence 16/16.
This is the first calibration backend to pass durable cold offline boot, queued
offline create/update, and exact reconnect settlement as well as every online
authorization and concurrency barrier.

### Correctness and local-first behavior

Three independent guest-auth profiles were stable across browser restarts.
Alice and Bob each received the exact 100-task protected dataset; Mallory was a
real authenticated subscriber and received zero protected rows. Alice's CRUD
operations appeared in Bob's live query over a directly observed native
WebSocket. Deleting Bob's membership cleared his already-connected protected
query and blocked the next write until regrant. Native logout removed the
protected UI and stopped future delivery.

The offline result is excellent. The test stopped the exact arm-owned Instant
server container and proved the browser connection closed. A warm client kept
all 100 rows. More importantly, after closing and reopening the previously used
Chrome profile while the server remained down, InstantDB restored all 100 rows
from IndexedDB. The cold offline client accepted one create and one update,
showed both optimistically, and reported `Queued offline`. After the server
restarted, authority contained the update and exactly one create; cleanup
returned the dataset to 100.

Task order uses one atomic JSON task-ID sequence owned by each list. Concurrent
reorders are whole-field last-write-wins, so one edit may supersede the other,
but the committed result remains a valid unique permutation. Concurrent title
edits use the same understandable policy: both optimistic clients reconcile to
the last transaction committed by the server.

### Permission-system findings

The relation traversal in view and update rules worked well for membership
isolation and live revocation. Two validation gaps created avoidable failures:

- Setting `$users.create` to false also blocks guest-auth signup. The failure is
  safe and explicit at runtime, but the guest-auth documentation does not make
  this permission dependency prominent.
- A rule containing `newData.ref(...)` was accepted by `instant-cli push perms`
  and only failed when a user performed an update. The runtime error explained
  that no matching `ref` overload exists, but accepting an unevaluable rule at
  deploy time is a serious authoring-quality defect.

The final rules authorize updates through current relation membership. They do
not attempt the invalid relation-immutability comparison. This is adequate for
the arm because normal update transactions never relink tasks or lists, but a
production app would want a validated way to state that invariant.

### Performance

Seven local samples after two warmups produced these medians:

- mutation to the origin query: 12.579 ms
- mutation to the second-client push: 87.874 ms
- admin SDK authoritative read: 85.342 ms
- browser reopen and full resubscription: 499.641 ms
- Vite production client build: 156.203 ms

These are one-machine, 100-task self-host measurements, not hosted-production
latency claims. The second-client distribution was materially slower than the
origin's optimistic reconciliation, which is expected but worth comparing
against later providers.

### Final ergonomics assessment

InstantDB's product-level authoring model is unusually compelling. Typed graph
schema, direct React queries, optimistic transactions, native live updates,
durable IndexedDB state, an offline transaction queue, guest auth, and
relation-aware permissions fit together without application-side repositories
or synchronization plumbing. The app code is recognizably the product, not a
custom sync engine.

The self-host/agent control plane is much weaker than the runtime. Official
documentation and Compose files disagree about exposed ports; the documented
`init --temp` path silently waited for interactive login; the working
`init-without-files --temp` path prints an admin token and does not create the
normal env file; schema push flooded the terminal with repeated progress
lines; and permission push did not reject an unevaluable rule. These are
fixable surfaces rather than evidence that the underlying architecture is
wrong.

The dependency audit reported zero vulnerabilities. The installed dependency
tree was about 189 MB, while the first self-host target also required multiple
large Docker images. That cost matters for local agents even though the image
cache is reusable.

### Cleanup and outcome

Target-bound cleanup verified the Compose project label before removing only
`llp0102_todo_instantdb` containers, network, and named volumes. It removed the
exact upstream clone, disposable browser profiles, and local credential files;
the shared Docker image cache was retained. Ports 4180, 8889, 8891, 9100, and
9101, the Compose project, runtime tree, and credential path all proved absent.
Removed target/runtime bytes are not recoverable, but retained source and the
deterministic seed recreate them.

Final outcome: complete, 14 PASS / 0 GAP / 0 FAIL / 0 STOP.

### Would I choose it?

Yes. After three Todo arms, InstantDB is the current leader for this specific
local-first workload. Convex remains more coherent and polished in local
project setup, function authoring, and agent-facing documentation, but
InstantDB is the only one so far to combine compact application code with
durable cold cache and restart-safe offline mutation settlement.

I would be more cautious for applications requiring complex trusted server
functions or highly constrained relational invariants; this arm exercised the
graph client, admin SDK, auth, permissions, and sync runtime, not a broad server
function platform.

### Lessons for Snapback

InstantDB sets the most important result Snapback should match: a developer
writes a normal typed React app, yet reopened clients retain protected queries
and offline mutations settle without duplicates. Snapback's local-first
advantages only matter competitively if they are this invisible in ordinary
application code.

Snapback can beat this result by pairing the same compact local-first surface
with stronger agent control: one noninteractive target command, secret-safe
structured output, deploy-time permission validation, explicit target identity,
first-class persona provisioning, scoped cleanup, and a trusted function model
that does not force authorization invariants into client-writable graph data.

## 2026-07-28 — Firebase, calibration, in progress

### Environment and first read

Firebase Web SDK 12.16.0 and Firebase CLI 15.24.0 are running against a
fresh, safety-prefixed demo project in the Local Emulator Suite. Only the two
services this Todo uses—Authentication and Cloud Firestore—are started. The
official documentation explicitly recommends `demo-` projects because any
attempt to reach a non-emulated production service fails instead of mutating
live state or incurring billing.

The current Firestore emulator requires Java 21 soon; this machine already has
OpenJDK 21.0.10. First launch downloaded a 139 MB Firestore emulator JAR and
printed a Node `url.parse()` deprecation/security warning from the CLI's
transitive OpenAPI stack. The download is cached for later Firebase arms.

### What felt good

The emulator path is mature and well documented. One explicit project ID ties
Auth, Firestore, Rules, the Web SDK, and Admin SDK together. The CLI clearly
states that the demo project cannot fall through to production. Port choices,
rules, indexes, and UI behavior all live in one small `firebase.json`.

Email/password auth produced three stable native users across browser-profile
reopens. Firestore Security Rules use a straightforward membership-document
existence check. Alice and Bob each received the deterministic 100-task
dataset; Mallory remained authenticated but received zero protected rows. All
three opened native Firestore WebChannel listen streams.

Firebase's offline behavior is opt-in on the web, including in the emulator
where persistence is disabled by default. The app deliberately initializes
Firestore with `persistentLocalCache`; this makes the durability decision
visible instead of accidentally crediting an in-memory cache.

### What felt bad or frustrating

The current `firebase-admin` 14.2.0 install reported five high and six moderate
npm vulnerabilities plus deprecation warnings for old `glob`, `uuid`, and
`node-domexception` packages. The exact advisory ownership still needs the
final audit receipt. This is substantially worse dependency health than
InstantDB's zero-finding arm.

Even when every Admin SDK call targets emulators, `applicationDefault()`
attempts a metadata-server credential lookup and emits a warning before the
local call succeeds. Replacing it with a minimal credential-shaped object is
rejected by the Firestore Admin wrapper, so the arm retains the documented
default credential path and its noisy local warning.

The first browser provision attempt exposed an application timing race rather
than a Firebase defect: the harness checked for the login form before Auth had
finished restoring persistence, then waited for an authenticated shell it had
never submitted. Waiting for either the form or shell fixed the barrier.

### Outcome

In progress. Fresh Auth and Firestore emulators, deterministic seed, stable
native personas, member reads, outsider refusal, persistent cache
configuration, and transport attribution pass. CRUD, realtime settlement,
offline/reconnect, conflict, ordering, logout, revocation, performance, and
cleanup remain.

## 2026-07-28 — Firebase, calibration, completed

Firebase passed all 14 frozen Todo scenarios with evidence confidence 16/16.
It joins InstantDB as the second backend in this round to pass durable cold
offline boot, queued offline create/update, and exact reconnect settlement in
addition to every online authorization and concurrency barrier.

### Correctness, realtime, and authorization

The native product path is cohesive. Firebase Authentication supplied three
stable email/password users, Firestore Security Rules enforced membership, the
Admin SDK provided an independent authority plane, and Cloud Firestore
WebChannel listeners pushed changes between browsers without refresh. Alice
and Bob each read exactly 100 tasks; authenticated outsider Mallory read zero.
Alice's create, edit, complete, reopen, reorder, and delete operations all
settled authoritatively and appeared in Bob's client.

Concurrent title edits are last-server-commit-wins at field granularity. The
barrier's final winner was Bob, and both optimistic clients reconciled to the
Admin SDK result. Task order is stored as one list-owned ID array, so concurrent
reorders also use whole-field last-write-wins; the winning array remained a
valid unique 0-through-24 permutation.

Live revocation is secure but not immediate in the absence of traffic.
Deleting Bob's membership did not proactively erase his current cached rows.
The next server write caused the listen to fail permission evaluation, clear
the protected UI, and block the new marker. Regrant did not revive the failed
listener automatically; the app needed a reload/resubscription. This is a
meaningful behavioral difference from systems whose authorization change
actively invalidates a connected query.

Firebase Auth sign-out removed the protected UI and stopped future delivery,
but it did not erase Firestore's persistent IndexedDB. The receipt records only
hashed database names and counts, not protected values. This is Firebase's
documented device-cache contract, but an application with a stronger
logout-erasure requirement must explicitly terminate Firestore and clear its
persistence.

### Offline behavior and the test barrier

The final app opts into `persistentLocalCache` and explicitly bootstraps the
two queries with `getDocsFromCache` alongside their live listeners. That extra
cache-read path made cold-start intent explicit, but it also added metadata
coordination code that InstantDB did not require. List and task snapshot
metadata had to be tracked separately; combining callbacks into one boolean
could otherwise latch `hasPendingWrites` or incorrectly report a server-backed
view while one query was still cached.

The offline harness itself revealed an emulator-specific trap. Pausing the
Firestore Java process left its TCP listener accepting connections, so a newly
opened client hung rather than declaring itself offline. Blocking emulator
HTTP requests in Playwright was also unfaithful: despite a populated persistent
database containing 114 remote documents, the routed client produced an empty
cache view. A full target stop was the reliable barrier.

The passing test therefore exported the exact local target, verified the
Firebase hub command, stopped the complete Auth/Firestore suite, and proved
ports 8085, 9102, 4400, 4500, and 9150 were all closed. The already-open tab
kept 100 rows. A closed-and-reopened Alice profile then restored all 100 rows
from IndexedDB, accepted one create and one update, displayed 101 tasks, and
reported pending writes while remote commit was impossible. Restarting the
suite from the exact export settled the update and exactly one marker at
authoritative count 101; cleanup restored 100.

This is a strong product result. It also validates the official emulator
documentation's warning that Web persistence is disabled by default: the arm
would have failed this workload without deliberate cache configuration.

### Performance

Seven local samples after two warmups produced these medians:

- mutation to the origin query: 26.852 ms
- mutation to the second-client push: 51.544 ms
- Admin SDK authoritative read: 174.561 ms
- browser reopen and full resubscription: 490.166 ms
- Vite production client build: 174.496 ms

These are one-machine emulator measurements over 100 tasks, not hosted
Firebase latency claims. The first two Admin SDK warmups were approximately
3.2 seconds because each fresh process attempted application-default metadata
credential discovery before using the emulator; recorded warm samples settled
near 175 ms. Firebase's median second-client push was faster than InstantDB's
87.874 ms in this local setup, while its origin reconciliation and Admin read
were slower.

### Dependency and control-plane findings

The final npm audit retained 11 findings: six moderate and five high, affecting
`firebase-admin` and transitive Google Cloud/request/filesystem packages. No
automatic audit fix was applied because it would change the frozen provider
path. This is the weakest dependency-health result so far and materially
changes how comfortable I would be adopting the exact tested dependency set.

The Local Emulator Suite is otherwise mature. The safety-prefixed `demo-`
project prevents accidental production fallthrough, export/import is built in,
rules and port configuration are compact, and one CLI controls Auth and
Firestore together. Friction came from the 139 MB first-run emulator download,
the CLI's `url.parse()` deprecation/security warning, Admin SDK metadata
credential noise, and the care required to stop/restart only the exact target.

### Cleanup and outcome

Target-bound cleanup verified the exact Vite and Firebase hub commands before
stopping them. It removed only the disposable emulator/auth data, exported
offline target, browser profiles, arm-local credentials, and generated logs.
All six declared ports and all disposable paths proved absent. The shared
Firebase CLI and Firestore emulator download caches were retained. Removed
target/runtime bytes are not recoverable, but the retained rules, source, and
deterministic seed recreate them.

Final outcome: complete, 14 PASS / 0 GAP / 0 FAIL / 0 STOP.

### Would I choose it?

Yes, with qualifications. Firebase is the most established and operationally
complete backend exercised so far: auth, rules, emulator tooling, Admin SDK,
realtime listeners, persistent cache, offline write queue, and deterministic
export/import all work together. It is a credible go-to choice when ecosystem
maturity, Google Cloud integration, and known behavior matter more than
minimalism.

For this Todo, InstantDB remains my current leader. It reached the same 14/14
product result with a smaller and more direct application surface. Firebase
required explicit cache bootstrapping, snapshot-metadata aggregation, verbose
document/rule plumbing, a separate Admin SDK, and careful handling of listener
death on revocation. Its unresolved dependency audit is also a serious negative.
Firebase's control plane is substantially more mature than InstantDB's, so the
ranking could reverse for teams that value long-term operational familiarity
over authoring compactness.

### Lessons for Snapback

Firebase demonstrates that a backend can make offline capability deliberate
and observable without turning the application into a custom sync engine.
Snapback should match the end result—persistent query state, queued local
writes, pending-write metadata, deterministic settlement, and explicit
cache-erasure controls—while making the default React path smaller than the
manual `getDocsFromCache` plus dual-listener metadata coordination required
here.

Snapback should also learn from Firebase's control plane: safety-prefixed local
targets that cannot reach production, one configuration file for services and
ports, deterministic target export/import, independent administrative
authority, stable native personas, and rules that can be exercised locally.
It can improve on Firebase by making revocation actively invalidate connected
queries, providing a one-command secure logout/cache purge, avoiding
application-default credential probes on local targets, publishing
secret-safe structured CLI output, and keeping its dependency surface healthy.

## 2026-07-28 — Supabase, calibration, in progress

### Environment and target isolation

The arm uses the frozen shared-hosted path because the dogfood target's public,
service, and direct-database credentials passed read-only preflight. Before the
first write, a redacted baseline proved that the exact namespace had no
matching Postgres relations, Realtime publication entries, or Auth users.

All database objects use the `llp0102_todo_sb01_*` prefix in the exposed
`public` schema. The three persona emails are exact arm-only addresses, and
their user records carry arm namespace metadata. This is intentionally more
conservative than treating a shared Supabase project like a disposable local
database: final cleanup must restore the zero-object, zero-user baseline
without touching any unrelated relation, publication member, or identity.

### First schema and seed

The first migration succeeded through the shared session pooler. It created
four relational tables, foreign keys, uniqueness and ordering constraints,
indexed membership lookups, explicit grants, RLS on every exposed table,
three transaction RPCs, and Realtime publication membership. Native Auth admin
creation produced stable Alice, Bob, and Mallory users. The service-role
authority plane then proved one workspace, two member rows, four ordered lists,
100 unique tasks, 100 unique seed keys, and four valid 25-task ID arrays.

### What felt good

Postgres is an excellent modeling substrate for this workload. Foreign keys,
unique constraints, arrays, transactions, indexes, grants, RLS, and
deterministic SQL migrations are all visible and conventional. The browser can
use the publishable key safely because authorization remains in database
policies, while the service key stays confined to arm-local admin scripts.

Supabase's current documentation is unusually candid about the tradeoffs. It
requires RLS on exposed tables, explains that update also needs a select
policy, and documents both the per-subscriber authorization cost of Postgres
Changes and Broadcast as the preferred higher-scale path.

### What felt bad or uncertain

Even this small Todo required much more backend definition than the document
stores: four tables, four groups of policies/grants, a security-definer
membership helper to avoid recursive RLS, three RPC functions for atomic
cross-table operations, replica identity settings, and publication changes.
The pieces are standard, but the author has to assemble and threat-model them.

Supabase does not provide durable offline query state and an offline mutation
queue in `supabase-js`. Its official ecosystem points offline-first workloads
to additional sync products such as PowerSync or Electric. Adding one would
turn this arm into a two-backend comparison and violate the neutral prompt, so
the native arm will record honest GAPs for cold offline boot, queued offline
writes, and reconnect settlement unless direct testing reveals an undocumented
provider capability.

### Outcome

In progress. The clean shared baseline, isolated hosted migration, native Auth
personas, RLS model, deterministic 100-task seed, and independent authority
summary pass. Browser member/outsider behavior, CRUD, Realtime, conflict,
ordering, revocation, logout, explicit offline GAP proof, performance, and
baseline-restoring cleanup remain.

## 2026-07-28 — Supabase, calibration, completed

Supabase passed 11 of 14 frozen Todo scenarios with evidence confidence 16/16.
The three GAPs are the workload's native local-first core: cold retained boot,
queued offline create/update, and settlement of those queued writes. Every
online data, auth, RLS, Realtime, concurrency, performance-evidence, and
baseline-restoring cleanup scenario passed.

### Online correctness and authorization

The relational result is strong. Stable native Auth users Alice and Bob each
queried all 100 protected tasks, while authenticated Mallory opened the same
native Realtime transport and received zero rows through RLS. Postgres RPC
functions kept create/delete plus list ordering atomic; direct RLS-authorized
updates handled reordering. Alice's create, edit, complete, reopen, reorder,
and delete transitions all appeared in Bob's browser and were checked through
the service-role authority plane.

The app subscribed to Postgres Changes over Supabase Realtime's Phoenix
WebSocket and refetched the affected RLS views on an event. This is native push,
not polling, but it is invalidation-plus-round-trip rather than a reactive query
that directly applies a typed result. The first implementation allowed
overlapping refetch responses to overwrite newer state. A monotonic load
sequence fixed that race. This is ordinary frontend cache coordination that
Convex, InstantDB, and Firebase's snapshot listeners largely own for the app.

Concurrent title edits ran through a security-invoker PostgreSQL function that
atomically incremented `revision`; both commits were counted, the final whole
field was last-commit-wins, and both clients converged to the service-role
result. Concurrent task-order updates used whole-array last-commit-wins and
preserved a valid 25-ID unique permutation.

Revocation was better than Firebase's result. Deleting Bob's exact membership
produced a Realtime membership event, the app refetched immediately, and RLS
reduced his already-connected view from 100 tasks to zero. Alice's subsequent
protected update was not delivered. Regrant plus reload restored the view.

Native `signOut` removed Bob's protected UI and stopped delivery. The browser
retained no Supabase query database because `supabase-js` has no durable
PostgREST result cache; only hashed store/key inventories were retained, and no
protected value was inspected.

### Native offline result

The exact project-host barrier left Vite available while blocking Supabase
HTTP and new Realtime WebSockets. A warm tab naturally kept its 100 in-memory
rows. A create RPC failed, rendered no optimistic task, and left the count at
100. An edited uncontrolled input visually kept the typed text, but the SDK
reported a transport error, exposed no pending queue, and authority remained
unchanged.

After closing and reopening the same browser profile behind the barrier,
Supabase Auth restored the local session but the app had zero tasks and zero
IndexedDB databases. Reconnect queried all 100 rows and resubscribed normally,
but there was no queued create or update to settle. Authority still had 100
tasks, zero marker copies, and the original title.

This is an architectural product GAP, not a missing toggle. Supabase's official
partner catalog points offline-first applications to separate sync layers such
as PowerSync and Electric. Those can produce the desired result, but including
one would turn this into a two-backend arm and obscure what Supabase itself
provides.

### Performance

Seven shared-hosted samples after two warmups produced these medians:

- service-role authoritative task read: 309.687 ms
- mutation to the origin query: 801.590 ms
- mutation to the second-client push/refetch: 804.531 ms
- browser reopen and full resubscription: 1,190.457 ms
- Vite production client build: 160.512 ms

The nearest-rank p95s were 1,038.963 ms for the authority read, 1,814.349 ms
for origin settlement, 1,818.096 ms for second-client delivery, and 1,712.709
ms for browser resubscription. These are internet-path measurements against one
shared hosted project from California, not a general Supabase benchmark. The
pooler hostname gave a `us-east-1` region hint; the billing plan and dashboard
region identifier were not independently observable and are not claimed.

The origin and second-client medians being almost identical reflects the app's
shape: an RPC round trip is followed by a PostgREST refetch in both places.
Realtime event delivery itself is only part of the measured transition.

### Authoring and dependency assessment

The SQL is conventional and powerful, but there is a lot of it for a Todo:
four tables, foreign keys and uniqueness constraints, indexes, grants, eight
policies, a security-definer membership helper, three security-invoker
transaction functions, replica identity settings, and four Realtime
publication entries. This is excellent explicit control for an experienced
Postgres team and a large correctness surface for an agent or small app.

The generated client was not schema-typed because this shared credential path
did not include a linked CLI project/session for type generation. The app
therefore carried manual TypeScript row shapes. That is avoidable in a
fully-linked Supabase workflow, but it is still setup work and another drift
edge that the more integrated competitors eliminate.

The dependency result was excellent: npm audit reported zero findings, and the
installed tree was about 106 MB. The retained authored/policy/test inventory
also makes the cost visible instead of hiding SQL as dashboard state.

### Cleanup and outcome

The shared-target lifecycle worked exactly as intended. Before writes, the
redacted baseline had zero matching relations, publication entries, and users.
Cleanup reverified the target hash, four exact relations, four publication
entries, and three persona ID hashes; verified each Auth user's arm namespace
metadata; then removed only those personas, functions, publication entries,
relations, browser profiles, and credential files. Post-cleanup probes returned
zero matching relations, policies, publication entries, and users. All
unrelated shared-project state was retained.

Removed namespace data and personas are not recoverable, but the retained SQL
migration and deterministic seed recreate them.

Final outcome: complete, 11 PASS / 3 GAP / 0 FAIL / 0 STOP.

### Would I choose it?

Yes for a relational, mostly-online product whose team wants PostgreSQL as the
center of gravity. Supabase offers the clearest escape hatches and the most
standard data substrate in the round so far. RLS, SQL functions, constraints,
direct database access, service-role administration, and Realtime form a
credible production toolbox.

I would not choose native Supabase for this particular offline-first Todo
without deliberately adding a sync product. InstantDB remains the leader for
the frozen workload because it delivered durable cold data and queued writes
with much less application and policy machinery. Convex remains the cleaner
online function/DX reference. Firebase also delivered the full offline result,
although with more client metadata/cache code and a much worse dependency
audit. Supabase is strongest when relational transparency and ecosystem
portability outweigh native local-first behavior.

### Lessons for Snapback

Supabase sets a high bar for explicit, inspectable authority: ordinary
Postgres constraints, migrations, RLS, grants, transactional functions, an
independent service role, and exact namespace cleanup. Snapback should make its
equivalent invariants and administrative authority just as inspectable, even
if its authoring surface stays much smaller.

Snapback can differentiate by owning the pieces this arm had to assemble:
generated row/function types without a linking ceremony, reactive queries that
cannot suffer stale refetch races, atomic multi-record mutations without
handwritten SQL RPC glue, active membership invalidation, persistent authorized
views, and a built-in offline settlement queue. It should also copy the result
of Supabase's mature target discipline: safe public versus privileged keys,
redacted target identity, migrations as source, clean shared namespaces, and
baseline-preserving cleanup.

## 2026-07-28 — Snapback, calibration, completed

The first self-hosted arm is complete: 10 PASS / 3 GAP / 1 FAIL / 0 STOP.
The three GAPs are the expected native offline boundary. The FAIL is more
important: removing Bob's declared workspace membership denied his next fresh
query, but his already-established `requireRole`-gated JS live query retained
all 100 protected rows. The later write did not arrive, but the required
visible-to-hidden blanking never happened.

### Environment and authoring path

This arm used the packaged local SQLite server, Ibex JS handlers, sessions-mode
auth, generated client references, the shipped headless client, and the shipped
React external-store hook. The required Guide pass was genuinely useful. It
made the intended division clear:

- schema and function declarations are the checked authoring surface;
- `ctx.membership` and `ctx.permissions` own scoped authority;
- protected JS handlers are server-only;
- membership-gated results are deliberately not retainable offline in v1;
- React is an Online-class client surface.

Code generation was fast and decisive. It rejected stale artifacts, generated
39 files from the declarations, exposed nominal workspace IDs and membership
helpers, and made capabilities such as `localRunnable: false` and
`offlineReplay: false` inspectable rather than aspirational. The production
React build was also ordinary once the generated API existed.

The final application model is resource-scoped: Alice atomically bootstraps a
workspace and owner seat, creates the bounded four-list/100-task fixture, and
adds Bob through an owner-only transition. Every task-by-ID mutation loads the
task and authorizes against its own workspace, so a caller-supplied resource
cannot be used to cross a workspace boundary.

### The reset and identity dead end

The first implementation used app-scoped membership plus an admin reset seed.
That looked like the shortest deterministic fixture path, but sessions and
reset form a circular dependency:

1. membership seed rows need server-issued principal IDs;
2. minting sessions supplies those IDs;
3. reset advances the auth boundary and invalidates those sessions;
4. reminting the same email after reset produced a different principal ID.

The first attempt therefore failed with `SNAPBACK_AUTH_REQUIRED`; the second
proved the principal changed across reset. Nothing in the Guide put this
lifecycle consequence close enough to the normal seed loop. The secure,
idiomatic answer was authenticated resource bootstrap with server-owned IDs,
but discovering that required reading examples and failed executions.

The bootstrap result is good: resource and owner membership are atomic, there
is no open self-join, private membership rows do not need to be queried, and
the fixture remains deterministic in shape without pretending IDs are
application-owned.

### CRUD, realtime, conflict, and ordering

CRUD was compact. Alice created, edited, completed, reopened, reordered, and
deleted a task; the authoritative count returned to 100. Bob received Alice's
edit over the durable WebSocket stream without polling or refresh. Independent
browser contexts also proved Alice and Bob saw 25 tasks in the selected list
while Mallory received the terminal permission denial.

Explicit row-version read sets gave a strong conflict result. One concurrent
edit committed and the other initially received
`SNAPBACK_AUTH_RESERVATION_STALE`, the documented pre-transaction authority
race. Retrying the complete losing attempt with its original baseline then
produced `SNAPBACK_MUTATION_CONFLICT`. This is correct, but it means application
code must understand two different 409 paths to surface one user-visible
conflict.

The same barrier held for concurrent reorders: one full-list reorder committed,
the stale attempt conflicted, and the authoritative list retained one unique
`0..24` position sequence. Transactions and read sets were much stronger than
the last-write-wins outcomes in several competing arms.

### Offline is an explicit product boundary

Stopping the server made both a cold protected query and mutation fail at the
network boundary. Restart restored the authoritative 100 rows and proved the
offline create had neither queued nor duplicated.

These are honest GAPs, not test omissions. The generated contract says the
membership-gated JS query is not locally runnable or retainable, protected JS
mutations have no offline replay, and the React client has no durable outbox.
The clarity is good; the capability is absent. For the frozen offline-first
Todo, InstantDB and Firebase remain materially ahead.

### Lifecycle defects

Three related live-client problems appeared:

- Repeated `pause()` / `resume()` on one live handle eventually attempted to
  remove an already-removed server subscription and threw
  `SNAPBACK_UNKNOWN_SUBSCRIPTION`. The performance barrier had to use fresh
  subscribe/dispose cycles.
- `replaceBearerToken(null)` correctly blanked rows and blocked future
  delivery, but still threw an `AggregateError` containing that same redundant
  unsubscribe diagnostic. A successful security transition should not look
  failed to application code.
- Most seriously, Bob's membership self-removal did not blank the 100 rows
  already held by his established `requireRole`-gated JS live handle. Fresh
  reads were denied and no future write arrived, so the authority check and
  future-delivery barrier partly worked; protected data eviction did not. This
  contradicts the accepted LLP/Guide promise that membership changes wake the
  captured dependency and shrink under a witnessed delivery obligation.

The generated function describes this query's authorization dependence as
`["opaque"]` even though the runtime captured a declaration-bound
`ctx.permissions.workspaceMembers.requireRole(...)` read. That seam is the
first place I would investigate.

### Performance and dependency cost

On the frozen small local profile, two warmups plus seven samples produced
these medians:

- representative read: 36.051 ms
- representative write: 105.409 ms
- second-client realtime delivery: 96.215 ms
- fresh live subscription: 45.634 ms
- production build: 1,739.743 ms

The native local data path felt responsive. Build time was dominated by
TypeScript/Vite rather than Snapback code generation. The app installed about
81.6 MB of dependencies and `npm audit` reported zero vulnerabilities.

### Evidence and cleanup

The arm retains native persona hashes, exact diagnostics, raw performance
samples, generated manifests, a pre-cleanup SQLite hash, dependency and source
inventory, and a target-bound cleanup receipt. The first cleanup review caught
an arm-harness mistake: Vite had copied the ignored transient persona bearer
file from `public/` into `dist/` during timed builds. The final runner removes
both copies plus the exact SQLite runtime and proves all three absent. Removed
state is not recoverable, but authenticated bootstrap recreates it.

### Would I choose it?

Not yet for this Todo. The offline requirements alone put InstantDB and
Firebase ahead, and the retained-row revocation failure is a security blocker
even for an online-only shared workspace. Snapback's declarations, generated
artifacts, transaction model, explicit settlement vocabulary, and authority
primitives are promising enough that this does not feel like a dead-end
architecture. But the current end-to-end result is behind the product promise.

### Lessons for Snapback

The most urgent work is correctness:

1. make a declaration-bound imperative `requireRole` read produce analyzable
   authorization dependence and a reliable live shrink/blank on revocation;
2. make redundant unsubscribe idempotent across pause, resume, logout, server
   invalidation, and dispose;
3. make bearer replacement report success when custody changed and only
   redundant cleanup failed;
4. document reset's session invalidation and principal-ID consequences next to
   the normal deterministic seed workflow.

After that, the competitive opportunity is still compelling: combine
InstantDB/Firebase-class retained offline state and queued writes with
Snapback's explicit receipts, generated capability truth, scoped authority,
and optimistic concurrency. The architecture does not need to be abandoned to
have a shot at first place, but the live-authorization seam must become
boringly correct before ergonomic refinement can matter.

## 2026-07-28 — Appwrite, calibration, completed

The final Todo arm completed at 11 PASS / 3 GAP / 0 FAIL / 0 STOP. The GAPs are
the three native offline scenarios. Appwrite's result was stronger than I
expected in schema authoring and transactional conflicts, but its official
self-host path was by far the heaviest local setup in this round.

### Setup and deployment

I used the official Appwrite 1.9.6 web installer, MongoDB profile, Web SDK
26.2.0, and CLI 23.2.0. The installer generated its own ignored Compose and
environment files, then launched 28 containers from seven images. The main
Appwrite image alone was about 910 MB. Pulling the official service set
dominated first-run time; parallel image pulls shortened the wait without
changing the resulting stack.

The wizard-to-CLI handoff exposed version skew. Login worked, but the current
CLI's organization listing called endpoints that 1.9.6 did not expose.
Creating the initial organization through the older native Teams route and
then passing its ID to `appwrite init project` worked. Project init also
silently installed two agent skills into the app directory; I removed them
because they were unrelated generated state. A project-creation command should
not mutate an agent's instruction surface without an explicit choice.

### What felt good

The current TablesDB API can create a table with its columns and indexes in one
call. That made the schema concise and eliminated the usual polling loop for
each asynchronously-created attribute. Team permissions were also direct:
Alice and Bob were project users plus members of one workspace Team, Mallory
was an ordinary outsider, table-level create belonged to the Team, and row
read/update/delete permissions named that Team.

Native transactions were the standout capability. Create and delete updated
both a task row and its list order atomically. Edit and reorder combined a row
patch with a revision increment. Two concurrent edits produced an explicit
optimistic commit conflict: one revision advanced, one client displayed the
conflict, and both converged on authority. Concurrent full-array reorder also
retained a valid unique 25-ID permutation. This is substantially better than a
silent last-write-wins story.

Auth, row queries, and Realtime were easy to connect in the browser. Alice's
create/edit/complete/reopen/reorder/delete sequence reached Bob over native
permission-filtered WebSockets, and Mallory's identical query returned zero.
The newer typed `Channel.tablesdb(...).table(...).row()` builder is much nicer
than assembling channel strings by hand.

### What felt bad or surprising

Realtime permission revocation has an awkward visibility boundary. Removing
Bob from the Team immediately denied his fresh query and prevented the next
protected task event, but his already-rendered 100 rows stayed in React memory.
The membership change itself did not give the now-unauthorized client a usable
signal to clear them. The SDK documentation also says session changes require
disconnecting and resubscribing, so auth lifecycle correctness is an
application responsibility.

Appwrite's Web SDK warned that a localhost API endpoint forces session
management into localStorage. Logout worked when I explicitly disconnected
Realtime, deleted the current session, and unmounted protected UI, but the
secure shape required coordinating three steps.

There is no native durable TablesDB query cache or mutation queue. With the API
port blocked, warm rows survived only in component memory, writes failed with
no optimistic task and no outbox, a cold boot showed zero rows and fell back
to login, and reconnect had nothing to settle. Appwrite's official offline
guidance is honest but delegates the core problem: add IndexedDB, SQLite,
RxDB, or another local database, design push/pull, and implement conflict
resolution. Under LLP 0102 that is a product GAP, not permitted glue.

The CLI dependency was expensive. The app-only SDK scaffold initially audited
clean, but retaining CLI 23.2.0 for reproducible project setup expanded
installed dependencies to about 285 MB and produced 16 audit findings
(3 low, 6 moderate, 7 high), all non-critical. The CLI also brought deprecation
warnings from unsupported transitive packages.

### Performance

On the local Docker Desktop stack, two warmups plus seven recorded samples
produced these medians:

- authoritative Admin read: 113.862 ms
- mutation to origin convergence: 193.792 ms
- mutation to Bob's Realtime view: 195.083 ms
- browser reconnect and resubscribe: 805.627 ms
- production Vite build: 234.403 ms

The data path was usable but noticeably slower than Snapback's local arm.
Reconnect paid for Auth validation, two table reads, and WebSocket setup.

### Would I choose it?

For an online-first product that wants a broad self-hostable backend, Appwrite
is credible. TablesDB, Teams, Auth, transactions, permissions, and Realtime
compose into a real application without SQL or custom server functions. I
would not choose it for this offline-first Todo: the three central offline
behaviors are delegated, the local operational footprint is large, and the
CLI/server compatibility seam made a nominally guided setup less predictable.

### Lessons for Snapback

Snapback should match the outcomes of Appwrite's best pieces:

1. allow schema, indexes, and access intent to be declared in one coherent
   operation with immediate typed feedback;
2. keep multi-record transactions and explicit optimistic conflict outcomes
   first-class;
3. offer composable, typed Realtime channel/query identities for diagnostics;
4. preserve the simplicity of one small local runtime rather than inheriting
   Appwrite's 28-container operational shape;
5. make logout and membership revocation actively clear protected state
   without requiring application choreography;
6. deliver the offline cache/outbox/settlement layer that Appwrite explicitly
   leaves to another database.
