# Snapback 4: the scale certificate calls the paved Following feed "grows with data"

- **Opened:** 2026-09-26, from calibration #21's builder diary ("The home query's
  cost report still lists growth, so I am not treating short functional tests
  as a scale proof") and a supervisor check.
- **Area:** `crates/snapback4/src/scale.rs` (`scan_with_window`), `scale/display.rs`
  (`summary`), `guide bounds` (the scale certificate section).
- **Severity:** Medium for developer experience and scale confidence; there is
  no runtime defect.

## What happens

`check` on the feeds card's own Following program prints:

> scale: 6 of 8 operations are constant; 2 grow with data (home, cards)

`check --cost` gives the reason:

> Following `following` entries skipped by retired follow epochs or removal
> tombstones before 20 match; rewrite: pin the filter column in the read, or
> add a view indexed by that predicate

The skipped entries are a transient backlog. An unfollow or a removal retires
inbox entries, and background cleanup purges them in chunks of at most 256.
Until then, the read meter bounds each page, which stays partial with a
continuation. The rewrite advice cannot apply: the platform owns the view. The
same holds for expired rows not yet swept, which the certificate also counts as
growth.

## Direction

Add a third verdict for work bounded by a background backlog, for example
`scale: constant once cleanup catches up (at most <meter> examined while it runs)`.
Count it separately in the summary: "6 constant; 2 bounded by background
cleanup (home, cards); 0 grow with data". Give it no rewrite. Update the JSON
class, the `guide bounds` text and the pinned expectations. A real residual
filter over application data stays "grows".

## Resolution

Resolved 2026-09-26 in the 0.4.3 integration (LLP 3000.013 §14.5). The scale
certificate has a third class, `backlog`, for work that a background sweep
removes: Following feed entries an unfollow or a removal retired, and expired
rows the expiry sweep has not reached. The feeds card's own program now reads
`scale: 6 of 8 operations are constant; 2 constant once background cleanup
catches up (home, cards); 0 grow with data`. A `backlog` certificate keeps the
read meter's allowance, and its verdict names what the cleanup removes. A real
residual filter over application data, a per-row read rule, and a maintained
aggregate over expiring contributions still grow.
