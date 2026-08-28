# The packed external consumer loads two physical `@expo/snapback-client` copies

**Type:** Issue
**Status:** Resolved
**Systems:** cli, client, packaging, acceptance
**Author:** Claude (sbs-orchestrate supervisor)
**Date:** 2026-08-26
**Revised:** 2026-08-28
**Related:** LLP 0181 (package closure), LLP 0302 §1 (exact-object declared-dev
custody), `issues/closed/20260825-packed-dev-lifecycle-declared-dev-refused-preexisting.md`
  (the symptom-level repair: `c4206da52`)

## Problem

The packed lifecycle fixture materializes **two physical copies** of
`@expo/snapback-client` in one external consumer:

```text
external-consumer/node_modules/@expo/snapback-client/declared-dev-capability.mjs
external-consumer/react/node_modules/@expo/snapback-client/declared-dev-capability.mjs
```

They are byte-identical but distinct files with distinct module URLs, so each
evaluates its own module-private `stamps` / `generatedAppStamps` WeakMaps.
A generated app minted by one copy is unrecognizable to the other. That is the
declared-dev custody contract working exactly as designed (LLP 0302 §1 makes the
stamp unforgeable and module-private on purpose) — the defect is the duplicated
closure, not the check.

LLP 0181 expects one compatible client-package copy in an ordinary app closure.
This fixture violates that expectation.

## Why this is filed separately

The declared-dev refusal that surfaced it was fixed at the symptom level: the
importer now consults the exact-object capability only when it is actually
selecting the URL/declared-dev source, so an independently admitted binding no
longer consumes an inert foreign stamp. Two blind reviews (codex gpt-5.6-sol and
grok-4.6, both xhigh) returned READY with no MATERIAL finding and **both**
independently recorded that the root cause remains unfixed.

That scoping was deliberate and is defensible, but it leaves a live edge:
**any path that legitimately selects the declared-dev/URL arm under a duplicated
closure still refuses.** Supplying the backend origin to a consumer that resolves
a different physical copy than the one that minted its app reproduces the
original failure.

## Expected resolution

Deduplicate/hoist the packed closure so one physical `@expo/snapback-client`
instance serves the consumer, or have the consumer import the application client
from the same physical package instance that minted its generated app.

Do **not** resolve this by weakening custody. A process-wide `Symbol.for` brand,
a global registry, or name-based admission would each defeat LLP 0302's
unforgeable module-private mint; both reviewers named that explicitly as the
wrong repair.

## Open question for whoever takes this

Whether a real user's app closure can reach the two-copy state, or whether it is
an artifact of how the fixture materializes the scaffold inside the external
consumer. If a real closure can reach it (peer dependency skew, a nested install,
a package manager that does not hoist), this is a user-facing defect and not
only a fixture problem — that determination should come before the repair.

## Resolution

This is a **user-facing packaging defect**, although the fixture reached it by
an especially direct route. The fixture installed a complete `react/` project
under an already installed external harness and then crossed that project
boundary with the harness's client importer. Independently, the published
0.1.29 manifest made `@expo/snapback-client@0.1.29` and
`@expo/snapback-react@0.1.29` ordinary exact dependencies of
`@expo/snapback-expo`. A real app with an older directly installed client could
therefore retain that root copy while a package manager nested the facade's
0.1.29 dependency. Generated code would mint through the app-root copy and the
facade would consume through the nested copy. A no-hoist layout exposes the
same module split even without different bytes.

`@expo/snapback-expo` now declares both runtime owners as required
`workspace:*` peers. The publication staging path rewrites internal workspace
edges to the one exact candidate version, so a consumer resolves one shared
client/React instance or the package manager refuses an incompatible vector;
the facade no longer owns private runtime copies. The packed regression opens
the tarball and proves those exact peer edges are present and absent from
ordinary dependencies.

The packed lifecycle now hoists the nested React scaffold's client and React
adapter to the external consumer's materialized packages while leaving its
codegen/tooling packages within the scaffold's admitted project root. It
asserts that the scaffold, harness, CLI, Expo facade, and React adapter all
resolve one physical client manifest. The headless M1→M2 journey supplies only
the backend URL, exercising the real `declared-dev` selection arm successfully
through both generations. The module-private capability and its exact-object
custody checks were not changed.
