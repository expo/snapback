# Guide gap: retention opt-in and the optimistic-toggle recipe read as contradictory

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, Offline retention, React client, Codegen
**Date:** 2026-08-04
**Governing:** LLP 0090, LLP 0107, LLP 0114

## Problem

Two guide pages give requirements that, read together and taken at face value,
are mutually exclusive for the single most common social-app feature (a like
button on a feed that works offline).

`guide/sync/offline-and-retention.md` — cold retention is opt-in per query and
requires:

> `authorityIndependent: true` — the trusted declaration that the complete
> result is identical for every caller.

`guide/recipes/optimistic-toggle.md` — the viewer's toggle state must be in the
query result:

> If `liked` is not in the query result, there is nothing authoritative to
> reconcile against, and component state is the only place left to put it —
> which is exactly the anti-pattern.

A per-viewer `liked` field is by definition *not* identical for every caller.
An author who believes both pages concludes that an offline-capable feed cannot
have a working like button, and falls back to component state — precisely the
anti-pattern the recipe exists to prevent.

## The resolution, which appears nowhere in the guide

The eligibility predicate does not reject viewer scoping. It rejects
**authority and ambient input**. From
`packages/snapback-codegen/index.mjs:352-371`:

```js
|| (plan.filters ?? []).some((filter) => serializedValueUsesAuthorityOrAmbientInput(filter.value))
```

`serializedValueUsesAuthorityOrAmbientInput` (same file, ~line 320) recurses
through `Field`, `Binary`, `Unary`, `If`, `Concat`, `Call`, and `Record`, and
returns `false` for anything else — including `Arg`.

So:

- `filter: [eq('userHandle', arg('handle'))]` → **rqsEligible, retains**
- `filter: [eq('userHandle', authUserId())]` → **not eligible, refuses with
  `SNAPBACK_RETENTION_NOT_RETAINABLE`**

Semantically identical queries; opposite offline behavior. The working pattern
is to split the viewer fact into its own argument-keyed retainable live query
and derive the boolean client-side:

```js
export const myLikes = defineLiveQuery({
  table: 'likes',
  args: { handle: v.string() },
  filter: [eq('userHandle', arg('handle'))],
  index: 'by_user',
  auth: 'public',
  authorityIndependent: true,
});
// client: const liked = new Set(likes.data?.map(l => l.postId)).has(post._id)
```

Verified working in `demos/warble` — both the timeline and the viewer's like
set render from disk with the server stopped
(`demos/warble/tests/acceptance/offline-local-first.mjs`, 6/6).

## The workaround then breaks the toggle recipe, at runtime

Splitting the viewer fact into its own query resolves *retention*, but it puts
the recipe's own guidance out of reach, and the failure is a runtime refusal
rather than anything the docs warn about.

`projectRecordFields(post._id, { liked, likeCount })` — the exact shape the
recipe teaches — spreads both fields into the timeline row
(`index.mjs:2315`: `{ ...row, ...intended }`). But `liked` is deliberately NOT
a column on `posts`; it lives in the split-out `myLikes` query. The projected
row therefore violates the generated result contract and the layer is refused:

```
SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED: value did not satisfy the generated
result contract
```

This renders as a visible error on every like tap. The only correct projection
is `{ likeCount }` alone, which means:

- the **count** moves optimistically, but
- the **heart** cannot, because flipping it means appending a row to `myLikes`
  — an optimistic *create*, which the recipe itself notes "has no paved path
  yet."

So an author who follows the offline page and the toggle recipe together gets a
runtime contract refusal, and the honest resolution silently downgrades half of
the recipe's promised behavior. Verified working both ways in `demos/warble`
(like and unlike commit; `likeCount` lands on 1, no double-apply).

## Why this is not just a docs nicety

The `arg()` vs `authUserId()` distinction is currently discoverable **only** by
reading the codegen predicate. It is not in the offline page, the toggle
recipe, the queries page, or the capability index. Two pages that are each
individually correct combine into wrong advice, and the platform's flagship
offline story is what breaks.

## Proposed fix

1. In `guide/sync/offline-and-retention.md`, add a short subsection under the
   `rqsEligible` opt-in: *viewer-scoped data can retain — key it by argument,
   not authority* — with the two-line contrast above and the split-query
   pattern.
2. In `guide/recipes/optimistic-toggle.md`, add a note where the viewer-fact
   requirement is stated, pointing at that subsection for the offline-capable
   variant.
3. State the security boundary explicitly in both places: argument-keyed viewer
   scoping is **not server-enforced**, so it is appropriate for public facts
   (likes, reaction counts) and wrong for private ones. Private retained data
   is the AuthorizedLease `retainable: true` path — see
   `guide/recipes/hidden-hands.md`.

## Evidence

- `packages/snapback-codegen/index.mjs:320-371` — the predicate
- `demos/warble/snapback/functions.mjs` — the working split
- `demos/warble/tests/acceptance/offline-local-first.mjs` — retained render of
  both queries with the backend down
