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

The RBAC-stage exact review was worth the extra pass. The standalone TypeScript
evaluator had matched the older corpus while omitting the new old/next,
created, final-exists, rollback, maintained-write, and memo-invalidation
semantics. Adding 16 named cross-runtime cases turned those assumptions into
92 executable parity checks. The same review found that the local owner
control bearer was strong on Unix but guessable on a non-Unix fallback and
browser-preflightable in dev mode. Moving every platform to the OS CSPRNG,
repairing private filesystem modes, and removing the control header from CORS
closed a system-authority seam that application-level RBAC tests would never
have exercised.

The final integration then reconciled that RBAC stage with the concurrent
Bytes and opaque capped-query work from `main`. Five additional frozen cases
brought the authoritative corpus to 97, all passing in both Rust and the
standalone TypeScript evaluator. The served chat acceptance proof also caught
two useful gaps before landing: private conversation/count shells needed
membership-scoped reads, and revocation needed to demonstrate both the direct
message write and its maintained message-count write in the same scope.

The last authority-custody pass exposed why the cross-runtime proof mattered.
A receipt-only replay could previously treat a held hidden relationship row as
authorization when its authority verdict was absent; the repaired client now
requires an exact rule/input/principal/epoch verdict and reports deterministic
partial coverage without committing tentative writes. The same pass found
that a source update can apply a maintained projection twice, that malformed
`by` shapes could overwrite aggregate `id`/`value`, and that changing or
removing a maintain left predecessor projection rows behind. Exact physical
write accounting, closed single-owner projection validation at both trust
boundaries, and transactional successor target rebuilds turned those implicit
assumptions into executable containment rules. Six frozen authority-custody
cases, plus the exact-review repair for omitted Optional maintained groups,
brought the final shared Rust/TypeScript corpus to 106 after adding held,
authority-absent, and authority-missing aggregate-target coverage.
Fresh exact-commit review then paid for itself again: branch analysis had to
sum sequential writes inside each arm before taking the arm maximum; raw
`check --ir` had to reuse whole-generation certification so nominal
`Principal` rules could not drift from serve; and successor clearing had to
avoid applying a newly added uniqueness rule to stale rows being removed.
The Optional parity case also exposed JavaScript prototype-key hazards, so the
twin now uses own-property checks and null-prototype row construction for
schema names such as `__proto__` and `toString`.

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
