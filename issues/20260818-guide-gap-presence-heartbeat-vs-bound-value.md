# guide-gap: surface presence value reads like bound state but is a continuous publish

**Status:** Open — reopened 2026-08-21 after independent review
**Systems:** Guide, ephemeral realtime, React/Expo hooks
**Date:** 2026-08-18
**Evidence:** diary 0096 M3 — publishing typing through the surface
`presence` value kept the lease alive for the whole non-empty draft, failing
the 5s expiry ceiling; the correct `touch`-on-keystroke / `delete`-on-idle
pattern exists in the guide but was not findable from the obvious queries,
and `useSurface({ typing: value })` invites the Supabase `track()` reading.

Wanted: a one-pager ("presence value is a continuous publish; idle expiry
needs touch + delete / useSnapbackActivityPresence") linked from the
ephemeral-state page and the typing-indicators recipe, plus search terms so
`snapback guide typing` lands on it. The membership-backed rooms recipe
(f8cbf3d25) does not cover this heartbeat-semantics trap.

## Reopening note — 2026-08-21

The recipe and retrieval route landed, but the closure evidence contains no
packed-external vertical contract fixture covering the advertised activity
presence path through client behavior and a negative diagnostic. LLP 0295 makes
that receipt mandatory for Phase 1 closure; the original exit remains unmet.

## Partial implementation

Added `guide/recipes/activity-presence.md` and linked it from ephemeral state
and typing indicators. It makes the decision explicit: a bound surface value
publishes continuously; activity presence uses
`useSnapbackActivityPresence`, `touch()`, provider-owned renewal, and explicit
or idle `withdraw()`, with TTL only as a crash backstop. Retrieval case 62 uses
the exact surface/bound-value, heartbeat, Supabase `track`, and publish/delete
vocabulary. The retained cold run at
`guide/eval-runs/2026-08-21/activity-presence.md` passed in 7/15 tool uses.

Partial evidence: the retrieval and full Guide checks pass; the required
packed vertical receipt remains open.
