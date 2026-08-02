# Default rqsStore lifecycle: sequential short-lived clients silently degrade to non-persisting readers (no disposal releases the writer lock)

**Opened:** 2026-08-01
**Systems:** Client integration, Sync
**Related:** LLP 0090 (D3), LLP 0129 (RN durable-store arm note, 2026-08-01), packages/snapback-client/rqs-store-file.mjs, demos/rn-durable-store-witness/

Found by the B1 on-device witness. The default-ladder durable store is
single-writer per lock domain (per origin). The FIRST client constructed in
a process resolves a store instance that acquires the writer lock (on-disk
lock file + the in-process `heldLocks` registry) — and nothing ever
releases it: `client.closeAuth()` does not close the client's resolved
`rqsStore`, and no other client-level disposal exists. Every LATER client
in the same process over the same origin resolves a fresh store instance
that sees the held registry entry and silently becomes a reader — reads
adopt persisted tokens, but commits are skipped by design (the multi-tab
posture), so **persistence quietly stops for the rest of the process
lifetime**.

On node, process exit unlinks the lock and short-lived CLI/test processes
mostly hide this. On React Native there is no process exit — an app (or a
test harness; the B1 probe hit exactly this) that constructs a client per
operation persists only what the first client wrote. The node control
`demos/rn-durable-store-witness/node-control.mjs` reproduces the healthy
single-client flow; the first on-device run's failure
(blob never written after a flush on the fourth client) was this edge.

Not a data-integrity defect: reads stay correct, single-writer stays
correct, nothing corrupts. It is a silent-degradation lifecycle gap on the
DEFAULT path.

Fix shape (smallest coherent): a client disposal that closes an
owned default-resolved store (e.g. `closeAuth()` closing `this.rqsStore`
when the client — not the caller — constructed it, or an explicit
`client.close()`), so the writer role hands over to the next client the way
`store.close()` already hands it over today. Guide guidance ("construct one
client for the app") is on guide/clients/react-expo.md; the ergonomic fix
belongs in the client.

Witness: construct client A, commit through it, dispose it, construct
client B in the same process — B's store is the writer and B's flush
persists.

---

**Resolved 2026-08-01.** `SnapbackClient.closeAuth()` now closes only a store
the client obtained from the default resolution ladder, after unregistering
its auth participant. An injected store remains caller-owned. The regression
constructs two sequential clients over one origin in one process, proves the
successor becomes writer and persists queued state, and separately proves
client cleanup never closes an injected store. LLP 0090 and the headless/Expo
guide now state the custody and handoff contract.
