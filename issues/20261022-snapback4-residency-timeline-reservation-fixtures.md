# Residency and timeline fixtures disagree with derived source reservations

Status: Open
Date: 2026-10-22
Scope: Snapback 4 residency/timeline test fixture schemas
Severity: P2

K0-Q fix round 2's complete CLI run at `aeb62378f7` and each unchanged
isolated rerun fail with `E_SCHEMA: source reservations differ from the schema
derivation` in these four cases:

- `init::w8b_residency_measures_the_wired_calibration_shape`
- `init::w7a_residency_measures_the_wired_500_follow_reader`
- `timeline_adoption::check_and_adoption_agree_across_expiry_through_changes_and_following_presence`
- `timeline_adoption::retirement_resets_dependent_aggregates_even_when_all_names_survive`

Reproduce from `snapback4/` with `cargo test -p snapback4 --test init -j 6 --
<name> --exact --nocapture`, or `--test timeline_adoption` for those cases.
All four exact isolated reruns fail. The timeline cases modify a compiled
schema's timeline declarations/owned tables and then call `Engine::new` or
`Engine::adopt` directly; no serving committer queue or read handoff is involved.
The source-reservation validator is unchanged by K0-Q. Base-commit runtime
attribution has not been verified; do not label these inherited solely because
the lane does not edit that validator. Investigate the fixtures' derived
reservation custody, preserving validation of source/schema disagreement.

Evidence: `/tmp/sb4-k0q-fix2-final/cli.log` and isolated logs 4, 5, 8 and 9;
[lane report](../snapback4/reports/20261022-k0q/REPORT.md).


## Device observations at 2ddab22685

The complete device suite also fails eight `readauth` cases with the same
`Schema("source reservations differ from the schema derivation")`. Every exact
isolated rerun fails: `outcomes::{bridge_publish, bridge_repost, recipe_post,
recipe_repost}_{memory,sqlite}`. The failures occur at
`tests/readauth/outcomes.rs:149` or `:225` during direct `Engine::new`;
these fixtures do not submit a serving command. Reproduce with
`cargo test -p snapback4-device --test readauth -j 6 -- <full-name> --exact
--nocapture` from `snapback4/`. Logs are
`/tmp/sb4-k0q-fix2-final/device.log` and `device-isolated-{0..7}.log`.
The validator and these fixture schemas were not changed by this lane.
