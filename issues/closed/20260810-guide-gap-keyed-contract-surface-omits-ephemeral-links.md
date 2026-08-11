# guide-gap: keyed Contract surface returns no generated ephemeral links

**Status:** Closed
**Opened:** 2026-08-10 · **Severity:** P2 · **Area:** Contract/Exact adapter · realtime
**Related:** LLP 0034, LLP 0052, Diary 0074, `demos/pointing-room`

## Problem

`createSnapbackContractSurface({ keyedQueryScopes: true })` returns keyed
durable query/mutation links but **no generated ephemeral read/publish links**.
A Contract component that declares both a keyed durable query and
`ephemeral presence = roomPresence(...)` therefore cannot boot from the
returned link object alone.

Nothing in `guide/clients/contract-adapter.md` says this. The page presents
keyed scopes and ephemeral channels as independent bullets on the same surface,
so the natural reading is that the keyed surface yields the whole link family.
The limitation was discovered only by reading the keyed branch in
`packages/snapback-contract/index.mjs`.

Building `demos/pointing-room`, the working composition was: create a companion
surface with empty durable query allowlists, take only its generated ephemeral
links, and merge those under the keyed durable links before configuring the
generated registry. That is host glue in `main.ts` — a Contract component can
express the *binding* (`roomPresence({ roomId: activeRoomId })`) but its
provider boot cannot be assembled from the documented path.

## Desired resolution

Decide which of these the product intends, then make the guide say it:

- **Product fix** — the keyed branch also returns generated ephemeral links, so
  one surface boots a component that uses both. Preferred; the two-surface
  merge is a seam authors should not have to know exists.
- **Documented composition** — if the split is deliberate, the adapter page
  needs an explicit "keyed scopes + ephemeral together" recipe with the
  companion-surface pattern and the reason for the split, plus a capability-index
  row so the limitation is discoverable before an author designs around it.

Either way a refusal would help: booting a keyed surface whose Contract manifest
declares an ephemeral collection should diagnose the missing link family by name
rather than failing at first use.

## Resolution (2026-08-10)

Implemented the product fix. Keyed surfaces now reuse the ordinary swappable
ephemeral wiring, return generated read/publish links, prewarm and dispose that
wiring, and swap it through the authority barrier. Construction refuses with
`SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED` when the client cannot serve the
required link family. Pointing Room now boots one keyed surface and configures
the generated registry from that surface alone. The implementation note is LLP
0034 §10.11; focused coverage lives in
`packages/snapback-contract/keyed-ephemeral-links.test.mjs`.
