# AssetRef retype diagnostic hides the changed upload intent

**Status:** Open
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
