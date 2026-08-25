# `snapback guide SNAPBACK_AUTH_STALE_RESULT` resolves to an unrelated assets page

**Filed:** 2026-08-25 · **guide-gap**
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** Guide, Diagnostics, Auth

## Problem

Familiar recorded a knowledge-lookup of `SNAPBACK_AUTH_STALE_RESULT` that
landed on an unrelated assets page. Orientation is inside the Clique
clock. A coded diagnostic must resolve to the page that explains stale
auth results.

## Direction

Point the diagnostic registry / `snapback guide` index for
`SNAPBACK_AUTH_STALE_RESULT` at the auth page that actually describes it.
Add a retrieval check so this code cannot silently retarget.
