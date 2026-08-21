# guide-gap: pattern for background writes during authorization transitions

**Status:** Open — reopened 2026-08-21 after independent review
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

**Additional evidence, 2026-08-20/21:** diary 0105 M2 reached the same
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` state during repeated interactive
two-client feed mutations, not only eager background receipt writes. An
unhandled rejection left Expo's development error overlay intercepting later
trials. Bounded retry plus explicit terminal handling prevented the poisoned
UI, while consolidating six live subscriptions removed the repeated trigger.
The recipe should cover foreground gesture handling as well as background
effects and link to
`issues/20260820-familiar-live-subscription-contention.md` for the underlying
multi-subscription investigation.

## Reopening note — 2026-08-21

The recipe and retrieval route landed, and the missing link to the still-open
multi-subscription contention investigation is now present. The ticket was
nevertheless closed without the packed-external vertical contract fixture LLP
0295 requires for every Phase 1 advertised-path closure. Retrieval and Guide
checks do not prove runtime/client/negative-diagnostic coherence. The original
exit is not met; keep this ticket open until it names that receipt.

## Partial implementation

Added `guide/recipes/auth-transition-writes.md` and linked it from the
headless-client authority transition. It distinguishes queueable background
intent from `queue: false` foreground gestures, keeps authorization suspension
local/pending, requires settlement observation, and permits only a bounded
same-principal retry. Retrieval case 61 includes the exact diagnostic, eager
route-entry receipt, and foreground vocabulary. The retained cold run at
`guide/eval-runs/2026-08-21/auth-transition-writes.md` passed in 12/15 tool
uses.

Partial evidence: the retrieval and full Guide checks pass. They prove routing
and corpus consistency only, not the missing vertical contract. The separate
live-subscription contention investigation remains open and is not silently
decided by this authoring recipe.
