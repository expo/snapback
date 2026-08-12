# snapback-vite websocket relay is black-holed when Vite runs under `bun --bun`

**Status:** Open
**Severity:** P1
**Systems:** snapback-vite, dev loop, live streams, ephemeral
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-12
**Related:** Aurora `llp/0002-global-chat.rfc.md`; Aurora `llp/0003-peer-repo-dependencies.decision.md`

## Problem

The `/__snapback/live/{connection_id}/stream` upgrade relay in
`packages/snapback-vite/proxy.mjs` spliced raw TCP: it wrote the request head
to a `net.connect` socket and `pipe`d the two sockets together. Under
`bun --bun vite` (which Exact Contract surfaces require, because the Exact
packages ship TypeScript source that Node cannot load), Bun's `node:http`
shim hands the `'upgrade'` listener a socket whose **writes are silently
dropped**: `socket.write(...)` returns `true`, `socket.writable` is `true`,
but zero bytes reach the client. Every browser live stream then fails with
`WebSocket is closed before the connection is established`, ephemeral
subscribe times out after 15s (`SNAPBACK_LIVE_STREAM_READINESS_TIMEOUT`),
and `createSnapbackContractSurface` stalls ~15s on attach.

Verified by instrumentation on 2026-08-12 (Aurora global-chat build, base
commit `d6fc55d7f97798591ec68d3490c489375ae840dc`): the tunnel received the
backend's HTTP response bytes and wrote them to the browser socket, which
never transmitted them. A direct-write probe from inside the upgrade handler
confirmed the black hole independent of piping. Meanwhile Vite's own HMR
websocket works under the same process because the `ws` package resolves to
Bun's native implementation.

## Fix applied (committed with this ticket)

`proxy.mjs` now relays at the websocket layer instead of the TCP layer: a
`WebSocketServer({ noServer: true })` completes the browser handshake via
`handleUpgrade` (the same path Vite HMR uses, which Bun supports), and a `ws`
client connects to the backend stream, with messages forwarded both ways,
close codes propagated (guarded for 1005/1006), the existing
one-shot `refreshTarget` retry preserved, and backend HTTP-level rejections
(`unexpected-response`) closing the browser socket. `ws@^8.18.0` was added to
`packages/snapback-vite/package.json` dependencies.

Behavior notes: hop-by-hop and `sec-websocket-*` request headers are not
forwarded (the ws client negotiates its own), and the 403 allowlist refusal
still attempts its diagnostic body write (a no-op under Bun) before
destroying the socket.

## Acceptance criteria (remaining before close)

- Witnessed so far: Aurora's global chat exercised the relay end to end under
  `bun --bun` (live queries, ephemeral typing subscribe/publish, two
  concurrent browsers) on 2026-08-12 — a manual witness, not a committed test.
- Still owed: a repository test covering the relay under Bun (or a documented
  standing witness), a Node-path regression check, and a guide sweep for any
  prose describing the retired TCP splice.
