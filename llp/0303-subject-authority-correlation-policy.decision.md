# LLP 0303: Subject/authority correlation policy — the derive-not-supply ruling

**Type:** Decision
**Status:** Accepted
**Systems:** Auth, Sync, Engine, Kernel, Server
**Author:** Claude (Opus 5), commissioned by Charlie Cheever (author ruling
2026-08-24, in session supervising LLP 0283 F-1)
**Date:** 2026-08-24
**Revised:** 2026-08-24 (b — provenance corollary added)
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

## Corollary — the artifact must carry provenance, not just type

Added 2026-08-24, after the first three implementation lanes were each blocked by an executable
review for the same reason.

Deriving the subject from the authority usually means introducing an artifact — a seal, an
operation identity, a bound attempt, a witness — that only the verifying path can produce. Three
independent lanes built such an artifact and each shipped the same hole:

- **Q03** sealed the revocation attempt by type. A reviewer resolved a real plan, built a *second*
  `LocalDatabase::memory()`, committed against that disposable database, and handed the resulting
  seal to the live coordinator. The live durable row stayed `(generation 1, revoked_at None)` while
  the live projection accepted the seal and revoked the session.
- **Q05** made the operation identity a provider pointer plus an RNG nonce, where the `RandomSource`
  is caller-supplied and the repository already ships constant sources that repeat every byte. Two
  operations on one provider could receive equal identities.
- **The authority seal** bound a `LeaseToken` that could still prepare two genuinely different
  authorities.

Each artifact proved *"something of the right type exists"*. None proved *"this specific instance
produced it."* A type-only seal is not a correlation; it is a forgery machine as soon as a second
instance of the right type can be constructed — and under `test-support`, public constructors for
second instances generally can be.

> **Any artifact introduced to carry a derivation must identify the instance that produced it, and
> the consumer must verify that it is the instance now consuming it.**

Three questions settle it, and a lane that introduces such an artifact answers all three explicitly:

1. Which instance produced this?
2. Can a second instance of the same type produce an equal one?
3. Can `test-support` staple it to an outcome it did not come from?

Question 3 is not a lesser one. `test-support` is not a safety boundary in this repository: a
feature-enabled public API is part of the surface, so "only tests can do that" does not answer it.
Uniqueness must also not rest on caller-supplied randomness — a provider-owned monotonic source is
the mechanism; a nonce is defence in depth.

The accepted shape already exists: `EngineAppStateGraphIdentity` is a private `Arc<()>` compared
with `Arc::ptr_eq` (`crates/snapback-engine/src/local/engine.rs`). Reuse it rather than inventing
another.

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
