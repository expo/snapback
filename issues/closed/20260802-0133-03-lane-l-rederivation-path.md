# 0133-03: Lane-L server re-derivation settlement path, driven by synthetic submissions

**Status:** Closed
**Program:** 20260802-0133-00-settlement-substrate-program.md
**Systems:** Runtime, Sync, Storage, Auth
**Depends on:** 0133-01, 0133-02
**Related:** LLP 0133 §The two settlement lanes, §Re-derivation semantics,
§The protocol-identity carve-out; LLP 0059 (choreography), LLP 0003, LLP 0008

## Task

Accept lane-L-labeled submissions and settle them by authoritative
re-execution with re-derivation as the default:

- `now` answers from the server's settlement clock — **one sample per
  settlement**, shared by every re-derived time sink;
- minted ids from the server's own generator;
- locally captured values travel as claims, recorded in the receipt
  (ticket 01's ledger), never authority;
- the local run's read baseline MAY travel as a diagnostic claim; it is not
  an OCC input — the server validates its own reads. The deliberate LLP 0003
  E3 client-declared `readSet` CAS channel stays untouched and available to
  lane-L submissions as an ordinary contract input;
- LLP 0059's choreography is unchanged: descriptor comparison first,
  reservation pair, `SNAPBACK_AUTH_RESERVATION_STALE` with no committed
  effect and no in-attempt rerun;
- lane assignment is a capture-time fact echoed in the receipt; the lane-L
  intent record (claims included) is immutable — a retry re-presents the
  identical recorded claim set or fails closed in the reused family;
- protocol-lane identity (`clientMutationId`, sequence number, descriptor,
  cursors) is never re-derived.

Because the lane label is client-attested and privilege-free (§rule 2), build
and test this entirely with synthetically constructed lane-L wire submissions.
No local evaluator exists yet; that is the point.

## Exit

- Sketch 2: skewed-clock lane-L submission settles with server-derived time
  and ids; receipt labels `re-derive`; claim ledger shows claimed ≠
  authoritative.
- Sketch 7: a submission labeled lane Q obtains exactly the shipped pin's
  semantics and nothing more; no receipt ever records `re-derived` for a
  value the server did not derive.
- Sketch 10: reservation-stale attempt has no committed effect; the retry
  settles exactly once with the fresh run's re-derived values.
- Mixed queues (lane-Q and lane-L intents in one outbox) replay in client
  sequence order with per-mutation lane policy (§rule 3).

## Resolution

Closed 2026-08-02 by `e266c633` (`feat(settlement): rederive lane-L
submissions`). The server now discards client runtime answers for lane L,
records one server-owned answer ledger for preview and commit, retains client
values only as receipt claims, and keeps lane Q on the established
replay-accept pin. The client outbox durably retains the lane and synthetic
claim carrier per sequence-ordered item. No local mutation evaluator or
speculative receipt was added.

Proof:

- `local::tests::llp0133_sketches_2_and_7_apply_lane_policy_without_privilege`
- `local::tests::llp0133_sketch_10_stale_reservation_rolls_back_then_retry_rederives`
- `synthetic_lane_l_wire_submission_rederives_before_commit`
- `mixed lane-Q and lane-L intents replay in sequence with immutable per-item policy`
- `bun run --cwd packages/snapback-client test` (green)
- `./ref-check --verbose` (green: 157 LLP docs, 4,060 refs, 0 errors)

The complete Rust library run proved 1,638 passing tests and inherited the
same three deterministic live-query failures already present at the ticket's
start: `rqs_mutation_after_answer_and_register_loses_no_ops`,
`rqs_tokens_refresh_across_delta_replace_and_current_as_of`, and
`standard_pattern_live_is_conservative_and_recorded`. Each is unrelated to
the settlement files and was already recorded by ticket 02.
