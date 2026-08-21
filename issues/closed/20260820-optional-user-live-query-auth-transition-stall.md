# `optional-user` live query stalls as ready/empty after sign-in

**Status:** Closed
**Opened:** 2026-08-20
**Closed:** 2026-08-21
**Systems:** Live queries, Auth transitions, React/Familiar client, Diagnostics
**Related:** LLP 0059; LLP 0107; LLP 0277 P16; LLP 0295; Diary 0101; `issues/20260820-authenticated-query-signed-out-settlement.md`
**Landing SHA:** TBD

## Problem

A live query declared `auth: "optional-user"` and armed while anonymous was
blanked at the anonymous-to-authenticated barrier but did not start a fresh
successor subscription. The observed projection remained
`status: "ready"`, `data: []`, `connection: "disconnected"`,
`freshness: "unknown"` indefinitely, with no diagnostic. Declaring the same
query `authenticated` used the documented blocked-to-successor path and
worked.

This was silent wrongness at the most common auth transition, not merely a
missing recipe.

## Resolution

The React registry's live-query authority admission now includes
`optional-user`. A transition-elected restart consumes the same exact staged
successor capture as the established `authenticated` path. The existing
barrier still decides which mounted stores to quiesce and re-enter; this
repair does not add a new restart-policy surface while LLP 0295 W2's shared
state-machine ruling remains pending.

Predecessor callbacks are rejected at callback ingress by generation and
handle identity before they can mutate store-owned rows, freshness, or
connection state. Successor creation failures publish
`SNAPBACK_AUTH_TRANSITION_FAILED` with phase `react-live-query-successor` and
retry through the bounded subscribe ladder with the exact successor capture.
Authorization prelude frames (`authorization_quarantine`,
`authorization_delete`, and `authorization_error`) instead keep the live
handle on the explicit blank boundary until its canonical `snapshot`, verified
retained `persisted` seed, or `authorization_denied` result arrives. They are
normal successor sequencing, not terminal transition failures. Familiar
`useQuery` continues to project the same canonical registry owner; its mounted
transition is covered separately from the core entry.

This provides two reusable pieces for the related authenticated-query
signed-out settlement ticket: exact settled-capture admission and a classified
successor-failure projection. It deliberately does not implement the sibling
ticket's one-shot authenticated signed-out settlement semantics.

## Published 0.1.24 closure reproduction

A standalone npm scratch app installed exact published versions
`@expo/snapback-client@0.1.24`, `@expo/snapback-react@0.1.24`, and
`@expo/snapback-codegen@0.1.24`. Its deterministic auth-barrier/transport
reproduction reported:

```json
{
  "anonymousSubscriptions": 1,
  "settledAuthoritySuccessors": 0,
  "successorAuthorityCaptures": [null],
  "projection": {
    "status": "ready",
    "data": [],
    "connection": "disconnected",
    "freshness": "unknown",
    "diagnostic": null
  }
}
```

This pins the defect in published package bytes rather than relying on a
source-checkout-only witness.

## Verification

- Core transition matrix: sign-in, sign-out, user A to B, reconnect callback
  during transition, and unmount/remount all pass. Each case observes exactly
  one settled-authority successor.
- The sign-in and reconnect cases inject late predecessor rows/connection
  callbacks after the synchronous fence; neither can repopulate the successor.
- Forced synchronous and asynchronous successor-creation refusals publish
  `SNAPBACK_AUTH_TRANSITION_FAILED` on the canonical query state and the client
  diagnostics channel.
- A transition successor that delivers quarantine before its production-shaped
  `snapshot` remains blank through the prelude and recovers to current `ready`
  on the same live handle. A verified retained `persisted` seed also releases
  the boundary as `refreshing` before the later current snapshot.
- Two consecutive synchronous successor-creation failures remain on the
  timer-owned backoff ladder; both retries retain the exact settled capture and
  the eventual production-shaped snapshot recovers to `ready`.
- The established authenticated blocked-to-successor suite and Familiar,
  authorization-denial, subscribe-retry, and runtime-import-fallback suites
  remain green.
- Final `npm pack` integrities used for scratch installation:
  `@expo/snapback-client` `sha512-PO9u6iUgJpiSE4wENJ9olcJHtXfaKwkV+8NCDCgW6mpWK6izVptmlu/tL5nDez3cPtAe0GulOTo/FX4VauFX3w==`;
  `@expo/snapback-react` `sha512-++A4DV6r2TmRdia/B18Tv99WZMjCJZ2WOaDSPMFzXw8xh1ZKFg3/5b6grsc9fTqWPQLebJLUovMO74sTrudpwg==`.
  An empty npm app installed those tarballs and observed two total attempts,
  core `ready`/`user-A`, Familiar `user-A`, exact successor capture, and a
  fenced late anonymous frame.

## Exit

An already-mounted optional-user query now re-resolves under the new authority
or publishes an explicit classified error within the transition. It cannot
settle in the silent stalled projection.
