# Remove the false wall-clock deadline from logout confirmation

**Status:** Closed
**Severity:** P2
**Systems:** Auth, Client kit, Logout, Custody ownership
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0059; LLP 0060
**Marker:** auth, logout, custody, ownership, liveness

The self-terminal logout fallback advertised a two-second confirmation
deadline, but checked it only between `synchronize` and `compareAndCommit`.
Those operations may legitimately wait on non-cancellable custody ownership or
participant barriers, so the deadline was not a hard bound. Racing them against
a timer would be unsafe: the orphaned owned operation could later publish after
logout had already returned.

**Done when:**

- Logout does not claim a wall-clock bound it cannot safely enforce.
- Confirmation never abandons an in-flight ownership or barrier operation.
- Successor detection and exact anonymous-mode/stream confirmation remain
  ownership-backed.
- The governing auth contract states the actual liveness boundary.

## Resolution

The misleading local deadline was removed. Logout now follows the custody
transition and participant barrier to an ownership-backed linearization point,
retrying only transient clearing/stale races. This matches the coordinator's
existing non-cancellable ownership contract and cannot leave an orphaned
confirmation that publishes after the caller observes completion. LLP 0060 now
states that liveness boundary explicitly.
