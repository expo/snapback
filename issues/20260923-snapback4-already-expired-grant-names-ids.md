# Snapback 4: a grant inserted already expired still names its row and group

Status: Open — partly fixed 2026-09-23. Nothing leaks before a sweep; the physical sweep's `del` and scope remain (see Progress).
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

