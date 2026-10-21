# Snapback 4: statically census caller strings reaching adapter writes

**Status:** Open
**Date:** 2026-10-21
**Systems:** Snapback 4, store adapters, admission policy
**Found by:** Lane NUL fix round 2 blind reviews
**Related:** LLP 3000.009.001.000 §9.1

Review found mutation ids/viewers and asset-intent owners/ids bypassing NUL
admission. The final NUL round fixes those named doors and makes Postgres
bind-guard refusals terminal. Remaining direct Rust-API paths can still store
a NUL string on SQLite while Postgres returns `E_INPUT` and rolls back.

Propose a static census with a ratchet-style test listing every adapter write
that binds a caller-supplied string. Tag each site
`admitted-through-chokepoint` or `residual`; record its string arguments and
the admission function, or the explicit residual rationale. Include buffered
commit-tail writes, optional strings, string arrays and both adapters, rather
than only calls with an obvious `&str` parameter.

The test should detect added or changed string-to-write paths without a
classification, with enough source context to review the proposed admission
boundary. Seed the census from existing sites and add a planted new-door
witness proving the ratchet fails. JSON-encoded values, diagnostic text and
generated strings need explicit classifications so their different treatment
does not silently hide an unadmitted raw string.

This ticket commissions no additional implementation in the final NUL round.
The desired follow-up replaces discovery by repeated manual review with a
tool that reports new doors and a maintained, explicit residual list.
