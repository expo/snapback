# snapback2: slow SSE clients create unbounded event queues

**Status:** Open
**Systems:** snapback2, HTTP, SSE, resource handling
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/serve.rs:259-299

Failure scenario: an admitted channel subscriber opens SSE and stops reading while an admitted publisher repeatedly sends near-1MiB payloads. The socket writer blocks, but every payload is cloned into the subscriber's unbounded queue until the owner is OOM-killed. Live-query queues have the same unbounded behavior.

Why it happens: both routes use std::sync::mpsc::channel, producers call non-blocking unbounded send, and respond_sse at lines 358-418 has no socket write deadline. Disconnect cleanup occurs only after the blocked write returns.

Suggested fix: use byte/event-bounded queues, coalesce superseded live-query frames, disconnect slow channel subscribers on try_send overflow, and set write deadlines. Add a non-reading socket stress test with a fixed memory/queue ceiling.
