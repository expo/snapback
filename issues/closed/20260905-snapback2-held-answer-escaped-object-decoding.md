# P3 Snapback 2: held-answer expansion does not honor wire object escapes

**Status:** Closed
**Priority:** P3
**Systems:** range-store reference traversal and delivery protocol
**Date:** 2026-09-05
**Source:** Codex local-data review; reproduced/inspected at `23e89b4a17fecb713b7ca61681cf6f4f969c8536` (product tree equal to locally tracked origin/main `11e2e60984e756128aa0091b4c6c36ff82094ecb`).
**Related:** LLP 1012 §8 (escaped row-shaped application values)

## Confirmed protocol inconsistency

The network decoder understands `{$row: {$value: ...}}`, but
`snapback2/packages/snapback2/src/store/range-store.ts:406–412`
recursively expands the contents without honoring the escape.

Commit a delivery with no pooled rows and:

```js
data: {$row: {$value: {$row: {table: "messages", id: "literal"}}}}
```

The network decoder yields the intended application literal:

```js
{$row: {table: "messages", id: "literal"}}
```

The stored answer yields:

```js
{$row: {$value: null}}
```

This was reproduced at the protocol/store boundary. Current Quarry
object-field syntax does not directly author the dollar-prefixed key;
application reachability through Quarry was not established, so this
is lower priority than the reproduced application bugs.

## Resolution and acceptance

Share escape-aware reference traversal among network expansion, held-answer
expansion and reference collection. Verify escaped literal objects survive
store and carrier round trips without gaining false row references or
being interpreted as viewed/evicted rows.

## Review qualification

The package was rebuilt before verification. Existing selected client/carrier
suites passed 251/251 and Rust offline/replay/retention tests passed 37/37.
The new review reproductions expose gaps in that coverage. This ticket is
self-contained; temporary review artifacts are not required to implement it.

## Resolution — 2026-09-05

Network expansion, held-answer expansion, and reference collection now use
the same escape-aware traversal. Escaped application literals survive
persistence without becoming false row references. Purge traversal preserves
the escape spelling while invalidating dependent content.

The original protocol reproduction and three-carrier reopen/viewing/eviction
regressions pass.

The complete package run passed 364 tests with one existing skipped
process-control placeholder; no package tests failed. The implementation,
regressions, and guide/LLP updates ship together with this ticket closure.
