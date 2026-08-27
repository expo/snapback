# Published 0.1.29 runtime refuses `assets.media-collection.v1` that 0.1.29 codegen emits (capability skew)

**Status:** Open
**Opened:** 2026-08-27
**Systems:** Media/assets, Packaging, Published runtime
**Source:** Clique benchmark matrix (published Snapback 0.1.29), sol-snapback-explicit lane

## Problem

A lane authored the documented `assetCollection` media surface. 0.1.29 codegen accepted
and generated it, but the pinned **published Linux runtime refused to load** it:

```
SNAPBACK_CAPABILITY_UNSUPPORTED assets.media-collection.v1
SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_INELIGIBLE
```

Quoted (`sol-snapback-explicit`): "0.1.29 codegen generated the documented
`assetCollection`, but the pinned published Linux runtime did not offer the required
capability and refused loading."

This is the **same class** as the 0.1.28→0.1.29 packaging regression just fixed
(runtime advertising a capability set that does not match what codegen requires) — a
codegen/runtime capability skew in the published package.

## Questions to resolve

1. Does the published 0.1.29 Linux (x64) runtime's advertised capability set actually
   include `assets.media-collection.v1`? Inspect the tarball's runtime capability manifest.
2. Is the media-collection capability intentionally **experimental/gated** (in which case
   codegen should refuse or warn at author time, not let it through to a runtime refusal)?
3. Is it another **platform/packaging skew** (present on darwin-arm64, missing on
   linux-x64, or vice versa) like the store-receipt regression?
4. `SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_INELIGIBLE` — separate authoring constraint or a
   downstream symptom of the capability being absent?

## Verification plan

- Extract the published `@expo/snapback-runtime-linux-x64@0.1.29` (and darwin-arm64)
  tarball; read the runtime capability manifest; grep for `media-collection`.
- Compare against the codegen capability requirement emitted for `assetCollection`.
- If codegen emits a capability the published runtime lacks, that is a publish gate gap:
  the store-qualification / capability-reconciliation should catch codegen-vs-runtime
  capability skew before publish, not only the packaged-store receipt.

## Relationship to the 0.1.28/0.1.29 fix

The store-receipt fail-closed guard (landed 90ee0937d) fixed the *receipt* skew. This is a
*capability-set* skew — a related but distinct gap in what the publish path verifies.
Worth checking whether the fix's fail-closed posture should extend to codegen-required
capabilities.

## Owner

Media/packaging. Confirm with a direct tarball inspection before assuming a runtime bug —
it may be an experimental-gating or author-time-warning gap rather than a build defect.
