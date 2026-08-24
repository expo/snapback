# Wide-predicate sweep: more live sites, and the inverse variant is real

Status: open
Date: 2026-08-24
Systems: snapback-engine, snapback-kernel, snapback-server
Related: issues/20260824-authority-validated-subject-supplied-separately.md,
  issues/20260824-sealed-plan-protocol-already-exists-and-is-already-broken.md,
  issues/20260823-uncorrelated-authority-axes-are-systemic-153-sites.md

## Why this sweep ran

The original sweep used a narrow predicate — authority paired with a *commit authority* — and
provably missed the grant-revocation planners, which hold no reservation at all. This re-sweep
used the corrected predicate: **an authority is validated, the subject it acts on is supplied
independently, and nothing structurally ties the two together.**

It found live variants beyond the known planners, the most serious being pending-effect authority
reconstruction, OAuth/grant operations, and branch mutation commits.

## Verified: the inverse variant exists

I asked the sweep to check a direction nobody had examined — sites where the authority is
**derived from the subject** rather than the subject checked against the authority. It exists, and
I verified the top instance directly.

`LocalSnapback::resolve_retained_effect_service_authority`
(`crates/snapback-engine/src/local/engine.rs:5194`) takes a management authority plus an
independent `(actor_user_id, credential_id, credential_generation, grant_id, token_id,
effective_user_id, expected_expires_at_ms)` tuple. Its **only** use of the management authority is:

```rust
let _effect = management.effect_guard("pending-effect service authority revalidation")?;
```

It then calls `self.db.resolve_retained_service_authority(actor_user_id, ...)`. The kernel
validates that tuple *internally* and derives principal B's service authority
(`crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1210`); it never compares B against
the management authority A.

**Result: any valid management authority plus a valid retained tuple for B returns a live service
authority for B and advances authorization-clock state.** The caller's own authority is reduced to
a liveness token; the subject supplies the identity.

This is a distinct and arguably worse shape than the earlier findings, because the *output is a
live authority for another principal* rather than a single durable row.

## Verdict discipline used

The sweep separated its verdicts explicitly, which is the discipline this program has repeatedly
needed:

- **YES** — an A-authority/B-subject composition was constructed that passes every check.
- **YES (mode-only)** — composition passes, but the "authority" is an `AdmissionLease` carrying
  admission epoch/mode rather than a principal: an origin/commit-authority split, not necessarily
  cross-user impersonation.
- **IMPOSSIBLE** — structurally prevented.
- **NO CONSTRUCTION** — could not establish a violation. *Explicitly not a claim of impossibility.*

That last distinction is recorded verbatim because collapsing it has hidden a live hole three
times in this program.

## Status of the population

The enumerated population has now been corrected twice: once for count (generic-bound occurrences
were not seams) and once for kind (the predicate missed reservation-free sites). This sweep widens
it again. **No claim of a closed population should be made until a sweep runs under the wide
predicate and reports its search boundary — and this one names families it did not examine.**

Only the `resolve_retained_effect_service_authority` chain above is verified here. The remaining
ranked sites are recorded as unverified and must be checked individually before being relied on or
dismissed.
