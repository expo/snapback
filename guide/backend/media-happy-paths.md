---
title: Media happy paths
id: backend.media-happy-paths
order: 10
audience: agent-first
capabilities: [assets.media-field.v1]
authorities: [llp/0239-asset-collections-and-media-field.rfc.md, llp/0044-asset-storage-pipeline.rfc.md, llp/0210-asset-upload-dx-closure.rfc.md, packages/snapback-client/assets.mjs, packages/snapback-react/implementation.mjs, issues/20260812-media-ref-snapshot-projection.md]
examples: [packages/snapback-client/assets.test.mjs, packages/snapback-react/assets.test.mjs, packages/snapback-react/asset-upload-types.fixture.ts]
status: current
targets: [local]
maturity: partial
since: 0.1.21
unreleased: true
reviewed: 2026-08-12
reviewed-commit: HEAD
---

# Media happy paths

> **Unreleased.** The empty-safe media controller and React hook are newer
> than the newest published closure, 0.1.20. Use them from contributor source
> until a later closure publishes them.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

This page is the four-path map from LLP 0239. Only path 3 has a shipped
contributor-source implementation in this rollout. The other paths stay
explicit GAPs so an agent does not mistake RFC syntax for an available API.

## Path 1 — store one optional profile image (GAP)

`v.media()` is not available yet. The intended optional profile-image field
cannot ship until the server can project its stored asset id as an exact,
authorized `MediaRef` at the application row's snapshot. The unresolved
authorization, settlement, and pending-kind choices are recorded in the
[open projection issue](repo:issues/20260812-media-ref-snapshot-projection.md).

For an application that must ship now, use the existing
[`v.optional(v.assetRef(...))` path](./assets.md#declare-the-upload-intent-and-the-reference-field).
It returns an opaque asset id rather than `MediaRef`; do not manufacture a
`kind` client-side and call it equivalent.

## Path 2 — attach a bounded media collection (GAP)

`assetCollection` is a later LLP 0239 rollout. Do not store asset references
inside `v.json()`, and do not infer that an ordinary app-owned array has asset
attachment, authorization, or GC semantics. Model explicit child rows using
the current [bounded relation guidance](./standard-patterns.md) when the
application cannot wait for the generated collection.

## Path 3 — render one authorized media reference or nothing

`useSnapbackMedia(mediaRefOrNull, options)` is empty-safe. `null` and
`undefined` synchronously return `{ status: "empty", media: null }`, start no
issuance, and make `refresh()` an inert resolved promise. An empty string is a
contract error that names the nullable spelling.

For non-empty input, pass only a `MediaRef` obtained from an authorized server
result. The hook projects the shared issued-URL controller: image delivery
defaults to `primary`, accepts `widthPx` or an explicitly declared `variant`,
refreshes before expiry, and blanks the URL on denial or authority replacement.
It does not probe a signed route and does not claim portable video playback.

```ts source=packages/snapback-react/asset-upload-types.fixture.ts
export function ProfileMedia({ media }: { media: MediaRef<'image'> | null }) {
  const state = useSnapbackMedia(media, { widthPx: 640 });
  if (state.status === 'empty' || state.status === 'issuing') return null;
  if (state.status === 'ready' || state.status === 'refreshing') {
    return { src: state.url, alt: 'Profile' };
  }
  if (state.status === 'unavailable') {
    return { retry: () => state.refresh() };
  }
  return null;
}
```

`denied` is intentionally distinct from `unavailable`: denial carries a typed
authorization diagnostic and no URL. A transient unavailable state may be
retried. A valid URL remains visible while the controller is `refreshing`.

## Path 4 — upload and commit media in one command (GAP)

The LLP 0239 media command/binding is not part of this rollout. Keep using the
ordinary asset upload task and explicit mutation attachment described in
[Assets](./assets.md#upload-and-attach). Do not claim that cancellation rolls
back a mutation or that a response-loss retry has atomic media-command
semantics; those require the future closed binding.

## Anti-patterns

- Do not pass `""` for no media; pass `null` or `undefined`.
- Do not construct `{ assetId, kind }` from MIME guesses, filenames, or client
  upload assertions. `kind` is reserved for server-admitted result metadata.
- Do not probe signed routes to discover variants or playback support.
- Do not treat `assetCollection` or the media command as shipped.
- Do not claim `media.video.playable.v1`; this rollout adds no transcoding or
  portable container/codec guarantee.
