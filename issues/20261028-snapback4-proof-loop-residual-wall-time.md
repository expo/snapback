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
