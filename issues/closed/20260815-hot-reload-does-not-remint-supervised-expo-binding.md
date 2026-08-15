# Hot-loading a changed function file does not remint the supervised Expo binding

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-explicit` (0.1.21) ·
**Systems:** CLI/dev supervisor, Expo client, Admission

## Problem

Hot-loading a changed `functions.mjs` regenerated the descriptor identity,
but the already-supervised Expo binding kept the stale digest, so every
final function change required an exact supervisor restart before the app
could call the new surface. The dev loop's core promise — edit a function,
see it live — breaks exactly at the seam that makes Snapback's supervised
binding distinctive.

## Evidence

- `lanes/sol-snapback-explicit/diary.md` M2 ("Hot-loading a changed
  function file regenerated the descriptor identity but did not remint the
  supervised Expo binding; each final function digest required an exact
  supervisor restart") and `final-report.md` correction-loop table
  (tooling: "stale supervised descriptor binding").

## Suggested fix

On descriptor-identity rotation, the supervisor should re-admit or remint
the supervised binding (or push an invalidation the Expo arm honors) so the
running client converges without a restart. Add a dev-loop test: boot
supervised Expo, edit a function, assert the new digest is callable without
restarting the supervisor.

## Resolution

Resolved 2026-08-15. At each successful `generated-and-loaded` cut, the Expo
dev supervisor reads the successor descriptor and remints its binding when
the descriptor identity changed, preserving the route and supervisor
generation while publishing the new exact digest through the exchange.
`packages/snapback-cli/expo-dev-loop.test.mjs` boots supervised Expo against
the real runtime, edits `functions.mjs`, proves the backend PID and supervisor
generation stay fixed, boots from the rotated exchange, and calls and
observes the successor mutation without restarting the supervisor.
