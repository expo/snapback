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

## Resolution (2026-08-25)

Resolved the guide work. The auth guide describes
`SNAPBACK_AUTH_STALE_RESULT`; the incidental offline-queue mention now links
to that teaching section without assigning the code to the surrounding
asset-retention heading; and retrieval-eval evidence is excluded from
diagnostic target selection. Retrieval case 99 pins the exact generated
anchor, and the focused test exercises `snapback guide
SNAPBACK_AUTH_STALE_RESULT` in both JSON and text modes and asserts the complete
user-visible anchor list, not only its primary member. This proves the
JavaScript `runCli` lookup over checkout artifacts; it does not execute the
native binary. The native binary embeds the generated registry at build time
and follows this correction when rebuilt. These checks do not exercise a live
stale-result mutation.
