# guide-gap: the guide's first fresh-app command resolves to an unrelated npm package

**Status:** Closed 2026-08-09 — guide text repaired in this repository; reaches
external readers at the next published closure (see "Resolution")
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

## Retested at 0.1.17 — 2026-08-10 — still open, still bites verbatim

The LLP 0176 G4 external re-rerun ran the guide's literal instruction again from
an empty directory, 19 seconds after its frozen `t0`:

```text
$ npx --yes snapback new snapback-g4-chat --template expo-chat
npm error could not determine executable to run
```

Identical to the 0.1.16 observation, and it again cost the run its first author
decision (`D1` in the frozen OQ5 vector) before anything had been installed. The
guide's alternative, `npm create snapback-app`, again worked and scaffolded in
8 seconds.

The cost is now higher than it was, not lower: at 0.1.16 the run died later on a
packaging blocker, so this was one confusing step on a path that failed anyway.
At 0.1.17 the rest of the path is clean — 99 seconds to a generated,
type-checking app and 15 minutes to a committed, rendered image send, with zero
hand-edited files — so this refusal is now the **only** thing standing between a
new author and an unbroken paved path.

## Resolution — 2026-08-09

Fixed as a **guide-text** change. `guide/clients/react-expo.md`'s fresh-app
instruction now leads with the command the 0.1.17 quarry actually used after
its `D1` decision — `npm create snapback-app my-app` — with the package-manager
equivalents and the explicitly scoped
`npx --yes @expo/snapback-cli@latest new my-app --template expo-chat` beside it,
and a short paragraph naming the `npm error could not determine executable to
run` failure so a reader who already hit it recognises the cause. The bare
`npx snapback new …` spelling survives only in the existing-app flow further
down the page, where `@expo/snapback-cli` is already a project dependency.

**Claiming or shimming the unscoped `snapback` npm name was explicitly out of
scope for this fix.** The name belongs to a third party (`snapback@0.9.0`,
"DOM Undo/Redo", maintainer `lohfu`); acquiring it, or publishing a
same-named bin shim, is a registry/ownership decision, not a documentation
one. If that is ever wanted it needs its own ticket and its own owner. Nothing
here depends on it.

**Acceptance, item by item.**

- Fresh-app instruction works with nothing installed — done; the page leads
  with `npm create snapback-app` and offers the scoped `npx` form.
- `guide/guide-flat.generated.md` regenerated from the fixed source — done,
  along with `guide-flat.clients.generated.md` and the guide manifest.
- A guide check that the fresh-app command does not depend on an unscoped bare
  `snapback` bin resolution — done: `checkBootstrapResolvability` in
  `scripts/guide-lib.mjs`, wired into `scripts/check-guide.mjs`'s consistency
  pass. The rule is positional rather than lexical: a bare
  `npx [flags] snapback …` occurrence is an error unless the page has already
  mentioned the scoped `@expo/snapback-cli` package name above it. Verified
  against the exact pre-fix prose, which the check rejects, and the post-fix
  prose, which it accepts.

**Delivery boundary.** This repair is in the repository's guide corpus. The
published corpus an external author reads is generated from the closure's
source revision, so **the fix reaches external users only at the next release**
— exactly as the 0.1.12 residue-portability repair did. Anyone running the
current published 0.1.17 guide will still see the broken command until then.
No consumer action is needed on an existing app.

## Deferred registry question — answered 2026-08-10 (author ruling)

The Resolution above put "claiming or shimming the unscoped `snapback` npm
name" out of scope and said that if it were ever wanted it would need its own
ticket and its own owner. Charlie ruled on 2026-08-10 that it is **not**
wanted: Snapback goes with the `@expo` scope, and the unscoped name — owned by
the third-party `snapback@0.9.0` DOM undo/redo package — is not pursued, both
because it cannot be had on a fast timeline and because having *expo* in the
name is desirable in its own right.

So no successor ticket exists or will. The ruling is recorded at
[LLP 0041 §Amendment (2026-08-10): npm naming is settled on the `@expo`
scope](../../llp/0041-packaged-dev-loop.rfc.md), which owns packaging and
publication naming. The practical effect on this ticket's subject matter: the
guide-text fix landed here is the permanent mitigation, not a stopgap awaiting
a registry acquisition, and `checkBootstrapResolvability` should stay enforcing
rather than be relaxed later.
