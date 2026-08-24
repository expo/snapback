# dk7_every_artifact_has_a_committed_schema_file red: externally-managed path escapes the repo

**Status:** Resolved
**Owner:** schema drift gate (`crates/snapback/tests/artifact_schemas_v0.rs`)
**Found:** 2026-08-24, during the LLP 0268 exit-extension landing verification
**Resolved:** 2026-08-24

## Problem

`dk7_every_artifact_has_a_committed_schema_file` panicked at
`artifact_schemas_v0.rs:1678`:

```
externally managed schema ../../../packages/snapback-codegen/handler-typescript-profile.schema.json is not present at its owning path
```

The file existed on disk and at `origin/main`
(`packages/snapback-codegen/handler-typescript-profile.schema.json`, landed
5f76536e4). The registered relative path `../../../packages/...`, resolved
from the schemas directory, escaped the repository root, so the presence
check looked outside the checkout. This reproduced identically in the primary
checkout and in two linked worktrees at the 2026-08-24 main era; the sibling
gates (`dk7_committed_schemas_match_rust_types`, public-instance drift) passed.

## Resolution

The externally managed artifact registration now uses
`../packages/snapback-codegen/handler-typescript-profile.schema.json`, which
resolves from `schemas/` to its owning package inside the repository. The DK-7
presence gate now canonicalizes the repository root and every registered
external owning path and asserts that each resolved path remains contained by
the repository root, preventing both parent-traversal and symlink escapes.

No schema content, codegen, or graph files changed.
