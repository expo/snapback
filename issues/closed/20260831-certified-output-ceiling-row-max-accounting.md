# Certified output ceiling accounts declared row maxima, not projected fields

**Status:** Closed

**Opened:** 2026-08-31 · **Systems:** snapback2 certificate, query planning, DX
**Source:** first Clique diagnostic run (cold lane, packaged tarballs) — RUN-DIARY in the run artifacts.

The ~1 MiB certified output ceiling is computed from table-declared row
maxima (an id-typed column priced at ~600 B), not from the fields a query
actually projects. A cold lane hit `E_BOUND` on ordinary screens and had to
ship real product caps to get under it: Following feed merged over only
viewer + 12 most recent follows, conversation list capped at 40, thread
pages at 25. The refusal shows the product math (good) but the fix distorts
the schema/product rather than the projection. Wanted: projection-aware
output accounting (price the shape, not the row), or a declared per-op
projection width the certificate checks.

## 2026-09-11 triage and resolution

**Priority:** P2. **Disposition:** Closed; projection-aware output and closure
accounting is implemented.

Commit `fc450e4cc` changed `certificate/output.rs` and `retention.rs` so a
field on a known row base is priced by `declared_serialized_column_max`,
coalesced fields from the same base form one projection, and only a complete
`*`-equivalent projection uses whole-row width. Its pinned 20-by-50 focused
shape certifies at 822,692 output bytes; the deliberately wide shape refuses
at 1,820,692. Packaged `guide programs` now states that canonical JSON byte
bounds price selected fields and that `*` selects all.

**Verification:** `cargo test -p snapback2-core --test estimate_row_width`
passed all six tests on 2026-09-11, including
`closure_objects_never_merge_distinct_row_bases`,
`canonical_array_and_whole_row_pins_cover_the_review_cases`, and
`corpus_output_estimates_bound_recorded_canonical_results`. The ticket's
projection-aware acceptance is satisfied.
