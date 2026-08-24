# LLP 0303: Subject/authority correlation policy — the derive-not-supply ruling

**Type:** Decision
**Status:** Accepted
**Systems:** Auth, Sync, Engine, Kernel, Server
**Author:** Claude (Opus 5), commissioned by Charlie Cheever (author ruling
2026-08-24, in session supervising LLP 0283 F-1)
**Date:** 2026-08-24
**Revised:** 2026-08-24 (c — executable provenance review corrections)
**Related:** LLP 0283, LLP 0298, LLP 0285, LLP 0274,
`issues/20260824-liveness-row-bucket-assignment.md`,
`issues/20260824-entitlement-predicates-for-the-live-sites.md`

## Ruling

Author ruling 2026-08-24, on the 45 open authorization questions covering 68 liveness-only
factory rows (`issues/20260824-liveness-row-bucket-assignment.md`).

**The recommendations recorded in this document are approved. Implement them.**

## The governing principle

Across all 45 questions the defect has one shape: an authority is validated for liveness, the
subject it acts on is supplied independently by the caller, and nothing ties the two together.
The ruling is therefore a single rule with enumerated exceptions:

> **The subject must be derived from the authority, not supplied alongside it.** Where a
> mismatched pair can be constructed and then rejected, prefer removing the parameter so the
> mismatch is unconstructible. Verification is the weaker outcome and requires a stated reason.

Exceptions are not "trusted callers". They are flows that are **cross-principal by design**, and
each carries its own binding rule rather than a relaxation.

## Approved dispositions

**Strict — derive from the authority (37 questions).** Q01–Q05, Q07–Q12, Q14–Q22, Q24–Q35,
Q37–Q45. In each case the subject, scope, claim, descriptor, channel, writer class, token set,
namespace, or lease field must be produced by whatever verified it, not asserted by the caller.

**Strict, with an explicit binding rather than ownership (2).**
- **Q06** — effect approval. The approver is deliberately a different principal from the
  reconstructed caller. The rule is *this approver, this pending effect, that effect's stored
  original authority* — **not** owner-only, which would break approval outright.
- **Detached-action sinks (S5, tracked with Q02/Q33)** — the caller may be a delegated service
  principal that does not own the effective user. The rule is same-origin correlation.

**Rate-limit rather than authorize (1).**
- **Q39** — challenge sends. An external effect precedes proof of ownership by design; the
  control is throttling and monitoring, not an authorization predicate.

**Priority order for implementation.**
1. **Q01** (5 rows) — attaching another principal's live channel bypasses session expiry,
   termination and deadline checks. Verified, not theoretical. Also constrains the architecture:
   any correlation identity must be taken *after* all attachments, never at root preparation.
2. **Q36** — minting a session for an email with no proof of ownership.
3. **Q10 with Q04** — self-asserted `authority_creating` consent in two places; the escalation
   primitive that turns one foothold into every privilege.

## Still open — approved in part only

Two questions were flagged as product decisions and remain open in their product dimension. The
ruling approves the *correlation* half of each; it does not choose the policy.

- **Q13 — who is billed.** Approved: whichever party is charged, it must be **derived** from the
  prepared authority rather than supplied. Open: whether the payer is the resolved principal or an
  explicit billing relationship that may differ from the actor.
- **Q23 — development-mode impersonation.** Approved: it must be **impossible, and tested as
  impossible**, for development mode to be active in a deployed environment. Open: whether
  in-development impersonation is unrestricted, owner-bound, or fixture-bound.

Do not treat either as settled by this ruling.

## Claim discipline this ruling does NOT grant

Implementing these does not license a structural-property, fence, or closure claim. Three
PROPERTY claims in this program were published and withdrawn as false. Each landing states what
it enforces, scoped to the functions and routes it changed.

Evidence bar, from what earlier rounds cost: every test watched failing first and quoted verbatim;
exact accepted/refused sets asserted; **durable rows read back and asserted**, because a test that
observes only method outcomes cannot prove a database property; and a mutation review including
comparison-operator mutations and subjects on both sides of the caller's lexical ordering.

## Severity context

Every defect behind these questions is reachable only from in-crate code, not remotely. These are
structural guarantees against future incorrect code, not open doors. That is why the strict answers
are affordable and why the program was not run as an incident.

## Authority-provenance implementation

### Q08 answer

The service-principal arm is no longer authorable from copied token, grant, credential, effective
user, and scope fields. `ResolvedScopedToken` keeps every resolved fact private and carries a
private resolution marker minted by either of two exact live-catalog paths: token-secret
resolution, or bearer-free retained-authority re-resolution from the complete durable token,
grant, actor, effective-user, credential, and generation tuple. The bearer-free path is public and
caller-supplied at the tuple boundary; it remains bounded by exact current-row, liveness, scope,
integration, and deadline predicates. Downstream code gets read-only accessors, so it cannot edit
a genuine resolution into a different subject.

The resolver output then enters a `RegisteredServiceAuthority` carrier that keeps the token,
service-publication reservation, and process-local admission origin together. Raw witness
registration is private. Each `ServingDatabase` mints one opaque registry binding; its token
resolutions carry the paired private origin, the binding can construct only the graph's sole
registry, and that registry rejects a token resolved by any other serving graph. No
service-authority constructor accepts a caller-selected origin. Final preparation consumes that
carrier and rejects a lease from any other admission graph. The session/service provenance also
seals an exact private copy of every resolved authority fact, so editing the public enum projection
after a genuine resolution cannot produce a preparable different authority.

Retained live fan-out and deferred-effect re-preparation validate that their enclosing drain or
approver admission belongs to the same controller as the retained resolution, then mint one fresh
counted lease for each `Session` or `ServicePrincipal` rerun from that authority's sealed resolution
origin. They therefore preserve admission transition fencing without reusing one generic lease
token across distinct subject authorities or accepting a foreign retained carrier.

This closes downstream struct/enum-literal construction and the old independently supplied
`ResolvedAppAuthority` plus `AdmissionLease` join for the service arm. It does not yet bind an
already prepared authority to every later `LocalSnapback` consumer; that engine-graph closure is a
separate remaining step and no global closure claim follows from this stage.

### Q09 answer

The session arm carries a private resolution marker. Only the coordinator path that consumes a
kernel-minted opaque durable projection snapshot can attach that marker. Every resolution gets a
distinct process-local authority identity, and the first preparation claims the shared
`LeaseToken` for that identity; cloned leases therefore cannot prepare a second genuine authority
from the same coordinator. Its
`PreparedBearerAuthority` retains the resolved subject and final-publication fence privately
through invocation preparation, and the marker records the coordinator's process-local admission
origin. A mode-valid lease from a separately manufactured controller therefore cannot prepare the
resolved session.

Rehearsal sessions use this same path: protected rehearsal lineage is projected as part of the
resolved session and there is no separate rehearsal session constructor. Asset-callback service
principals, durable-watch service anchors, and revalidated human watch principals now likewise
require opaque kernel carriers produced by their exact protected-catalog reads, and their fact
fields are read-only before public preparation.

The honest claim for this stage is only: authority is unconstructible as a `Session` or
`ServicePrincipal` literal join, while `System`, `AdminBypass`, `DevImpersonation`, and remaining
carrier-FRU routes still produce `PreparedAuthority`. Operator authority remains separately closed
by the existing private `Arc<()>` engine identity and `Arc::ptr_eq` check. Closing the remaining
non-resolution and carrier routes is required before describing `ResolvedAppAuthority` or
`PreparedAuthority` as globally unconstructible.

### Q11 answer

`InvocationGate::prepare_admitted_authority` is crate-private, and public bearer/service entry
points consume resolution-owned carriers instead of accepting a freely supplied resolved subject.
Session and service provenance is compared to both the lease's private controller origin and the
specific shared `LeaseToken` that the resolved authority first claimed at the inner gate. Thus a
public `AuthModeStateRecord` plus `AdmissionController::from_mode_state` can still create a
mode-valid lease, but that lease cannot mint either subject-bearing arm, cannot be joined to an arm
resolved under another controller, and cannot be cloned to join two different genuine resolutions
from one controller.

The first stage deliberately makes no claim about every consumer of an already prepared authority.
Some engine APIs still accept `PreparedAuthority` produced by another engine graph, and the public
non-resolution arms named above remain reachable. Those are residual construction/correlation
work, not exceptions to the ruling.
