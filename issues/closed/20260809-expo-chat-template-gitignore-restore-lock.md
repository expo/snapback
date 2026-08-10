# expo-chat template `.gitignore` omits the sibling restore lock

**Status:** Closed 2026-08-09 — all five templates carry the rule and a package
test pins it; ships to authors with the next closure
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

## Retested at 0.1.17 — 2026-08-10 — still open, still bites

The `expo-chat` template scaffolded by `create-snapback-app@0.1.17` still ships:

```gitignore
.snapback/
.expo/
dist/
node_modules/
snapback/generated/*
!snapback/generated/artifacts.json
```

with no `*.snapback.restore.lock` line. Severity is unchanged and still low: the
G4 re-rerun's two host transports used explicit `rsync --exclude` lists and the
EAS staging helper excluded the lock (verified again in the 0.1.17 stage-only
inspection, 88 files / 0.69 MiB), so no lock crossed a host boundary. The
exposure remains a hand-rolled copy or archive that does not use the helper.

## Resolution — 2026-08-09

`*.snapback.restore.lock` now sits directly beneath `.snapback/` in every
scaffold template's `gitignore.template`, not just `expo-chat`:
`crud-dashboard`, `expo-chat`, `media-feed`, `react`, and `todo-contract`. The
acceptance asked for the other four to be checked and fixed together; all four
had the same omission.

The rule is pinned so it cannot silently drop out again.
`packages/snapback-cli/package.test.mjs` already walked every template
directory to enforce the `gitignore.template` carrier convention (npm-packlist
strips literal `.gitignore` files from the tarball); that same loop now asserts
each template ignores **both** local-state forms, `.snapback/` and
`*.snapback.restore.lock`, with the reason stated inline — the lock is a
*sibling* of the state directory, so `.snapback/` never covered it.

`guide/clients/react-expo.md` gains one sentence next to the existing ignore
rule saying the templates ship both, so an author scaffolding from
`npm create snapback-app` knows the hand-edit is only for a retrofit.

Nothing else in the repository embeds these bytes: the guide corpus states the
rule as prose rather than transcluding the template, and no publication
inventory or closure manifest digests template file contents. The change
therefore reaches authors with the next published closure, exactly as the
acceptance predicted, and needs no consumer action on an existing app.
