# Coterie Snapback avatar picker cannot identify the selected server asset

**Filed:** 2026-08-17 · **Status:** Open · **Systems:** Demos, Contract,
Provider adapters, Snapback

**Related:** LLP 0266; `demos/coterie/scripts/v7-declaration-delta.md`;
`review-codex-v7r2.md` finding 3

## Problem

The Coterie profile picker needs an `avatarRef` to mark one canonical option
selected. The frozen `listProfiles@2` row exposes only `avatarUrl`. That works
in the memory lane because its URLs are the canonical fixture URLs, but the
Snapback adapter returns server asset URLs. The fixture-only reverse map cannot
recover which declared avatar ref produced a real server asset URL.

This is a declaration-shape limitation, not a client-side mapping bug. Guessing
from the server URL or keeping provider-specific UI state would violate the
provider-neutral boundary and would not survive reload or another client.

## Closure wanted

On the next `listProfiles` compatibility-token bump, add nullable `avatarRef`
to the profile row and project the authoritative ref from both the memory and
Snapback providers. Update the profile route to pass that value directly as
`currentAvatarRef`, regenerate the provider artifacts, extend conformance and
both-provider tests, and remove the README limitation note.

The shape change should ride the next already-needed `listProfiles` token bump
rather than rotating the frozen `@2` token solely for this interim picker seam.
