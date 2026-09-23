# Snapback 4: a grant inserted already expired still names its row and group

Status: Open
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
