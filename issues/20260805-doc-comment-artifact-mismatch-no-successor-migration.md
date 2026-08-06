# A documentation-only comment change wedges the local edit/restart loop

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 2
**Confidence:** 5
**Systems:** CLI, Developer experience, Local server lifecycle, Deployment identity
**Date:** 2026-08-05
**Governing:** LLP 0041, LLP 0058, LLP 0174
**Related:** LLP 0176; `issues/20260805-managed-dev-multi-json-load.md`; Diary
0059 ("Snapback experience")

## Problem

In `demos/tandem-expo-bakeoff`, editing only an `@ref` documentation comment in
a function file changed the complete generated artifact identity (the
source-byte deployment-identity contract is working as designed — see LLP
0058/LLP 0174). Restarting the local dev loop against the existing SQLite
session store then correctly refused with
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`.

The refusal itself is correct: strong deployment-identity pinning is the
intended behavior, and silently admitting a superset function surface would be
worse. The gap is that the dev loop has no supported next step once that
refusal fires. There is no automatic local migration, reseed, or "activate this
complete valid successor and keep my local data" path — the only way forward
found during the bakeoff was to manually move the old SQLite file aside under
an ignored `.local-backups/` directory and reseed from scratch, discarding
local session/product state for a change that was, in this case, a comment.

This makes the ordinary edit/restart loop meaningfully more expensive than it
needs to be: a one-line comment edit should not cost a full local database
reset, even though the underlying identity pinning must remain strict.

## Fix shape

This is the same gap RFC LLP 0176 §6 ("One supervised Expo development loop")
names as required behavior — this ticket makes it a concrete, reproduced
mechanical case rather than only a design requirement:

- [ ] When the supervisor detects a new complete, valid function/schema
  successor at restart, it should offer (or, in a scriptable dev context,
  perform) a live successor activation that preserves the local database,
  rather than requiring the author to notice the refusal and hand-roll a
  backup/reseed. (Open — the larger LLP 0176 §"One supervised Expo development
  loop" work.)
- [ ] Keep the correctness property that an incomplete or invalid successor is
  refused outright — this is only about the case where the new artifact is a
  complete, valid, loadable successor. (Verified by the automatic-activation
  rung when it lands; the pin itself remains fail-closed today.)
- [x] If automatic activation is out of scope short-term, at minimum the
  refusal's repair message should name the supported migration command instead
  of leaving the author to discover the manual backup/reseed workaround.
  (Landed 2026-08-05 — see note below.)

## Acceptance

- Editing only a documentation comment and restarting the local dev loop does
  not require manually relocating or deleting the local database.
- An incomplete or genuinely incompatible successor still refuses startup with
  the existing `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`-style diagnostic.
- The diagnostic's repair step names the supported path, whatever it is,
  instead of leaving local-state recovery to author intuition.

## Notes

**2026-08-05 — repair-message rung landed** (branch
`fix/artifact-mismatch-repair-message`). No successor/migrate/reseed command
exists today, so the refusal now spells out the two supported procedures
itself, on both surfaces:

- Native (`src/cli.rs`): the settled-sessions pin refusal
  (`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`, "startup artifact pair differs
  from the pinned deployment") now carries a structured `details.repair`
  object alongside the expected/observed identities — `keepData` (restart on
  the carrier matching `expectedDeployment`, then apply the changed sources
  through the running server's `snapback dev` watch reload), `reseedFresh`
  (back up with the real `snapback auth backup --db <db> --output
  <ignored-backup-dir>` command naming the exact store, move/delete the
  database file, restart on the new carrier), and `safety` (the pin is
  auth-mode state per LLP 0058, not a runtime/codegen defect). It rides the
  existing `snapback.startup-diagnostic.v1` stderr line.
- Managed (`packages/snapback-cli/index.mjs`): the refined pin diagnostic's
  `recovery` block gains `freshReseed` with the same backup-then-reseed
  procedure, printing the managed store's exact path.
- Tests: `settled_sessions_pin_refusal_names_supported_repair_paths`
  (`src/cli.rs`) reproduces the doc-comment case (bundle identity rotated,
  schema unchanged) and asserts the repair text;
  `packages/snapback-cli/sessions-dev-loop.test.mjs` now asserts
  `recovery.freshReseed` names the backup command and the exact database.

The ticket stays **open**: the automatic successor-activation rung (first
bullet) is the remaining work.
