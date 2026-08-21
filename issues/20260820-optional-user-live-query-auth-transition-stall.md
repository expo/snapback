# `optional-user` live query stalls as ready/empty after sign-in

**Status:** Open
**Opened:** 2026-08-20
**Systems:** Live queries, Auth transitions, React/Familiar client, Diagnostics
**Related:** LLP 0059; LLP 0107; LLP 0277 P16; LLP 0295; Diary 0101

## Problem

A live query declared `auth: "optional-user"` and armed while anonymous is
blanked at the anonymous-to-authenticated barrier but does not start a fresh
successor subscription. The observed projection remains
`status: "ready"`, `data: []`, `connection: "disconnected"`,
`freshness: "unknown"` indefinitely, with no diagnostic. Declaring the same
query `authenticated` uses the documented blocked-to-successor path and works.

This is silent wrongness at the most common auth transition, not merely a
missing recipe.

## Requested repair

- Reproduce against the published 0.1.24 closure and pin the anonymous -> user
  transition in both core and Familiar React projections.
- Fence the predecessor synchronously, create exactly one successor under the
  settled authority, and prevent a late anonymous frame from repopulating it.
- If successor creation cannot proceed, surface a classified auth-transition
  diagnostic; never project ready/empty/disconnected as settled success.
- Cover sign-in, sign-out, user A -> B, reconnect during transition, and
  unmount/remount.

## Exit

An already-mounted optional-user query re-resolves under the new authority or
publishes an explicit classified error within a bounded transition; it never
stalls silently.
