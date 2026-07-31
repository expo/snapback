# 0044 L1-07: commit-boundary typed references and attach

**Status:** OPEN. **Authority:** LLP 0007 dated amendment; LLP 0044
§Typed references and atomic attachment.

Storage commit hook validating every v.assetRef field on every write
path: handler writes consume transaction-scoped ctx.assets.attach
admissions (intent/args agreement rule; availability per attachment
policy; commit-time generation + authorization re-check inside the
final write lock); non-handler paths (host plan, seed, migration,
admin) get the schema-derived admission from the field's upload
restriction; restriction-less fields refuse there. Untyped or
admission-bypassing writes fail with SNAPBACK_ASSET_REF_UNVERIFIED.
Reverse edges commit in the same changeset (set/update/clear/row-
delete). Logical import of assetRef-bearing rows refuses while
export/import is Missing.

Done when: the references-and-attachment acceptance rows pass,
including forged-string on all six paths, attach-vs-delete races, and
host-plan restricted/unrestricted both shapes.
