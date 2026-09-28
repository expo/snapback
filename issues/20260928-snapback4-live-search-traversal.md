# Snapback 4: live search traversal repeats or skips IDs after order edits

Status: Open
Date: 2026-09-28
Scope: ordinary search continuation, LLP 3000.028 §3.3/§7.2

The lane OS round-5 generated oracle runs 300 seeded scenarios on each real
process and wasm device. Its independent model finds traversal invariants
stronger than the implemented live `(at, id)` keyset protocol. These are live
product limitations, not authorization leaks or a reason to weaken the oracle.

Reproduce from `snapback4/` after the normal native/wasm/client builds:

```sh
SB4_SEARCH_SEEDS=3,28,88,105,142,237 node --test packages/snapback4/test/ordinary-search-oracle.test.mjs
```

- Seed 28: ascending, limit 9. Emit m00004 at 20. After page two, edit its
  `at` to 279 without sync. Page three emits m00004 again.
- Seed 105: ascending, limit 9. After two pages, move the still-matching,
  continuously readable U+10000-prefixed 00022 from 110 to 77. The final page
  omits it and reports complete. Seed 237 does the same with m00024 and sync.
- Seed 88: mutable scope, deliberately declined composition. Move an emitted
  m00003 from a retained scope into the current scope and change its `at` to
  76, then sync. The ordinary device fallback emits that ID again. Immutable
  scope admission fixes Astra's two-source collision; it cannot certify the
  generic mutable-order fallback as duplicate-free.
- Seed 3: a new matching row is inserted before the consumed key. The terminal
  page cannot certify that every currently matching row was emitted.
- Seed 142: a body stops matching while its position is traversed, then starts
  matching again. The old cursor misses it. This is not a continuously matching
  ID, but it fails the requested whole-current-corpus terminal guarantee.

The public `complete` contract describes page coverage. It can be true while
`next` is non-null. Round 5 leaves that public contract unchanged and tests the
stronger whole-corpus assertion at terminal complete pages, alongside the
continuous-match and duplicate assertions. All failing seeds and action traces
are retained under `snapback4/reports/20260928-os-ordinary-search/round5/`.

Resolution needs a bounded consistency design: decide which relevant changes
invalidate/restart a traversal, and prove it without making an unrelated sync
or body-only edit restart pagination (round-3 regressions), leaking hidden
state, introducing an unbounded seen-ID set, or adding server invocations.
A snapshot or durable search session is not part of the accepted design.
Do not claim round-5 acceptance or a universally duplicate-free fallback until
that design and these generated cases pass.
