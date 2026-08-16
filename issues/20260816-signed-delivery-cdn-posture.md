# Signed delivery needs a CDN/edge posture before hosted scale claims

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Assets, Hosted,
Design

**Related:** LLP 0210 (signed issuance), LLP 0044; device-pass design
discussion (issues/20260815-finish-media-happy-path.md)

Per-user short-TTL signed URLs are the right authorization boundary for the
local/self-hosted target, but they are poor CDN citizens: every
(user, asset, rendition, TTL window) mints a distinct URL, so edge caches
never share entries and every fetch rides to origin. Before any
hosted-scale delivery claim, the private tiers need an edge story — e.g.
edge-verified tokens/cookies over stable object URLs, or origin-signed
redirects into immutable cache keys — designed against the same instant
revocation/authority-replacement semantics the local target proves today.
Public-immutable delivery (now the recommended default for
non-security-sensitive media, author ruling 2026-08-16) is unaffected: it
is already CDN-shaped.

This is a design/LLP item, not a patch; it gates hosted delivery claims
only.
