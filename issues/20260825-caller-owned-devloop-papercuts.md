# Caller-owned dev-loop papercuts from the Q-b probe (restart lease, SIGTERM semantics, guide port)

**Status:** Open
**Opened:** 2026-08-25
**Systems:** CLI, Local server lifecycle, Guide
**Related:** LLP 0307 (Q-b probe F2-F4),
`benchmarks/runs/2026-08-25-qb-lifecycle-probe-0127/record.md`

## Problems (published 0.1.27, caller-owned URL-first path)

1. **F2:** native `snapback restart` demands a secret-read lease
   (`SNAPBACK_ADMIN_SECRET_READ_REQUIRED`) — there is no credential-free
   caller-owned restart verb for the ordinary dev loop.
2. **F3:** SIGTERM to `snapback dev` leaves the managed server daemon
   running (the attach model), which the URL-first guide section never
   states — an agent cleaning up "its" processes will strand a server.
3. **F4:** the `snapback guide` fallback hint hardcodes port 4287
   regardless of the running server's actual port.

## Wanted

A dev-scoped restart path (or a documented equivalent) that needs no
secret lease; the attach/daemon lifecycle stated plainly in the URL-first
guide section (including how to actually stop the server); the guide hint
deriving its port from the live descriptor. Each is small; they share the
dev-loop surface.
