# 0133-03: Lane-L server re-derivation settlement path, driven by synthetic submissions

**Status:** Open
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
