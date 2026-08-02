# Cloudflare live fan-out selects subscriptions by declared tables, not captured reads

**Status:** Resolved (2026-08-01)
**Found:** 2026-08-01, LLP 0146 round-1 super-refine (Codex family BLOCKING-1,
author-verified)
**Systems:** Cloudflare arm, live queries, invalidation
**Related:** LLP 0008, LLP 0040, LLP 0146 (OQ8), LLP 0127 decision 6

## Defect

On the Cloudflare arm, a live query that reads a table it does not declare is
never woken when that table changes.

`fanOut` selects affected subscriptions by intersecting the commit's changed
tables with each LiveQuery function's tables:

```js
.filter((fn) => functionTables(fn).some((table) => changedTables.has(table)))
```

— `cloudflare/src/coordinator.js:5163-5167`

and `functionTables` returns the function's **manifest-declared** tables:

```js
function functionTables(fn) {
  if (Array.isArray(fn.tables) && fn.tables.length > 0) return fn.tables;
  return [schema.tables[0].name];
}
```

— `cloudflare/src/coordinator.js:5539-5542`

Captured read dependencies *are* recorded on this arm
(`cloudflare/src/host-ops.js`) but are not consumed by the coordinator. The
coordinator's own header says so: "captured read sets are recorded but not
yet validated" (`cloudflare/src/coordinator.js:22-23`).

## Why it matters

Declared reads/writes are documented as "evidence, not enforced ceilings"
(LLP 0127 decision 6), and nothing in the toolchain checks a declaration
against observed behaviour. So an under-declared handler is not a
contract violation today — it is an ordinary authoring mistake, and it is
precisely the mistake an LLM agent authoring an inline handler is most
likely to make (add a `ctx.db.query('members')` call, forget the
declaration).

Locally the blast radius is narrow: `live_subscription_may_be_affected`
(`src/live_matcher.rs:129`) prefers captured dependencies and consults the
declared `read_set_summary.tables` only as a fallback when no `Query`
dependency was captured (`:229-233`). On Cloudflare the declared set is not a
fallback — it is the only filter.

Failure shape: the subscription silently goes stale. No refusal, no
diagnostic, no reconnect. The client shows correct-looking data that stops
updating.

## Note on the `functionTables` default

The fallback `return [schema.tables[0].name]` for a function with no declared
tables is worth a second look while fixing this: an undeclared function is
attached to whichever table happens to be first in the schema, which is
arbitrary rather than conservative. A conservative default would be "every
table."

## Candidate fixes

Carried as LLP 0146 OQ8; the three shapes and their costs:

1. **Consume captured reads in `fanOut`.** Most precise; costs a storage read
   per fan-out and needs a disposition for subscriptions with no captured
   query dependency.
2. **Widen conservatively.** Treat an under-declared or unwitnessed function
   as affected by every changed table. Cheapest to implement; costs delivery
   precision and therefore idle economics (LLP 0040 §Idle economics).
3. **Require declaration/observation strict mode on this target** (LLP 0146
   D1 surface 3). Keeps fan-out cheap; costs an authoring-contract change,
   and cannot ship before that decision is taken.

Fix 2 is the honest interim if the arm needs to be correct before LLP 0146
is adjudicated.

## Acceptance

An acceptance case on the Cloudflare arm: a live query declaring table A that
also reads table B, with a commit touching only B, must deliver an update.
Before this fix, it did not.

## Resolution (2026-08-01)

The Cloudflare arm now uses the correctness-first interim described above:
every non-empty commit considers every `LiveQuery` function affected. The
existing bounded indexed `_snapback_subscriptions(function_name)` lookups
still limit work to live functions with active durable subscriptions, and
equal function/argument shapes still share one re-query. The old
`functionTables` helper and its arbitrary first-schema-table default are
removed.

This deliberately accepts false-positive re-query work rather than allowing a
false-negative update, following LLP 0008 §Reactivity and Read Sets. Captured
reads remain available as a future precision optimization; they do not need to
be persisted or consumed for correctness now.

Acceptance is pinned in the Cloudflare All Aboard arm:
`underdeclaredFeedState` declares `trainStatus`, executes the `feedState`
handler that reads `feedRefreshState`, and must receive a `live_replace` after
`claimFeedPoll` commits a change only to `feedRefreshState`. The focused suite
passes 20/20 checks. Source-derived deployment identities were regenerated for
both Cloudflare proof apps.
