# Experimental-registry additions lack maturity transition records

**Opened:** 2026-08-03
**Resolved:** 2026-08-03
**Systems:** Capability maturity (LLP 0134), proof gates

`scripts/check-capability-maturity.mjs` requires every single-parent commit
that changes the experimental capability projection to introduce exactly one
`.demotion.json`/`.promotion.json` record in the same commit
(`validateTransitionRange`). The initial report identified three landed
registry additions with no record:

- `eaecfb3a` — `sequence_allocation_v1` (main)
- `532d56ee` — `vector_search_v1` (main, superseded implementation; the id
  survives in the reconciled tree)
- `353fd746` — `snapshot_batch_v1` (wave-resume umbrella branch, merged
  2026-08-03)

The gate passes today only because the local proof validates the default
range, which on main resolves to `HEAD^..HEAD` (and skips merge commits), so
these historical commits are never in scope. Any explicit `--range` sweep
across them fails with `MATURITY_TRANSITION_RECORD_MISSING`.

The `.demotion.json` schema also cannot express "new id introduced at
experimental" — it models stable→experimental demotion and demands a
`voidedReceiptRef` naming a prior promotion receipt, which never existed for
these ids. Either the schema needs an introduction record kind, or the range
validator needs to treat first-appearance-at-experimental as its own case.

**Next:** decide the record vocabulary for experimental introductions (LLP
0134 owner), then backfill records or explicitly exempt the three commits.

## Resolution

Resolved with LLP 0134's `MaturityIntroductionRecordV1`. Registration now has
its own `unregistered` → `experimental` vocabulary and a closed
`*.introduction.json` suffix. Future registrations require a
`same-commit.v1` record and the full atomic code/test/doc/guide/board shape.
The repair permits `historical-backfill.v1` only for an exact LLP-owned table;
arbitrary post-hoc records fail closed.

A new canonical full-registry history projection is emitted from Rust's
`TargetCapabilityId::ALL`. The range checker compares parent and transition
projections to derive whether an experimental addition was absent
(introduction) or already registered (demotion), so a record cannot relabel a
demotion to evade its prior-receipt requirement.

The complete projection-history audit corrected the preliminary census:

- `eaecfb3a` introduced `sequence_allocation_v1`;
- `353fd746` introduced `snapshot_batch_v1`;
- `3bea0bbb` introduced the previously omitted
  `live_full_text_search_v1`; and
- `79b7f618` introduced `vector_search_v1`. The reported `532d56ee` commit
  implemented the already-registered vector id but did not change the
  experimental projection.

Each real transition now has a canonical historical introduction record that
binds its full commit, sole parent, exact added id set, governing LLP, and
normalized committer timestamp. Focused unit tests cover the forward
same-commit path and closed-backfill refusal. Explicit checks of each of the
four historical `commit^..commit` ranges pass with exactly one introduction.
