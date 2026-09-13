# Stale handle auth restore purges a successor-protected recovery carrier

**Status:** open
**Date:** 2026-08-26
**Area:** destructive auth restore; schema freshness; protected membership
**Related:** LLP 0303, F182, `issues/shelved/20260826-stale-handle-schema-policy-sibling-survey.md`

## Finding

The destructive-restore part of family 2 **REACHES EFFECT**. At
`crates/snapback-kernel/src/storage/auth.rs:2313`, `apply_auth_restore_declaration` clones the
handle-cached manifest before opening its immediate transaction. The transaction deletes agent
authority at line 2379 and validates the final protected-membership state at lines 2386–2390 using
that predecessor manifest. It does not re-read the active manifest from the SQLite resource.

## Executed two-handle composition

The ignored regression witness is
`storage::auth_agent_credentials::tests::stale_predecessor_manifest_reaches_destructive_auth_restore_effect`.
It ran this schedule against one SQLite file:

1. Open handle A and publish/activate a sessions manifest whose `event_members` table has no
   membership policy.
2. Through A, create `agent-a`, issue its only credential family, and seat the agent as sole `host`
   of `event-1`.
3. Open handle B and durably publish a same-mode successor defining the membership relation and
   `lastHolder.protect: host`.
4. Confirm A still holds the predecessor while B holds the successor.
5. Through stale A, call `apply_auth_restore_declaration` with a fresh declaration id.
6. Through B, count `agent-a` rows in `_auth_agent_credentials`.

Run:

```sh
cargo test -p snapback-kernel stale_predecessor_manifest_reaches_destructive_auth_restore_effect -- --ignored --nocapture
```

The observation fired at the witness's effect branch, currently
`crates/snapback-kernel/src/storage/auth_agent_credentials.rs:4159`:

```text
FAMILY2_REACHES_EFFECT: use returned Ok(Applied { sessions_revoked: 0, challenges_deleted: 0 }); publisher handle B observed credential_rows=0
```

No error or diagnostic code fired at the `use`. In particular,
`SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND` did not fire. The exact durable effect was deletion of the
sole protected holder's only agent credential family.

## Scope

This is a measurement-only ticket and makes no fix. Family 2's auth-mode staging and same-mode
schema publication paths still require separate schedules; this composition establishes the
destructive-restore sibling only.
