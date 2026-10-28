# Proof loop residual wall time remains above LAT3 targets

Status: Open
Date: 2026-10-28
Scope: proof callers / day-two inspection scheduling; coordinate with DX16 and LAT1

LAT3 removes eager Playwright/SQLite loading and the extra JS shim for native
proof commands, preserving keeper custody, deadlines, streams and every real
command. There is no store, deployment, token or verdict cache. The paired
waves32/34 total acceptance median/p90 remains 9.684/31.127 seconds (targets
6/15); frontend median is 14.046 seconds (target 12). Probe ready median 3.134
seconds meets its target. The wave33 successful day2 median is 97.204 → 96.354
seconds, far short of a 40% reduction.

The existing [witness-tail issue](20261027-snapback4-default-check-staging-witness-tail-latency.md)
covers the engine share. Subtracting the measured enclosing security preflight
gives acceptance 3.700/7.083 → 3.364/6.636 seconds and frontend median
6.609 → 6.518 seconds. These are wall-time complements of the full preflight,
not exact witness CPU: report/witness stages can overlap and must not be added.
They do not turn the missed total targets into passes.

Day2's corresponding residual median is still 82.747 → 81.685 seconds. The
selected wave33/025 profile removes 123 JS shim processes while retaining all
130 command wrappers/keepers. Total time is 216.576 → 198.574 seconds, but its
unchanged native security envelope also varies (69.660 → 57.705 seconds), so
the whole 18-second difference cannot be credited to JS dispatch. The residual
is 146.916 → 140.869 seconds. Its two native deploys each have roughly 11 seconds
outside bind/security; startup, store access and release materialization are
not separately resolved by these timers. Release semantics were not changed.

The selected wave32/002 acceptance has a 10.867/11.017-second unobserved Node
tail after traced cleanup. Source inspection finds an uncleared authored
12-second Promise.race timer. Browser launch is only 0.12–0.13 seconds in the
selected frontend cases; fresh browser contexts are not the dominant cost.
Negative authentication tests and their real-clock throttles remain intact.

Follow up on caller timer ownership and repeated inspection work, using the
existing bounded helpers and explicit source/store/release identity. Changes
to day-two helpers/API belong to DX16. Keep all original migration, auth,
visibility, rollback, data-preservation and security assertions; do not cache
inspection results across state changes or reduce budgets to meet a wall target.

Evidence: [phase profiles](../snapback4/reports/20261027-lat3/phases.json),
[paired measurements](../snapback4/reports/20261027-lat3/summary.json).

## LAT4 followup, 2026-10-28

The complete ordered copied-lane census now covers all 120 Snapback apps in
waves 32–34 (400 pairs). Production non-security median/p90 is
1.496/3.309 → 0.409/0.815 seconds in same-version 0.4.45 controls, with complete
store/release identity in the separate controlled-clock campaign. Finite proof
completion removes both reproduced 11-second timer tails. Same-version release
inspection medians fall 0.313 → 0.118 seconds, or 0.404 → 0.116 for explicitly
selected current release. SQL/loader dispatch is already inexpensive and is
unchanged. There is no mutable-state/authorization cache.

The 40% day-two bar still fails. All 33 original LAT3 target lanes were replayed;
31 pass on both binaries. Their paired median is 94.272 → 76.376 seconds (19.0%);
the security wall complement is 81.341 → 71.028 seconds (12.7%). The two target
conservation failures and a third non-target failure reproduce without LAT4 on
0.4.45; see the anchor conservation issue. No assertion is weakened, and no
failed lane becomes a timing qualification pass.

The selected 025 proof still performs 124 native calls, including 108 SQL/data
inspections. Its finite native call wall time falls 111.018 → 30.208 seconds,
while full proof wall time falls 194.824 → 111.903. This cross-version comparison
also includes security improvements, which must not be attributed to LAT4.
Future work should measure caller/keeper spans, inspection scheduling and
awaited business/browser work on the remaining slow median lanes. Changes to
proof-kit inspection APIs/scheduling belong with DX16; witness work belongs with
LAT1. Do not skip awaited work, change release/refusal semantics or cache live
store observations to force the target.

Evidence: [LAT4 results](../snapback4/reports/20261028-lat4/README.md),
[same-version inspection controls](../snapback4/reports/20261028-lat4/inspection-summary.json).
