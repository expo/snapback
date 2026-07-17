# Reconcile ambiguous agent credential and revocation commits

**Status:** Closed
**Severity:** P2
**Systems:** Agent credentials, Grants, Auth transactions, Connection lifecycle
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Credentials and tokens, LLP 0059 §Rollback and ambiguous commit
**Marker:** reliability, security

Several credential and grant lifecycle mutations use the direct
`with_auth_transaction` helper, which turns a `tx.commit()` error into an
ordinary failure and discards whether the transaction may already be durable.
The same module already contains `attempt_auth_transaction` specifically to
preserve `Committed`, `RolledBack`, and `CommitUncertain`.

Credential rotation, credential-family revocation, scoped-token minting, and
grant revocation use the simpler helper. Server topology changes—terminating
old live tokens and returning a newly minted secret—run only after storage
returns success.

If rotation commits but its acknowledgement is lost, the predecessor is
revoked while the successor secret is never delivered and the caller receives
an ordinary error. If a revocation commits ambiguously, existing service-token
connections may remain projected because the server never runs terminal
topology cleanup.

**Done when:**

- Secret-producing and authority-ending lifecycle operations use an
  attempt/reconciliation protocol with an operation identity and exact durable
  witness.
- Rotation either returns/reconciles the one committed successor secret or
  leaves the affected authority explicitly unavailable; it never reports a
  normal rollback after a durable predecessor revocation.
- Revocations reconcile their exact token/grant set and project terminal
  topology exactly once after an ambiguous acknowledgement.
- Fault-injection tests cover lost commit acknowledgements for rotation,
  minting, family revocation, and grant revocation.

## Resolution

Closed 2026-07-16. Commit `6b81e1a` moved credential issue/rotation, token mint, family
revocation, and grant revocation onto exact commit-attempt reconciliation in
`src/storage/auth_agent_credentials.rs`; injected lost-ack tests cover each lifecycle
operation.
