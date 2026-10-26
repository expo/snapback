# Snapback 4 fixture-free admission timing guard includes the security campaign

Status: Resolved
Date: 2026-10-22
Scope: `snapback4/crates/snapback4/tests/run_admission.rs`, fixture-free `test`
Severity: P3 (timing-sensitive check; command succeeds)

During K0-Q fix round 1 qualification, the full CLI suite with four outer test
cases failed `live_dev_forwards_run_refuses_other_offline_writers_with_its_address_and_releases_on_exit`
at line 200: `must not enter SQLite's writer wait`. The guarded command succeeded,
printed `generated-fixture only`, and did not report `E_STORE_BUSY`; only the
five-second wall-clock assertion failed. One unchanged isolated run passed
(10.35 s for both watch modes); the next unchanged isolated run failed (5.26 s
for the whole test). No timeout or work count was changed.

With the fixed CLI bytes copied to a private path to avoid rebuild interference,
the same source's fixture-free `test` command returned exit 0 in 7.218 s **without
a live developer server**. Two exit-0 samples with the live developer server
returned in 6.837 s and 15.324 s. Device compilation was active on the host.
This is evidence that the total command time is not a reliable proxy for the
live store's writer wait. It does not attribute the delay to one particular
security-campaign stage, establish a baseline regression, or prove that a store
wait never occurred in another run.

The command includes the finite security campaign and private HTTP qualification,
including a snapshot of the CLI executable. Follow up with direct evidence that
fixture-free testing does not acquire the live writer, preserving the campaign,
existing no-write assertions, and meaningful deadline checks. Do not simply raise
the five-second threshold or remove security work to turn the check green.

Evidence: [K0-Q report](../snapback4/reports/20261022-k0q/REPORT.md), fix-round
fixture timing and qualification receipts. Unabridged logs are retained under
`/tmp/sb4-k0q-fix1/` on expo-build-450a. Both diagnostic dev hosts were stopped
and their recorded PIDs independently checked absent. A retained pre-K0-Q binary
failed its private HTTP preparation during this diagnostic and is excluded from
the timing comparison; no claim about baseline latency is made from it.

The complete repeat with one outer test case at eaa3a60098 passed this unchanged
five-second guard. That repeat failed a separate concurrent-adoption lifecycle
case; it is not a clean-full-suite claim. Keep this issue open because the
reproduced fixture-free wall-clock proxy flaw remains.


K0-Q fix round 2 observation at `aeb62378f7`: the complete CLI pass again
failed `live_dev_forwards_run_refuses_other_offline_writers_with_its_address_and_releases_on_exit`
at the unchanged five-second assertion (`tests/run_admission.rs:200`,
"must not enter SQLite's writer wait"). Its exact isolated rerun also fails
(5.24 s). No guard or product behavior was changed. Logs:
`/tmp/sb4-k0q-fix2-final/cli.log` and `cli-isolated-6.log`; the earlier fixture-free
timing investigation remains above.

Resolved by Integration 27: hold BEGIN IMMEDIATE on the live store for the entire fixture-free test, assert successful isolated completion and unchanged jobs/generation, then release the barrier. This replaces total campaign duration as a writer-wait proxy with a concrete exclusion witness; product deadlines remain unchanged.
