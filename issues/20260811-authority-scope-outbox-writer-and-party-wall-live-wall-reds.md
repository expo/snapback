# Acceptance reds at main: authority-scope SNAPBACK_OUTBOX_NOT_WRITER; party-wall live-wall row empty

**Filed:** 2026-08-11 (ship run `llp0231-visibility-20260811`, Lane E1 verification)

Two acceptance suites fail on a bootstrapped worktree at base `952fcaa3a^`
(origin/main era 5c5f43db3), own binary, primed codegen:

1. `demos/card-game/tests/acceptance/authority-scope.mjs` — fixture install
   dies with `SNAPBACK_OUTBOX_NOT_WRITER` (client store single-writer
   ownership not held; `packages/snapback-client/rqs-store-file.mjs:477`).
   Possibly interaction with the recently landed writer-gate seam
   (LLP 0225 owner-#5) or another session's watchdog on this shared machine.
2. `demos/party-wall/tests/acceptance/headless.mjs` — 11/12; "the canonical
   handler attach lands the post on the live wall" gets `[]`.

Both reproduce identically at the pre-change base with the same binary, so
they are NOT caused by the asUser-kit extraction (landed on top). Confirmed by
an independent reviewer's parent-commit run as well. Needs triage: real main
red vs machine-environmental (fleet load / stale watchdog); reproduce on a
quiet machine, then fix-forward or close as environmental with the recipe.
