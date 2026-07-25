# 0080: shadow rebuild under the 0081 barrier with the split oracle

**Status:** In progress (local-profile slice landed 2026-07-25)
**Severity:** P2
**Systems:** Storage, Migrations
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0080 §6, Accepted LLP 0081 §§3-4
**Marker:** step5-impl

Rebuild as `RebuildMaintainedProjection`: pin V, exclusive barrier, fresh
output generation in canonical key order, split-oracle proof (logical rows
byte-equal an independent materializeAll(core, V); system fields checked
against the deterministic rule) via ContentDigestV1, atomic publication,
prior-generation retention through the rollback window, crash recovery both
sides of publication. Runs inside the 0081 executor — joint deliverable with
the 0081 lane; lands in the coupled suite. M/L-sized.

**Progress (2026-07-25):** the local-profile rebuild landed as the minimal
0081 slice (`LocalDatabase::rebuild_projection_if_stale` /
`rebuild_projection`): one IMMEDIATE transaction is the exclusive barrier —
the serialized writer fences source writes for the rebuild's duration, any
crash rolls back to the predecessor generation whole, and publication is
the commit. Activation materializes (both install paths rebuild
stale-digest plans before the manifest installs), the pre-activation
fan-out proof over existing data refuses activation
(`SNAPBACK_PROJECTION_FANOUT_EXCEEDED`), the streaming content digest
(`seq1` over logical rows in canonical output-key byte order) and a typed
receipt (deterministic operation id from plan digest + generation) persist
in `_snapback_meta`, plan revisions republish without re-keying row
identity, and unchanged digests skip. Witness:
`projection_activation_rebuild_materializes_and_republishes`.

**Remaining:** the independent `materializeAll` split-oracle comparison as
a standalone verifier (the witness recomputes via table contents; the
digest-vs-independent-evaluation harness belongs to the coupled suite);
injected crash-point fixtures beyond transaction-rollback equivalence;
the durable batch-cursor state machine, downtime ceiling, and full
approval records — the complete 0081 lane (Phase C).
