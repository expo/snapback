# Certified output ceiling accounts declared row maxima, not projected fields

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
