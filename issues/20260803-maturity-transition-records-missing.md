# Experimental-registry additions lack maturity transition records

**Opened:** 2026-08-03
**Systems:** Capability maturity (LLP 0134), proof gates

`scripts/check-capability-maturity.mjs` requires every single-parent commit
that changes the experimental capability projection to introduce exactly one
`.demotion.json`/`.promotion.json` record in the same commit
(`validateTransitionRange`). Three landed registry additions carry no record:

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
