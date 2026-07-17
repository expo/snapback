# Enforce durable last-holder eligibility across auth and membership changes

**Status:** Closed
**Severity:** P1
**Systems:** RBAC, Memberships, Agent lifecycle, Auth catalog, Storage
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Principal kinds and §Ending authority, LLP 0056 §Writes
**Marker:** security, data-integrity

The shipped `lastHolder` guard does not enforce the RFC's durable-recoverability
predicate or re-evaluate the final eligible-holder set across auth-catalog and
membership changes.

`principal_is_eligible_on` in `src/storage/auth_agents.rs` defines eligibility
as merely “not permanently deactivated” and treats a principal absent from
`_auth_users` as eligible. `eligible_protected_holder_rows` and
`has_other_eligible_holder` reuse that weak test. Separately,
`revoke_agent_credential_family` in
`src/storage/auth_agent_credentials.rs` can revoke every credential, token, and
grant without consulting protected memberships.

Membership departure planning in `src/storage.rs` captures one surviving
membership row, but no auth-lifecycle fact. Commit validates that row version
and never evaluates the final eligible set. This leaves several legal paths to
a permanently stranded resource:

- an unowned production agent with no recovery key can be the sole protected
  holder and call `revoke-self`, becoming unable to authenticate forever;
- A may be deactivated while B, which has no auth-principal row, is counted as
  an eligible survivor;
- removing B can be planned while A is eligible, then still commit after A is
  deactivated or made unrecoverable because A's membership row did not change;
- promotion into the protected role can be planned, then commit after the
  target becomes ineligible.

The invariant has to be one transaction-final property shared by every writer,
not a collection of planning-time checks.

**Done when:**

- Define one durable-recoverability predicate covering principal existence,
  deactivation, ownership, live credential families, and recovery-key facts.
- Run one serialized final-state eligible-holder evaluator for membership
  insert/promotion/removal/demotion/expiry and auth lifecycle operations that
  can change recoverability.
- Make revoke-self, operator revocation, restore, and import either refuse or
  atomically use the specified emergency-transfer/quarantine path when a
  protected resource would otherwise be stranded.
- Prove both commit orders for `deactivate/revoke A` racing
  `remove/demote/expire B`, and for deactivation racing a promotion.
- Add regressions for an active A with nonexistent B and for a sole unowned
  production holder with no credential or recovery path.

## Resolution

Closed 2026-07-16. Commits `6b81e1a` and `dfd829e` route membership departure, agent
deactivation, credential revocation, and restore through the shared durable-holder
evaluator in `src/storage/auth_agents.rs`, `auth_agent_credentials.rs`, `auth.rs`, and
`storage.rs`, with both-order race tests inline.
