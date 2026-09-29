# LL round 1 failure ledger

## Expected round-0 failures (ours, repaired)

`regressions-before.log` ran the new tests against the round-0 SDK, after the
main merge (neither product file changed in that merge). All six fail by
assertion, with zero cancellations/skips:

- process and wasm: `pending cut preserves transition before sync publication`
  — no current whole-server answer while sync is held.
- process and wasm: `pending cut preserves refusal before sync publication`
  — mounted ordinary query never publishes the terminal `E_STORE`.
- process and wasm: `pending cut preserves held-refusal before sync publication`
  — mounted held query stays parked instead of publishing `E_STORE`.

The fixed run is `regressions-fixed.log`: 32/32 passed, including the expanded
causal suite and all six reproductions. The final affected run also covers the
later test-only teardown guard for setup failures.

## Test harness development (ours, repaired)

`regressions-harness-initial.log.gz`: the initial process transition failed its
setup because its injected past time was below the device's clock floor; the
following refusal test then hung in cleanup after its expected assertion.
`regressions-harness-teardown.log`: the corrected transition reached the intended
missing-fallback assertion; refusal cleanup still hung because resetting mocked
timers discarded the failed-follow sleep. Both development runners were stopped
using their recorded child PIDs, not counted as completed regression runs.
The final fixture uses a future cutoff, waits for the real server to cross it,
and advances only the queried device's time. It preserves the original query
arguments. Cleanup closes the client, drains the failed-follow sleep, then
restores timers. Test assertions pump only zero-delay turns after notification.

Two early shell invocations also used repository-root paths while already in
`snapback4/` (or vice versa); they failed before building/running tests. Corrected
working directories, with no source or result omitted.


## First affected run: two fixture failures (ours, repaired)

Both `pending cut preserves transition before sync publication` cases failed
in `affected.log.gz`. Increasing the fixture's initial cutoff from one second to
five seconds crossed the four-second change-feed silence watchdog while its
notification response was held without a heartbeat. This disconnected the
fixture before the intended notification; it was not the routing regression.
Restored the one-second cutoff used in the passing 32-case run. The final
focused rerun and full suite cover the corrected fixture. No product timeout or
assertion was weakened. The broader affected run was allowed to finish.

The first previous-route mutation also used that five-second setup, so its red
is not accepted as mutation evidence (`mutation-previous-local-route-initial.log`).
The control was repeated with the corrected fixture in an isolated artifact copy,
first requiring two passes without a mutation, then two assertion failures with
only the previous-route rule restored. Its first isolated-copy setup omitted the
package's `#fetch` import map (`mutation-copy-setup.log`); copying the real
package manifest repaired that harness error. Final control evidence is
`mutation-route-positive.log`, `mutation-previous-local-route.log` and the updated
`mutations.json`. Other controls did not wait for a time transition and were not
affected by the cutoff mistake.

That first affected run finished with **715 tests: 707 passed, 8 failed, zero
cancelled/skipped**, 402,199.452901 ms. Besides the two transition-fixture failures
above, six `omitted change tables recover a disjoint local profile` cases failed:
process and wasm, each with `keep=undefined`, `keep=true`, and `keep=false`.
All six were **ours**: round 0's tests still required zero old-replica evaluations
for ordinary queries. They are now split into ordinary and explicitly held
variants: ordinary queries must evaluate and keep bounded 25 ms exponential
retry work; held queries must do zero pre-apply work and schedule no retry.
Both must resume at publication even when the apply footprint is disjoint.
This adds six cases and preserves the stronger zero-work assertion where its
held-query proof applies. `affected-corrections.log` covers every failed case
and the additional held variants. Both 300-history mixed-evidence hosts passed
in the broader run, with `failedSeeds: 0`.


## Final full suite

Exactly one full-suite invocation: **`== 0 failure(s) in 1290 s`**, exit **0**.
No full-suite failures: **ours 0, baseline 0, environmental 0**. Rust 4,323
passed with 33 declared ignores; client stage 5,245 passed with 10 existing
skips and no cancellations; serial client models 79/79. The final full suite
includes all corrected test cases above. All 24 cases in the targeted correction
run also pass. No baseline or environmental test failure was identified in this
round. The suite's inherited runtime exceeds its 60-second target.

The final staged whitespace check rejected raw test-output whitespace and an
extra comparison-table EOF newline (ours, artifact formatting). The affected
logs are stored losslessly as gzip; the Markdown newline was normalized. The
final staged check passes. No test output was edited.
