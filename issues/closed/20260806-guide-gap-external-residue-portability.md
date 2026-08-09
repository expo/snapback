# guide-gap: external Snapback state and restore lock are not documented as non-portable

**Status:** Closed 2026-08-09 — repair `a951074e4`, carried by the `0.1.12`
closure corpus and every closure since, through `0.1.15`
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** CLI, Expo guide, EAS staging, External distribution
**Date:** 2026-08-06
**Related:** LLP 0176 §G4,
`../20260806-guide-gap-g4-live-0110-external-vector.md`

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

## Note (2026-08-07)

The source repair is fully landed on main (verified at origin/main
f4d4d8c18): `guide/clients/react-expo.md` gives the two ignore rules
(`.snapback/`, `*.snapback.restore.lock`) and the host-pinned-reservation
explanation; `demos/_kit/eas-stage-build.mjs` excludes `.snapback`, the
sibling restore lock, and `dist-*` by default; and
`demos/_kit/tests/repo-layout-unit.mjs` pins all three exclusions. The
0.1.11 rerun receipt (commit a951074e4) records the iOS and EAS arms PASS.
Absorption addendum this pass: `guide/capabilities.md` `clients.react-expo`
aliases now include the miss vocabulary (restore lock, .snapback gitignore,
copy project) so the index reaches the page from either register.

The guide bytes carrying the rule landed after the 0.1.11 closure was built
(a951074e4 at 18:12 vs the cf47cc3b7 publish close-out at 17:05 on
2026-08-06), so the *published* (server-embedded) guide at 0.1.11 does not
contain them. Remaining acceptance is release-lane, not docs: the next
published closure (> 0.1.11) embeds the current corpus through the ordinary
promotion lane. Keep open until that publish; close with a pointer to the
closure version that carries the rule.

## Resolution (2026-08-09) — carried by the 0.1.12 closure corpus and newer

**Resolving commit:** `a951074e47839c741663f4f496178c3c6c0738a2`
(2026-08-06 18:12 PDT) — the same commit added the two ignore rules to
`guide/clients/react-expo.md`, the `.snapback/` / sibling restore-lock /
`dist-*` exclusions to `demos/_kit/eas-stage-build.mjs`, and the three
exclusion pins in `demos/_kit/tests/repo-layout-unit.mjs`.

**First published version:** `0.1.12`. The remaining acceptance here was
release-lane, and the 2026-08-07 note stated it exactly: the guide bytes landed
at 18:12 on 2026-08-06, after the 0.1.11 publish close-out at 17:05, so the
0.1.11 closure could not carry them. The 0.1.12 closure was built from
`fad3d53922e920d9cdc23a2b5b9cad84e3c872c0`, and
`git show fad3d53922:guide/clients/react-expo.md` contains the
`*.snapback.restore.lock` rule at line 230 beside `.snapback/`. Every closure
since — 0.1.13, 0.1.14, 0.1.15 — carries it too; `latest` is `0.1.15`.

Stated precisely, because the distinction matters for future closes: the npm
tarballs do not embed the `guide/` corpus (a grep of the packed
`@expo/snapback-cli@0.1.15` and `@expo/snapback-expo@0.1.15` for
`snapback.restore.lock` matches only `comparator-profile.mjs`; the shipped
`skills/snapback-authoring/SKILL.md` does not carry the rule). "The published
guide" for this ticket means the guide corpus at the published closure's source
revision, which is what an external reader is directed to and what the docs
projection is generated from. That corpus has carried the rule since 0.1.12.

**Acceptance, item by item.**

- A documented external scaffold ignores both state forms before its first
  smoke run — landed and published (guide rule, 0.1.12+).
- Stage-only inspection excludes Snapback state/lock and all `dist-*` outputs
  without per-run knowledge of their names — landed
  (`demos/_kit/eas-stage-build.mjs`), pinned by
  `demos/_kit/tests/repo-layout-unit.mjs`.
- The focused staging proof passes and the successor public guide carries the
  rule — the proof passed in the 0.1.11 rerun (`a951074e4`: the repaired
  stage-only inspection contained 42 app/registry-input files with no state,
  restore lock, export, source edge, or Git ancestor), and the successor guide
  is 0.1.12+.

No G4-rerun residue is left here: the fresh-quarry rerun exercises these rules
again, but it does so as part of its own acceptance, not as an open item on
this ticket.
