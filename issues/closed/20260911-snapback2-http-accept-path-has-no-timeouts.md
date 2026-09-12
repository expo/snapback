# Snapback 2 HTTP accept path has no header/body timeouts

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2/src/serve.rs` (tiny_http accept loop, `read_body`, `control_admission`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1002 §4; LLP 1015 H0 (Draft — do this before any non-loopback bind)

## Symptom

Snapback’s worker cap (64 total, 4 control / 8 JSON / 4 upload / 48 SSE) only applies **after** tiny_http has already parsed a complete request. tiny_http’s accept loop spawns an **unbounded** `TaskPool` thread per TCP connection and reads headers with no line-length cap and no read timeout. Snapback then reads JSON with `take(1_048_577)` and no socket timeout.

A slowloris client on loopback can (a) spawn unbounded OS threads inside tiny_http before any `E_OWNER_BUSY`, and (b) hold every JSON/SSE worker by trickling a 1 MiB body. Control workers are reserved, so CLI `--stop` can still get in; the app plane cannot.

This is loopback-only today (`bind 127.0.0.1`). It becomes a hosted availability hole the moment the bind address is not loopback.

Related nits to land in the same change, because they only matter off-loopback:

- Control-secret compare is `header(...) != Some(secret)` (`serve.rs:277`). Channel leases on the same process already use a fixed-width XOR with `black_box` (`writer_channels.rs:79-88`). Reuse that for `X-Snapback-Control`.
- `header_value` `.expect` on query-derived values is [the Location injection ticket](./20260911-snapback2-public-asset-location-header-injection.md).

## Proposed

1. Set a read timeout on accepted sockets before handing them to workers (5–15s is enough for loopback JSON; uploads already have their own class).
2. Cap tiny_http header size, or replace the accept path so in-flight accepts count against the same budget as workers.
3. Constant-time compare for the control secret:

```rust
fn control_admission(request: &Request, secret: &str) -> Result<(), Refusal> {
    if !is_loopback(request.remote_addr().map(SocketAddr::ip)) {
        return Err(Refusal::owner(
            "E_OWNER_CONTROL_REMOTE",
            "control routes are loopback only",
            "call the owner from the local machine",
        ));
    }
    let supplied = header(request, "X-Snapback-Control").unwrap_or_default();
    if !lease_style_eq(secret, &supplied) {
        return Err(Refusal::owner(
            "E_OWNER_CONTROL_SECRET",
            "invalid owner control secret",
            "read X-Snapback-Control from .snapback/owner.json",
        ));
    }
    Ok(())
}
```

Export or copy `lease_matches` from `writer_channels.rs` (64-byte pad) so secret length is not leaked by early length mismatch. The secret is 64 hex chars today (`random_secret` 32 bytes).

Do this **before** any `0.0.0.0` / TLS serve bind. Not a blocker for current loopback `dev`.

## Acceptance

- A client that connects and never sends a request line is dropped by timeout; owner RSS/thread count does not climb without bound across 1_000 such sockets (or is capped by an accept budget).
- Control secret compare is not a byte-at-a-time `!=` of the live secret.
- Existing worker-budget tests still pass; `--stop` still gets a control slot while SSE is busy.

## Resolution (2026-09-12)

Accepted streams have 5-second read/write idle deadlines. Parser threads and pending work are capped at 128 each, request/header allocation is bounded, and spawn/clone failures shed one connection. A 300-idle-socket regression verifies shedding and deadline close; unread-body teardown is bounded. Loopback control secrets use ConstantTimeEq. Native socket, spawn, secret, and raw owner tests pass; network binding remains loopback.
