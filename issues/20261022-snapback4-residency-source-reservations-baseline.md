# Snapback 4 residency and adoption fixtures reject derived source reservations

Status: Open
Owner: unassigned (outside wave-24 DX7)
Discovered: 2026-10-22, sb4-b24-dx7 full five-crate tests

`init::w7a_residency_measures_the_wired_500_follow_reader` and
`init::w8b_residency_measures_the_wired_calibration_shape` fail with
`cannot open a store: E_SCHEMA: source reservations differ from the schema derivation`.
The affected test/fixture sources are unchanged from origin/main.

Both failures reproduce using an origin/main `cadb7c55be` CLI built from a
disposable git-archive source snapshot. The existing test executable's single
embedded CLI path was redirected to that baseline with an equal-length path;
no assertion, fixture or engine code was changed in the comparison executable.
Baseline build, exact hashes/path substitution and the two failure logs are in
`~/sb4-loop/dx7-baseline-provenance.json` and
`~/sb4-loop/dx7-residency-baseline-{1,2}.log` on the DX7 Linux host. The disposable
source and build outputs were removed after the comparison.

The full run also reports the same schema error in
`timeline_adoption::retirement_resets_dependent_aggregates_even_when_all_names_survive`
and `timeline_adoption::check_and_adoption_agree_across_expiry_through_changes_and_following_presence`.
Both now reproduce on an unmodified origin/main git-archive source snapshot,
as do eight `snapback4-device --test readauth` recipe/bridge outcomes:
`recipe_{post,repost}_{memory,sqlite}` and
`bridge_{publish,repost}_{memory,sqlite}`. All twelve failures share the exact
source-reservation schema error. The baseline readauth census passes (80 passed,
8 failed overall); timeline_adoption reports 13 passed and 2 failed.
Commands, source commit and cleanup are recorded in
`~/sb4-loop/dx7-baseline-extra-results.json`; complete logs are
`dx7-baseline-readauth.log` and `dx7-baseline-timeline_adoption.log` beside it.
The disposable source and target were removed. Investigate these alongside
the residency failures. Do not normalize away the reservation census or raise
a bound to clear them.

Reproduction: run the two named `init` tests on origin/main with
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
Inspect the reservation derivation/validation around following/timeline fixtures
before changing language or authority semantics. Governing design:
LLP 3000.009.001.000 and LLP 3000.007.
