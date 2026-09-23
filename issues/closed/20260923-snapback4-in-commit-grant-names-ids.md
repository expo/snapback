# Snapback 4: a grant that ends inside its own commit still puts ids on the wire

Status: Closed — fixed 2026-09-23 (option (a) below)
Priority: P3
Observed: 2026-09-23
Baseline: `440973d7f` (0.2.33)
Found by: exhaustive small-scope checking, `snapback4/crates/snapback4-sim/tests/exhaustive.rs` (every sequence of two writes over two viewers and two conversations, commissioned by Charlie Cheever as a trial of exhaustive and formal methods on disclosure).

## Evidence

The mutation `blip` in `exhaustive.rs` inserts a membership and deletes it in
one commit. This is the shape of review finding 4, tested by
`reviews.rs::p4_a_grant_that_ends_in_its_commit_delivers_nothing`. No row image
crosses the wire, so the fix holds for content. Two kinds of id still cross it:

1. **The grantee learns the group's id.** Suppose `dev:alice`, admin of `c1`,
   runs `blip(c1, public)`. Then `stream("public", 0, 1)` returns
   `scope conversations/[{"Id":"c1"}]`, and the same for `memberships`,
   `messageCounts` and `messages`, at the blip's sequence. `public` held `c1`
   at no commit boundary, and it had no other way to learn the id. The same
   holds for a stranger who is blipped.
2. **Every member of the group learns a row id that never existed.**
   Each member receives `del memberships/<id>` for the transient row. That
   row existed at no commit boundary.

The explorer tolerates both, naming this ticket, and fails on anything else.
At depth 2 it tolerated them at 688 and 2,592 events.

Severity: metadata only. A conversation id reaches a principal outside the
conversation, and a transient row id reaches the group's members. No row
content leaks. Test p4 asserts only that no `put` crosses, although its name
says "delivers nothing".

## Implementation locations

Paths are relative to `snapback4/crates/snapback4-core/src/partition.rs`.

- **`account_row_change`** logs a `join` and then a `scope` for a grant that
  ends in its commit. The comment above `if let Some((partition, group)) = &was`
  says the same commit's join and scope "deliver nothing". The `join` expands
  to nothing, but the `scope` is streamed.
- **`append`** coalesces a put followed by a delete to "the delete alone". Its
  comment says an image that did not survive the commit never crosses the
  wire. That is true of the image but not of the id.
- **Related (not a defect).** `stream` re-reads current row images, so
  coalescing is redundant for streams. Mutating `append` to keep every event
  changes nothing any stream delivers; the mutation test in the 2026-09-23
  journal entry shows this.

## Acceptance

Choose one:

- **Fix.** Within one commit, a `join` and a `scope` of the same (partition,
  group) that the partition did not hold before the commit log nothing. A put
  then delete of a row absent before the commit logs nothing.
- **Or rule the ids acceptable.** The tolerance then becomes the documented
  contract. In that case, correct the two comments and the name of p4.

In either case, remove the `KNOWN` tolerance in
`snapback4/crates/snapback4-sim/tests/exhaustive.rs` so the explorer enforces
the outcome.

## Resolution — 2026-09-23

Fixed as option (a), commissioned by Charlie Cheever. The rule and its
reasons are recorded in
[LLP 3000 §7](../../llp/3000-snapback4.explainer.md#7-decisions-during-execution):

- a born row logs only its final image;
- a born grant stays born through renewals and expiry until undone, and
  shares its birth with born siblings of its key;
- events from before a birth stay;
- a renewal is not a birth;
- a replacement beside a pre-commit predecessor is not a birth.

Both comments this ticket named are corrected.

Astra reviewed the change over five rounds
([record](../../llp/reviews/3000-in-commit-grant-names-ids.astra.md)). Rounds
1–4 were NOT READY, with six findings, two of them High; every one is fixed,
and each is a test. Round 5 was READY.

- **A pinned behavior changed.** The W13g same-commit `rejoin` fixture and
  its JS twin had pinned the old log. They now expect one join and no scope.
- **One inherited Medium is fix-forward:**
  `issues/20260923-snapback4-already-expired-grant-names-ids.md`.

Tests:

- **`exhaustive.rs`.**
  - It no longer tolerates the finding.
  - It gained `churn`, which re-creates a count row within one commit.
  - Without the fix it fails on both original kinds (688 and 2,592 events
    at depth 2).
- **`reviews.rs`.**
  - p4 asserts its name: the grantee's stream is empty, and no member sees
    the transient row's id.
  - Eight new cases cover renewals, re-grants, expiry, replacements,
    same-commit siblings, re-created rows and moved rows. Each fails on the
    version before its fix, or on an over-eager variant.
