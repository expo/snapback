## 2026-07-28 — Snapback, deep round, completed with gaps

### Environment

- Frozen source/product commit: `5f31cb6174daaefa04a1e05242acbbc22c725040`
- Freeze aggregate: `ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a`
- Product: Snapback `0.1.0`; canonical local Ibex + SQLite target; sessions auth
- Isolation: `/private/tmp/llp0102-partiful-snapback-w1`, server `3335`, Vite/fake provider `4335`, namespace `llp0102-partiful-snapback-w1`
- Timed window: `2026-07-29T05:51:52Z` through the final evidence run; no extension
- Assistance: shipped guide first; then repository examples/source for session minting, config HTTP, the codegen egress gate, and anonymous sessions reads
- Hosted target: explicit product GAP; no hosted claim

### Milestones

- First authoritative mutation: see `evidence/acceptance-results.json`
- First local read: see `evidence/acceptance-results.json`
- First native realtime transition: see `evidence/acceptance-results.json`
- Local acceptance: 12 pass, 3 GAP, 0 fail, 0 Stop defects
- Hosted acceptance: GAP

### What felt good

- Schema, functions, generated references, and manifest output form a concrete
  inspectable backend. Once the handlers were valid, codegen was fast and
  deterministic.
- Server-derived session principals made the authority evidence strong. No
  mutation accepted a caller-supplied user id, and four real sessions exercised
  host, cohost, guest, outsider, and revoked states.
- Capacity enforcement fit naturally in one mutation. Two simultaneous
  final-seat claims converged to exactly 50 seats and 50 RSVP rows.
- Native managed live queries proved the hard privacy transitions directly:
  guest-list policy changed an established handle `3 → 0 → 3`, and revocation
  blanked a 20-row wall handle to zero before a later protected write was
  refused.
- Action → mutation composition, write-only config, and the cron tick made it
  possible to build inspectable reminder/effect ledgers without putting network
  I/O in a transaction. Secret status remained redacted.
- Cleanup was unusually provable. The suite enumerated SQLite, WAL/SHM, config,
  auth keyring, startup artifact, reservation lock, and restore lock carriers,
  then proved every exact path absent and both ports closed.

### What felt bad or frustrating

- A Partiful-shaped product is blocked by the lack of authenticated asset
  upload, delivery, and deletion. This is not edge functionality for this app;
  it makes the product incomplete.
- There is no honestly complete hosted path at the frozen commit. A polished
  local demo cannot become a deployable event service with the same auth and
  operational claims.
- Notification effects required an application-authored reservation,
  settlement, certainty, attempt ledger, fake provider, and retry policy.
  Snapback supplied safe primitives but not the ordinary end result.
- The high-level client cannot make an anonymous public query against a sessions
  app while offering the required protocol: a plain client is refused by the
  server, while a protocol-bearing client is refused for lacking custody. The
  UI and harness needed a raw HTTP helper.
- `SNAPBACK_OUTBOUND_ACTIONS=1` is documented as a runtime grant, but codegen
  also requires it. The first action bundle failed until source inspection.
- The auth-invalidation machinery is visibly conservative for protected JS
  live queries. Each ordinary post produced a quarantine-to-empty event and a
  fresh authorization snapshot, yielding roughly two deliveries per write.
  This is safe but potentially flickery and expensive for bursty application
  surfaces.
- Membership roles did not offer an obvious host-managed promotion/removal path
  for another principal, so the app modeled invitations and role checks in
  ordinary tables and JS handlers. The result is correct but much more custom
  than the product concept.
- Action failure settlement returns `{ok:false}` while mutation failure rejects.
  That difference cost a harness iteration and makes generic settlement code
  harder to reason about.
- The capacity loser surfaced as generic `SNAPBACK_HANDLER_FAILED`, not an
  application/domain code such as `EVENT_CAPACITY_EXCEEDED`.
- The packaged server helper rejected reuse of the already-built binary once
  the arm made the worktree dirty, so repeated acceptance attempts entered the
  `cargo run` rung even though product source was frozen.

### Modeling and correctness

The model uses events, invitations/roles, RSVPs, wall posts, reminder attempts,
and notification effects. Public preview is a closed projection. Protected
queries read the invitation table and return no rows after policy loss.
Mutations recheck the effective session principal inside the authoritative
transaction.

This was a strong correctness experience. The transaction and live-query
boundaries made capacity and revocation much easier to prove than they would be
with client rules alone. The downside was authoring volume: 738 authored-source
lines and 615 test lines for the arm, plus application-authored effect and role
infrastructure.

### Realtime, offline, and auth

Realtime evidence is native WebSocket push, not polling. The 20-post burst,
guest-list policy change, and revocation blanking were observed on established
second-client handles. Session attribution is direct and reproducible.

Reconnect pause/resume was sampled. This arm does not claim durable offline
retention. After revocation, the online protected handle was empty and a fresh
write was denied; that is the retained-data claim actually proved.

### Deployment and operations

Local startup, health identity, config status, cron tick, function manifests,
and cleanup are inspectable. The local target was reproducible and fast after
bootstrap. Hosted deployment, hosted auth admission, hosted logs, and hosted
cost remain GAPs.

The exact cleanup story is a differentiator. The package-level asset and hosted
gaps are decisive negatives.

### Documentation and diagnostics

The guide successfully established the canonical target, function model,
sessions, auth safety, live handles, cron, actions, config, and acceptance
lifecycle. It also correctly prevented false hosted claims.

Source/examples were still required for:

- exact session fixture minting through the capture mailbox;
- codegen-time egress admission;
- admin config-set request shape; and
- anonymous public reads in sessions mode.

The capability manifest explicitly says `assetUpload: false` and
`notifications: false`, but the guide capability index has no corresponding
assets/notifications GAP rows.

### Glue and workaround inventory

- Four-session capture-mailbox fixture
- Ordinary-table host/cohost/guest authorization model
- Raw anonymous query helper
- Application-level reminder and notification ledgers
- Deterministic idempotent fake notification provider with two fault modes
- Fixed-port 15-scenario acceptance, performance, screenshot, inventory,
  capsule, and cleanup tooling
- No custom asset substitute and no fake hosted target

### Outcome

- Pass: PARTY-01 through PARTY-07, PARTY-09 through PARTY-12, PARTY-15
- GAP: PARTY-08 assets, PARTY-13 hosted deploy, PARTY-14 complete frozen
  performance (asset path missing)
- Fail: none
- Stop defects: none

### Would I choose it?

Conditional, not as my present default for this app. I would choose Snapback
for a local or correctness-focused event core where capacity, authorization,
and live revocation matter more than platform completeness. I would not choose
it today for a real Partiful-shaped launch because assets and an honestly
complete hosted path are table stakes, and notification delivery takes too much
application-owned infrastructure.

### Lessons for Snapback

1. Ship the complete authenticated asset outcome: upload, authorized delivery,
   content identity, deletion, local target, and at least one hosted target.
2. Make one hosted profile honestly end-to-end, including sessions, config,
   effects, inspection, logs, backup/restore, and cleanup.
3. Provide a first-class idempotent effect-attempt outcome with explicit
   known-failure, ambiguity, retry, and terminal replay semantics.
4. Make anonymous generated queries ordinary in a sessions app without a raw
   protocol helper.
5. Add host-managed role promotion/revocation ergonomics while preserving
   Snapback’s fail-closed authority and live invalidation.
6. Coalesce ordinary authorization-backed JS-query refreshes so safety does not
   require a visible empty snapshot before every positive replacement.
7. Document codegen-time egress admission and add direct config methods to the
   headless client or CLI journey.
8. Preserve structured application error codes through handler failures.
9. Separate product-binary provenance from app-artifact dirtiness so the
   packaged acceptance loop can safely reuse a verified binary.
