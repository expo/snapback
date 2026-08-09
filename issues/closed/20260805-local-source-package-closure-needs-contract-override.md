# Local source packages resolve an unpublished Contract dependency from npm

**Status:** Resolved
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Packaging, React/Expo client, Developer experience
**Date:** 2026-08-05
**Related:** `issues/closed/20260803-first-npm-latest-promotion.md`, LLP 0122

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

## Resolution scope (2026-08-05)

The source-checkout half is implemented. The supported consumer command is:

```sh
node scripts/install-local-snapback-packages.mjs <expo-app-directory>
```

It discovers the client/React internal runtime closure, packs it into
app-local tarballs, writes local roots plus top-level local overrides, removes
the need for a manually authored direct Contract dependency, and installs with
the checkout-pinned Bun. The regression at
`scripts/local-source-package-closure.test.mjs` copies a nested Expo fixture,
cold-installs it against an unreachable registry with an empty cache, imports
both package roots, deletes `node_modules`, and repeats under
`--frozen-lockfile`; its lock assertions require client, React, and Contract to
resolve only through local `file:` entries. The registry-publish manifests and
their exact-version closure proofs are unchanged.

At that checkpoint, the ticket remained open only for its final
published-closure acceptance bullet.
`issues/closed/20260803-first-npm-latest-promotion.md` owned publishing the terminal
package generation and the independent clean consumer rehearsal with no local
paths or overrides.

## Resolution (2026-08-09)

The final published-closure acceptance bullet is satisfied by
`scripts/published-closure-rehearsal.test.mjs`. The network-only regression
copies the same nested Expo fixture as the source-checkout proof, removes its
local stubs, and cold-installs exact public dependencies on
`@expo/snapback-client` and `@expo/snapback-react` with checkout-pinned Bun
1.3.12 and a new empty cache. The consumer has no `file:` paths, no overrides,
and no direct `@expo/snapback-contract` dependency. The resulting Bun lock must
contain exactly one registry record each for client, React, and the transitive
Contract package, all at the selected coherent version, and both public package
roots must import.

The rehearsal is registered in `.github/workflows/public-package-proof.yml`
for terminal-scope publication ledgers, using the ledger's exact version. It is
deliberately absent from `scripts/verify-local-proof` and its offline selection
policy because it contacts the public npm registry.

The real registry run completed successfully on 2026-08-09:

```sh
export PATH="$HOME/.volta/tools/image/node/24.18.0/bin:$PATH"
SNAPBACK_PUBLISHED_CLOSURE_VERSION=0.1.15 \
  node --test scripts/published-closure-rehearsal.test.mjs
```

Result: 1 test passed, 0 failed, in 15.6 seconds. The installed
`@expo/snapback-client`, `@expo/snapback-react`, and transitive
`@expo/snapback-contract` package records and package manifests all resolved to
public registry version 0.1.15, and both requested roots imported successfully.
