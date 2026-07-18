# Preserve brownfield auth-collision rescue during storage preflight

**Status:** Closed
**Severity:** P1
**Systems:** Storage open, Auth rescue, Brownfield adoption
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0007; LLP 0057 §Collision rescue; `issues/closed/20260717-refuse-storage-version-exhaustion.md`
**Marker:** brownfield, collision, rescue, storage-head, preflight

The storage-ordering hardening initially classified every database containing
any non-SQLite schema object as an existing Snapback database. It therefore
required `_snapback_version` before opening a database whose only object was a
foreign `_auth_*` table. That contradicted LLP 0057's dormant-collision route:
such a brownfield database must open in dev/test so catalog inspection can
report `SNAPBACK_AUTH_TABLE_COLLISION` and keep the registered rescue operation
reachable. Adding a synthetic head to the tests masked the broken production
classification.

The inverse boundary remains security-critical. Once a database contains a
Snapback-owned schema object or a managed app `_version` column, absence of the
canonical head is damage, not brownfield adoption. Open must refuse before DDL
or defaults can make retained rows appear uncommitted.

**Done when:**

- A foreign `_auth_*` table with no Snapback storage or managed-row evidence is
  eligible for fresh storage adoption and remains visible to auth collision
  inspection.
- Even an exact protected auth-table shape is not affirmative storage evidence
  once every `_snapback*` object and marker is absent: LLP 0057 requires the
  observationally identical unmarked shape to remain a collision, never an
  implicitly adopted catalog.
- Snapback-owned schema objects without `_snapback_version` fail with
  `SNAPBACK_STORAGE_VERSION_CORRUPT` before any repair or additive DDL.
- An ordinary app table carrying the managed `_version` ordering column without
  a head fails at the same pre-DDL boundary.
- Dormant-runtime and server rescue fixtures use their original no-head
  brownfield shape; no fabricated storage authority is needed.
- Exact regressions cover brownfield rescue, managed-state refusal, and damaged
  canonical-head refusal.

## Resolution

The open classifier now treats only Snapback-owned schema names or managed app
`_version` columns as evidence that a storage authority must already exist.
Databases containing only foreign/brownfield objects take the fresh-adoption
lane; auth-reserved tables are intentionally excluded from managed-app
classification so LLP 0057 can inspect and rescue them. Once evidence exists,
the existing exact head, ordering-fact, and journal preflight remains
unchanged and fail-closed. There is intentionally no physical-DDL heuristic for
an unmarked exact auth catalog: LLP 0057's closed catalog-state table says “no
marker + any auth-reserved table” is a collision, and says an unmarked catalog
is never adopted even when its SQL exactly matches a known version. Treating
that shape as damaged storage would make a conforming foreign collision
unrescuable.

Focused proof on 2026-07-17:

- `cargo test --lib brownfield_auth_collision_without_storage_facts_adopts_before_rescue -- --nocapture` — passed.
- `cargo test --lib unmarked_exact_auth_catalog_without_storage_objects_remains_a_collision -- --nocapture` — passed.
- `cargo test --lib managed_brownfield_row_without_storage_head_is_refused_before_adoption -- --nocapture` — passed.
- `cargo test --lib reopen_refuses_missing_canonical_head_without_recreating_it -- --nocapture` — passed.
- `cargo test --lib dormant_foreign_auth_table_remains_servable_for_rescue -- --nocapture` — passed.
- `cargo test --lib auth_rescue_host_op_returns_pinned_metadata_and_keeps_service_live -- --nocapture` — passed.
- `cargo test --lib` — 1,098 passed, 0 failed.
- `cargo clippy --all-targets -- -D warnings` — passed.
