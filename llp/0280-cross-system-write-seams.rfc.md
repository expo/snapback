# LLP 0280: Cross-system write seams

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Sessions, Password auth, Application data API, Assets,
Client integration, React, Diagnostics, Guide, Developer experience
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-17
**Revised:** 2026-08-21 (LLP 0295 D0.5: registers provider connection rebuild
across the persona-replacement seam as a named consumer — dated note at the
end); 2026-08-17 (initial Draft from LLP 0277 F4: the Coterie
adversarial auth cuts and the asset finalize/attach boundary)
**Related:** LLP 0059, LLP 0095, LLP 0151, LLP 0210, LLP 0236, LLP 0238,
LLP 0247,
LLP 0258, LLP 0269, LLP 0277, LLP 0278, LLP 0295, Diary 0086,
`issues/20260821-provider-connection-subscription-budget-decision.md`

## Summary

Some of Snapback's most important writes are pairs that cannot be one
transaction: **credential issuance then the app's profile row**, **trusted
asset finalization then the app mutation that attaches it**, **remote session
revocation then local custody clearing**, **predecessor logout then successor
login**. The platform's halves are individually correct — issuance is
durable, finalization is trusted, revocation is honest about unknown
outcomes, a live bearer is never silently replaced. What the Coterie run
showed is that the *compositions* across each seam are currently invented
per application, under adversarial pressure, after shipping a subtly wrong
happy-path version first.

This RFC proposes treating cross-system write seams as a named platform
concept with three tiers of support:

1. **name and document each seam** — the non-atomicity, its failure windows,
   and the honest composition — as first-class guide content;
2. **ship paved compensation patterns** (client-side, app-owned) for the
   four seams above, as endorsed compositions over existing primitives; and
3. **evaluate first-class composed operations** where the server can do
   better than client compensation (signup-with-profile in particular),
   without pretending atomicity that does not exist.

The invariant: a seam may be more ceremony than a single-database
transaction, but it must never be a *discovery exercise*. Every seam the
platform creates, the platform documents and paves.

## Motivation

All evidence is from Diary 0086's dual-review rounds (LLP 0277 F4); each
item below was found by adversarial review, not by the build pass — which is
exactly the problem, since ordinary applications do not get adversarial
review.

- **Partial registration.** A forced handle race between password issuance
  and the profile mutation bricked an email address: the durable credential
  existed, the profile did not, and retrying signup reported
  `DuplicateHandleError` — wrong, since the duplicate was the caller's own
  half-completed registration. The working composition: a distinct
  `PartialRegistrationError`, custody cleared on the failed path, login
  admitting a narrowly-recognized incomplete-profile state, and a completion
  path that writes only the profile with a new handle. Two adapters paused
  after issuance prove it. None of this is Coterie-specific; every
  sessions-mode app with a required profile row has this seam.
- **Adoption rollback.** When login/signup adopted a bearer but a later
  projection failed, subscribers retained a session the mutation reported as
  failed until a capture-scoped custody clear was added.
- **Terminal sign-out.** Logout's remote outcome can be unknown; the honest
  composition makes local sign-out a `finally`-style terminal path while
  still returning the remote error. The first adapter observed only the
  happy return.
- **Persona replacement.** Snapback (correctly) refuses to issue Bob over
  Alice's live bearer. The frozen provider API allows `login` to replace the
  current persona, so the adapter had to express replacement as two explicit
  authority transitions — settle predecessor logout, then issue successor —
  after first misclassifying the refusal as a credential error.
- **Attach residue.** Trusted finalization precedes the attaching mutation,
  so an attach refusal leaves a ready asset. The guide's explicit residue
  warning was praised as "the useful fact"; the *pattern* built on it — sniff
  bytes before upload, keep a bounded owner/digest map so immediate retries
  reuse the finalized asset, state the no-cleanup posture — was invented in
  the lane.

The Clique sweep corroborates the auth seams at lower intensity: the
Explicit lane's logout/authority-clearing race and post-auth remount needs
(both since closed) were the same seam surfacing as lifecycle bugs.

## Design

### D1. Seams are named and documented

Add a guide page ("writes that cross system boundaries") enumerating each
platform seam: the two writes, the window between them, what each half
guarantees, what state a crash or refusal in the window leaves, and the
endorsed composition. The four seams above are the initial register. The
LLP 0269 storage plan and the LLP 0258 bootstrap keep ownership of their
surfaces; this page owns the cross-cutting concept and links in.

### D2. Paved compensation patterns

For each seam, an endorsed, tested, client-side composition:

- **Registration:** the `PartialRegistrationError` pattern generalized —
  detectable incomplete state, idempotent completion, custody semantics on
  each failure path. Shipped as a recipe plus, where LLP 0258's bootstrap
  owns the composition, as bootstrap behavior.
- **Adoption rollback and terminal sign-out:** candidate defaults in
  `AuthCoordinator`/bootstrap: capture-scoped clear on failed post-adoption
  projection; terminal local sign-out with the remote outcome reported, not
  swallowed. These match what the coordinator already half-owns; the RFC
  asks whether they become defaults or documented options.
- **Persona replacement:** a documented two-transition composition (or a
  coordinator-level `replaceAuthority` that performs it), so a stale-
  authority refusal in a replacement flow is distinguishable from bad
  credentials at the type level.
- **Attach retry:** the owner/digest reuse mapping as an asset-client
  recipe, with the no-GC posture stated where the app has not opted into
  reference GC.

### D3. Evaluate first-class composed operations

Where the server can hold both halves closer together, offer a composed
operation with *stated* (not pretended) semantics. The concrete candidate is
**signup-with-initial-row**: one client call that performs issuance and then
the app's declared bootstrap mutation server-side, returning either full
success or a typed partial-registration outcome with the completion token.
This does not make the pair atomic; it makes the window server-managed,
shrinks it, and gives every app the same typed outcome vocabulary. Whether
the bootstrap mutation is declared in `defineAuth` or passed per-call is an
open question. If evaluation says the server composition adds more surface
than it removes, D2's client pattern remains the endorsed answer and this
RFC records the decision.

### Non-goals

- No distributed-transaction machinery, no two-phase commit, no pretense of
  atomicity across the auth store and application store.
- No weakening of the live-bearer replacement refusal, the trusted
  finalization boundary, or logout's honest unknown-outcome reporting —
  every paved pattern above is built *on* those behaviors, which the run
  validated as correct.

## Acceptance evidence

- The Coterie adapter's four hand-built compositions are replaced by (or
  shown equivalent to) the paved patterns, and its paused-after-issuance
  race test passes against the paved registration pattern unchanged.
- A fresh sessions-mode app (the Clique rerun of LLP 0236's protocol is the
  natural vehicle) completes signup-race, sign-out-offline, persona-switch,
  and attach-retry scenarios without inventing new composition code.
- The guide page exists and every seam's refusal names it (LLP 0193
  errors-as-docs posture).

## Open questions

1. Which D2 behaviors become `AuthCoordinator`/bootstrap defaults versus
   documented options? Defaults change existing apps' observable lifecycle.
2. D3 signup-with-initial-row: declare the bootstrap mutation in
   `defineAuth`, pass it per-call, or decline the server composition?
3. Is there a fifth seam this register misses? (Candidate: schema-evolution
   pin advancement beside a durable store, from the Clique Simplified lane —
   that lane is withdrawn, but the seam may survive in sessions deployments
   generally.)
4. Should partial-registration state be observable through a generated
   query (so UIs can render "finish creating your profile") rather than only
   through the login outcome?

## Note (2026-08-21 — LLP 0295 D0.5): provider rebuild consumes the persona-replacement seam

**Adopted per LLP 0295; author may revise.** The D0.5 ruling (LLP 0095 and
LLP 0278 amendments of the same date) makes provider/headless connection
rebuild across an authority transition a named consumer of this RFC's
persona-replacement composition: a provider tears down every
predecessor-owned subscription (settling predecessor logout) before opening
the successor's connection and subscribing after the coordinator's settled
authority state. No new seam or mechanism is added here; this note exists so
the seam register knows providers depend on the two-transition composition
and so a future `replaceAuthority` coordinator operation (D2) is designed
with the provider teardown/rebuild ordering in scope. Exact's provider
runtime consumes the same facts through LLP 0279.
