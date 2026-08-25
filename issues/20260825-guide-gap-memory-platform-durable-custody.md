# Expo-chat start packet does not say Node `memory` cannot do durable custody

**Filed:** 2026-08-25 · **guide-gap**
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-explicit`
**Systems:** Guide, Auth, Testing

## Problem

Explicit replay hit `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE` on the Node
`memory` platform and had to impersonate `expo-web` + fake-indexeddb. The
template's own acceptance already does that. The start packet does not say
so, so the first headless replay is a correction loop.

## Direction

On the expo-chat start packet / acceptance recipe: durable custody is an
`expo-web` (or other durable-capable) platform; `memory` will refuse.
Point at the existing acceptance helper. Do not invent a second store.
