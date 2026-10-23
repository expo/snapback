# Residency and timeline fixtures disagree with derived source reservations

Status: Closed
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
[lane report](../../snapback4/reports/20261022-k0q/REPORT.md).


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

## Also seen: 0.4.38 publication, Linux qualify at `cadb7c55be` (2026-10-22)

The same error is wider than these four cases. At `cadb7c55be` (the origin/main tip), the full suite failed 19 Rust tests in 6 targets, plus one client test:

- `snapback4-device::readauth`: 8 tests;
- `snapback4-lang::live_parent`: 6 tests;
- `snapback4-sim::maintains_recorded`: 2 tests;
- the four cases listed above;
- `snapback4-lang::declarative_receipts`, the prediction round1 authentic-predecessor case, which fails with `add: execution facts changed without a program change`;
- `packages/snapback4/test/residency.test.mjs` test 6.

Both messages come from `snapback4-core/src/engine/activation_facts.rs`, which `202826334f` added (merged by `c3f23ff2c2`). `maintains_recorded` fails on its own on Linux (2/2) and on the Mac (1/1). 0.4.38 was published from `951ecdd4df`, which comes before the merge. Evidence: `snapback4/reports/20261022-publication-0.4.38/superseded/attempt-1-cadb7c55be-linux/`.


## Resolution — Integration 23, 2026-10-23

Resolved by refreshing derived reservation/receipt facts after raw fixture schema
composition (`df20ca427c`, `9f186d6d43`), plus the narrowly scoped legacy previous-layout
normalization in `1daadaf4aa`. The latter requires an unchanged executable program
map and candidate equality; forged execution changes still refuse. Production
source/schema validation and assertion coverage remain intact.

Affected CLI init/timeline, device read-authority, language live-parent and
receipt, simulator recorded-maintain and client residency checks are included in
Integration 23's Linux and Mac qualification. Final evidence and exact scope are
recorded in WORKSTREAM-REPORT.md and snapback4/reports/integration23/. The original
publication evidence above remains a record of the unfixed base, rather than a
claim that those failures were inherited before their introducing merge.
