# Snapback 4: a grant inserted already expired still names its row and group

Status: Closed 2026-09-24. A program commit retires the rows it inserted already expired (see Resolution).
Priority: P3
Observed: 2026-09-23
Found by: Astra's fifth-round review of the in-commit grant fix
(`llp/reviews/3000-in-commit-grant-names-ids.astra.md`, round 5), which
judged it inherited and non-blocking. It is present at `327fa6eac`, before
that fix.

## Evidence

In `EXPIRING`, the fixture in `snapback4/crates/snapback4-sim/tests/reviews.rs`,
`join` writes `until: 100`. Run it for `dev:alice` at time 150, so the
membership is expired when it is inserted. Then stream Alice from the
preceding watermark at time 151, at page size 1 or 1000. She receives
`del members/<id>` and `scope notes/["g"]`, although the row was never live
and she held the grant at no commit boundary.

- The expired put becomes a deletion where the stream re-reads current
  images (`partition.rs`, the `put` normalization in `expand_joins`).
- Logical-expiry handling appends the scope for an open span whose lifetime
  has already ended (`partition.rs`, `stream`, after catch-up).

Severity: metadata only. A row id and a group id reach a principal who never
held the grant live. No row image leaks. This is the same class as the
in-commit grant finding (`issues/closed/20260923-snapback4-in-commit-grant-names-ids.md`).

## Acceptance

A grant whose lifetime has ended by the time it is committed must not reach
its grantee: no `del` of its row and no scope for its group. That holds at
both page sizes, on a fresh stream and on catch-up. A grant held live at an
earlier commit boundary must keep its revocation. Add the reproduction beside
the in-commit cases in `reviews.rs`. The exhaustive explorer has no expiring
audience, so consider an `EXPIRING` variant of it too.

## Progress — 2026-09-23

Fixed, recorded in LLP 3000 §7, with Astra's review in
`llp/reviews/3000-already-expired-grant-names-ids.astra.md`:

- **At commit.** A row born in the commit whose final image is already
  expired logs no put. The stream would re-read it as absent and send its id
  as a `del`.
- **Before a sweep.** Logical expiry appends a scope only for a grant once
  held live. A chain whose every join had ended by its own commit (compared
  against the join's explicit lifetime) stays silent, including when the
  watermark has passed the join.
- **Held at the watermark.** For a span held at the watermark, the chain is
  walked back to its last scope, so a live predecessor keeps its revocation.

Tests in `reviews.rs`:

- `a_grant_inserted_already_expired_reaches_nobody`
- `a_never_live_grant_stays_silent_across_watermarks`: the next poll,
  snapshot then poll, and a two-page catch-up.
- `a_grant_live_at_its_commit_still_revokes_when_it_expires`
- `a_never_live_replacement_keeps_its_live_predecessors_revocation`
- `a_live_chain_still_revokes_when_a_page_ends_at_its_never_live_join`

Each guard fails if the rule is loosened to the last span, or if the chain
walk is removed.

**Remaining: the physical sweep.** A later `sweep_expired` of such a row
still logs `del members/<id>` and `scope notes/["g"]` in the sweep's commit,
and the stream forwards both. Deciding that a swept grant was never live
needs the principal's log history (the grant's joins and their lifetimes)
at write time. `account_row_change` sees only `Rows`, which has no log
access. Two ways forward, a decision for the engine's owner:

- give the write path read access to the partition log;
- record liveness where the sweep can see it.

The same applies to any synced row with an `expire` column that was
inserted already expired and later swept. Its `del` names a row no device
received.

## Resolution — 2026-09-24

Charlie chose the third way: **a row whose lifetime ended by its own
commit's end is retired in that commit.** The sweep then never sees it. The
rule is in LLP 3000 §7. The review record is
`llp/reviews/3000-retire-expired-births.astra.md`.

- **At commit end.** `Runner::retire_expired_births` removes each row the
  commit inserted into an expiring table if the row is expired at the
  commit's `now`. It runs in mutations, job chunks, native chunks and the
  Postgres adapter.
- **Nothing is logged.** It uses the sweep's `remove`. The rows are born,
  so the born-row rule withdraws their events and a born grant logs no
  scope. A replacement beside a pre-commit predecessor still logs the
  predecessor's owed scope.
- **A row revived in its commit survives.** Here, revived means updated to
  a lifetime that is still live before the commit ends.
- **Aggregates.** They take one net change per row, applied after every
  removal. A maintained table cannot expire.
- **Cost.** The work is linear, because each audience key is scanned once.

Tests are in `snapback4/crates/snapback4-sim/tests/reviews.rs`:

- `an_already_expired_grant_is_retired_in_its_commit`: the sweep
  reproduction above;
- `a_row_revived_within_its_commit_survives`;
- `an_already_expired_content_row_is_retired_and_counts_stay_true`;
- `retirement_reaches_no_total_the_commit_never_held`;
- `a_maintained_table_cannot_expire`.

The core test `engine::retire_tests::retiring_expired_siblings_scans_their_key_once`
covers the cost.

**Not covered: seeds, loads and activation.** They write rows without a
program, and they keep an already-expired row for the sweep. Its `del` and
scope still reach the wire when it is swept. Those writes are the operator's,
not the application's. If that ever matters, the same retirement can run at
the end of a load.

