# dk7_every_artifact_has_a_committed_schema_file red: externally-managed path escapes the repo

**Status:** Open
**Owner:** schema drift gate (`crates/snapback/tests/artifact_schemas_v0.rs`)
**Found:** 2026-08-24, during the LLP 0268 exit-extension landing verification

## Problem

`dk7_every_artifact_has_a_committed_schema_file` panics at
`artifact_schemas_v0.rs:1678`:

```
externally managed schema ../../../packages/snapback-codegen/handler-typescript-profile.schema.json is not present at its owning path
```

The file exists on disk and at `origin/main`
(`packages/snapback-codegen/handler-typescript-profile.schema.json`, landed
5f76536e4). The registered relative path `../../../packages/...`, resolved
from the schemas directory, escapes the repository root, so the presence
check looks outside the checkout. Reproduced identically in the primary
checkout and in two linked worktrees at the 2026-08-24 main era — this is a
main red, not a lane artifact; the sibling gates
(`dk7_committed_schemas_match_rust_types`, public-instance drift) pass.

## Ask

Fix the `EXTERNALLY_MANAGED_SCHEMA_ARTIFACTS` registration (or the presence
check's base directory) so the owning path resolves inside the repo root,
and add a canonicalized containment assertion so a future registration
cannot escape again.
