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

## Suite index (2026-07-25) — RELATIONAL_MIGRATION_COUPLED_SUITE_V1, local profile

The suite is assembled across three homes: the boundary-fixture file
`tests/relational_migration_coupled_suite_v0.rs` (anchored by its
`relational_migration_coupled_suite_v1_summary` test, which fails if this
map stops naming its witnesses), the callable-query corpus
`tests/relational_corpus_v0.rs` (+ `tests/conformance/relational/`), and
the engine/activation unit witnesses in `src/local.rs`.

**Maintained-projection boundary items (LLP 0080 §Acceptance):**

- 1,023-reference joined-row update = exactly 1,024 writes and succeeds;
  the 1,024th admission refuses before any write —
  `boundary_1023_1024_write_ceiling_and_admission`
  (tests/relational_migration_coupled_suite_v0.rs). The same test carries
  the disclosed-capacity ladder at 0/1/1,023/1,024 references
  (`sharedFanOutDisclosure` fixture), the join-key-move union (into-full
  refuses; between-non-full updates joined leaves in the same commit),
  repeated-write coalescing (two patches, one output evaluation), and
  whole-mutation crash equivalence (a second-step refusal rolls back the
  first step's insert and every projection write).
- Pre-activation 1,024-reference corpus refuses activation —
  `pre_activation_1024_reference_corpus_refuses_activation` (same file);
  the load-time summed write-budget refusal is
  `maintained_projection_activation_refusals` (src/local.rs).
- Admission race: on the local profile the single serialized writer
  structurally excludes interleaving — the sequential second-admission
  refusal in `boundary_1023_1024_write_ceiling_and_admission` is the
  complete local witness (rationale in the test comment); the genuinely
  concurrent variant belongs to the hosted executor profile.
- `materializeAll` split oracle over >1,024 roots: logical rows byte-equal
  an independent evaluation and the rebuild receipt's streaming `seq1`
  digest equals an independently recomputed digest in canonical
  output-key byte order —
  `materialize_all_oracle_over_1100_roots_matches_independent_digest`.
- Same-commit maintenance, absent-unique-lookup fan-out, changed-bytes
  counting, key-stable row identity, key immutability —
  `maintained_projection_engine_end_to_end` (src/local.rs).
- Activation materializes / republishes without re-keying; unchanged plan
  digests skip — `projection_activation_rebuild_materializes_and_republishes`
  (src/local.rs).
- Generation fences (chains/diamonds, disclosure, output write/read) —
  `maintained_projection_activation_refusals` (src/local.rs).

**Callable-query half:** `relational_corpus_v0` and its committed corpus
(see the acceptance-corpus ticket's item→witness map).

**Honest residuals before the Implemented flips (author decisions once
these close):**

- hosted evaluator arms (Cloudflare reports the `relational_query_v1`
  capability gap; the hosted DO executor ticket stays deferred);
- the retention lease class (`opaque-authorized-snapshot-v1`) and the
  relational obligation-fault / authority-rotation e2e (live-0053 ticket);
- the full 0081 lane: durable batch-cursor executor state machine,
  MigrationPlanArtifactV1 with golden vectors, approval records with the
  complete LLP 0072 audience, schema-transition journal events + client
  handshake, verification/rollback receipts (`generationRepublish`);
- examined-entries instrumentation for the index-served bound;
- Step 0's exit, which gates *claiming* any Step 5 gate regardless of
  suite state.

Per the phasing, the maturity flip for `relational_query_v1` and the
Implemented statuses of LLP 0080/0081 are author decisions to take once
the residuals above close; this ticket records the suite's state and does
not flip either.
