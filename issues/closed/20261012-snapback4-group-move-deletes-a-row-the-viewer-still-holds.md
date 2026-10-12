# Snapback 4: a row moved between two groups a viewer holds is deleted from its device

**Opened:** 2026-10-12 (workstream UNION; LLP 3000.036.000.000 §4.2, LLP 3000.036 §1 B1 names the hazard)

A table synced to one group audience whose content group column is mutable
(`sync to members[.team]`, `team` not `immutable`) logs a move from team X
to team Y as a `put` to `g:…:Y` and then a `del` to `g:…:X` in the same
commit (`partition.rs`, `account_row_change`: puts before dels). A viewer in
both teams follows both partitions, so its device applies the `put` and then
the `del` and loses a row it may read, while its pages still say `complete`.

Union tables are not affected: R1 (LLP 3000.036.000.000 §4.2) serves every
union `del` from serve-time state, and the union simulator moves a task
between two of Alice's teams at depth 1. Single group audiences keep the
unconditional `del`.

What landing it takes:

- Server: extend R1's condition in `expand_joins` from union tables to every
  table whose group audience's content columns are not all `immutable`
  (the same fetch, whole-rule check and projection); or refuse a mutable
  content group column at `E_SYNC`, as a target's audience columns already
  are.
- Simulator: a single-audience world with a `move` between two groups a
  viewer holds (the union world's `move` is the template); it fails today.

**Resolved:** 2026-10-12, workstream UNION (round 3 of LLP 3000.036.000.000's
review, Muse finding 2). R1 now also covers a single group audience with a
content group column that is not `immutable` (`partition.rs`,
`movable_group`): the move's `del` is served from serve-time state, so a
viewer in both groups keeps the row. Pinned by
`snapback4-sim/tests/union.rs`
`a_row_moved_between_two_held_groups_of_one_audience_stays` (before the fix
the stream's last event for the row was its `del`).
