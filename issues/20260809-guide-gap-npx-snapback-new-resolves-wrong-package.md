# guide-gap: the guide's first fresh-app command resolves to an unrelated npm package

**Status:** Open — found by the LLP 0176 G4 external rerun against live 0.1.16
**Impact:** 4
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** Guide, Packaging, Onboarding
**Date:** 2026-08-09
**Related:** [`guide/clients/react-expo.md`](../guide/clients/react-expo.md),
[LLP 0176 §G4](../llp/0176-expo-messaging-golden-path.plan.md),
[G4 0.1.16 receipts](../demos/expo-golden-path-fixture/receipts/20260809-g4-external-0116-summary.md)

## Symptom

`guide/clients/react-expo.md` opens its published Expo path with:

> For a **new** Expo app, start from the Expo-native `expo-chat` template
> instead of assembling packages by hand: `npx snapback new my-app --template
> expo-chat`, or `npm create snapback-app` …

An external author in an empty directory has no `@expo/snapback-cli` installed,
so `npx snapback` resolves the bare registry name `snapback` — an **unrelated
third-party package** (`snapback@0.9.0`, "DOM Undo/Redo", maintainer `lohfu`),
which has no `bin`. Observed verbatim, 1 second after the command:

```text
$ npx --yes snapback new snapback-g4-chat --template expo-chat
npm error could not determine executable to run
npm error A complete log of this run can be found in: …
```

The failure is confusing rather than merely unhelpful: the error blames the
executable, names no package, and gives an author no reason to suspect they
just downloaded someone else's library.

## Scope

Two source occurrences, in `guide/clients/react-expo.md` (the generated flat
guide mirrors both):

- **line 43** — the fresh-app instruction above. **Broken**: nothing is
  installed at that point.
- **line 88** — `npx snapback new ../snapback-backend-scaffold --template
  react`, inside the *existing Expo app* flow. **Correct**: by then
  `@expo/snapback-cli` is a local dependency and `npx` resolves the local bin.

The guide's own alternative, `npm create snapback-app`, is correct and
published at 0.1.16 (`create-snapback-app@0.1.16`, which depends on
`@expo/snapback-cli@0.1.16`). It scaffolded the template in 8 seconds.

## Why it matters more than a typo

This is the very first command in the guide's recommended path for a brand-new
app, and the paved path behind it is otherwise excellent — the G4 rerun reached
a generated, type-checking Sessions chat app in 89 seconds with zero
hand-edited files. Losing an author at command one, to a name collision with
somebody else's package, is a disproportionate cost.

## Acceptance

- Make the fresh-app instruction a command that works with nothing installed:
  lead with `npm create snapback-app my-app` (or an explicitly scoped
  `npx --yes @expo/snapback-cli@latest new my-app --template expo-chat`), and
  keep the bare `npx snapback new` spelling only where the CLI is already a
  local dependency.
- Regenerate `guide/guide-flat.generated.md` from the fixed source.
- Add a retrieval or guide check that the fresh-app command does not depend on
  an unscoped bare `snapback` bin resolution.
