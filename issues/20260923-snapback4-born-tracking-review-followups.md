# Snapback 4: born-tracking review follow-ups (the BORN-PERF equivalence test; one question on sibling grants)

**Status:** Open — P3, test strength; plus one design question for the born-grant owner
**Date:** 2026-09-23
**Scope:** `snapback4-core/src/partition/born_tests.rs`, and the in-commit
birth semantics from `0388900b8` (LLP 3000 §7)
**Source:** Grok 4.7 xhigh packets on BORN-PERF (`cda37bcfe`). Astra rated
it READY with no findings. Neither family found a behavior change in
BORN-PERF itself.

## 1. The equivalence test's strength (Grok packet 5)

- `other_messages` is declared but never written, so a Join index that
  dropped its table component would still match the reference. Write two
  content tables sharing one grant, with the same and different row ids;
  renew and undo the grant; undo one content row; and assert that the
  other table's pre-birth joins remain. Stop substring-replacing the
  schema: it renames the sibling too.
- The collision case should assert that the colliding step produced both a
  Put/Del and a Join under that id, using the production group-id
  constructor.
- Add a mid-commit `take()` after a fixed prefix. Then undo and re-log the
  same keys, and assert the suffix.
- Assert that one fixed seed's expected log is non-empty and contains both
  a row event and a join.

## 2. A question on the old semantics, which BORN-PERF preserves exactly (Grok packets 2 and 3)

When two live rows grant the same `(partition, table, group)` key inside one
commit, and one of them is undone, the `Some(earlier)` arm withdraws every
Join after the birth mark for that key. Nothing re-logs a Join for the
surviving sibling. If both rows were born in the commit, the survivor may
reach the commit boundary holding the grant with no Join logged. That would
be under-delivery, not disclosure.

This is unconfirmed. It predates BORN-PERF, and the equivalence test
deliberately freezes it. **To do:** add an exhaustive-explorer case: two
born sibling grants of one key, undo one, and check the survivor's delivery.
Fix it, or record why it cannot happen (for example, a unique key that
prevents two live rows of one key in one commit).
