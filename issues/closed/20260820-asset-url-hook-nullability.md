# Asset URL hooks disagree on absent asset identifiers

**Status:** Closed
**Opened:** 2026-08-20
**Resolved:** 2026-08-21
**Systems:** React/Expo, Assets, Generated types, Diagnostics
**Related:** LLP 0114; LLP 0210; LLP 0277 P23; LLP 0295; Diary 0100
**Landing SHA:** TBD

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

## Resolution

`null` and `undefined` now select a stable inert issued-URL store owned by the
framework-neutral asset client. `useSnapbackAssetUrl` accepts that nullable
spelling unconditionally, transitions absent → present → absent without issuing
for either absent state, and keeps empty-string input as a contract error that
names the nullable spelling. LLP 0210's state algebra, LLP 0114's named-
projection ledger, the assets guide, generated API references, and focused type
and runtime fixtures were updated with the implementation.

**Review note (2026-08-21):** adding `empty` to `AssetIssuedUrlStatus` widens
the public status union — a consumer exhaustively switching the previous
five states would need a new arm. Ruled intentional under the repository's
publication posture (no stability dependents; the state is semantically
real); no input-dependent overloads were added.
