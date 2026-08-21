# guide-gap: pattern for background writes during authorization transitions

**Status:** Resolved
**Resolved:** 2026-08-21
**Landing SHA:** 2ff70f609af412223a72d0b9dfcd69a81cf9cdbe
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

## Resolution

`guide/recipes/auth-transition-writes.md` now names the shipped settlement
vocabulary exactly:

- protected live reads project `blocked:authentication-required` while
  signed out and `blocked:authentication-not-settled` during sign-in/sign-out,
  both with `transitionOwner: "auth-coordinator"`;
- imperative one-shots refuse with `SNAPBACK_AUTH_REQUIRED` or
  `SNAPBACK_CLIENT_AUTHORITY_CLEARING`, respectively, before transport;
- the default qualified-outbox mutation path returns the truthful
  `settled | queued` union, while `queue: false`,
  `useSnapbackSettledMutation`, and Familiar `useMutation` stay foreground
  settled-only paths; and
- every gesture promise has an immediate terminal handler, one bounded
  same-principal retry at most, and a `finally` path that restores UI state so
  Expo's error overlay cannot be poisoned by an unhandled rejection.

The recipe keeps LLP 0295 D0.2's unimplemented declared-housekeeping lane and
`blockedReason: "auth-barrier"` out of today's authoring surface. It links the
still-open `issues/20260820-familiar-live-subscription-contention.md` rather
than treating query consolidation as the cause or universal repair.

## Vertical and retrieval receipts

The packed-external vertical fixture is
`scripts/auth-settlement-packed-proof.mjs`. It loads freshly packed Contract,
client, and React packages and proves signed-out, signing-in, signed-in,
signing-out, and revoked semantics for both one-shot and live-query
projections. Its retained packed-package receipt and tarball integrities are
recorded in
`issues/closed/20260820-authenticated-query-signed-out-settlement.md`.
Authorization-invalidation and outbox-store tests remain the queue/
`queue: false` witnesses named by the recipe.

Retrieval case 61 now carries the exact plausible wrong vocabulary “write
after login”, “mutation during sign-in”, “outbox suspended”, and “background
write auth”. Case 73 adds diary 0105 M2's foreground vocabulary: “interactive
feed mutation”, “unhandled rejection”, “Expo error overlay”, and “six live
subscriptions”. The retained cold probe at
`guide/eval-runs/2026-08-21/auth-transition-writes.md` loaded the recipe in 12
of 15 tool calls and passed; the extended deterministic retrieval check passed
all 73 cases.

Verification at closure:

- `node scripts/check-guide.mjs` under Volta Node 24.18.0 — 20 passed, zero
  failed/skipped/preconditions;
- `node scripts/check-retrieval-eval.mjs --check` under Volta Node 24.18.0 —
  73 cases, 5 Rosetta records, zero errors; and
- `./ref-check --verbose` — 297 LLP documents, 6,646 references in 14,451
  files, zero errors and zero unchecked references.
