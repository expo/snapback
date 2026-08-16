# MediaRef snapshot projection needs an authorization and settlement ruling

**Status:** Ready to close
**Owner:** LLP 0239 rollout
**Review:** 2026-08-19
**Related:** LLP 0044, LLP 0210, LLP 0239, LLP 0244

## Problem

LLP 0239 D1 requires a stored opaque asset id to project as
`{ assetId, kind }`, with `kind` read from server-admitted asset metadata in
the same authoritative snapshot as the application row. The current runtime
cannot add that projection without choosing semantics the RFC does not freeze:

1. Query result validation receives `DbRead` and could perform the lookup, but
   mutation results and replayed settlement results are validated on paths
   that no longer carry the write/result snapshot. A single exact result
   contract therefore cannot currently promise the same projection on every
   online and retained result path.
2. Asset metadata has its own LLP 0044 read decision. When a caller may read
   an application row but not its referenced asset, D1 does not say whether
   the whole result refuses, the media field becomes null, or another typed
   state replaces it. Required fields and exact result contracts make those
   outcomes observably different.
3. A pending asset may omit `declaredContentType`. It then has no
   server-admitted kind until finalization. Refusing the attachment, delaying
   projection, or changing the same asset id's projected kind after a retry
   are distinct identity/rotation policies.

## Required ruling

Freeze one projection point shared by fresh query, live/retained query,
mutation return, and settlement replay; freeze the unauthorized-field result;
and freeze pending/retry kind identity. Then implement a `mediaRef` result node,
same-snapshot metadata lookup plus live dependencies, write-shape rejection of
forged `kind`, and the `v.media()` descriptor/lowering as one qualified slice.

Until that ruling, `assets.media-field.v1`, media collections, and the media
command remain GAPs. The independent empty-safe `MediaState` controller and
`useSnapbackMedia` projection can ship without asserting these server
semantics.

## Resolution

[`LLP 0244`](../llp/0244-media-ref-projection.spec.md) is accepted and its v1
slice is implemented and qualified. It freezes the authoritative storage-cut
projection, treats coarse `kind` as disclosed with a class-M-disclosed media
field while leaving delivery under asset policy, requires finalized assets for
v1 attachment, and preserves projected bytes verbatim through an
identity-bound settlement seal.

The implementation adds `v.media()`, exact `mediaRef.v1` result contracts,
pinned query projection, JS provenance, OCC-before-commit-egress mutation
projection, legacy-watermarked settlement recovery, conservative RQS
demotion, and the optional-profile-image guide fixture. Focused acceptance
tests cover same-snapshot query projection, exact mutation replay, denied
delivery without a projection oracle, pending attachment refusal, related-fact
OCC conflict, and valid-JSON settlement corruption. The issue is ready to
close when this lane is integrated; collection, command, class-M activation,
and playable-video work remain separately out of scope under LLP 0239.

## Resolution — 2026-08-15 (backlog sweep)

The ticket already marked itself Ready to close. LLP 0244 froze
same-snapshot `MediaRef` projection, disclosed coarse `kind`, finalized-only
v1 attachment, and identity-bound settlement. `v.media()`, exact
`mediaRef.v1` contracts, and the empty-safe controller shipped; capability
`assets.media-field.v1` is **shipped**. Collection/command remain separately
owned by `issues/20260815-finish-media-happy-path.md`.
