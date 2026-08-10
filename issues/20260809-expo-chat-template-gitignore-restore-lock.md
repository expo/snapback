# expo-chat template `.gitignore` omits the sibling restore lock

**Status:** Open — minor; found by the LLP 0176 G4 external rerun against live
0.1.16
**Impact:** 2
**Urgency:** 2
**Ease:** 5
**Confidence:** 4
**Systems:** Templates, Expo, Guide
**Date:** 2026-08-09
**Related:** [`closed/20260806-guide-gap-external-residue-portability.md`](./closed/20260806-guide-gap-external-residue-portability.md),
[`guide/clients/react-expo.md`](../guide/clients/react-expo.md),
[G4 0.1.16 receipts](../demos/expo-golden-path-fixture/receipts/20260809-g4-external-0116-summary.md)

## Symptom

`guide/clients/react-expo.md` tells authors to ignore **both** local-state
forms before copying, staging, or archiving an app, because the sibling restore
lock records an absolute target-instance reservation and is not portable
between hosts:

```gitignore
.snapback/
*.snapback.restore.lock
```

The scaffolded `expo-chat` template's `.gitignore` carries only the first:

```gitignore
.snapback/
.expo/
dist/
node_modules/
snapback/generated/*
!snapback/generated/artifacts.json
```

## Why it matters

A host-pinned `.snapback.snapback.restore.lock` crossing a host boundary is
exactly what broke the first 0.1.11 iOS run
([residue ticket](./closed/20260806-guide-gap-external-residue-portability.md)),
and the guide rule added afterwards is the fix. The template — now the guide's
recommended starting point for every new Expo app — does not carry it, so a new
author gets the paved path without the paved-path protection.

## Severity is genuinely low

The EAS staging helper excludes `.snapback.snapback.restore.lock` explicitly
(verified in the 0.1.16 stage-only inspection), and this rerun never produced a
lock because no backend ever started. The exposure is a hand-rolled `rsync`,
`cp -R`, `git add`, or archive that does not use the helper — which is what the
0.1.11 transport did.

## Acceptance

- Add `*.snapback.restore.lock` to
  `packages/snapback-cli/templates/expo-chat/gitignore.template`.
- Check the other templates (`react`, `crud-dashboard`, `media-feed`,
  `todo-contract`) for the same omission and fix them together.
- Ships with the next closure; no consumer action needed on an existing app
  beyond adding the line.
