# snapback2: shaped page results are `any[]` in the generated `api.d.ts`

**Opened:** 2026-09-03 (Clique Pay lane, blind review finding)
**Resolved:** 2026-09-03 (`<SHA>`)
**Area:** `snapback2/packages/compiler/src/project.ts` (API result inference)

A query that returns a shaped page (`table[...] first N { *, nested: ... }`)
is typed `Op<Args, any[]>` in the generated `api.d.ts`; only unshaped pages
(`Page<UsersRow>`), point reads (`UsersRow | null`), scalars, and object
literals are typed. Pre-existing at `7e19a5244` (`chat.chatThread`,
`social.globalFeed`, `social.myFollowing`, `chat.myConversations` in the
Clique fixture are all `any[]`); Clique Pay's `pay.myLedger`,
`pay.myOpenShares`, and `pay.convExpenses.expenses` inherit it, so their
`money USD` fields reach a client untyped even though scalar results
(`pay.myBalance: Money<"USD", 2>`) and object literals keep the brand.

Fix: infer the element type of a shaped page from the shape (spread columns
plus named fields, nested shapes recursively) the way object literals already
are, so branded money/decimal columns survive into collection results.
Pin with the Clique fixture (`quarry-checks.ts` inventory test): every
`pay.*` collection result names its money fields.

## Resolution

API result typing now follows the Quarry-lowered scan/get bindings, loop rows,
null guards, guarded shape assignments, accumulator pushes, row spreads, and
nested accumulators. Row spreads retain their generated named row aliases, and
picked or computed branded fields retain `Money`/`Decimal` types.

`api-shape-checks.ts` pins the absence of `any[]`/`any` result fields in the
Clique API, exact types for the seven named Clique shapes plus the
`quarry-surface` where result, a journey-level branded-money and misspelled-field
check, and todos/chat template journey compilation. The existing
`quarry-money-checks.ts` pins remain unchanged and green.
