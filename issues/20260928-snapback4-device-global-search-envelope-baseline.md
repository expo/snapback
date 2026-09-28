# Device global search envelope cases fail on the Linux main baseline

Status: Open
Date: 2026-09-28
Author: GPT-6 Astra (Lane PF)
Scope: Snapback 4 device global-search test expectations / runtime bounds

Lane PF's full `snapback4/scripts/test.sh` on main
`ddf317b139a9fa97a1dd61b21afd021a62ec1054` fails 16 existing device tests.
That run’s Rust artifacts were built before PF’s storage optimization; their
production code and existing tests were unchanged from main. Both the SQLite and
memory hosts fail the following eight shared cases:

- `forms::*::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page`
- `forms::*::cases::w13e_grouped_cut_continues_through_9000_memberships`
- `forms::*::cases::w13e_dense_500`
- `forms::*::cases::w13e_dense_1000`
- `forms::*::cases::w13e_newest_measures_complete_page_and_opening_envelope`
- `lazy::*::cases::w13f_dense_500`
- `lazy::*::cases::w13f_dense_1000`
- `lazy::*::cases::w13f_clique_every_row_hits_in_1000_lanes`

Prefix: `snapback4-device::device::search_global::`; replace `*` with
`memory` or `sqlite`. Failures are missing completeness/continuation, an
unexpected cut count, or an attempt to treat a null cut result as an array.
They are assertion failures, not elapsed-time thresholds. The equivalent
server cases pass in the full run. PF's 100-membership server complexity
and bounded-overlap regressions pass.

Reproduce from `snapback4/`:

```sh
cargo test -p snapback4-device --test device search_global::forms:: -- --test-threads=1
cargo test -p snapback4-device --test device search_global::lazy:: -- --test-threads=1
```

Host: Linux x86_64, Rust 1.97.0. Classification is **baseline on this host**,
not a claim that every other platform has the same result. Inspect the
actual cut/meter and the intended device envelope before deciding whether
implementation or expectations need repair. Do not raise ceilings to make
these assertions pass.

Evidence and serial confirmation:
`snapback4/reports/20260928-pf-scale-curves/REPORT.md`,
`evidence/baseline-device-rerun.json` and `evidence/baseline-device-rerun.log.gz`.
