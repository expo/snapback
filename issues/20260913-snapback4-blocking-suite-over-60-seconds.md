# Snapback 4: warm blocking suite exceeds the 60-second budget

**Status:** Open
**Priority:** P0
**Date:** 2026-09-13
**Systems:** `snapback4/scripts/test.sh`, the simulator and development loop
**Author:** Codex / GPT-6 Astra

At `2063884c8fd40c672158d4b4e3187864192db11c`, the full suite completed with
zero failed assertions in 72 seconds twice, including the publication
path's repeat from an already built checkout. The adopted rules budget is
60 seconds. This is a timing failure; correctness and installed-consumer
publication checks passed. The release was published through the existing
publication path, which refuses assertion failures and currently reports
elapsed time without enforcing the time budget.

Reproduce from `snapback4/` with Node 24.18.0 on PATH, Bun 1.3.12, Rust 1.97.0,
CARGO_BUILD_JOBS=4, installed frozen-lockfile dependencies, and
`bash scripts/test.sh`. Both observations were on the shared M5 Max Black
machine. Shared load may contribute; no causal attribution has been proved.

The publication run's 14-test simulator unit group took 28.15 s; fixture
wrapper tests took 5.99 s and client tests 14.52 s. The prior 0.1.14 publication
on this machine took 51 s overall, with the 14-test group 20.65 s. Main's
rusqlite 0.32 → 0.40.2 update is among the inputs that changed. The new HTTP
framing/version unit group took 0.01 s. Stage-level timing and an equivalent
current-main control are needed before blaming a particular change.

Evidence and the exact release pin are in
[the catalog record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md).
Detailed local logs are retained under
`.llp/ship-runs/sb4-performance-20260913/catalog-{final-suite,publish}.log`.

Resolution: restore the existing complete suite to the 60 s budget on an
appropriately idle documented host, without dropping correctness assertions,
raising the budget, or adding a gate. Record before/after step timings and
close this ticket once the warm repeated run fits.
