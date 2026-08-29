# Published 0.1.29 runtime refuses `assets.media-collection.v1` that 0.1.29 codegen emits (capability skew)

**Status:** Closed
**Opened:** 2026-08-27
**Closed:** 2026-08-28
**Systems:** Media/assets, Packaging, Published runtime
**Source:** Clique benchmark matrix (published Snapback 0.1.29), sol-snapback-explicit lane

## Resolution

Resolved by `f3c09fcb0`. The publication store qualification gate now derives
the authoritative required capability set from codegen, compares it with every
platform runtime's `supportedCapabilities` and `capabilityGaps`, and fails
closed when required capability evidence is missing or malformed. Its tests
cover both platform runtimes and an experimental capability absent from one
runtime, so this class of codegen/runtime publication skew cannot qualify.

This closes only the publication capability-coherence gap described here. The
broader physical-device Expo and end-to-end published-package media reruns stay
open in `issues/20260815-finish-media-happy-path.md` and remain explicit GAPs
for `assets.media-collection.v1` and `assets.media-command.v1` in
`guide/capabilities.md`.

## Original problem

A lane authored the documented `assetCollection` media surface. 0.1.29 codegen accepted
and generated it, but the pinned **published Linux runtime refused to load** it:

```
SNAPBACK_CAPABILITY_UNSUPPORTED assets.media-collection.v1
SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_INELIGIBLE
```

Quoted (`sol-snapback-explicit`): "0.1.29 codegen generated the documented
`assetCollection`, but the pinned published Linux runtime did not offer the required
capability and refused loading."

This was the **same class** as the 0.1.28→0.1.29 packaging regression just fixed
(runtime advertising a capability set that does not match what codegen requires) — a
codegen/runtime capability skew in the published package.

## Questions resolved

1. Publication qualification now reads each platform runtime's capability
   evidence rather than trusting a single platform or a package receipt alone.
2. Experimental capabilities are included in the authoritative required set;
   missing runtime support fails qualification.
3. Platform skew is exercised directly by the two-platform test matrix.
4. `SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_INELIGIBLE` remains a separate
   authoring constraint; it is not used to excuse missing runtime capability.

## Relationship to the 0.1.28/0.1.29 fix

The store-receipt fail-closed guard (landed `90ee0937d`) fixed the *receipt*
skew. `f3c09fcb0` extends the same fail-closed posture to the required runtime
capability set.
