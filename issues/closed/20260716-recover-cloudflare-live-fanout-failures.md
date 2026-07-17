# Recover Cloudflare live subscribers from post-commit fan-out failures

**Status:** Closed
**Severity:** P1
**Systems:** Cloudflare target, Live queries, WebSockets, Diagnostics
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0003 §Realtime pipeline, LLP 0008 §Realtime delivery
**Marker:** reliability, data-consistency

The Cloudflare target can leave a connected live subscriber silently stale
after a mutation has committed.

`fanOut`/`pushReplaceGroup` in `cloudflare/src/coordinator.js` re-query affected
subscriptions after commit. If the group query fails, the code logs and
returns. If an individual `ws.send` throws, it logs and continues. The outer
catch also only logs. No affected socket receives `resync_required`, and a
failed socket is not closed, so the client has no signal that its materialized
rows missed a committed version. The local target's corresponding failure path
does raise a resync/authorization obligation.

**Done when:**

- Group re-query or serialization failure sends a best-effort resync signal or
  closes every affected socket so reconnect obtains a fresh snapshot.
- A per-socket positive-data send failure closes that socket while healthy
  group members continue.
- Record bounded diagnostic codes/counters without failing or undoing the
  already committed mutation.
- Fault-injection acceptance proves the mutation remains committed, healthy
  subscribers update, and failed subscribers recover through resync or
  reconnect instead of remaining stale-connected.

## Resolution

Closed 2026-07-16. Commit `814522f` makes group failures signal resync/close and
per-socket send failures close only the failed subscriber in
`cloudflare/src/coordinator.js`; fault-injection acceptance verifies committed
mutations and subscriber recovery.
