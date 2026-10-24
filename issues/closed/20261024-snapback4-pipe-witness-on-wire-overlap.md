# Snapback 4 PIPE: witnesses must prove several queries are on the wire

**Status:** Closed
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


## Resolution — FF2, 2026-10-24

`pipeline_on_wire_overlap_precedes_release_and_backend_termination` uses a
frontend protocol relay. It counts complete Execute/Sync units only after
forwarding their bytes to the private PG socket, while an advisory lock holds
the first query open. Three units must arrive before release or backend
termination. The two branches also check independent snapshots, statement-error
isolation and retryable failure of every outstanding request.

Failing-before: changing the real independent-request custody read lock to a
write lock makes the new wire witness fail 0/1 at its submission barrier. The
mutant was restored. This is the serialization that passed the old permit-only
witnesses; permit counts are no longer the only overlap evidence.

Socket-only TCP_NODELAY qualification now fails loudly. The subprocess
`pipeline_tcp_nodelay_refuses_socket_only_qualification` witness fails 0/1 on
the old vacuous pass, then succeeds with the refusal. The existing real TCP
strace witness still requires successful TCP_NODELAY enables on reader and
writer. `scripts/test-postgres.sh` accepts `SNAPBACK4_EVAL_POSTGRES_TCP` for
this scope, allowing the other ownership fixtures to retain Unix sockets.
No reader transport behavior or throughput claim changes.
