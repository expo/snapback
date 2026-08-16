# Governed visibility overrides validate at activation but have no executable carrier or read-dispatch seam

**Opened:** 2026-08-16
**Severity:** P2 (no current override is authorized, so nothing is broken today; blocks the first real override)
**Systems:** Security/authorization, Code generation, Server, Storage
**Source:** the live governed-activation acceptance lane (this landing) — its alternate-scope
e2e deliverable stopped on the brief's real-defect rule rather than paper over the gap.

## Facts (verified in this landing's lane)

- `VisibilityGovernanceActivationV1` carries only program/baseline digests,
  fixture-profile tuples, and production windows (`src/visibility_governance.rs` ~48-64);
  it has no normalized alternate row scope, no override-id→operation binding, and no
  authority-mode admission carrier.
- Codegen keeps normalized overrides in the `visibilityOverrides` projection only
  (`packages/snapback-codegen/visibility-governance.mjs` ~2009-2029); the executable
  manifest never receives them, per `src/manifest.rs` ~738-748's review-facts boundary.
- The host validates at activation/admin only; there is no override-backed read dispatch
  and no per-read expiry or fixture-fence check.

Consequently LLP 0234's G0 residual ("end-to-end alternate-scope storage behavior")
cannot be discharged by a test: the enforcement seam itself does not exist yet. A test
that installed a scope from the review projection would violate 0234 D6 (the projection
is never authority).

## Resolution shape

An override-execution slice under LLP 0234: extend the activation carrier (or a sibling
executable record, digest-bound into the deployment identity) with the approved
normalized scope + operation binding + authority mode; consult it at read dispatch with
per-read expiry and fixture-fence checks; then the deferred e2e (in-scope rows served,
out-of-scope identical-absent, expiry/fence refusal at execution) discharges the G0
residual. Design latitude (carrier vs sibling record) is an author/LLP call; the RFC's
D6 boundary (projection never authority) is already decided.
