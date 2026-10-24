# Snapback 4 PIPE: witnesses must prove several queries are on the wire

**Status:** Open
**Opened:** 2026-10-24
**Area:** snapback4 Postgres reader transport (`engine/postgres/pipeline.rs`, `pipeline_tests.rs`)
**Related:** LLP 3000.009.001.000.002 reads section; `snapback4/reports/20261024-pipe/REPORT.md`

Both blind reviewers of PIPE (`c7a0a597ee`) found the same gap; no code
defect was found.

- `pipeline_tests.rs` ~75 and ~124 treat semaphore permit counts as proof
  that requests are in flight, but `pipeline.rs` ~425 acquires the permit
  before the shared custody lock (~430) and before submission. Replacing the
  shared custody lock with an exclusive one serializes every query and the
  snapshot, error-isolation and termination witnesses still pass.
- The TCP_NODELAY witness returns success without asserting when the eval
  host has no TCP address (~191-199).

Fix: a deterministic submission/flush barrier or protocol trace proving that
multiple Query/Sync units were sent before the first is released or its
backend terminated; make the TCP witness fail (or be skipped loudly) instead
of passing vacuously.
