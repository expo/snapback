# Snapback 4: Return and preserve dependencies for online live queries

Status: Open
Priority: P1
Observed: 2026-09-12
Review finding: R12
Evidence: Reproduced end to end
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The core query outcome contains read tables, but the `/q` response omits them.
The online client reads `json.tables ?? []` and later refreshes a watch only
when its dependency set intersects `/changes`. An ordinary watch therefore
never refreshes for another client's commit.

Reproduction: observe an `all` query over one row, insert a second row through
a separate request, and allow the changes poll to finish. The observation
still shows one row with `fresh: true`; a direct query returns two. Writes
issued by the same client can mask the bug because they explicitly refresh.

Carry the required dependency information across the wire and retain it for
watch invalidation. Also keep the changes-consumption watermark independent
of the newest sequence seen by an arbitrary query or mutation: advancing that
shared sequence can skip changes owed to other watches. Verify two watches,
a foreign commit, a direct query before the next poll, and reconnect. Each
observation must reach the correct current result without remounting.

## Implementation locations

- [crates/snapback4/src/serve.rs](../snapback4/crates/snapback4/src/serve.rs)
- [packages/snapback4/src/client.ts](../snapback4/packages/snapback4/src/client.ts)
