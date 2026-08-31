# 0115 — Snapback 2 accounts and scoped RBAC

**Application:** the Snapback 2 chat template, expanded into the canonical
accounts, profiles, social feed, direct/group conversation, membership, and
authorization proof surface.

**Date:** 2026-08-30

## What was built

The template now uses password sessions and explicit authority ownership from
the client through the serving owner. Application profile row ids remain
separate from nominal `Principal` values. Public profiles and the global feed
are readable without granting message authority; follows, private messages,
group membership, promotion, removal, and departure all bind their exact
scope and principal axes.

Group creation is one atomic program: it creates the conversation and the
creator-admin seat together, and a final-exists constraint prevents a
half-created group. Membership promotion relates the old and next row once,
so it cannot move a seat to a different group or principal while changing its
role. Remove/re-add creates a new intrinsic row id. The serving owner reserves
ids from a durable per-store namespace and precommitted high-water range, so a
stale operation cannot hit a successor membership after rollback, reset,
restart, or wall-clock movement.

The named qualification covers live revocation, successor policy fencing, and
grant-incarnation ABA through the served loop. Its invalidation receipt uses
the retained authoritative read trace and the commit's physical touched keys,
distinguishing overlap with changed output, overlap with equal output, and
disjoint silence. Effect continuations are explicitly excluded from persona
probing and execute only through the engine's private system entry point.

## What felt good

The schema carries more of the security argument than a conventional handler
suite. `Principal` is nominal across authored types, generated APIs, compiler
rules, raw IR certification, and the runtime, which caught profile-id versus
authority-id mistakes before they became data. `created`, old/next terms, and
final-exists constraints made atomic bootstrap and role transitions readable
without hiding authorization in imperative helper code.

The same exact trace drives live invalidation and the test receipt. That made
revocation evidence unusually concrete: the proof names the membership
deletion commit, the denied delivery at that sequence, and the absence of a
post-revocation row. Client authentication ownership was similarly explicit:
token restoration has a readiness boundary, transitions serialize, old
streams are fenced by auth generation, and terminal session failures clear
the configured custody store.

## What was hard or surprising

The authorization substrate landed concurrently with this work. It made
`Actor` unforgeable, made system context private, added schema-scoped rule
hashes and transitive probe metering, and defined generation identity by the
schema. The RBAC implementation had to be joined semantically rather than by
choosing either side of the merge. A program-only successor therefore cannot
prove replacement with the generation hash; the served proof now binds
distinct certified `plan_hash` values and always reapplies the exact original
project during cleanup.

Transitive visibility work also counts even when a structural exact-row proof
allows the outer rule input to be disclosed. Keeping that work both traced and
metered doubled the chat thread's admitted rule-probe count, which was correct
but exposed a stale metrology assertion. The larger test corpus briefly pushed
the edit-to-test loop just over 30 seconds because four related integration
files were linked as four binaries. Keeping them as independent Rust modules
behind one integration-test entry point preserved all cases and returned the
loop to 27.6 seconds.

Secure sessions required more ceremony than a typical demo: tokens are
domain-separated SHA-256 digests at rest, epochs are durable monotonic ids,
expiry is exact at the boundary, and login throttles run before Argon2 while
unknown-email and wrong-password paths retain one verification call. That
ceremony paid for exact logout and expiry fencing instead of a best-effort
"current user" check.

## Comparison

Compared with React plus Convex, this path asks for more up-front boundedness,
rule typing, and certificate discipline, but it produces stronger evidence
for old/next transitions, live revocation, and stale-handle behavior than a
collection of server-function tests. Compared with Supabase RLS, the policy is
checked together with the authored program and exact indexed probes rather
than living as a separate SQL policy layer; atomic multi-row bootstrap and the
physical invalidation oracle stay in one model. Both alternatives can be
quicker for a permissive prototype. Snapback 2 was most valuable here where
the application needed a durable, inspectable explanation for why authority
could not silently retarget.

Exact and Contract were not used in this build, so there are no observations
about either tool to attribute to this experience.
