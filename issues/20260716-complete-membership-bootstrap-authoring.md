# Make membership bootstrap authoring executable

**Status:** Open
**Severity:** P2
**Systems:** RBAC, Codegen, Runtime bridge, Guide
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Last-holder safety
**Marker:** feature-completeness, authorization

The public authoring surface exposes `bootstrapRole` and `lastHolder`, and
storage implements `plan_membership_bootstrap`, but generated mutation context
has no bootstrap operation and production code never calls the planner. A
protected resource whose first holder must be established atomically therefore
cannot be created through the public app surface.

**Done when:**

- Provide an atomic generated create/bootstrap operation carrying the resource
  creation witness, or reject/withhold bootstrap declarations until one exists.
- No public field claims a capability that has no production caller.
- End-to-end tests create a last-holder-protected resource without an
  unprotected intermediate state, and guide text matches the supported API.
