# React core profiles retain optional surface, command, and asset capability mass

**Status:** Closed
**Impact:** 3
**Urgency:** 2
**Ease:** 2
**Confidence:** 4
**Systems:** Client integration, React/Expo, Packaging
**Date:** 2026-08-06
**Related:** LLP 0114, LLP 0145, LLP 0179, LLP 0180,
`issues/closed/20260805-static-capability-composition.md`,
`issues/20260806-client-bundle-ratchet-red-on-main.md`

## Problem

The client-bundle ratchet disposition found that the existing
`react-external` and `external-react-application` query/mutation profiles retain
the complete LLP 0179 surface composition and LLP 0180 command/asset client.
After the unrelated development-only HMR re-admission path is split out, the
largest retained modules are still:

- `packages/snapback-react/index.mjs` (about 49.1 kB minified ownership);
- `packages/snapback-client/assets.mjs` (about 14.7 kB); and
- `packages/snapback-client/commands.mjs` (about 9.8 kB).

This is not a dead import under today's root API. `SnapbackProvider` creates a
provider whose synchronous `provider.surface(...)` projection can expose a
command, and LLP 0180 requires command `start()`/`retry()` to synchronously
return the stable task object. A literal asynchronous import cannot remove
that implementation while preserving the current root contract.

## Desired outcome

Design a static capability composition for React that gives query-only users a
narrow entry without creating a second registry or weakening LLP 0114's
single-owner rules. Plausible shapes include a new narrow React entry plus a
Full compatibility composition, or a generated composition that selects
surface/command/assets capability at build time. Preserve the existing root
entry and synchronous command task semantics.

Add positive and negative metrology profiles proving the chosen narrow entry
excludes surface, command, and asset modules. Do not mutate the historical
client-bundle receipts; record any new entry prospectively.

## Resolution (2026-08-10)

Added `@expo/snapback-react/core` as the static provider/query/mutation/
optimistic-create/presence/outbox composition. It constructs over the same
prepared-binding `createRegistry` owner as the Full package root but omits the
surface, command, and asset provider decoration. The root remains compatible
and preserves synchronous surface and command-task semantics. A narrow
`@expo/snapback-client/react-binding` subpath prevents the core composition
from reaching the client's Full barrel.

Metrology now carries three negative core profiles and one positive Full
profile. All core closures retain the shared React implementation and
literally exclude `full-capabilities.mjs`, `commands.mjs`, and `assets.mjs`;
the Full positive profile contains all three. Against the committed
pre-change root profiles:

- query: 114,826 → 61,681 minified (−53,145), 34,830 → 19,329 gzip
  (−15,501), 30,450 → 16,951 Brotli (−13,499);
- query + mutation: 115,001 → 62,605 minified (−52,396), 34,883 →
  19,586 gzip (−15,297), 30,483 → 17,173 Brotli (−13,310).

The Full compatibility profiles also tightened slightly, so no existing
ceiling needs a rollover. Historical receipts remain byte-identical. The new
profile set is declared for prospective
`baseline.react-core-composition.v1.json`; source-bound receipt minting waits
until the implementation and instrument have a reachable commit.
