# Enforce membership patch `from` role restrictions

**Status:** Open
**Severity:** P1
**Systems:** RBAC, Membership transitions, Storage
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Writes
**Marker:** security

`plan_membership_patch` in `src/storage.rs` matches operation, caller class,
target class, and field coverage, but never compares the target row's current
role with the transition's optional `from` list.

For example, a transition intended to let hosts update `expiresAt` only on
guests:

```json
{"op":"patch","by":["host"],"target":"other","from":["guest"],"fields":["expiresAt"]}
```

also authorizes the same patch on a cohost or protected host row. The shared
`matches_role_lists` helper has a related semantic mismatch: when an actual
role is supplied, an omitted transition list matches nothing, although the RFC
defines an omitted optional `from` as unrestricted.

**Done when:**

- Patch matching compares the current row role against `from` whenever it is
  present.
- Omitted optional `from` has the specified “any current role” meaning, while
  operation-specific required lists remain enforced by manifest validation.
- Tests prove guest allowed, cohost/host denied, and omitted `from` allowed for
  an otherwise matching patch.
- The same role-list helper semantics remain correct for set-role and remove.
