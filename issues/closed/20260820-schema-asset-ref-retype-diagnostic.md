# AssetRef retype diagnostic hides the changed upload intent

**Status:** Closed
**Opened:** 2026-08-20
**Systems:** Schema evolution, Assets, Diagnostics, Generated identity
**Related:** LLP 0044; LLP 0210; LLP 0277 P20; LLP 0295; Diary 0103

## Problem

Changing the upload intent or policy behind an AssetRef can refuse schema
evolution as `SNAPBACK_SCHEMA_FIELD_RETYPED`, but the message renders the
transition as "AssetRef to AssetRef". The load-bearing identity/policy delta is
omitted, so the author cannot tell whether the change is compatible, needs a
migration, or is stale generated state.

## Requested repair

- Render the bounded semantic delta: old/new upload intent identity, accepted
  media class, delivery policy, and any other field participating in the
  stored type identity.
- Point to preserve-data migration and dev-fresh repairs separately.
- Add a fixture for equal display type with unequal underlying intent.

## Exit

The first refusal identifies the exact policy fact that changed and offers the
correct data-preserving or destructive repair path.

## Resolution

Resolved 2026-08-21. `SNAPBACK_SCHEMA_FIELD_RETYPED` now renders a bounded
`semanticDelta` for every stored `AssetRef` identity participant (upload/media
intent, policy identity, accepted media classes, delivery, variants,
classification, retention, and target capability). Every scalar and array uses
a capped preview with original byte/count metadata and stable SHA-256 digests
for omitted content, so a multi-megabyte valid manifest cannot become a
multi-megabyte diagnostic. The message and structured repair distinguish the
reviewed preserve-data migration from the explicitly database-targeted local
dev `snapback reset --dev-fresh --db <path-to-this-database>` path, naming the
database/WAL/SHM/admin-token/dev-identity/readiness artifacts it removes and
the keyrings, asset blobs, and unrelated databases it leaves intact. Rust
fixtures pin the equal-display-type/unequal-intent case, all nine participants,
digest stability, and the serialized bound.

landing SHA: 96ad7dcd8
