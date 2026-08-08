# JS client: three silent-divergence paths in live recovery (managed frame drop, presence suspend, queries snapshot)

**Opened:** 2026-08-08 · **Severity:** P2 (correctness; each silently diverges client state from the server) · **Area:** snapback-client / snapback-react

Three independent spots where the client swallows a recovery signal instead of
re-entering through a fresh snapshot. All share the theme: the codebase's own
"durable_bytes resync" posture is not applied on the production path.

## A) Managed live socket silently drops undecodable frames

`packages/snapback-client/index.mjs:12346-12362` (`LiveStreamManager` message
listener). Any non-`SNAPBACK_INGRESS_LIMIT_EXCEEDED` parse/decode failure is
`return`ed (dropped) with no state transition. A truncated/corrupt `live_delta`
(proxy truncation, RN transport bug, server defect) leaves a hole; the next
higher-version delta applies over it, so `handle.rows` silently diverges. For
RQS-eligible queries the resume-token digest eventually forces resubscribe, but
auth-scoped and non-eligible queries have no digest check — divergence persists.
The raw `openLiveStream` path latches `fail(error)` on the same failure
(:8890-8892); only the managed path (the one production uses) swallows it.
*Fix:* treat non-limit decode failures as socket loss (`this.#loseSocket`) or
route the `durableBytesResyncSentinel` (:12800).

## B) Presence publisher never recovers from a single failed publish

`packages/snapback-react/index.mjs:1611` (set), 1723-1732 (gate), 1706-1750
(`startRoom` never clears). A publish failing on a dying network sets
`room.suspended = true` and clears the heartbeat; on foreground the room
resubscribes and reaches `ready`, but the `!room.suspended` gate skips republish
and never reschedules the heartbeat. The server presence entry expires by TTL
and the user stays invisible until an unrelated `setTokenIntent`. `suspended`
clears only on publish success / changed intent / delete — never on a fresh room
subscription reaching ready.
*Fix:* clear `room.suspended` when a fresh room subscription reaches `ready`, or
only latch it for non-connectivity failures (the client has
`isConnectivityFailureError`) and schedule a bounded retry otherwise.

## C) `useSnapbackQueries` snapshot cache can return a stale group snapshot

`packages/snapback-react/index.mjs:2684-2696`. The memo compares only the
current descriptors' entries and omits `boot`. When entries shrink `{a,b}→{a}`
with `a` unchanged, `read()` returns `previous` (still holding stale
`queries.b`) and, with unchanged object identity, memoized children don't
re-render. `boot` transitions while statuses are equal are also invisible.
*Fix:* also compare `previous.boot === next.boot` and require
`Object.keys(previous.queries).length === descriptors.length` before returning
`previous`.

## Confidence

A: high asymmetry, medium on non-deliberateness. B: medium-high. C: high
mechanics, low-medium user-visible impact. Also fold the queries-map variant
into the existing inline-args resubscribe ticket
(`20260806-usesnapbackquery-inline-args-resubscribe.md`), which names
`useSnapbackQuery`/`useSnapbackPresence` but not `useSnapbackQueries`
(index.mjs:2670).
