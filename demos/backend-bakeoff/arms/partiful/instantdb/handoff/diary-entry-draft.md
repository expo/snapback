# Diary draft — Partiful / InstantDB

Date: 2026-07-28/29

I built the Partiful-shaped app against three fresh official hosted temporary
Instant apps. The final attempt completed all 15 frozen checks with 9 passes
and 6 honest gaps. Functional acceptance and cleanup fit comfortably inside
the 8-hour/400-call budget.

## What felt good

Temporary app provisioning was excellent. One noninteractive
`instant-cli init-without-files --temp` call returned an app ID and admin token,
with no account login or billing setup, and the app will expire automatically.
That is close to an ideal agent-dogfood path.

Schema and permission deployment was also fast. `instant-cli push all --yes`
made the model/rule diff visible, deployed in roughly 0.66–1.34 seconds in the
recorded no-op samples, and the same TypeScript schema drove the React, Core,
and Admin SDKs.

The data API stayed pleasantly small. Atomic transaction chunks, lookup/unique
attributes, links, and declarative nested queries covered the event model
without an application server. Native backend subscriptions made the realtime
burst easy to prove. Median recorded delivery for the small realtime path was
about 570 ms.

Auth was unusually convenient for an automated arm. The Admin SDK could create
native refresh tokens for Alice, Bob, and Mallory, while scoped admin queries
made actor-specific permission probes concise. Storage integrated into `$files`
and shared the same rules language.

The permission debugger was genuinely useful. `debugTransact` showed the
evaluated program, old/new data, and exact modified fields. It quickly explained
why reverse links touched `events.wallPosts` and why an apparently harmless
link transaction was denied.

## What felt bad or surprising

Permission dependencies across links did not invalidate an already-connected
query. Bob had legitimately received 49 invitation rows. After the linked
event's `guestListVisible` flag changed to false, a fresh Bob query returned
zero, but the existing SSE subscription emitted neither a new result nor an
error for 12 seconds. A UI would silently retain stale protected state. The
workaround was to denormalize `guestListVisible` onto every invitation and
atomically update 50 records so the subscribed namespace itself changed.

Links are elegant until permissions enter the picture. Creating a linked wall
post also modifies the reverse `events.wallPosts` field, so the event update
rule must permit that link change. The first capacity model also failed because
permissions could not establish eligibility through a relationship being
created in the same transaction. Preallocating an unoccupied final-seat row
made the eligibility link exist before contention, but that is application
model ceremony rather than a general invariant.

The capacity result is convergent rather than serializable. Both actor writes
can report success against the same unique slot and the whole entity settles by
last-write-wins. The database prevents two rows for one slot, so final capacity
is safe, but the losing client needs to observe settlement to know it lost.

Storage authority is easy to mis-test. The Admin SDK explicitly bypasses
Storage permissions even after `asUser`, so I had to instantiate independent
native Core clients for the real Alice/Mallory boundary. Metadata deletion
worked, but signed URLs remained usable (and could be freshly issued) during
the observation window. That made complete asset deletion an honest gap.

The current product has rich webhooks with delivery history and stable
idempotency keys, but the bakeoff needed a deterministic hosted receiver ledger.
The first public receiver could not pass Instant's DNS validation, and the
available path did not prove exactly-once receiver behavior or an ambiguous
timeout strongly enough. Instant also lacked an evident first-party scheduled
job surface and a hosted function-secret boundary in the pinned release, so
schedule/effect/deploy coverage stopped short of a full Partiful backend.

The native Core client is browser-oriented. Running it in the Node acceptance
harness required a memory store, a network listener, and an explicit client
environment. That is reasonable internals-wise but less smooth than the Admin
SDK for agent tests.

## Snapback implications

Snapback should match Instant's best end result for zero-friction disposable
targets: one command, machine-readable credentials, no dashboard prerequisite,
and an automatic cleanup lifecycle. Schema plus policy as typed source, a
permission debugger that shows bindings/modified fields, and first-class
actor impersonation are also strong targets.

Snapback can differentiate on reactive authorization correctness. A dependency
change that revokes a query must invalidate every live result that depended on
it, ideally with an explicit revoked/filtered transition rather than silence.
The dependency graph should be inspectable so an agent can see why a query will
or will not invalidate.

For invariants, Snapback should offer a direct serializable conditional mutation
or server function path. A capacity check should not require preallocated slots
and should give the losing actor an unambiguous rejected/settled result.

For files, deletion and revocation semantics should say exactly what happens to
already-issued capabilities and offer a way to revoke them immediately. Admin
impersonation should preserve end-user policy by default or require an explicit
elevated mode so tests cannot accidentally prove the wrong boundary.

Finally, a complete Partiful backend wants scheduled jobs, durable idempotent
effect attempts, ambiguous-outcome state, hosted secrets, logs, and cancellation
under one inspectable operational model. Instant's webhooks are a good start,
but Snapback could win by making that entire effect lifecycle coherent rather
than asking the application to assemble receiver infrastructure and ledgers.
