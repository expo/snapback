# Snapback 4: the engine mutex is held across Argon2 and asset disk I/O

Status: Closed
Resolved: 2026-09-13
Priority: P1
Date: 2026-09-13
Systems: HTTP host, identity, assets
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: [LLP 3000.002](../../llp/3000.002-end-to-end-resource-bounds.research.md); overlaps [auth lock](./20260913-snapback4-auth-engine-lock-and-rate-limits.md) and [upload lock](./20260913-snapback4-upload-holds-engine-lock.md)

## Problem and reproduction

Every query, mutation, snapshot page, job chunk, and `/changes` wake serializes
on `Shared.engine`. Password KDF work and asset file writes and deletes ran
while holding that mutex. Protected POST bodies were also buffered before
resolving a principal, so an unauthenticated asset request could consume its
large body allowance before returning 401.

## Implementation locations

- [snapback4/crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs)
- [snapback4/crates/snapback4/src/assets.rs](../../snapback4/crates/snapback4/src/assets.rs)
- [snapback4/crates/snapback4-core/src/engine/mod.rs](../../snapback4/crates/snapback4-core/src/engine/mod.rs)
- [snapback4/crates/snapback4-core/src/identity.rs](../../snapback4/crates/snapback4-core/src/identity.rs)

## Resolution — 2026-09-13

Credential lookup and final session/account writes retain only short engine
guards; Argon2 preparation and verification run in bounded KDF slots outside
the guard. Asset requests authenticate before upload admission or body reads.
Sniffed uploads are prepared under the engine guard, written and synced through
an owner-only staging file without it, then committed under the original
generation. Asset sweeping selects catalog work under the guard and unlinks
files afterward. Independent KDF and upload caps prevent those slow paths from
occupying every request slot.

Focused regressions cover concurrent short queries, early unauthenticated-body
refusal, staging cleanup, and sweep behavior. The exact integrated proof and
independent-review evidence is retained in the
[security remediation record](../../llp/reviews/3000-security-remediation-20260913.md).
