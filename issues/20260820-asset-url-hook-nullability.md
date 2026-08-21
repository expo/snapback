# Asset URL hooks disagree on absent asset identifiers

**Status:** Open
**Opened:** 2026-08-20
**Systems:** React/Expo, Assets, Generated types, Diagnostics
**Related:** LLP 0114; LLP 0210; LLP 0277 P23; LLP 0295; Diary 0100

## Problem

`useSnapbackAssetUrl` accepts a non-null `string` and throws when callers pass
the common placeholder `?? ""`, while sibling `useSnapbackAssetImage` accepts
`string | null`. Optional media rendering therefore either violates hook order
or calls a hook with an invalid sentinel. The thrown message is clear, but the
surface provides no consistent absent-asset contract.

## Requested repair

- Choose and document one absence spelling (`null` or a typed `skip` sentinel)
  across asset projection hooks.
- Preserve hook order and ensure absence performs no issuance or refresh work.
- Add type and runtime tests for absent -> present -> absent authority changes.

## Exit

An optional image/video component calls the hook unconditionally with a typed
absence value and receives a stable empty state without throwing or issuing.
