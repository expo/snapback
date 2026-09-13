# The design's proposed shape already exists in the tree — and is already broken

Status: open
Date: 2026-08-24
Systems: snapback-auth, snapback-engine
Related: issues/shelved/20260823-mandatory-authority-correlation-design.md,
  issues/shelved/20260824-authority-validated-subject-supplied-separately.md,
  issues/shelved/20260824-correlation-design-review-synthesis.md

## Round-two adversarial verdict: BROKEN

The revised design closes the three previously verified breaks on paper but relocates the defect
into unenumerated authority-root and non-caller factories. The strongest break is not
hypothetical: **the sealed, consuming, closure-backed plan protocol the design proposes already
exists in this codebase, and ordinary caller code can already defeat it.**

## The live chain, verified directly

1. `AuthProvider::admit` is public and takes no authorization at all
   (`crates/snapback-auth/src/auth/provider.rs:3080`):
   ```rust
   pub async fn admit(self: &Arc<Self>) -> AuthAdmission
   ```
2. `AuthAdmission::record_authenticated_use_plan` is a public sanctioned factory that captures a
   **caller-chosen `session_id`** into the sealed closure (`provider.rs:3383`):
   ```rust
   pub fn record_authenticated_use_plan(self, session_id: String, expected_generation: u64, now_ms: u64)
       -> impl AuthDatabasePlan<Output = ProviderResult<AuthenticatedUse>>
   ```
3. `LocalSnapback::execute_auth_plan` is a public generic consumer that runs the sealed closure
   against the engine's private database (`crates/snapback-engine/src/local/engine.rs:6749`).
4. The closure rechecks only whether the selected session ID/generation is live, then durably
   extends that row.

`AuthDatabasePlan` really is a sealed trait wrapping a `FnOnce(&mut LocalDatabase)` that
downstream code cannot implement (`crates/snapback-auth/src/auth/database_plan.rs:9`). The seal
works. It is simply not the protection anyone needs.

## The lesson, which is the point of filing this

`execute_auth_plan` carries this doc comment:

> "The sealed trait prevents adapters from substituting an arbitrary closure or obtaining the
> engine's raw database handle."

That statement is **true**, and it is **insufficient**. You do not need to substitute a closure
when a public factory will mint a sealed one around the subject you selected. The comment
describes a property *correlated with* the one that matters rather than the one that matters —
the exact defect class this program exists to eliminate, stated in a doc comment, in the
protocol the design proposes to adopt as its remedy.

Sealing the trait is not the operative protection. **Verifying ownership at the factory is.** Any
carrier design that seals the consumer while leaving a public factory that accepts caller-chosen
subject identifiers reproduces this, no matter how private the fields are.

Reachable from in-crate code only, like every other finding in this program.

## Consequence for the design

The revision's rule — "a constructor is not `pub(crate)` and is not placed in a leaf server module
callable by ordinary caller code" (design:471-481) — does not cover this, because
`record_authenticated_use_plan` is not a leaf-server constructor. It is a legitimate, sanctioned,
auth-owned factory. The design must additionally require that **every factory minting a sealed
product verify that the caller's authority owns the subject the product names**, and must
enumerate those factories rather than characterize them.

## Analysis caveats, recorded

The adversarial pass ran under a read-only sandbox where `git fetch` was denied; it reviewed
`b303866e2`, which is the revised-design commit, so the target was correct. It reports that B1/B2/B3
are closed "on paper" and that the residual risk moved to unenumerated factories; only the chain
above has been verified here. Its remaining findings are recorded as unverified and must be checked
individually before being relied on or dismissed.
