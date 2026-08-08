# Process-global StreamAttemptRegistry only ever grows — no in-memory eviction

**Opened:** 2026-08-08 · **Severity:** P2 (resource leak; unbounded memory on streaming-action workloads) · **Area:** server / streaming actions

## What

`src/stream_attempt.rs`

`RegistryInner` holds `by_token`, `by_client_key`, `by_invocation`, `by_cursor`,
and `dirty` maps (~211). The only `.remove()` in the file is
`inner.dirty.remove(token)` (~437). `settle` / `terminalize_invocation` mark
records terminal but never evict them, and `by_invocation` is keyed by a fresh
UUID per detached streaming invocation (server.rs ~2672), so it gains a new
entry per invocation forever. The global registry (~693) lives for the process
lifetime.

## Failure scenario

A long-running server whose app uses streaming actions accumulates one
`AttemptRecord` per client_key plus one `by_invocation` set entry per streaming
invocation, indefinitely. Memory grows without bound until restart, and
`dirty_snapshots` iterates the full dirty set per flush. A durable-row startup
reconciler exists, but nothing prunes the in-memory side.

## Fix

Evict terminal records — and their `by_client_key` / `by_cursor` /
`by_invocation` index entries — once the terminal row is durably flushed, or add
a TTL sweep for terminal attempts.

## Confidence

High that nothing removes records (verified across the repo); medium on impact
(streaming-action workloads only). No `@ref` marks in-memory retention as
deliberate. Part of the "every registry names its retention bound" theme —
see the jobs-table sibling ticket filed the same day.
