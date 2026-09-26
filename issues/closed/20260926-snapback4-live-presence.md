# Snapback 4: a live query that reads `connected[p]` never follows presence

- **Opened:** 2026-09-26, from a supervisor probe while landing 0.4.3.
- **Area:** `crates/snapback4-core/src/engine/runner.rs` (`Builtin::Connected`),
  `crates/snapback4/src/serve.rs` (`Live`), `crates/snapback4/src/serve_changes.rs`,
  and the clients' `/changes` invalidation (`client.ts`, `local.ts`).
- **Severity:** Medium. The value is stale, and the read still reports itself fresh.
- **Resolved:** 2026-09-26, by [LLP 3000.018](../../llp/3000.018-a-live-query-follows-presence.rfc.md) revision 5 in the 0.4.3 integration. An answer that read presence carries `refresh: 5000`, and both clients re-run that watch every 5 seconds while keeping its answer. `presence-live.test.mjs` passes on the online, native and web tiers: Alice's mark turns within one interval of Bob's first poll and of the end of his grace, and never reads loading. Revisions 1 to 4 followed presence through held polls instead and were withdrawn after four review rounds (§6).

## What happens

A query that reads `connected[p]` records no dependency. Presence `enter` and
`leave` update an in-memory map and signal nothing. A live observation of that
query therefore refreshes only when a table it also reads changes.

Probe (`presence.probe.mjs`, online and web tiers, on eb1000): Alice observes
`presenceOf(p: principal): return { online: exists connected[p], count: connected[p] }`
for Bob. Then Bob opens a client and holds a live watch.

| When | One-shot query | Alice's live snapshot |
| --- | --- | --- |
| 3 s after Bob opens | `{count: 1, online: true}` | `{count: 0, online: false}`, `fresh: true`, `complete: true` |
| after 60 s | | still `online: false` |

The presence guide card says "a query reads it for an online mark". The Grok
builder of the 0.4.1 comparative polled `memberPresence` from the client to
work around this.

## Direction (as first written; LLP 3000.018 revision 5 chose the fallback's spirit instead)

The fix is principal-scoped presence invalidation, and it needs an RFC. It
changes a `NOT-DOING.md` boundary, "no presence stream".

- A query that reads `connected[p]` lists `@connected:<p>` among its tables.
- The server keeps an in-memory presence log: online, and grace ended.
- A long poll carries the principals it follows and a presence cursor.
- The server wakes that poll when one of those principals changes.

Clients already refresh a watch whose tables intersect a `/changes` answer.

The smallest honest fallback, if the RFC stalls: a live answer that read
presence must not report `fresh: true` past the presence confirmation window.
