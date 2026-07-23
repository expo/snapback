# CC-3.3: InstantDB revocation-eviction empirical probe

**Status:** Blocked
**Severity:** P2
**Systems:** Competitive analysis, Auth
**Author:** Claude (Fable), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0086 CC-3, LLP 0082
**Marker:** llp-0086-execution
Build a probe app on InstantDB answering whether permission revocation evicts
already-synced rows; preregister the observable (row state per client store
constituting evicted/not-evicted) and timing threshold before running.
**Blocked:** no InstantDB account/credentials available in this environment
(.agent-local-secrets.md has none). Needs a human-provisioned Instant app.
Exit: probe results recorded in LLP 0082's open questions, both branches.
