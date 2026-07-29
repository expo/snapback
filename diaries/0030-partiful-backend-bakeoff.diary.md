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
