# useSnapbackQuery freshness: 'snapshot' emitted at runtime but missing from published types and guide

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** React client, Types, Guide
**Date:** 2026-08-08

guide/clients/react.md:154-156 closes the `useSnapbackQuery` return
contract's `freshness` as `unknown | retained | current`, and the published
`packages/snapback-react/index.d.mts:80-84` union agrees — but the runtime
also emits `freshness: 'snapshot'` (with `status: 'ready'`) for mixed-route
read-only children (packages/snapback-react/index.mjs:879, 892), and the
same guide page later documents that path with "The hook shape stays the
same" (react.md:215-219).

So doc and published types both disagree with the runtime: a TypeScript
consumer switching exhaustively on the declared union misses a real state,
and a doc reader building freshness UI drops it silently.

Ask:
1. Add the `'snapshot'` arm to the `.d.mts` freshness union.
2. Footnote the fourth value in react.md's return-contract list.

Found by the 2026-08-08 comprehensive docs review (clients slice).
