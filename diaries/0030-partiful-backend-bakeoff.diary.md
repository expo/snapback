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
