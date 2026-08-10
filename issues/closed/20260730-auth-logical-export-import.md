# Agent-auth logical export/import tooling

**Status:** Closed
**Impact:** 4
**Urgency:** 2
**Ease:** 1
**Confidence:** 5
**Severity:** P2
**Systems:** Auth, Logical export, Restore, Tooling
**Date:** 2026-07-30
**Governing:** LLP 0055, LLP 0057
**Source:** Residual split from Linear ENG-24918

ENG-24918 landed the G7 ending-authority machinery, attribution block,
restore/downgrade purge behavior, and durable-authority settlement. Its only
remaining independently owned surface was the logical export/import contract,
which LLP 0057 specifies but does not implement.

The first-class logical export must include agent principals and identities,
ownership, registration provenance, deactivation state, and
`_auth_scope_bases`. It must exclude credentials, scoped tokens, grants,
invitations, pairing requests, and other spendable or consent-pending
authority. Import and declared restore must preserve LLP 0055's owned-versus-
unowned recovery posture without resurrecting excluded authority.

## Done when

- A first-class logical export command emits the exact LLP 0055/0057 agent
  identity and scope-base fields with a versioned, validated format.
- Credentials, tokens, grants, invitations, pairing requests, and secret
  material are absent by construction and covered by planted-secret tests.
- Import/restore revokes or omits every excluded authority carrier, preserves
  owned-agent recovery metadata, and leaves unowned agents dormant on
  production profiles.
- Round-trip, downgrade, corrupt-input, older-format, and no-resurrection
  acceptance cases pass.
- The Guide documents the inclusion/exclusion boundary and recovery behavior.

## Resolution

Implemented 2026-08-10. `snapback auth export` writes the closed,
deterministically ordered `snapback.auth-logical-export.v1` shape from one
exact-v2 catalog snapshot. `snapback auth import` validates that artifact,
admits only an empty exact-v2 target, imports the included identity/recovery
facts and scope bases atomically, and rotates the authorization incarnation in
the same transaction. The format structurally omits spendable and
consent-pending authority. Focused acceptance plants session/challenge/
credential/grant/token/invitation/pairing markers, proves round-trip and no
resurrection, and covers old/catalog-version, corrupt, collision, and
nonempty-target refusal. The generated schemas and Guide page ship with the
implementation.
