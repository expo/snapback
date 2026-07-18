# Reject authority-independent membership and scope dependencies during codegen

**Status:** Closed
**Severity:** P2
**Systems:** Codegen, Auth, RBAC, Function manifests
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0058; LLP 0056
**Marker:** auth, rbac, authority-independent, codegen, fail-closed

Codegen validated `authorityIndependent: true` against ordinary HostPlan filter
expressions, but did not include membership predicates or `authScopeField` in
that check. Both declarations derive `authorizationDependence: ["userId"]`, so
codegen could report success and write artifacts that the Rust manifest loader
then refused. The runtime failed closed, but the authoring and CI boundary was
inconsistent and delayed the error until server load.

**Done when:**

- Codegen rejects every authority-independent query with membership or
  auth-scope dependence before writing artifacts.
- Explicit auth and runtime-clock/id expression checks remain intact.
- Regression tests cover both a membership predicate and `authScopeField`.
- The governing LLP names membership as an authority dependency.

## Resolution

`validateFunctionAuthDefinition` now composes the existing ambient-expression
check with `hostPlanAuthorizationDependence`, so explicit auth expressions,
membership predicates, and auth-scope declarations share the same fail-closed
authoring decision while runtime clock/id remain covered separately. Codegen
regressions exercise both omitted dependency classes, and LLP 0058 now states
the complete authority-independent declaration profile.
