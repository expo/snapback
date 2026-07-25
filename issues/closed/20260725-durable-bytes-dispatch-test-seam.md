# kit: durable_bytes dispatch-wiring needs an injectable test seam

**Opened:** 2026-07-25
**Source:** LLP 0093 Round-7 Fable review, Concern 1 (Moderate,
non-blocking per its own resolution) —
`llp/reviews/0093-client-protocol-and-native-clients.fable.md`.
**Systems:** Client SDK, Tests

`regression-durable-bytes-resync.mjs` exercises the production helper
(`dispatchDurableBytesFrame`) and the real registry recovery path, but
nothing exercises the four-line `#dispatch` interception itself — the
exact wiring whose absence was the original silent-staleness defect. A
future refactor that reorders `#dispatch`'s branches or drops the
interception would pass the existing test and silently regress
(the schema gate only pins that the kind is declared, not dispatched).
There is no injectable WebSocket seam (`new WebSocket` is constructed
inline in the stream manager).

## Fix

Add a debug seam on `LiveStreamManager` mirroring `debugCloseSocket`
(e.g. `debugInjectFrame(frame)`) that routes through the real message
path into `#dispatch`, and extend the regression test with a third half:
`durable_bytes` frame in at the seam → poison sentinel observed in the
registry (and, per the Round-7 suggestion, an assertion that the
sentinel carries the propagated authority capture). Alternatively fold
into LLP 0093 P-1's fixture work if that lands first.

## Resolution (2026-07-25) — RESOLVED with the LLP 0095 (P-1) landing

Exactly as prescribed. The live `message` listener's post-parse tail was
extracted into `LiveStreamManager.#receiveFrame(ws, frame)` (auth-error
short-circuit + authority-fence commit into `#dispatch`), shared verbatim
by the listener and the new `debugInjectFrame(frame)` seam — so the seam
exercises the REAL wiring, not a replica.
`demos/_kit/tests/regression-durable-bytes-resync.mjs` gained a third
section (suite is now 4 checks): a `durable_bytes` frame injected at the
seam on a `transport: 'stream'` handle surfaces exactly one connection-wide
clear-retained poison sentinel in the lane registry, carrying a
synthetically-set stream authority capture (asserted via
`db.authorityCaptureFor(sentinel)`, non-vacuous on the fenceless dev arm),
and drives the real registry consumer to `resubscribed`. Suite passes 4/4;
`provider-live-conformance` (14/14) and the socket-path regressions
(handshake-loss, multiplexed-lanes, midflight-resync) confirm the listener
refactor changed no behavior.
