# LLP 0295 R2 — published 0.1.25 calibration rerun plan

**Status:** PREPARED / BLOCKED — no benchmark cell has started.

This directory preregisters the load-isolated twelve-cell R2 calibration wave
from LLP 0295 §R2. It repeats the retained 2026-08-17/18 published-0.1.24
matrix at N=1: Clique and Coterie × Explicit and Familiar × GPT-5.6 Sol,
Grok 4.6, and Claude Opus 5. R2 validates the instrument and measures
variance. It cannot select a profile winner or support a published comparative
claim.

## Frozen basis

- The original prompts are recovered from commit `67700dd43`, not from the
  subsequently edited reusable templates. The four files under `prompts/`
  change only the published Snapback spelling from 0.1.24 to 0.1.25 and the
  absolute instrument root to the R2 root. Model, effort declaration, app
  scope, M1–M3 limit, fixtures, proof contract, safety limits, and Exact pin
  remain as recorded.
- Snapback is the fourteen-package public 0.1.25 closure
  `fastpath-0-1-25-9d9265394953`, qualified from
  `9d9265394953769aaa52e63c8a914464175f93ab`.
- Coterie retains Exact commit `4046cafcf`; changing that commit would create a
  different comparison. Its legacy checkout is restored at the prompt-pinned
  path, has frozen-lockfile dependencies installed, and is filesystem
  read-only.
- App semantics remain the 0.1.24 instrument snapshot lineage, migrated through
  the coordinated observability build on this branch. The runnable pin is
  `social-messenger@0.3.3-m8`: schema `0.3.0-m8`, UI `0.3.1-m8`, and
  choreography `0.3.3-m8`. The broader LLP 0281 worklist remains open; this
  pin claims only the R2-gating slice recorded by its issue.
- The final cell record must validate against
  `benchmarks/schema/social-messenger/run-record.schema.json` and then pass
  `benchmarks/tools/social-messenger/record-validator.mjs`.

## Execution plan

1. Resolve every blocking entry in `preflight.json` and rerun preflight. Do not
   waive a red by editing a cell after its authoring clock begins.
2. Freeze the single machine, Node 24 path, CLI versions, Exact checkout,
   instrument tree, package closure, and proposed load ceiling in
   `harness-config.json`.
3. Materialize each lane from a fresh directory with the landed lane setup and
   its bounded start packet. Start its exact `controllerCommand` from
   `harness-config.json`; that command supplies the production native-CLI
   driver to `lane-controller.mjs`. The driver launches Codex, Grok, or Claude
   from the cell definition and keeps one cold session behind milestone gates.
   No session, implementation, store, or generated output may cross a cell
   boundary.
4. Run cells in the registered order with `maxConcurrentCells: 1`. The next
   cell cannot start until the prior process tree is closed and three
   consecutive one-minute load samples are within the ceiling.
5. At every attempted milestone retain the suite receipt, choreography
   segment summary, terminal boundary, first-green time, semantic actions,
   failure-to-recovery episodes, restarts/reseeds, assertion attempts/wait,
   and harness-native usage. Suite and choreography must both attest green.
   The 0.3.3-m8 controller hash-links all of these sources. A green milestone
   with no native semantic action or no measured suite/choreography settlement
   attempt is invalid.
6. Sample one-, five-, and fifteen-minute load averages every 60 seconds from
   before prompt delivery through the terminal boundary. Any ceiling breach
   sets `host-load-contamination`; any provider interruption window sets
   `api-interruption`. Either flag makes that cell ineligible for the
   efficiency scorecard while its product findings, diary, and proof receipts
   remain valid evidence.
7. The controller always writes `metering.json`, then composes and validates
   the complete `record.json`. Its `finally` path does the same after a thrown
   milestone, producing a valid failure-shaped record rather than losing the
   attempt. Generate aggregate tables only from complete records; keep each
   qualitative essay as pre-metrics narrative evidence.

The production command shape is frozen per cell, for example:

```sh
/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node \
  benchmarks/tools/social-messenger/metering/lane-controller.mjs \
  --harness-config benchmarks/runs/2026-08-23-r2-published-0125/harness-config.json \
  --cell sol-clique-explicit \
  --driver benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs
```

`validate-plan.mjs` resolves all twelve concrete commands, imports the driver
hooks, verifies each native CLI exists, and asks the lane controller to resolve
every cell against the external 0.3.3-m8 pin.

## Load-isolation proposal

The sole machine is this `MacBookPro18,4` (Darwin arm64, 10 logical CPUs,
64 GiB). The proposed ceiling is loadavg-1/loadavg-5/loadavg-15 each at or
below 10.00, sampled once per minute. A cell is contaminated on the first
sample above any ceiling; it continues for product evidence but becomes
scorecard-ineligible. The machine must be otherwise reserved, and a new cell
requires three consecutive all-green samples.

LLP 0186 deliberately reused the 0.1.24 contamination flags without inventing
a threshold, while this R2 request requires an explicit ceiling. The numeric
10.00 proposal therefore needs an orchestrator ruling before cell 1.

## Record layout

Each `cells/<cell-id>/` begins with `cell.json` and will receive, only when the
wave is authorized:

```text
record.json                       # composed D2 record + landed extension
run-log.md
diary.md
essay.md
final-report.md
lane-report.json                  # bounded orientation carrier
first-product-edit.json
terminal-boundaries.json
metering-manifest.json
metering.json
record-base.json                  # driver metadata merged by the controller
load-samples.jsonl                # must be hash-linked by the run record
api-interruptions.jsonl           # must be hash-linked by the run record
receipts/                         # suite status + choreography JSONL/summary
events/                           # retained native harness stream/tree
artifacts/                        # app proof artifacts named by the record
```

`record.json` is not pre-created: a placeholder cannot honestly validate as a
completed D2 record. Its path, schema, validators, and required evidence are
fixed in the cell configuration before execution.

## Eligibility and comparison

The exact comparator and targets are in `scorecard-preregistration.md`.
Missing phase usage, `host-load-contamination`, or `api-interruption` makes a
cell scorecard-ineligible without erasing product findings. Grok remains an
advisory family under the landed D2 meter and therefore records honest null
per-milestone tokens; its output-token comparison is inapplicable unless the
governing protocol changes before the wave and the wave is preregistered
again.

The 0.1.24 raw lane workspaces and native event streams named by the retained
record are absent on this machine (only the restored `exact-pinned` checkout
now exists under the historical root). The committed aggregate preserves all
output totals, but most M1 first-green boundaries and every retrospective D0.6
correction episode need the raw streams. Under LLP 0186, fewer than half of
matched cells being applicable requires a D0.6-only pre-wave rather than
estimates. Restore and hash those streams or rule explicitly on that pre-wave
before R2 starts.

## Time envelope

The twelve 0.1.24 cells summed to 121,095 seconds (33h 38m 15s) of authoring
wall. With serial quiet-window admission and cell turnover, reserve 38–42
elapsed hours after all blockers clear. The safety-limit upper bound is 144
authoring hours (four hours × three milestones × twelve cells), excluding
load-drain waits and final aggregation.

## Dry-run lifecycle proof

`dry-run-cell.mjs` runs a two-minute no-op stub through the same controller,
typed observation, manifest, metering, complete-record, and checked-validator
path. It does not invoke a model CLI or mark a preregistered campaign slot
started. The output is a private temporary cell root containing a validating
`record.json`; the script prints its path and validation disposition.

```sh
node benchmarks/runs/2026-08-23-r2-published-0125/dry-run-cell.mjs
node benchmarks/runs/2026-08-23-r2-published-0125/dry-run-cell.mjs \
  --duration-seconds 1 --failure-probe
```

The first command is the required full-duration lifecycle proof. The second is
a focused fault-injection check: it throws in M1 before choreography, then
requires a validating `record.json` with M1 `aborted` and M2/M3 `not-run`.

## Start blockers

The authoritative list is `preflight.json`. The controller, driver,
suite-status refusal, complete-record path, and 0.3.3-m8 pin are no longer
blockers. The campaign still waits for materialization of the new private
instrument archive, Grok authentication, absent raw 0.1.24 event streams or a
governing pre-wave ruling, the load-ceiling ruling, an actually reserved/quiet
host, and the Claude effort contradiction. Codex also moved from the recorded
0.147.0 to 0.149.0 and needs a comparator ruling or restoration of the old
binary.
