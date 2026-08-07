# React core profiles retain optional surface, command, and asset capability mass

**Status:** Open
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
