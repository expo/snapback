# Stale handle credential-family revocation bypasses successor last-holder policy

**Status:** open
**Date:** 2026-08-26
**Area:** agent credential lifecycle; schema freshness; protected membership
**Related:** LLP 0303, F182, `issues/20260826-stale-handle-schema-policy-sibling-survey.md`

## Finding

Family 1 of the stale-schema sibling survey **REACHES EFFECT**. Agent registration's F182 fix does
not cover credential-family revocation. `LocalDatabase::revoke_agent_credential_family` clones
`self.schema` before its transaction at
`crates/snapback-kernel/src/storage/auth_agent_credentials.rs:440`, then passes that predecessor
manifest to the transaction-final protected-membership check at lines 479–483. There is no
resource-derived manifest re-read inside that transaction.

## Executed two-handle composition

The ignored regression witness is
`storage::auth_agent_credentials::tests::stale_predecessor_manifest_reaches_credential_family_revocation_effect`.
It ran this schedule against one SQLite file:

1. Open handle A and publish/activate a sessions manifest whose `event_members` table has no
   membership policy.
2. Through A, create `agent-a`, issue its credential family, and seat that agent as the sole `host`
   of `event-1`.
3. Open handle B before the use and, through B, durably publish a same-mode successor manifest that
   defines the membership relation and `lastHolder.protect: host`.
4. Confirm A still holds the predecessor and B holds the successor.
5. Through stale A, call `revoke_agent_credential_family` with the issued secret.
6. Through B, read the exact credential row's `revoked_at_ms`.

Run:

```sh
cargo test -p snapback-kernel stale_predecessor_manifest_reaches_credential_family_revocation_effect -- --ignored --nocapture
```

The observation fired at the witness's effect branch, currently
`crates/snapback-kernel/src/storage/auth_agent_credentials.rs:4113`:

```text
FAMILY1_REACHES_EFFECT: use returned Ok(AgentFamilyRevocation { user_id: Some("agent-a"), ... }); publisher handle B observed revoked_at_ms=Some(1001)
```

No error or diagnostic code fired at the `use`. In particular,
`SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND` did not fire. The exact durable effect was the sole recovery
carrier's credential row changing from `revoked_at_ms = NULL` to `revoked_at_ms = 1001` under the
successor's protected membership policy.

## Scope

This ticket records measurement only and makes no fix. Integration retirement has sibling cached
manifest uses in the same file and still requires its own executed composition; this witness does
not claim that every operation in family 1 is reachable.
