# Make `requireRole` parsing fail closed

**Status:** Closed
**Severity:** P1
**Systems:** RBAC, JavaScript runtime bridge, Codegen
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Rule helpers
**Marker:** security, authorization

The runtime bridge parses `ctx.permissions.*.requireRole` role arguments with
`filter_map`, silently discarding non-string values. If every supplied role is
malformed, the resulting empty vector is interpreted as the broader
`memberOf` check. A handler calling `requireRole(resource, undefined)` can
therefore admit any non-pending member rather than refusing the request.

**Done when:**

- Every supplied role is a non-empty string in the declaration vocabulary.
- Missing, empty, unknown, or non-string role lists fail before authorization.
- Generated TypeScript requires a non-empty role tuple/rest argument.
- Runtime and generated-surface tests prove malformed values cannot broaden a
  check to ordinary membership.

## Resolution

Closed 2026-07-16. Commit `dfd829e` validates every role argument in `src/runtime.rs`
and emits a non-empty generated TypeScript signature from
`packages/snapback-codegen/index.mjs`; runtime and codegen regressions cover malformed
and unknown roles.
