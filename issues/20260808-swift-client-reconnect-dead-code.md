# Swift client never reconnects: `handleSocketLoss` cancels the task it runs inside

**Opened:** 2026-08-08 · **Severity:** P1 (correctness; live data silently freezes forever after any socket drop) · **Area:** clients/swift

## What

`clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift`

`handleSocketLoss()` (line ~743) is the reconnect/resubscribe driver. It is
only ever reached from inside `socketReadTask` (`socketReadLoop`, the `await
handleSocketLoss()` at ~688) or `heartbeatTask` (`heartbeatLoop`, ~734). Its
first statement is `closeLiveStream()` (~744), which does:

```swift
public func closeLiveStream() {
    socketReadTask?.cancel()
    heartbeatTask?.cancel()
    ...
}
```

That cancels the very task currently executing `handleSocketLoss`. The reconnect
loop immediately below is `while !Task.isCancelled { ... openLiveStream() ...
resubscribe ... }` (~749) — and `Task.isCancelled` is now `true`, so the loop
body **never runs**.

## Failure scenario

Any socket drop or missed freshness budget → subscriptions are marked
`.dropped`, phase goes `.recovering`, transports quiesce — and the client never
reconnects or resubscribes. The UI shows stale data indefinitely with no error
surfaced to the app.

## Why the tests miss it

The fixture corpus and `snapback-prove` exercise the abstract
`VirtualTransportSupervisor` / `ClientStateMachine` (the *policy*: backoff
floor/cap, freshness loss), never the networked `handleSocketLoss` /
`heartbeatLoop` implementation. This path has no coverage, which is exactly why
a dead-on-arrival loop shipped.

## Fix

Run the reconnect work outside the cancelled task's scope: either snapshot and
clear the task handles before `closeLiveStream()` cancels them, or spawn the
reconnect/resubscribe body in a fresh stored `Task` (so it can still be
cancelled by `shutdown`). Then add a loopback-WebSocket integration test that
kills the socket mid-subscription and asserts a fresh subscribe lands — the
class is currently untested.

## Confidence

High. Verified by reading the call sites and the cancellation semantics
(`Task.cancel()` sets `isCancelled` on the running task; execution continues to
the guard, which then short-circuits). No comment marks the behavior deliberate.
