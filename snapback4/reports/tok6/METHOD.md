# TOK6 measurement method

These are paired, whole native builder sessions, one attempt per selected idea
and artifact revision. This is a small observation, not a population or causal
claim. Dollars are primary; token and call counts diagnose the result.

The four preselected Codex ideas are wave34 assignments 1 (CPAP, Expo), 2 (Canine,
React), 5 (Short-Term Rental Licenses, React), and 39 (Boat Shrink Wrapping,
React). The two Muse ideas are 18 (Horse Trailer Rentals, React) and 19 (Child
Talent Bookings, Expo). Both before and after start with an empty, uninstalled
application directory; BRIEF.md is the only initial file. No packet reading is
forced, no transcript is truncated at wiring, and no completed high-cost lane
is dropped or rerun for a cheaper result.

`replay.mjs` renders the exact current `~/sb4-loop/bakeoff/brief-bakeoff.md` and
`backends/snapback.md`, extracting frontend notes/proof instructions from the
harness's FRONTENDS object. It uses the harness builderEnvironment and process
shims and the native CLI flags/model/reasoning settings from run-bakeoff.mjs.
Only task-owned directories, port ranges and the local npm registry overlay
change. All six paired briefs match after path/port normalization; input hashes
are in evidence/method-inputs.json. The overlay supplies the pinned frozen
client, platform and Expo tarballs; it forwards other dependencies to the
existing registry and never changes that registry. Native sessions continue
through terminal exit and REPORT.md. Harness post-build scorer/probe/feedback
phases are not run: there is no application capability or bakeoff score claim.

Before artifacts are frozen from 55a4d4e39c (0.4.49); after artifacts are from
eafcd61d87 (0.4.49). Subsequent commits contain reviews/evidence, assertions and
consumer fixtures; main's merged changes are test-only. All shipped product
inputs are unchanged from that after snapshot. Hashes are in evidence/artifacts.json.
Both replay platform packages contain matched dev-profile native binaries
(incremental=0, debug=0), not the optimized publication binary. This limits
runtime/performance interpretation. The unchanged device wasm is optimized.
The separate consumer-only proof builds and packs the real production static
musl binary, so installed-consumer correctness does not rely on the dev binary.

A provider-capacity interruption killed the first replay driver and unfinished
before runs 5/39/18. Completed before 1/2 remain; unfinished runs are archived,
excluded from paired measurements and restarted in fresh before-r2 directories.
Before 19 was first launched in before-r2. The valid result set contains exactly
six terminal runs per phase. One early after driver failed before model launch
because npm pack had not completed; it contributes no model session. The Muse
wrapper's plan-quota fallback to its supported API path is retained. No key
file was opened or copied.

`measure.py` parses the complete native session records, using the existing
wave34 parser's tool classification. It omits poll records from command counts.
Dollar rates are the frozen `prices.json` version 2026-10-28.1, including cached
input and output separately. Long-context rates are selected per request, never
from a lane's cumulative input. Reasoning is already within output and is not
charged twice. `price-audit.mjs` independently reconciles every request with the
harness priceUsage({perCall:true}). Codex request sums reconcile exactly with
its terminal input/cached/output counters. One repeated cumulative token_count
in after idea 5 is deduplicated; the raw trace is preserved and the duplicate
count is explicit. Muse uses native session usage events, including wrapper
fallback sessions; terminalReconciled=false means no equivalent Codex terminal
counter exists, not that the Muse calls were estimated.

`referenceFile` counts explicit long reference filenames or reference/*.md read
commands; `fullReferenceCats` is the subset containing cat. It is a command
census, not an inference that all bytes were delivered. `referenceGuide` counts
package-reference CLI commands. `wiringLookups` counts client/react/auth/generated
guide commands; `wiringCalls` counts distinct model turns issuing those commands
(batched commands can share a turn). `generatedApiReads` counts read commands
naming generated/api.ts. The census cannot prove that the model cognitively
used a packet. Per-lane counts and call indices are retained without app secrets
or raw tool bodies in evidence/measurements.json.gz.

`package-budget.mjs` measures the actual client tarballs with o200k_base: a
sorted recursive file listing, then every .md file except README.md. The after
package has README.md as its only Markdown file. This explicit proxy satisfies
the 3,000-token package-reading bound; it is not a dollar substitute. The guide
cards retain the independent existing 8,000-byte output bound.

Verification uses the real affected selector's planAffected/runPlan and retains
both its full conservative plan and a named scoped execution receipt. The
explicit workstream prohibition on complete crate/client/difftest closure takes
precedence over its broad shared-input fallback. Consequently
fullSelectorPlanExecuted=false and qualification=false are explicit in the
receipt and report. This is not a pass of the unmodified selector's complete
closure. Packed qualify-linux --consumer-only is separate; suite=not-run and
publicationQualified=false are retained. No Mac proof or publication is claimed.

Reproduction after building/frozen packing with `pack.mjs`:

```
node snapback4/reports/tok6/replay.mjs before
node snapback4/reports/tok6/replay.mjs after
python3 snapback4/reports/tok6/measure.py
node snapback4/reports/tok6/price-audit.mjs
node snapback4/reports/tok6/package-budget.mjs
```

Long launches use the workstream's 40G systemd scope, at most four concurrent
active workload jobs. `replay.mjs` refuses existing application
roots. Task-owned node_modules, generated web bundles, unpacked qualification
workspaces and duplicate binaries are removed after their terminal evidence is
saved; frozen tarballs and compact evidence are retained under target/tok6.
