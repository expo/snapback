# Snapback 4: maintained-column review follow-ups (F1a, F1b, F1 x F3)

Status: Open
Priority: P3. These are test-strength and tooling items. No production defect
is known from them.
Date: 2026-09-23
Systems: `snapback4-device/tests/maintains/columns.rs`,
`snapback4-lang/tests/maintained_columns*`, `snapback4-core/tests`,
`snapback4/tests/check.rs`, `scripts/measure-column-activation.mjs`,
`scripts/test.sh`
Evidence status: blind reviews (Grok 4.7 xhigh packets, Astra xhigh) of F1a's
final delta, F1b's review round 1, and the F1 x F3 composition fix

## Why this is a ticket, not another round

F1a used its three review rounds: two fix rounds and the finalize commit.
Astra's final verdict was READY with no findings. F1b's round 1 left one
Astra Medium, fixed at landing. These notes are the review findings that
survived verification but did not justify another round. Every claimed
production defect in these reviews was checked against the code or run, and
refuted. Two examples: "does not compile" (twice), and "17 bytes is too small
for an i53".

## 1. The published-binary fence is skipped by default (tooling, first)

`scripts/test.sh` runs `schema-capabilities.test.mjs` only when
`SNAPBACK4_FENCE_PUBLISHED` names a tarball cache. Otherwise the three
published-0.2.33 fence tests (timeline, recorded-attribution,
maintained-column) are skipped, and an ordinary green suite does not prove
the fence. `publish.mjs` inherits the same default.

**Fix:** make the publication path set the cache, or fail when it is unset.
Consider running the fence by default whenever the registry is reachable.
The 0.3.0 publication sets it by hand.

## 2. Test strength (F1a final delta, Grok)

- `snapback4-device/tests/maintains/columns.rs`, `run`:
  - Restart while a mirrored total is still nonzero. Today the only restart
    happens after the unlike, at `[0, 0, 0]`. After it, compare the full
    device row to the server row.
  - Pin each loop step's predicted path exactly.
- Same file, `recorded_projection`:
  - Refuse a client-supplied `postId.parentId` through the projected
    operation, not only through literal-IR forges.
  - Give post `p` a non-null parent, so the recorded value is distinctive.
- `snapback4-core/tests/maintained_columns_review.rs`: bind one raw schema,
  and assert that both the validation issues and the `Engine::memory` error
  exclude every private target.
- `schema_capabilities.rs`: derive `maintained-column` from a schema with
  private maintains and no column metadata, and the reverse, each in
  isolation.
- `snapback4-lang/tests/maintained_columns.rs`,
  `resolved_dependencies_and_private_projection`: compile the rewritten base
  before inserting each refused line.
- `creators_cannot_observe_hidden_totals…`: scan the meter and failure
  reason for private target names, and assert `maintains` is non-empty.
- `maintained_columns/review.rs`:
  - Restore and import checks should require exactly one private row, not
    read `rows[0]`.
  - The cascade refusals should assert the error code, not `is_err()`.
- `snapback4/tests/check.rs`: scan stderr as well as stdout for private
  target names on `data`, `sql` and `why`.

## 3. Test strength (F1b round 1)

- `maintained_columns/activation.rs`, expired-parent test: key the no-write
  trigger to the stored id of `id("p")`, and re-read `at` and `expiresAt`.
- The Trending tests' quiet-parent storage assertions should name which zero
  representation they expect:
  - a parent born after the column exists stores an explicit 0 (F1a birth);
  - a parent that activation leaves at zero stays absent (F1b).
- `measure-column-activation.mjs`:
  - write `result.json` with `gate5: "FAIL"` and the failing clause before
    asserting;
  - log the seeded counts as the actual batch length.

## 4. Composition (F1 x F3)

- There is no runtime test for a mapped **source** counted onto an
  **ordinary** parent, for example an ordinary table counting the timeline's
  cards. The core raw-schema test covers its admission, and
  `maintained_columns_on_mapped_tables_leave_timeline_state_identical` covers
  mapped parents with ordinary and mapped sources.
- An owned **parent** cannot be declared in Quarry, because the timeline
  generates its owned tables. The core raw-schema test covers its refusal,
  but no binder test does.
