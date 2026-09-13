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

Follow-up on 2026-09-13: the borrowed-JSON/prepared-statement candidate passed
all assertions in 124 s, then 85 s warm. Stage timing of the warm run placed
26.2 s in Cargo tests and 35.6 s in launching the chat check, whose own compiler
timer reported 4.2 ms. Direct follow-up launches, including after Cargo tests,
took milliseconds and did not reproduce that delay. It remains intermittent
and unattributed; no macOS security settings were changed. Isolated simulator
runs of the SQL-statement substitution alone had variable wall/CPU time, so
that substitution is not claimed to resolve this ticket.

The next candidate shares one freshly parsed diagnostic snapshot across the
four fixed chat checks, preserving their order and watermark history. Ten
before/after fault and day-two scenarios produced identical trace digests,
trace lengths, final host states and reports. Timing and the complete-suite
budget still require qualification before closure. Retained evidence includes
`borrowed-cached-warm-suite-timing.json`, `sim-cache-comparison.json`, and
`chat-trace-{control,shared}.txt` in the same ignored run directory.

During qualification after the 0.1.16 version rebuild, another slow test
launch was sampled for one second. The process was at `_dyld_start + 0` in
all 893 samples, with a 96 KiB footprint and no loaded binary image list;
its application tests had not started. This narrows that observed pause to
process launch, without identifying the underlying macOS cause. The host
was M5 Max Black, macOS 26.6.2 (25G83), with load averages 42.39/31.39/23.10.
The sample is `shared-suite-sample-70679.txt` in the run directory.

That complete run finished with zero failed assertions in 676 s (675.06 s
on the stage timer): Cargo build 7.50 s, Cargo tests 610.11 s, and the chat
compiler launch 33.318 s. The simulator group itself took 8.54 s. This run
predates main's subsequent correctness fixes and the integrated vendor patch;
the sampled pre-main pause does not establish the cause of every delay.

After integrating those changes, Linux qualification on the Office M1 Max's
four-vCPU/12-GiB Colima VM passed all Rust tests and client assertions using
`TMPDIR=/tmp`. Its fifteen-test simulator group took 51.21 s. The script
reported 105 s and one failed stage because the copied source initially
lacked the shared root benchmark fixture pack. With that exact committed
pack copied, all nine fixture tests passed separately in 40.716 s. The React
browser lifetime group was skipped because Chromium is absent in the VM;
the native process-core test passed. These separate runs establish no
complete-suite budget pass.

The integrated Darwin publication suite at landed `d5215e6d2` subsequently
passed every stage in 112 s: all Rust groups, nine fixture tests and all
94 client tests, with no skips. The simulator's fifteen-test group took
10.24 s, fixture tests 6.377 s and client tests 10.559 s. At 55 s after the
first test executable launched, another one-second sample caught it at
`_dyld_start + 0` in all 93 samples, with a 96 KiB footprint and no binary
image list. It later ran successfully. This is further evidence of an
intermittent pre-main pause on this host, not an explanation for every
second of the run or a suite-budget pass. Evidence:
`production-016-publish.log`, `production-publish-processes.jsonl`, and
`production-suite-sample-3189.txt` in the same ignored run directory.

Resolution: restore the existing complete suite to the 60 s budget on an
appropriately idle documented host, without dropping correctness assertions,
raising the budget, or adding a gate. Record before/after step timings and
close this ticket once the warm repeated run fits.
