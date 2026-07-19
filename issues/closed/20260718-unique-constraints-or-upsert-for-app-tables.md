# No unique constraints or upsert: dedupe is a handler scan with a race window

**Status:** Closed
**Severity:** P3
**Systems:** Storage, Codegen, Runtime
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** LLP 0004; guide/backend/mutations.md; demos/shindig/snapback/handlers.mjs (invite); diary 0015
**Marker:** unique-index, upsert, read-set, invariants

App tables have indexes but no uniqueness declaration, and mutations have no
upsert primitive. Shindig's `invite` must enforce "one invites row per
(eventId, userId)" by collecting the `by_event` index and scanning for the
principal — O(guests) work for a two-sided key lookup, and the invariant is
only as good as the read-set conflict window (two concurrent invites of the
same person from different snapshots can both commit unless the scan's range
dependency catches it; nothing structural guarantees the pair stays unique).

Membership declarations get real host-owned uniqueness (principal × resource)
— ordinary app data deserves a declared version of the same idea. This shows
up in every "one row per (A, B)" shape: RSVPs, reactions, votes, follows,
read-receipts.

Candidate shapes:

- `.index('by_event_user', ['eventId', 'userId'], { unique: true })` —
  enforced at commit inside the write transaction with a stable diagnostic
  (`SNAPBACK_UNIQUE_VIOLATION`), so concurrent inserts race to one winner
  instead of relying on caller read sets.
- Equality-shaped index lookups (`.eq` on a compound index prefix) so the
  existence check is a point read either way.
- Optionally `ctx.db.upsert(table, uniqueIndex, keyValues, values)` sugar
  once uniqueness exists.

**Done when:**

- A schema can declare a unique (possibly compound) index; codegen and the
  server enforce it transactionally with a stable diagnostic; docs state the
  concurrency guarantee.
- The shindig `invite` handler (and any similar demo scan) is rewritten to
  the declared form, with an acceptance check for the concurrent-duplicate
  race.
- Explicitly decided and recorded if upsert sugar is in or out of scope.

## Resolution

Closed 2026-07-18. Ordinary tables can declare total single- or compound-key
uniqueness with `.index(name, fields, { unique: true })`. Codegen and schema
activation reject optional unique-key fields, SQLite enforces the invariant
transactionally, and activation/write conflicts share
`SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`. Shindig now declares its event/user
invite key structurally and its acceptance suite races duplicate inserts.
LLP 0007 explicitly defers upsert sugar to a separate portable API decision.
