# guide-gap: pattern for background writes during authorization transitions

**Status:** Open
**Systems:** Guide, client outbox, auth invalidation
**Date:** 2026-08-18
**Evidence:** diary 0092 M3 — eager route-entry receipt writes hit
SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED and serialized foreground sends; the
lane's fix was removing eager dispatch, and its diary explicitly asks
whether such writes should queue, retry, wait for a client state, or move
elsewhere.

The 0.1.24 auth queue-store program made this seam correct; nothing yet
teaches consumers the intended authoring pattern for
"idempotent housekeeping write immediately after route entry/sign-in".
Wanted: a recipe page naming the states, the queueable-mutation default,
and an anti-pattern note on effect-identity-driven repeat dispatch.
