# CC-7: record history/branching exploration RFC (LLP 0088)

**Status:** Done (2026-07-23 — LLP 0088 authored, Draft: history reads pursue (phase 1, journal-backed, portable), losing versions subsumed, branching deferred with named trigger, merge-in-core never, GC/retention + per-version fail-closed auth as preconditions, LLP 0007 no-change derived; acceptance waits on the LLP 0085 gate + own review)
**Severity:** P2
**Systems:** Storage, Sync, API
**Author:** Claude (Fable), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0086 CC-7, LLP 0085, LLP 0008, LLP 0007
**Marker:** llp-0086-execution
Author LLP 0088 (Draft RFC): whether to expose record history and/or branching
as API, decomposed per capability (history reads, retained losing versions,
branch creation, merge policy, GC/retention, authorization, target
portability), scoped against LLP 0008's retention rule; states whether LLP
0007's portable storage contract changes. Note: CC-7 is commitment-gated on
LLP 0085 review in the plan; started early by author direction (2026-07-23),
recorded in LLP 0086's close-out note. Acceptance still waits on the gate.
