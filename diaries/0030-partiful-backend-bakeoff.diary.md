# Diary 0030: Partiful backend bakeoff

**Type:** Diary
**Status:** Active
**Systems:** Backend bakeoff, Events, Authorization, Assets, Scheduled work, Effects
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Related:** LLP 0102

## 2026-07-28 — Stage 0, protocol freeze

No provider arm has started. This is a new direct-provider comparison, not a
reuse of the earlier Partiful matrix's normalized polling gateways. The frozen
facts distinguish public preview, role-scoped controls, guest-list visibility,
capacity contention, authenticated assets, scheduled reminders, and an
external effect with retry and ambiguous-outcome evidence.

## 2026-07-28 — Supabase, deep round, complete with hosted unavailable

### Environment and outcome

The arm used Supabase CLI 2.110.0, `supabase-js` 2.111.0, PostgreSQL
17, Storage, Postgres Changes, Edge Runtime 1.74.2, and `pg_cron`. Fourteen
local frozen scenarios passed; the hosted scenario is unavailable because no
isolated managed-project credential existed. Coordinator confidence is 14/16:
the frozen app has no persistent-offline scenario, and I failed to capture a
separately timestamped empty baseline before local provisioning.

### What felt good

The relational and transactional parts fit extremely well. Roles,
invitations, RSVP revisions, guest-list visibility, and wall posts remained
ordinary tables with RLS. The final-seat race was a small row-locking RPC: Dave
and Erin submitted concurrently, exactly one committed, and the authoritative
seat count stayed at capacity one.

PostgreSQL gave unusually direct scheduled-work evidence. A real five-second
`pg_cron` job selected due reminder rows, changed the schedule to `ran`, and
inserted one unique notification attempt. Waiting through a second interval
proved that the dedupe ledger stayed at one.

Storage also produced a crisp end-to-end result. Alice uploaded private event
art, Bob downloaded byte-identical content, Mallory was denied, Alice deleted
the object, and service-role listing proved the exact path absent.

The local deterministic external effect used two actual Edge Functions:
`notify` called `provider-fake` over HTTP with server-only configuration, while
Postgres retained the application attempt ledger and provider delivery ledger.
A known-success retry returned the first receipt without redelivery. In the
ambiguous case, the provider accepted once, the caller deliberately retained
uncertainty, and the next attempt reconciled through provider status without a
second delivery.

### What felt bad or frustrating

RLS is powerful but the policy surface expanded quickly across profiles,
events, members, invitations, RSVPs, wall posts, schedules, attempts, and
Storage objects. The builder has to maintain helper-function security,
privileges, policy recursion, publication membership, and invoker/definer
boundaries coherently.

Realtime readiness remained unreliable. In both early attempts the channel
reported `SUBSCRIBED` but missed the immediate guest-list policy transition.
The final run retained the first cold miss, restored the policy, and received
the second false transition directly. Local measured Postgres Changes delivery
was also surprisingly stable but slow at about 491 ms median.

Edge Function discovery was lifecycle-sensitive. The running Edge Runtime had
snapshotted only the first function; adding the deterministic provider
function required restarting the exact Edge container/project. Several more
attempts isolated the distinction between user JWT propagation, Kong's
Authorization handling, a provider-specific secret header, and the Edge
worker's cached source. The final boundary works, but getting there was
considerably more orchestration than the application logic suggests.

The CLI stack used ten containers, three volumes, one network, and about
245 MB of installed JavaScript dependencies. Colima still could not mount the
assigned `/private/tmp` worktree, so the official runtime project needed an
exact temporary mirror under `/Users`.

### Authority, realtime, and revocation

Six native Auth users represented host, cohost, guests, capacity contenders,
and outsider. Anonymous callers saw only the seven-column public preview and
could not read the events table. Alice and Carol could edit host controls, Bob
could RSVP but not take over controls, and Mallory could neither read the
private event nor post.

Changing guest-list visibility narrowed Bob's already-connected view to his
own membership while the public preview stayed visible. After Bob's membership
was revoked, his existing subscription did not receive the exact protected
post, and a direct read returned zero. Host-visible RSVP and wall history
remained durable and explicitly disclosed.

The frozen burst delivered ten wall inserts and two RSVP transitions to
independent clients through native Postgres Changes, with authoritative wall
and seat totals matching afterward.

### Performance and operations

Two warmups plus seven retained samples produced local medians of 2.115 ms for
capacity contention, 1.669 ms for a ten-post burst, 13.739 ms for private asset
upload/download/delete, 491.018 ms for Realtime delivery, and 1,067.679 ms for
the production build. Local provider charge was zero; these are not hosted
latencies.

Cleanup removed only the exact CLI project and runtime/XDG state. Ten
containers, three volumes, one network, and ports `4330/57431–57440` were
absent, while every container that predated cleanup remained. Because the
empty pre-provision state was not separately timestamped, the capsule
correctly gives cleanup-isolation confidence 1 rather than pretending the
negative proof is stronger.

### Would I choose it?

For an event application that is connected-first and values SQL, RLS, private
assets, scheduled database work, and explicit server-side effects, Supabase is
a strong choice. Its core relational correctness is excellent.

I would hesitate when minimal operations, very low-latency realtime,
automatically coherent policy, or persistent offline behavior matter most.
The amount of SQL policy, Edge/Kong lifecycle, container, and harness machinery
was substantial.

### Lessons for Snapback

Match the end result of row-locked capacity enforcement, private asset
authorization, inspectable schedules, and a durable effect ledger that keeps
known success, failure, and ambiguity distinct. Make the same outcomes one
coherent authoring surface instead of requiring separate RLS, grants,
publications, cron, Edge functions, and provider ledgers.

Snapback should provide a true live-ready barrier, lower local push latency,
first-class server-only effect configuration, an idempotency/ambiguity
primitive, scheduled-run inspection, and exact target cleanup receipts. It can
retain a real advantage through a lightweight runtime and built-in
offline/outbox behavior. This arm does not suggest that Snapback needs a
fundamental architectural change; it shows that production scheduling,
assets, effects, and authority must become much more complete and observable.

## 2026-07-28 to 2026-07-29 — Firebase, deep round, complete with hosted unavailable

### Environment and outcome

The arm used Firebase 12.16.0, Firebase CLI 15.24.0, Admin SDK 14.2.0,
Functions 7.3.2, and the Local Emulator Suite on a fresh project namespace.
Fourteen local frozen scenarios passed. Hosted deployment was unavailable
because the isolated CLI state had no account, so no managed target was
mutated and no hosted result is inferred. Coordinator evidence confidence is
15/16; only the frozen app's lack of a browser offline-write scenario is
indirect.

The first evidence pass proved the 20-post native listener burst but omitted
the simultaneous RSVP-total transition. I did not turn that omission into a
narrative pass. A second fresh remediation project, with its own empty
baseline and exact cleanup, reran only the missing fact and directly observed
both 20 posts and attendance `0 → 2`. The capsule discloses both target
lineages.

### What felt good

Firestore transactions were a strong fit for the final-seat race. The callable
transaction read the invitation, prior RSVP, and attendance; rejected
over-capacity writes; and updated the RSVP plus derived count in one place.
Exactly one of two authenticated clients won the last seat and the
authoritative count stayed at 50.

Native `onSnapshot` listeners were simple and convincing. A second client
received the wall burst without polling. More surprisingly, Firestore Rules
dependencies were re-evaluated for already-connected clients: changing
guest-list visibility or role membership terminated protected listeners with
`permission-denied`. Clearing retained client state in the listener error path
made revocation honest.

The Local Emulator Suite made destructive concurrency, authorization, Storage,
Functions, and ambiguous-effect tests cheap. Callable Functions automatically
carried the authenticated actor into privileged handlers, and a `demo-*`
project identity supplied a useful production-access guardrail.

Separating anonymous preview, member event state, and host controls made the
public/private boundary legible. Private Storage also passed byte-for-byte
download, outsider denial, and post-delete absence checks.

### What felt bad or surprising

The operational surface was much larger than the app surface. In addition to
Auth, Firestore, Functions, Storage, and UI, the CLI opened hub, logging,
Eventarc, Tasks, Pub/Sub, and a Firestore UI WebSocket listener. The worker had
to inspect installed CLI source to discover and pin all twelve ports safely.

Scheduled-function emulation was not self-evident. `onSchedule` was skipped
until Pub/Sub joined the emulator set. Deterministic acceptance then needed an
authenticated callable that invoked the same reminder core; there was no
obvious “run this schedule now at this logical date” workflow.

Firestore Rules cannot redact fields, so a natural single event document was
unsafe for anonymous reads. The three-document split works, but introduces
denormalization and atomicity obligations. Storage Rules also cannot consult
Firestore, so the object had to bind host ownership in immutable metadata
instead of consulting event membership.

Effect idempotency and ambiguous settlement were entirely application-authored.
Transactions made the ledgers reliable, but stable effect keys, attempt states,
provider dedupe, known success, and ambiguous-after-accept reconciliation were
all custom code.

The Functions emulator emitted noisy Admin SDK metadata/config warnings for a
valid local demo project. The frozen dependency audits retained 22 findings in
the UI tree and 12 in the Functions tree, including high-severity entries, and
the minified Firebase UI bundle was roughly 763 KiB before gzip. These are
ecosystem-weight observations, not frozen-arm fixes.

### Performance and operations

Two warmups plus seven retained samples produced local medians of 3.941 ms for
representative reads, 2.790 ms for writes, 1.427 ms for realtime delivery,
13.686 ms for reconnect, 3,432.132 ms for capacity contention, 30.836 ms for
the 20-post burst, 40.270 ms for the 256 KiB asset round trip, and 161.835 ms
for the production UI build. These are emulator timings, not hosted latency or
scale claims. Local provider charge was zero.

Cleanup reduced both the primary and remediation data planes to zero, closed
all twelve assigned and auxiliary ports, removed exact runtime state, and left
no arm process. The cache quarantine was moved to macOS Trash and remains
recoverable until Trash is emptied.

### Would I choose it?

Firebase is a strong choice when mature first-party auth, adversarial local
testing, transactions, native listeners, Functions, and object storage matter
more than conceptual economy. It is a particularly useful correctness
benchmark.

I would hesitate for this app when I wanted one coherent policy model, a small
operational footprint, first-class effect settlement, or relational querying.
Document projection, two rule languages, scheduling plumbing, and hidden
emulator topology added substantial glue.

### Lessons for Snapback

Match Firebase's end result for safe transaction retries, typed contention
failures, and authoritative settlement. Match its active invalidation of
already-connected clients, but provide a standard retained-state purge hook.

Snapback can materially improve on the local workflow by exposing every
process and port in one target receipt, with no hidden auxiliaries. It should
also offer first-class public/private projections, a scheduled-job test API
with a frozen logical clock, one coherent data-and-blob authority model, and
an effect primitive that records idempotency, attempts, known success, and
ambiguity.

The Firebase arm strengthens the view that Snapback's architecture can compete:
its coherent authority/settlement model and smaller runtime are meaningful
advantages. The gap is completeness and operational proof, not an obvious need
to abandon the approach.

## 2026-07-28 — SpacetimeDB, deep round, complete with hosted unavailable

### Environment and outcome

The arm used SpacetimeDB 2.7.0 on an isolated Linux standalone server with
generated TypeScript bindings, a React client, and a deterministic external
effect receiver reached through a readiness-gated Cloudflare Quick Tunnel.
Fourteen local frozen scenarios passed; Maincloud evidence was unavailable
because the frozen credential inventory had no account. Coordinator evidence
confidence is 15/16: reconnect is direct, but Partiful has no frozen persistent
browser-offline scenario.

### What felt good

Private source tables plus identity-aware public views fit this application
unusually well. Mallory received the anonymous invitation projection and no
protected state. More importantly, changing policy or revoking Bob removed
rows from his already-connected subscription rather than merely denying his
next request. This is one of the strongest revocation end results in the
bakeoff.

Transactional reducers made final-seat contention pleasantly small. Bob and
Casey crossed one client barrier, one reducer committed, one rejected, and
direct SQL confirmed that capacity was not exceeded. There was no explicit
lock or transaction retry loop in application code.

Generated bindings made reducer names and live row shapes comfortable in both
the harness and UI. A second client received the 20-post burst, RSVP totals,
asset changes, policy transitions, and revocation over native WebSockets
without polling.

Native scheduled procedures were also a good fit. One scheduled row produced
one inspectable run and one idempotent notification attempt. Keeping external
HTTP in a procedure, outside the transactional reducer section, encouraged a
sound outbox-like boundary.

### What felt bad or surprising

The CLI vocabulary was inconsistent enough to consume real time:
`spacetime --version`, positional `init`, `--module-path` for build and
generate, and the `spacetimedb` npm package each differed from the first
reasonable guess. Help output made these recoverable, but not predictable.

Intentional reducer rejections arrived at the SDK as a generic
`InternalError`; the useful capacity or authorization diagnostic lived in the
server log. The server behavior was correct, but expected domain refusal felt
like a crash at the call site.

Identity-aware views are powerful and opaque. The client sees the resulting
rows but has no first-class explanation for why this actor can see a row or
why it disappeared. Debugging policy therefore required reading server source
and correlating callbacks.

Procedure HTTP correctly refused loopback/private destinations. That is a
secure production default, but it made a deterministic local effect test much
heavier: the arm needed an ephemeral public tunnel and a separate readiness
gate. A 502 after the receiver accepted and dropped the response also proved
why transport failure cannot be called provider failure; the ledger had to
retain `ambiguous` and retry the same key.

The frozen 256 KiB asset worked as inline table bytes with clean authority and
hash evidence. Production event media would still want object storage, signed
delivery, metadata, and lifecycle support.

### Performance and operations

Two warmups plus seven samples produced local medians of 5.265 ms for RSVP
writes, 14.304 ms for capacity contention, 4.922 ms for realtime delivery,
21.665 ms for the wall burst, 9.125 ms for the inline asset round trip,
3.544 ms for reconnect/read, and 519.592 ms for a module build. These are
isolated local-host measurements, not Maincloud claims.

Cleanup deleted the exact immutable database identity. A syntactically valid
positional `describe` then returned `No such database` without a usage
diagnostic. The worker validated PID/cwd ownership, removed only arm state,
closed ports `3332/4333`, and left no arm tunnel.

### Would I choose it?

SpacetimeDB is compelling for a connected, transaction-heavy application whose
authorization can be expressed as identity-aware live views. Its reducers,
generated bindings, schedules, and automatic live row eviction are genuinely
preference-shaping.

I would hesitate when conventional object storage, structured domain errors,
ordinary local HTTP-effect testing, relational/ad-hoc query tooling, or a
mature managed operational story dominates. The current Maincloud story is
also unmeasured here.

### Lessons for Snapback

Match the end result of automatic protected-row eviction, transaction-by-default
contention, typed generated bindings, and inspectable schedules. Improve on
SpacetimeDB by returning structured domain refusals, explaining live authority,
and offering a safe official local-effect transport.

Snapback should standardize known-success, known-failure, and ambiguous effect
settlement with stable idempotency keys. It should add real object storage
ergonomics instead of relying on inline bytes. None of these outcomes requires
copying SpacetimeDB's database architecture; they are plausible refinements of
Snapback's existing authority, transaction, settlement, and target model.

## 2026-07-28 to 2026-07-29 — Appwrite, deep round, complete with hosted unavailable

### Environment and outcome

The arm used Appwrite self-host 1.9.6, Web SDK 26.2.0, Node SDK 27.1.0, CLI
23.2.0, TablesDB, Auth, Teams, Realtime, Storage, and a deployed Node 22
Function. Fourteen local scenarios passed. Appwrite Cloud was unavailable
because no arm-scoped target or credentials existed, so the hosted scenario is
an unavailable remote dependency rather than a product failure. Coordinator
evidence confidence is 15/16 because Partiful has no persistent offline
scenario and this arm claims no durable offline store.

### What felt good

Native TablesDB transactions were the strongest Appwrite result. Two
actor-scoped transactions staged the 49-to-50 final-seat race, one committed,
one returned a typed `transaction_conflict`/409, and authority remained exactly
50/50. The schema and indexes were compact to create and easy to inspect
through admin APIs.

Auth sessions, a Team role, and row permissions made the host, cohost, guest,
and outsider tests concrete. Splitting public invitation fields from protected
event state gave anonymous users a structural boundary instead of a
client-side projection.

Storage produced a clean application-level lifecycle: Alice uploaded the exact
262,144-byte object, Bob downloaded an identical hash, Mallory was denied, and
the post-delete read failed. Appwrite's breadth is real.

Function variables gave the effect boundary redacted secrets, while execution
logs and TablesDB attempt/delivery rows made settlement inspectable. A native
future `scheduledAt` execution ran once, and both known-success and
accepted-then-disconnected retries preserved one logical delivery.

The self-hosted product exposed enough API surface to inventory the project,
tables, permissions, indexes, function, executions, storage, and cleanup
without scraping an admin UI.

### What felt bad or surprising

The local operational footprint was enormous for this application: 29 Compose
containers, 12 volumes, two networks, three Open Runtimes residues, and an
arm-owned effect sink on a 4 CPU/8 GiB Colima VM. The assigned Hetzner machine
had ample compute but no Docker-compatible runtime or installation authority,
so the arm had to move back to the control plane.

The official installer stream terminated after the stack was healthy, and
Colima did not mirror generated files from the `/private/tmp` bind. Recovery
required health-checking the exact installer container and copying its Compose
files. Node 22 was cached but not enabled in generated configuration, so the
worker changed the exact stack's runtime setting and recreated the relevant
services.

Realtime was the largest product papercut. Three natural concurrent
`subscribe()` calls activated only the first observed channel; an array
subscription also failed to behave as expected. Sequential registration
worked. Collection delivery additionally required table-level read permission,
so table authority, row authority, Auth restoration, channel shape, and
subscription timing formed a subtle state machine.

The frozen 20-row client burst hit endpoint rate limiting; native
`createRows` batching was the correct path. A signed-in host could not grant
Bob read permission during Storage upload, requiring a server-authorized
follow-up permission update.

The cron definition loaded and enqueued work but did not yield an inspectable
execution inside the bounded wait. The native future `scheduledAt` API worked,
but requires minute precision and at least a one-minute lead. The generated
Function execution key also failed to authorize TablesDB writes through the
control-plane endpoint, so the arm used a broader app-scoped key as a redacted
Function variable.

The frozen dependency audit retained 16 findings—seven high, six moderate, and
three low—mostly in the CLI's development tree.

### Realtime revocation and retention

An already-connected Bob received no protected event after guest-list authority
was removed and no post after invitation revocation; fresh protected reads were
denied. Appwrite did not proactively erase the 21 previously authorized wall
rows from React memory. The UI disclosed that retention until refresh, exactly
as the frozen scenario requires; this is not represented as an eviction pass.

### Performance and operations

Two warmups plus seven samples produced local medians of 107.580 ms for
capacity contention, 164.843 ms for the 20-row burst, 20.014 ms for the asset
round trip, 13.932 ms for Realtime delivery, and 467.137 ms for deploy/build.
These are self-hosted local measurements, not Appwrite Cloud claims.

The first cleanup pass caught three project-named Open Runtimes containers and
a probe bug, retained both facts, validated exact name/runtime-ID/type/image
ownership, and removed only those residues. Final proof shows all 29 Compose
containers, 12 volumes, two networks, the three runtime containers, effect
sink, four assigned ports, and three arm-runtime directories absent. Unrelated
baseline hashes were untouched.

### Would I choose it?

Appwrite is strong when backend breadth, native transaction conflicts,
inspectable authorization, first-party assets, Functions, and self-host control
matter. It is not the lightest or most predictable developer loop in this
comparison. I would choose it conditionally for ownership and breadth, not as
the default for a small team optimizing for minimal machinery.

### Lessons for Snapback

Match Appwrite's end result for native assets, scheduled work, redacted
function configuration, effect execution history, typed transaction conflict,
and complete target inspection. Preserve Snapback's chance to be much better
at local startup, deployment footprint, runtime coherence, and live-authority
clarity.

The most important competitive lesson is to make subscription readiness and
authorization transitions difficult to misconfigure. One coherent live handle
should expose readiness, authority cause, revocation, retained-state policy,
and cleanup without requiring developers to coordinate table permission, row
permission, session restoration, channel syntax, and registration order.

## 2026-07-28 to 2026-07-29 — Snapback, deep round, complete with product gaps

### Environment and outcome

The arm used the exact repaired-and-frozen Snapback source commit
`5f31cb6174daaefa04a1e05242acbbc22c725040`, the canonical local Ibex + SQLite
target, and sessions auth. Twelve frozen scenarios passed. Authenticated
assets, an honestly complete hosted profile, and the complete asset-dependent
performance scenario are explicit product GAPs; none was replaced with an
application-table imitation.

Coordinator evidence confidence is 14/16. Actor authority, contention,
transport, settlement, target identity, and artifact reproducibility are
direct. Reconnect is direct but the app makes no persistent-offline claim.
Cleanup proves every exact carrier absent, but a separately timestamped
pre-write baseline was not retained, so cleanup isolation scores 1 rather than
2.

### What felt good

Schema, functions, generated references, and manifests made the backend
inspectable. Once the handlers were valid, codegen was fast and deterministic.
Four real server-resolved sessions exercised host, cohost, guest, outsider, and
revoked states; no mutation accepted a caller-supplied user id.

Capacity enforcement fit naturally in one authoritative mutation. Two
simultaneous final-seat claims produced one success and one rejection, while
an independent audit proved exactly 50 seats and 50 RSVP rows.

Managed live queries proved the difficult privacy transitions directly. An
established Bob handle changed `3 → 0 → 3` when guest-list visibility changed.
After invitation revocation, a 20-row wall handle blanked to zero before a
later protected write was refused.

Actions composed with mutations, deployment config stayed write-only, and a
deterministic cron tick made reminder and effect ledgers inspectable without
network I/O inside a transaction. Cleanup was unusually concrete: the receipt
enumerates SQLite, WAL/SHM, config, auth keyring, startup artifact, reservation
lock, and restore-lock carriers, then proves every exact path absent and both
ports closed.

### What felt bad or frustrating

The absence of authenticated asset upload, delivery, and deletion blocks a
Partiful-shaped product. The frozen source also has no honestly complete
hosted path. A polished local event core cannot become a deployable service
with equivalent auth and operational claims.

Notification effects required an application-authored reservation, certainty,
attempt ledger, fake provider, and retry policy. Snapback supplied safe
primitives but not the ordinary end result. Known failure, success,
ambiguous-after-accept, and keyed retry were provable only because the app
built that machinery itself.

An anonymous public query in a sessions app was not paved. A plain
`SnapbackClient` was refused for lacking auth-client protocol v1, while a
protocol-bearing client was refused for lacking a custody owner. The arm
needed a raw HTTP helper carrying the protocol offer without caller auth.

`SNAPBACK_OUTBOUND_ACTIONS=1` is documented as a runtime grant, but codegen
also required it. Local config automation named the operations without a
runnable request shape, and the sessions guide showed `mailbox.code` without
the complete gated mailbox fixture. All three detours required source or
example inspection and now have guide-gap tickets.

Protected JS live queries were conservatively noisy. Each ordinary wall write
produced a quarantine-to-empty delivery followed by a fresh authorized
snapshot—safe, but potentially flickery and expensive for bursty surfaces.
Host-managed promotion/removal also lacked an obvious product path, so roles
were ordinary rows plus custom checks.

Action failure settlement returned `{ok:false}` while mutation failure
rejected. The capacity loser surfaced as generic `SNAPBACK_HANDLER_FAILED`
rather than a domain code. Repeated acceptance attempts also fell through to
`cargo run` after app work dirtied the worktree, even though the frozen product
binary itself had not changed.

### Modeling, realtime, and operations

The model uses events, invitations/roles, RSVPs, wall posts, reminder
attempts, and notification effects. Public preview is a closed projection.
Protected queries read invitation authority and return no rows after policy
loss. Mutations recheck the effective session principal inside the
authoritative transaction.

Native WebSocket evidence—not polling—covers the 20-post burst, guest-list
policy transition, and revocation blanking. Reconnect pause/resume was sampled,
but this arm does not claim durable offline retention. After revocation, the
online protected handle was empty and a fresh protected write was denied.

Local startup, health identity, config status, cron tick, function manifests,
and cleanup are inspectable. Hosted deployment, hosted auth admission, hosted
logs, hosted cost, and an asset performance path remain unmeasured gaps.

The arm contains 750 authored-source lines, 904 test lines, and 68 generated
files. Glue includes four-session fixture setup, an ordinary-table role model,
the raw anonymous helper, application-level reminder/effect ledgers, a
deterministic fake provider, and evidence/cleanup tooling.

### Would I choose it?

Conditional, not as my present default for this app. I would choose Snapback
for a local or correctness-focused event core where capacity, authorization,
and live revocation matter more than platform completeness. I would not choose
it today for a real Partiful-shaped launch: assets and hosted operation are
table stakes, and notification delivery takes too much application-owned
infrastructure.

### Lessons for Snapback

Ship the complete authenticated asset outcome and one honestly end-to-end
hosted profile. Provide a first-class idempotent effect-attempt result with
explicit known-failure, ambiguity, retry, and terminal replay semantics. Make
anonymous generated reads ordinary in sessions apps, add host-managed role
ergonomics, preserve structured domain errors, and coalesce safe auth-backed
refreshes without showing a transient empty snapshot for every normal write.

The Guide needs explicit assets/notifications GAP rows, codegen-time egress
instructions, a complete local session fixture, a runnable local config
journey, and a paved anonymous-read path. Snapback's transactional authority,
fail-closed live revocation, deterministic codegen, and exact cleanup remain
real differentiators worth preserving while those product outcomes are filled
in.

## 2026-07-28 to 2026-07-29 — InstantDB, deep round, complete with gaps

### Environment and outcome

The arm used three fresh official hosted temporary Instant apps with client,
Core, Admin, and CLI version 1.0.52. Nine frozen scenarios passed. Complete
asset deletion, scheduled jobs, known-success effect retry, ambiguous effect
settlement, cancellation/revocation delivery, and the complete hosted
function-secret boundary are explicit GAPs.

Coordinator evidence confidence is 13/16. Native actor authority, convergent
contention, SSE transport, settlement, target identity, and three-target
cleanup are direct. No reconnect/offline fact was exercised. The retained
artifact set is reproducible in broad shape, but the timed inventory preceded
substantive final acceptance/performance edits and omitted cleanup/finalizer
scripts, so artifact reproducibility is indirect.

### What felt good

Disposable target provisioning was excellent. One noninteractive
`instant-cli init-without-files --temp` command returned a fresh app and
machine-usable authority without account login or billing setup, and the empty
shells enter automatic expiry. This is close to an ideal agent-dogfood path.

`instant-cli push all --yes` made schema and permission diffs visible and
deployed quickly. The same TypeScript model drove the React, Core, and Admin
SDKs. Atomic transaction chunks, unique attributes, links, nested queries, and
native backend subscriptions covered most of the event model without an
application server.

Native refresh-token principals made Alice, Bob, and Mallory easy to automate.
Storage shares the same rule language, and the permission debugger was
genuinely useful: `debugTransact` exposed evaluated bindings, modified fields,
and why reverse links caused a transaction denial.

### What felt bad or surprising

The most important finding was linked permission invalidation. Bob had
legitimately received 49 invitation rows. Alice then set the related event's
`guestListVisible` flag false. An independent host read confirmed false and a
fresh Bob query correctly returned zero, but the already-connected SSE query
emitted neither a replacement result nor an error for 12 seconds. A UI would
silently retain stale protected state.

This was not classified as an active cross-user disclosure: the rows were
authorized when delivered, the false-state fresh read was filtered, and no new
protected payload arrived. It is still serious provider friction. The final
model denormalized visibility onto every invitation and atomically updated the
event plus 49 invitation rows so the subscribed namespace itself invalidated.

Links became ceremony under permissions. Creating a wall post also modified
the reverse `events.wallPosts` field, so the event rule had to permit that
link-only change. The first capacity model could not establish eligibility
through a relation created in the same transaction; preallocating an empty
final-seat row made the relation exist before contention.

Capacity was convergent rather than a clean serializable conflict. Both actor
transactions can report success against the same unique slot, with
last-write-wins settling one row and preserving the total at 50. The invariant
holds, but the losing client needs a later observation to know it lost.

Storage testing had a trap: Admin SDK `asUser` still bypassed Storage policy,
so the real boundary required independent Core clients. Upload, outsider
denial, and metadata deletion passed, but an issued signed URL—and even a newly
issued delivery path—remained usable during the observation window. Complete
deletion is therefore a GAP.

Native webhooks expose useful delivery history and stable idempotency keys, but
the deterministic receiver URLs were rejected during provisioning. The arm
could not prove known-success dedupe, a conclusive timeout ambiguity, or
post-cancellation delivery. The pinned product also exposed no first-party
scheduled-job surface or hosted function-secret boundary.

The UI evidence is only a polished native-token login shell, not the complete
event surface. The Node acceptance harness needed a memory store, network
listener, and explicit client environment because the Core client is
browser-oriented.

### Performance and cleanup

Each of contention, burst, 262,144-byte asset, realtime, and config-push paths
retains two warmups plus seven successful samples. Local-client medians were
355.477 ms for contention, 482.005 ms for the burst, 1,117.606 ms for the
asset path, 569.623 ms for realtime, and 683.275 ms for config push. These are
hosted temporary-app measurements, not production scale claims.

All rows, files, users, webhooks, and actor tokens across three temporary
targets were retired or invalidated. Ports `4337/9337`, browser/runtime state,
and local credentials are absent. Only empty provider-owned app shells with
schema/rules remain until automatic expiry.

### Would I choose it?

InstantDB is compelling for disposable hosted setup, typed schema/policy,
realtime queries, and very small application code. I would choose it
conditionally for connected collaborative apps whose invariants tolerate its
transaction model.

I would not choose it as the default Partiful backend today. Cross-link live
authorization requires defensive denormalization; capacity settlement is
ambiguous to the loser; asset revocation is weak; and scheduling, hosted
effects, and secrets do not form a complete operational backend.

### Lessons for Snapback

Match InstantDB's one-command disposable target, typed schema/policy,
permission debugger, and first-class actor testing. Preserve and amplify
Snapback's stronger reactive-authorization dependency model: every authority
change should invalidate dependent live results explicitly and inspectably.

Keep direct serializable conditional mutations with unambiguous loser
settlement. Define asset capability revocation precisely, including already
issued URLs. A coherent schedule/effect/secret/log lifecycle remains a major
opportunity to beat a lightweight data platform without copying its
last-write-wins or linked-permission semantics.

## 2026-07-28 to 2026-07-29 — Convex, deep round, complete with hosted unavailable

### Environment and outcome

The arm used Convex client/CLI 1.42.3 and the pinned local backend on a fresh
anonymous project-local deployment. Fourteen frozen scenarios pass. Managed
deployment is an unavailable remote dependency because the supplied deploy key
was empty; the readable shared target was not mutated.

Coordinator evidence confidence is 14/16. Actor authority, contention,
transport, settlement, target identity, and artifact reproducibility are
direct. Reconnect is measured, but the Partiful workload has no persistent
offline-write/retention scenario. Cleanup is exact, but the primary baseline
fields were serialized during cleanup rather than in a separately timestamped
pre-write receipt.

The original timed PARTY-07 receipt directly proved two established clients
observing the 20-post WebSocket burst, but it omitted an RSVP-total transition.
That omission was not upgraded through prose. A separately named fresh local
remediation target established two clients at `yes/seats=0/0, wall=1`; both
later observed `2/2, wall=21`, and an independent authoritative query agreed.
The original receipt and timed performance remain unchanged, and both targets
were cleaned independently.

### What felt good

The product model needed little backend scaffolding. One schema and one
functions module produced generated APIs and a running backend. The initial
push compiled indexes, scheduler, Storage identities, and system-table
inspection cleanly. Anonymous local startup required no account and kept
durable SQLite data and Storage inside the project.

Transactions and realtime were the standout. Two actors competed for the
final seat; ordinary serializable mutations plus optimistic-concurrency retry
yielded exactly one success and one typed capacity rejection without
application locks. Native reactive queries then made ordinary reads into
multi-client live state.

Storage was cohesive: upload URL, opaque Storage identity, authorized delivery,
exact 262,144-byte hash, outsider denial, deletion, and post-delete negative
probes all fit the native surface. `runAfter` returned a durable scheduler ID
whose terminal state was inspectable in `_scheduled_functions`.

### What felt bad or surprising

Parallel isolation exposed hidden CLI controls. Exact local backend and site
ports exist but were omitted from `convex dev --help`, requiring installed
source inspection. Noninteractive `--configure new` opened an interactive
device flow; `CONVEX_AGENT_MODE=anonymous` was the working zero-account path.
The backend also listened on `0.0.0.0` even though the app/browser were
loopback-only.

Realistic local authorization testing used a runtime acting-identity method
present in both clients but absent from their public TypeScript declarations.
The harness isolated one cast and all application checks still used
`ctx.auth`, but this is not the same ergonomic confidence as a documented
multi-persona test API or a complete Convex Auth setup.

Outbound effects remained application policy. Actions made network fetch easy,
but known-success suppression, attempt state, ambiguity, idempotency keys, and
retry accounting required a custom ledger. When the receiver accepted a body
and closed before response, Convex honestly left the attempt ambiguous.
Retrying preserved the state machine but could duplicate the external effect;
the product did not supply receiver-side exactly-once semantics.

The local backend downloaded a dashboard the arm did not need, while the
runtime binary came from a machine-global cache. State remained project-local,
but hermetic accounting was less obvious. Scheduled IDs also needed
string-storage and a cast back to the system-table ID type for inspection.

### Performance and cleanup

Each of seven local paths retains two warmups plus seven samples. Medians were
1.328 ms read, 8.561 ms write, 123.430 ms final-seat contention, 40.168 ms
asset round trip, 42.552 ms realtime delivery, 11.194 ms reconnect-to-first
value, and 1,105.517 ms build/typecheck. No hosted latency, scale, or price is
inferred.

The primary namespace ended with all eight tables at zero, exact processes
stopped, ports `3336/3337/4336` closed, and local target/config/browser state
absent. The remediation namespace independently ended at zero and retired its
exact target/runtime paths with `3356/3357` closed. One post-window diary
erratum intentionally changes the original 52-file inventory's diary hash; all
51 implementation/evidence hashes still match.

### Would I choose it?

Yes, Convex is a strong default for this workload. Serializable mutations,
reactive queries, native Storage, scheduler receipts, generated APIs, and a
zero-account local target form a cohesive path with unusually little product
code.

The main reservations are hosted evidence unavailability, hidden isolation
flags, undocumented test identity injection, machine-global runtime cache, and
application-owned effect ambiguity/dedupe policy.

### Lessons for Snapback

Match the outcome of one typed schema/function/client loop, serializable
capacity mutations, reactive ordinary reads, authenticated object Storage, and
inspectable scheduler IDs. Preserve Snapback's stricter authority and
settlement model while making the safe path just as short.

Snapback can exceed this experience with discoverable isolation controls, a
typed multi-persona testing facility, fully relocatable runtime/cache roots,
and a first-class effect-attempt primitive that distinguishes known success,
failure, ambiguity, retry, and terminal replay without requiring every app to
invent its own ledger.

## 2026-07-29 — Snapback final installed-package confirmation

The frozen Partiful result stayed **12 PASS, 3 GAP, 0 FAIL** in a second clean
external project using the immutable `0.1.1-llp0102.1` Darwin closure.
Schema/functions already used package imports, installed codegen succeeded,
and the packaged runtime reproduced sessions, capacity contention, native
push, cron, effect retry and ambiguity, revocation blanking, and exact
cleanup.

Package authoring felt better here than in Linear because no import rewrite was
needed for schema/functions. Lifecycle remained lower-level than ideal: the
acceptance harness needed custom orchestration around installed
`snapback start/stop`. The copied build sampler also assumed its evidence
directory existed; after retaining that failed attempt, the complete two
warmup plus seven recorded build window reran.

Assets, a complete hosted profile, and the asset-dependent full performance
scenario remain GAPs. The application-owned notification/effect and role glue
also remains real friction; package success does not erase it or change the
original score.
