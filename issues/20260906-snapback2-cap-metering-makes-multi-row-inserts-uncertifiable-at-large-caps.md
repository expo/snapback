# snapback2: cap metering charges N examined per capped write, so a large cap makes multi-row inserts uncertifiable

**Date:** 2026-09-06 · **Area:** snapback2 certificate / `cap N by` (LLP 1017) · **Source:** Clique full run, astra-snapback2 lane (run-log lines 71–72, `snapback/schema.q`)

## What happened

The builder declared `cap 1000 by principal` on `memberships` (the fixture's main actor belongs to
1,000 conversations) and then could not certify a single group-creation mutation that inserts
49 membership rows: each capped write site is metered as N examined, so 49 × 1,000 exceeded the
10,240 examined ceiling. The workaround was to create a group with at most 7 invitees per mutation
and add the rest through ordinary `memberAdd` calls, so a 50-member group is a multi-step,
non-atomic sequence. The builder's own summary: "initial group create capped 7 invitees under
compiler ceiling, UI adds remaining invitees through normal memberAdd calls."

The rule is LLP 1017's "metering N examined per capped write site". It is correct as a bound on
the naive check (scan the group up to N), but it is a poor price when the engine could count the
group from a maintained count or from the cap index in O(1), and it couples an unrelated cap
(memberships per user) to the admitted size of a write on a different axis (members per
conversation).

## Proposed

1. Meter the cap check against a maintained per-key count (one point read per distinct key per
   mutation), not N examined per row; or at least charge N once per distinct `(table, key)` in a
   mutation rather than once per inserted row.
2. If the metering stays, say so on the Quarry guide's cap page with the arithmetic, so a builder
   can predict that `cap 1000` admits about ten inserts per mutation.
3. Regression fixture: a mutation inserting 49 rows into a table with `cap 1000 by <other column>`
   must certify.

Related: LLP 1017 §3 (metering), LLP 1001 §9 (ceilings).
