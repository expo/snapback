# LLP 0303 — Subject/authority correlation policy

Type: Decision
Status: Accepted
Systems: snapback-auth, snapback-sync, snapback-engine, snapback-kernel, snapback-server
Author: ccheever
Date: 2026-08-24
Revised: 2026-08-24
Related: LLP 0283 (post-rearchitecture follow-ups), LLP 0298 (durable-effect scope),
  LLP 0285 (kernel authorization closure), LLP 0274 (explicit write authority postures)

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
