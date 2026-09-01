# snapback2: updating id corrupts physical and index row identity

**Status:** Open
**Systems:** snapback2, core engine, storage
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/engine/runner_ops.rs:36-83

Failure scenario: store {id:"a",label:"x"}, then update key "a" with patch {id:"b"}. SQLite keeps the row under physical row_id "a" while its JSON says id "b". Reindexing deletes entries for "b", leaves the old "a" entries, and creates "b" entries pointing to a nonexistent physical row; lookup "a" can return a row claiming "b", while lookup "b" misses.

Why it happens: update merges id, replace stores by the operation key at lines 75-79, and reindex_row derives identity from new_row.id. Upsert likewise does not require its key to equal row.id. Validation checks type but not identity equality.

Suggested fix: reject id in update patches and require key==row.id for replacement/upsert at runtime, with matching compiler/certificate diagnostics. Add transactional byId and secondary-index corruption tests.
