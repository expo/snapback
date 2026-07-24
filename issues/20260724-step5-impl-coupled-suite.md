# RELATIONAL_MIGRATION_COUPLED_SUITE_V1 — join gate for 0080/0081 Implemented

**Status:** Deferred (phase B)
**Severity:** P2
**Systems:** Testing, Migrations, Query planning
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0080 §6, Accepted LLP 0081 §Acceptance, LLP 0063 WS6
**Marker:** step5-impl

Assemble the named coupled suite: 0080's rebuild corpus executes through
0081's RebuildMaintainedProjection executor, and 0081's projection step
proves through 0080's split oracle. Neither RFC claims its executable
acceptance witness before this passes; on pass, flip both to Implemented and
record the witness against LLP 0063's Step 5 entry conjunction (step 0 still
gates any Step 5 claim). Depends on both acceptance-corpus tickets. M-sized.
