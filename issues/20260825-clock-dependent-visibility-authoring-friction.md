# Time-windowed live reads: SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY leaves no paved path

**Status:** Open
**Opened:** 2026-08-25
**Systems:** Guide, Live queries, Code generation
**Related:** `benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/`
(cell 1, M8)

## Problem

Building M8 insights/trending on published 0.1.27, the capstone builder hit
`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY:insights,trending` — 0.1.27
refuses runtime `now` in authenticated live computed reads (the determinism
guard working as designed). The builder's workaround was a load-pinned
client clock argument combined with server-authored row times. It found
this shape by itself; nothing in the served guide names the blessed pattern
for time-windowed live queries ("trending in the last hour", "expiring
soon"), which is a bread-and-butter product need.

## Wanted

- A guide recipe for time-windowed live reads under the determinism guard:
  the client-clock-argument pattern, its staleness semantics, and when to
  re-issue with a fresh clock.
- Evaluate whether a paved primitive is warranted (server-authored time
  buckets, or a declared clock-quantization argument type) so the pattern
  is generated rather than hand-designed. Design-level; do not weaken the
  determinism guard itself.
