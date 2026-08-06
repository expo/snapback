# Local source packages resolve an unpublished Contract dependency from npm

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Packaging, React/Expo client, Developer experience
**Date:** 2026-08-05
**Related:** `issues/20260803-first-npm-latest-promotion.md`, LLP 0122

## Problem

An Expo application consuming Snapback directly from this source checkout
cannot install the natural local pair by itself:

```json
{
  "@expo/snapback-client": "file:../../../packages/snapback-client",
  "@expo/snapback-react": "file:../../../packages/snapback-react"
}
```

`packages/snapback-client/package.json` declares an exact registry dependency
on `@expo/snapback-contract@0.1.0`. Bun preserves that dependency edge when the
client itself comes from a local `file:` path, tries to resolve Contract from
the registry, and stops because the matching package is unpublished. The
source checkout contains the compatible Contract package, but the nested app
does not inherit the repository workspace's resolution automatically.

Relay Room could install only after adding both:

```json
{
  "dependencies": {
    "@expo/snapback-contract": "file:../../../packages/snapback-contract"
  },
  "overrides": {
    "@expo/snapback-contract": "file:../../../packages/snapback-contract"
  }
}
```

Evidence is retained in
`demos/relay-room-bakeoff/snapback-expo/package.json` and its `bun.lock`, which
shows the client's Contract edge rewritten to the local file package. The
build experience is recorded in
`diaries/0058-relay-room-expo-backend-bakeoff.diary.md`.

## Why this is a separate bug from npm promotion

Publishing the current nine-package closure would happen to satisfy this exact
`0.1.0` registry lookup. It would not make local source consumption hermetic:
a checkout whose internal package versions move ahead of the registry can hit
the same failure or, worse, mix local client code with an older registry
Contract. A documented source-checkout path should resolve one coherent
checkout closure without requiring every demo to rediscover transitive local
overrides.

## Acceptance

- A nested Expo fixture can cold-install the documented local Snapback client
  and React packages without a manual direct Contract dependency or override.
- Every internal runtime dependency resolves from one coherent source: all
  local checkout packages for the source workflow, or one published versioned
  closure for the registry workflow. The install must not silently mix them.
- Add a cold-install regression for the supported source-checkout package
  manager and document the intended local dependency command.
- The published-closure rehearsal independently proves that the same consumer
  installs without local paths after npm promotion.
