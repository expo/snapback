---
title: Move auth identities without moving authority
id: auth.logical-transfer
order: 7
audience: agent-first
capabilities: [auth.logical-transfer]
authorities: [llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0057-auth-provider-protocol.spec.md, src/auth/logical_transfer.rs, src/storage/auth_logical_transfer.rs, src/cli.rs, schemas/auth.logical-export.v1.schema.json]
examples: [src/storage/auth_logical_transfer.rs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-11
reviewed-commit: HEAD
---

# Move auth identities without moving authority

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

These CLI verbs are **contributor-source** today: they exist in the source
`snapback` binary and are not yet part of a published `@expo/snapback-*`
closure. Build from source to use them.

Use logical auth transfer when another store should recognize the same human
and agent principals but must not inherit their ability to act. It is an
identity-and-recovery transfer, not a backup. For a byte-faithful store copy or
disaster recovery, use [back up, copy, and move a store](../operating/backup-and-copy.md).

## Export stable identity facts

Stop the source server, then write a new artifact:

```sh
snapback auth export \
  --db .snapback/source.sqlite3 \
  --output auth-logical.json
```

The command requires an exact auth catalog (version 2, 3, or 4), takes the database
instance lock, reads one SQLite snapshot, and refuses to overwrite an existing
output path. Fresh catalogs use version 4; exact version-2 and version-3 catalogs
remain supported without migration. The format is
`snapback.auth-logical-export.v1`, and its `authCatalogVersion` records the
source version. Version 4 additionally records its immutable
`passwordIdentifierMode`; import refuses a target with a contradictory mode.
Every row set is deterministically sorted and validated against the generated
`schemas/auth.logical-export.v1.schema.json` shape.

Format 1 can reconstruct the current email-code, local-password, and
agent-credential identity descriptors exactly. Export refuses disabled links
or any other v3 descriptor rather than guessing at kind, issuer, canonical
value, or enabled state; import applies the same fail-closed mapping rule for a
v3 target.

The artifact includes:

| Included fact | Why it travels |
| --- | --- |
| Human and agent user ids and creation times | Preserve stable principal identity. |
| Principal kind, display name, and operator contact | Preserve the agent's presentation. |
| Registration provenance | Preserve how the agent originated after invitations are gone. |
| Deactivation timestamp | A disabled agent stays disabled. |
| Owner user id | Preserve the owned-agent recovery relationship. |
| Identities, provider, canonical subject, and verification time | Preserve stable provider and agent-credential identity facts. |
| Every `_auth_scope_bases` tombstone | Prevent removed-and-readded function scopes from reviving old consent. |

It has no representable field for any spendable, secret, or consent-pending
authority. In particular, it excludes:

- sessions and session-token tombstones;
- verification challenges, digests, and the capture mailbox;
- credential hashes and credential generations;
- password-attempt and lockout state;
- grants, scoped-token hashes, and durable grant carriers;
- creation or recovery invitations and pairing requests;
- auth keyring bytes, integration/OAuth carrier state, rehearsal authority,
  and sender-proof replay state.

Treat the artifact as private identity data even though it cannot authenticate
a caller: canonical addresses, display names, operator contacts, and
registration provenance can still be sensitive.

## Import into a fresh auth catalog

Prepare the destination through the same app's normal sessions-mode activation,
so its database already contains an exact auth catalog but no principal or
credential rows. Fresh destinations use version 4; exact version-2 and
version-3 destinations remain supported without migration. Activation may
already have seeded the app's `_auth_scope_bases`; import accepts those schema
facts only when every seeded row exactly matches the incoming artifact. Stop
that server, then import:

```sh
snapback auth import \
  --from auth-logical.json \
  --db .snapback/destination.sqlite3
```

Import rejects malformed JSON, missing or unknown fields, unsupported format
or catalog versions, unsorted or duplicate ids, identity collisions,
non-canonical email subjects, orphan ownership/identity rows, and any target
that already contains auth-catalog, auth-retry/throttle/rehearsal,
integration/OAuth, or sender-proof carrier rows. It never merges.

All user, identity, ownership, deactivation, and scope-basis rows commit in one
transaction. That transaction also changes the destination authorization
incarnation and clears retained authorization retry state plus every authorized
lease reservation. A refusal or crash before commit leaves the destination
unchanged.

The result reports imported and owned/unowned/deactivated counts and explicitly
reports zero minted sessions, credentials, and grants. The source
authorization incarnation is not imported.

## Recover deliberately after import

Import preserves `ownerUserId`, so an owned agent retains the metadata needed
for owner-authorized re-credentialing on every profile. Import itself never
mints that replacement. The current contributor surface still lacks the
owner-issued replacement-credential command described on
[agent principals](./agent-principals.md), so do not mistake preserved recovery
eligibility for an immediately usable credential.

An unowned imported agent has no production recovery carrier and therefore
lands dormant on `prod`. Development/test/demo may use the separately gated
operator recovery surface when that carrier is available; production must not
turn import into operator impersonation. A deactivated agent remains
ineligible everywhere.

## Anti-patterns

- Do not call logical transfer a backup: it intentionally cannot preserve a
  working login, session, credential, grant, or keyring.
- Do not copy credential or token tables alongside the artifact to “help” an
  imported agent reconnect; that defeats the no-resurrection boundary.
- Do not import into a catalog with even one existing principal or retained
  auth carrier. Choose a fresh target instead of inventing merge semantics.
- Do not delete `_auth_scope_bases` from the artifact. Tombstones are what keep
  old consent dead when a function id returns.
- Do not reactivate a deactivated imported agent merely because its identity
  transferred successfully.
