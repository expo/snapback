# Sessions-mode live updates are delivered three times per change

**Status:** Open
**Opened:** 2026-08-10 · **Severity:** P1 · **Area:** live queries · sessions auth · wire protocol
**Related:** LLP 0059, LLP 0060, Diary 0074, `demos/pointing-room`, `demos/card-game`

## Problem

On a sessions-mode server, every live-query update is pushed to a subscriber
**three times**: three byte-identical WebSocket frames, same subscription id,
same snapshot version, one socket, one subscription. A dev-mode server sends
one frame for the same logical change.

Measured 2026-08-10 with a stream-transport subscriber whose frames were
captured at the `WebSocket` boundary (binary `target/debug/snapback` @
`84dc1b6ee`; every run printed the `stamp-mismatch` provenance warning):

| Configuration | Envelope `kind` | Frames per change | Bytes each |
|---|---|---|---|
| dev + `defineLiveQuery` (`todo-v2` `listTodos`) | `live_replace` | **1** | 833 |
| sessions + `defineLiveQuery` (`card-game` `myHand`) | `authorization_invalidation` | **3** | 1979 |
| sessions + `defineJsLiveQuery` (`pointing-room` `liveTally`) | `authorization_invalidation` | **3** | 1874 |

Two independent findings are tangled here; both are reproducible.

### 1. Threefold delivery

Not a probe artifact: one `WebSocket` instance, one listener, three `message`
events carrying identical bytes at the same `snapshot.version`. It is **not**
specific to `defineJsLiveQuery` — the plain declarative `myHand` live query in
the shipped `card-game` demo shows it too, so this is a live-update path
property under sessions mode, not something the pointing-room demo introduced.

**Hypothesis tested and refuted:** that one frame is emitted per enabled auth
protocol (the client enables `authInvalidationProtocol`,
`authorityDescriptorProtocol`, and `authorizedLeaseProtocol` — three protocols,
three frames). Re-running with only `authInvalidationProtocol: 1` still
produced exactly three frames. Whatever multiplies, it does not track the
client's protocol opt-ins.

### 2. Envelope shape and payload size

Sessions-mode updates arrive as `authorization_invalidation` carrying
`obligation` + `resolution` + `snapshot`, rather than a data-shaped
`live_replace`. A pure data change — one participant casting a vote, nothing
touching authorization — is delivered in an authorization-invalidation wrapper
whose `maxDisposition` is `quarantine`.

Consequences:

- **Cost.** A one-row tally costs ~1.9 KB × 3 ≈ 5.6 KB per change versus 833 B
  in dev mode — roughly 6.7× the bytes for the same information, before any
  fan-out multiplier.
- **Legibility.** The obvious client assertion is wrong. The first
  `pointing-room` acceptance test asserted the revealing frame's `kind` would be
  `live_replace` and failed against real bytes. Anyone reading a sessions-mode
  stream will make the same guess.
- **Semantics.** It is not obvious to a reader whether a data-only change
  *should* carry an authorization obligation with a `quarantine` disposition, or
  whether that framing is incidental to how sessions-mode subscriptions
  register their obligation scope (see `src/local.rs` around the
  `issue_resolution` / `obligations.projection(&scope_id)` path).

## Reproduction

`/private/tmp/.../scratchpad/envelope-probe.mjs` and its `todo-envelope-probe`
/ `cardgame-envelope-probe` / `cardgame-oneproto-probe` variants (session-local;
re-create by subclassing `globalThis.WebSocket`, logging `JSON.parse(raw).kind`
plus `snapshot.version` per frame, and driving one mutation per phase). Prime
the codegen cache first — a fresh `card-game` run refuses with
`SNAPBACK_CODEGEN_CACHE_INVALID`.

## Desired resolution

- Root-cause the threefold emission. One correct frame per commit version per
  subscription is the expected contract; confirm whether the duplicates
  originate in obligation projection, in subscription registration issuing more
  than one scope, or in the stream writer.
- Decide whether a data-only change should be delivered as
  `authorization_invalidation` at all, or whether the obligation should ride
  alongside a `live_replace`-shaped payload. If the current shape is
  deliberate, document it in `guide/protocol/client-protocol.md` and say so on
  the live-query pages, because the natural client assumption is wrong.
- Add a regression asserting exactly one frame per commit version per
  subscription in sessions mode; nothing in the corpus currently counts frames,
  which is why 3× went unnoticed.
- Re-measure against a current-HEAD binary before acting. Every number here is
  bound to `84dc1b6ee`.

## Claim

- 2026-08-10: claimed for root-cause + fix + LLP 0094 delivery-multiplicity
  amendment by the pointing-room follow-up orchestrator (session fc5b2e2b,
  lane `lane-sess3x-20260810`). Frame-count regression and re-measurement on a
  current-HEAD binary are in the same lane. Please coordinate before starting
  competing work on this ticket.
