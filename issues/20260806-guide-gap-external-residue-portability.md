# guide-gap: external Snapback state and restore lock are not documented as non-portable

**Status:** Open — source/guide repair in worktree, awaiting landing and a
published guide
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** CLI, Expo guide, EAS staging, External distribution
**Date:** 2026-08-06
**Related:** LLP 0176 §G4,
`issues/20260806-guide-gap-g4-live-0110-external-vector.md`

## Finding

The external 0.1.11 smoke left `.snapback.snapback.restore.lock` beside the
ignored `.snapback/` directory. The G4 transfer excluded the directory but
copied the sibling lock to the Air. It contains an absolute, host-specific
target-instance reservation, so the public supervisor refused before Metro:

```text
existing target-instance reservation is not the exact closed record for this target
```

A blank Expo scaffold and the React Expo guide named neither local-state form.
The first EAS stage-only copy likewise included the state/lock until the caller
provided explicit exclusions. This is portable-residue behavior the guide
should have prevented, so it is a `guide-gap`, not merely a proof-script typo.

## Source repair in this worktree

- `guide/clients/react-expo.md` now gives the two required ignore rules and
  explains that the sibling reservation is host-pinned.
- `demos/_kit/eas-stage-build.mjs` excludes `.snapback/`, the sibling restore
  lock, and `dist-*` exports by default.
- `demos/_kit/tests/repo-layout-unit.mjs` pins all three exclusions.

The external repository added the ignore rules and reran successfully without
patching a package. Keep this ticket open until the source repair lands and the
published guide containing it is available.

## Acceptance

- A documented external scaffold ignores both state forms before its first
  smoke run.
- Stage-only inspection excludes Snapback state/lock and all `dist-*` outputs
  without per-run knowledge of their names.
- The focused staging proof passes and the successor public guide carries the
  rule.
