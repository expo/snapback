# The lock-rank check permits the inversions it exists to reject

- Status: open
- Created: 2026-08-26
- Area: lock ordering (`llp/0290`, `llp/0059`), the rank check, `crates/snapback-kernel`, `crates/snapback-sync`
- Found by: two independent adversarial reviews, in unrelated lanes, on the same day

## The pattern

Two lanes independently authored **inverted lock edges**. Neither lane's own audit caught its own edge,
and — the part that matters — **the lock-rank check permits both**.

**Edge 1, in room-reauthorization completion.** Completion runs inside `with_snapback`
(`crates/snapback-server/src/server.rs:22875`), which holds the global `LocalSnapback` guard until the
closure returns, and then acquires lifecycle and SQLite
(`crates/snapback-sync/src/ephemeral.rs:3907`). Separately, `OutboxDrainLease::try_commit`
(`ephemeral.rs:1195`) holds the subscriber outbox mutex and invokes a **public caller-supplied
closure** (`:1230`), reachable through `AdmittedRealtimeEnvelope::into_leased_parts` (`:1396`). That
callback can wait for SQLite while completion holds SQLite and waits for the same outbox (`:4088`).

**Edge 2, in membership commit.** The transaction takes `IMMEDIATE`
(`crates/snapback-kernel/src/storage.rs:6915`), then `before_commit()` acquires membership admission
guards (`storage.rs:7574`) which retain the controller-state mutex through COMMIT
(`crates/snapback-kernel/src/auth/admission.rs:1283`). The reverse is publicly composable with a second
`LocalDatabase` handle on the same file:

```
A: SQLite IMMEDIATE → waits admission
B: admission        → waits SQLite
```

SQLite's five-second busy timeout bounds one wait, but retaining or retrying under the guard makes the
cycle persistent, and even without retry it forces a transaction failure while the first writer holds
`IMMEDIATE`.

## Why the rank check did not stop them

**The lock-rank check explicitly permits rank-50 admission under SQLite**, so edge 2 raises no
assertion. Edge 1 is not expressible to the checker at all, because the waiting party is a closure the
callee never names.

That is the general problem: a rank system orders *lock acquisitions the checker can see*. It cannot
see an acquisition that happens inside **caller-supplied code invoked while a lock is held**. Both
edges here run through exactly that shape, and both lanes' audits missed them for the same reason —
**a closure handed to a caller is a reverse edge invisible from the callee.**

## Why this is filed rather than fixed in a lane

Each lane is fixing its own edge, and the governing specs are being amended (LLP 0290 §7.1 and LLP
0059) to state one permitted bounded order and forbid every reverse edge. But two independent lanes
producing edges the checker allows, on the same day, says the checker's model is wrong rather than
that two engineers were careless.

Worth deciding, and none of it belongs inside a row lane:

1. **Should rank-50 admission under SQLite be permitted at all?** If the amended rule forbids every
   reverse edge, the rank table contradicts the specification and one of them must change.
2. **Can the checker see callback sites?** A rank system that cannot model "lock held while invoking
   caller code" will keep passing this class. At minimum it could flag *any* site that invokes a
   caller-supplied or trait-dispatched closure while holding a ranked lock, and require an explicit
   annotation.
3. **Is there a third edge?** Two were found by reviewers looking at unrelated lanes. Nobody has swept
   for this shape deliberately. The method is: enumerate **callback sites**, not callees — every place
   a ranked lock is held across a call to code the callee does not control.

## Related

`llp/0290-authorization-commit-participant.spec.md`,
`llp/0059-session-projection-and-client-barrier.spec.md`,
`llp/0303-subject-authority-correlation-policy.decision.md`.
