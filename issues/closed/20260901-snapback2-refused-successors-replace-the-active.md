# snapback2: refused successors replace the active build cache

**Status:** Closed
**Resolution:** The watcher now publishes project.json, certificates.json, and api.d.ts only after runtime successor admission in snapback2/crates/snapback2/src/watch.rs; a destructive source-watch refusal test proves the active cache remains byte-identical.
**Systems:** snapback2, owner, watcher, successors
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/watch.rs:51-76

Failure scenario: a source edit changes a query and destructively drops a table. Certification succeeds, apply_successor refuses the drop, and the owner keeps serving the predecessor. Nevertheless .snapback/build/project.json, certificates.json, and api.d.ts describe the rejected successor; why combines successor certificates with predecessor execution and generated clients advertise unavailable operations.

Why it happens: write_build_cache runs before Action::Apply, and the refusal path performs no rollback or generation selection. Consumers such as why read the unversioned cache directly.

Suggested fix: stage generation-scoped cache files and atomically promote them only after apply succeeds, or version caches and have all consumers select the active owner generation. Add a destructive-refusal test comparing served manifest, why, and api.d.ts.
