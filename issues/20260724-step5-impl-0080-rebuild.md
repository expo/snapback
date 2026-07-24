# 0080: shadow rebuild under the 0081 barrier with the split oracle

**Status:** Deferred (phase B)
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
