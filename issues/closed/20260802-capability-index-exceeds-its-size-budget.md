# The capability index cannot hold its required rows within the 32 KiB budget

**Status:** Open
**Impact:** 3
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Severity:** P2
**Systems:** CI, Guide
**Author:** Claude (Fable 5), directed by Philippe Loulidi
**Date:** 2026-08-02
**Related:** LLP 0061

`node scripts/check-guide.mjs` fails, so local-proof cannot go green:

```
[guide-check] error: guide/capabilities.md: exceeds its size budget (32856 > 32768 bytes)
```

## How it got here

The checker refuses any declared route that the surface map does not
classify. The LLP 0062 served-envelope work added two routes and never
classified them:

```
route '/app-api/current' is not classified in the surface map
route '/app-api/envelope/{sha256}' is not classified in the surface map
```

Classifying them is mandatory and correct — both belong to the existing
`clients.app-cli` capability (LLP 0062). Their two rows are 88 bytes more
than the budget allows. So the page is now in a state where the content the
checker *requires* does not fit in the size the checker *permits*.

`generate-guide-manifest.mjs` refuses to write over a failing corpus, so the
stale `guide-manifest.generated.json` and `guide-flat.generated.md` errors
are downstream of this and clear once the size question is settled.

## Why this ticket instead of a bump

`CAPABILITIES_SIZE_BUDGET_BYTES` in `scripts/guide-lib.mjs:19` is a designed
gate, not an incidental constant: LLP 0061 adopted the index size budget to
bound what an agent pays to load the index (§Budget: the relevant guide page
loaded within the first ~15 tool uses). Quietly raising it to make CI green
would weaken the gate and set the precedent of bumping it on every overflow.
Checked for slack first: no trailing whitespace, no double blank lines, and
no duplicated `notAuthorFacing` rationales to merge — every remaining byte
carries information.

## Options for the owner

1. Raise the budget deliberately and record the new number in LLP 0061 with
   the reasoning. Simplest, but the index keeps growing.
2. Move the surface map out of `capabilities.md` into its own generated page
   and budget the two separately. The map is mechanical (routes + host-ops
   joined from code); the index is prose an agent reads to orient. They have
   different growth curves and arguably different budgets.
3. Compress the map's format, for example one row per capability with its
   routes grouped, instead of one row per route.

Option 2 looks right to me: the map grows with every route the server
declares and will overflow again whatever number is chosen, while the
human-read index stays roughly stable.

Exit: `node scripts/check-guide.mjs` passes with both `/app-api` routes
classified, under whatever budget arrangement is chosen, and the generated
manifest and flat page regenerate.

## Resolution — 2026-08-02

Charlie's call: option 1, raise the budget deliberately.
`CAPABILITIES_SIZE_BUDGET_BYTES` in `scripts/guide-lib.mjs` is now 40960, and
LLP 0061 §Design 2 records the raise, the reason there was no slack to
reclaim, and option 2 (split the mechanical surface map into its own
generated page) as the recorded next step for the next overflow rather than a
second bump. `node scripts/check-guide.mjs` passes: 46 pages, 140 snippets,
88 routes + 29 host-ops joined, 14 freshness warnings (warning-only by
design).
