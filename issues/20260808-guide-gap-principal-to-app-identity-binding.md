# guide-gap: no recipe for binding server principals to app-owned identities

**Opened:** 2026-08-08 · **Severity:** P3 (guide-gap; the largest identity friction cluster)

The sessions guide documents `ctx.auth.userId`, dev minting, logout, and
bearer replacement, but gives no recipe for the thing every ported app
needs first: securely populating a principal-to-app-user table when the
app carries its own user identity scheme. Handler auth exposes the
verified principal but not the verified mint email, so an in-handler
claim cannot prove which app row a principal owns. The Zerobugs control
confined this to an acceptance-only bootstrap (`W-IDENTITY`: frozen
actor map, one-to-one refusal, closure sentinel, gateway omission) — fine
for a harness, not an answer for products, which still need a trusted
identity claim or privileged provisioning path.

Ask: an intent-indexed guide page for principal↔app-identity binding
(acceptance-harness pattern AND the production external-broker pattern),
plus consideration of exposing verified identity claims to handlers.
Owner seam: the LLP 0183 review round flagged identity as a cross-cutting
contract needed by D2 authorization, D3 partitions, and D5 guards — not a
D7 afterthought.

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.
