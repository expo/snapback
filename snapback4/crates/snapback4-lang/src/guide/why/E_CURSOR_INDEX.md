# Indexes — E_CURSOR_INDEX

E_CURSOR_INDEX concerns an older explicit index that lacks a total order.
For new reads, use `tasks where .ownerId = viewer first 20 by .at after c`:
the planner adds the id tiebreak. For a non-unique explicit index, append `id`
to its definition or apply the diagnostic's mechanical `check --fix`.
Keep nullable unique constraints unchanged; use the column-ordered read
above to obtain a separate page index without weakening uniqueness.

For a table, order keys after `id` are redundant and omitted: `by .id, .at`
uses the same index and cursor as `by .id`. View orders retain later keys,
because distinct branches may carry the same source id; branch identity
breaks any remaining tie.

A direct table or maintained-view cursor binds the evaluated prefix and active
generation. Another prefix or schema adoption refuses it. Ordinary writes keep
it valid, but a changing order can move rows across the cursor. Refresh a live
ranking; continuation is not a snapshot. Planned unions preserve branch and
source-row identity, even when two tables contain the same id.
