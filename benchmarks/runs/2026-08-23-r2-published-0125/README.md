# LLP 0295 R2 — published 0.1.25 calibration rerun plan

**Status:** cell 1 deterministically recovered; continuation is a serial,
fresh per-cell admission transition. No later cell has started and no current
admission artifact exists.

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
  absolute instrument root to the non-overwriting R2 resume root. Model, prompt-text effort
  declaration, app scope, M1–M3 limit, fixtures, proof contract, safety limits,
  and Exact pin remain as recorded. Actual launch effort follows the executed
  harness record and the deviations table below.
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

## Orchestrator rulings and deviations

| Item | Retained 0.1.24 / proposed basis | R2 ruling and disposition |
| --- | --- | --- |
| Claude effort | The frozen prompts say `effort=xhigh`, but the retained harness record shows harness-default effort actually ran. | Preserve executed behavior: config `effort.value` is null and Claude argv deliberately has no `--effort` argument. The prompt text remains unchanged as the recorded discrepancy. |
| Claude executable | The prepared config named the mutable `~/.local/bin/claude`, which advanced from 2.1.239 to 2.1.241 after preparation. | Invoke the retained installed 2.1.239 executable by its immutable versioned path. |
| Host load ceiling | The 0.1.24 contamination flags carried no numeric admission threshold. | Approve loadavg-1/loadavg-5/loadavg-15 ≤ 10.00, sampled once per minute, with three consecutive passing samples before admission. |
| Codex CLI | The 0.1.24 record used 0.147.0; the prepared R2 host has 0.149.0. | Accept 0.149.0 as the same harness and carry `same-harness-version-change-accepted:0.147.0->0.149.0` as an explicit config and record flag. |

## Execution plan

1. Resolve every blocking entry in `preflight.json` and rerun preflight. Do not
   waive a red by editing a cell after its authoring clock begins.
2. Freeze each allowed host identity, the exact Node 24 executable bytes, CLI
   versions, Exact checkout, instrument tree, package closure, and host-scoped load ceiling in
   `harness-config.json`.
3. Materialize the registered resume instrument at its new immutable path,
   then run `r2-cell-admission.mjs`. Admission atomically acquires the exclusive
   host lock and verifies the exact Node/controller/driver bytes, ordered argv,
   source and read-only materialized instrument trees, allowed host hardware,
   complete committed-prefix replay, harness version/auth, and three one-minute
   load samples followed by fresh prior-process and all-campaign-port probes.
   It writes a self-hashed artifact valid for 30 seconds. The controller claims
   and holds that same lock, repeats the live probes and byte checks immediately
   before its first private write and driver import, and releases it only after
   finalization. Materialize each lane from a fresh directory with the
   landed lane setup and its bounded start packet. Start its exact
   `controllerCommand` from
   `harness-config.json`; that command supplies the production native-CLI
   driver to `lane-controller.mjs`. The driver launches Codex, Grok, or Claude
   from the cell definition and keeps one cold session behind milestone gates.
   No session, implementation, store, or generated output may cross a cell
   boundary.
4. Run cells in the registered order with `maxConcurrentCells: 1`. The next
   cell cannot start until the prior campaign tree is closed, every registered
   campaign port is unbound, the exclusive lock is available, and three
   consecutive one-minute load samples are within the host-scoped ceiling.
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

Materialize the resume snapshot once after this commit lands and before any
admission; the command refuses an existing destination and never touches the
old `/Users/ccheever/bench-matrix-20260823-r2/instrument` archive:

```sh
node benchmarks/tools/materialize-instrument.mjs \
  --out /Users/ccheever/bench-matrix-20260823-r2/instrument-resume-20260824
```

Create the next admission artifact without real waiting only in tests; the
production command takes the registered three one-minute samples:

```sh
/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node \
  benchmarks/tools/social-messenger/metering/r2-cell-admission.mjs \
  --harness-config benchmarks/runs/2026-08-23-r2-published-0125/harness-config.json \
  --cell sol-clique-familiar --reserved-by <operator> \
  --out benchmarks/runs/2026-08-23-r2-published-0125/admissions/sol-clique-familiar.json
```

The production controller command shape is frozen per cell:

```sh
/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node \
  benchmarks/tools/social-messenger/metering/lane-controller.mjs \
  --harness-config benchmarks/runs/2026-08-23-r2-published-0125/harness-config.json \
  --cell sol-clique-familiar \
  --driver benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs \
  --admission benchmarks/runs/2026-08-23-r2-published-0125/admissions/sol-clique-familiar.json
```

`validate-plan.mjs` resolves all twelve concrete commands and deterministic
admission paths, accepts a contiguous committed prefix of finalized records,
imports the driver hooks, verifies each native CLI exists, and resolves every
later pristine cell against the external 0.3.3-m8 pin. The controller verifies
admission before importing the driver, creating the private cell, writing a
prompt, or launching a process. Existing private unrecorded evidence must be
finalized; it can never be admitted as a rerun.

For a retained single attempt whose native stream, terminal boundaries,
metering manifest, and record base completed but whose controller failed in
the final join/record step, use the no-launch finalizer. It does not import the
production driver or call `prepare()`:

```sh
node benchmarks/tools/social-messenger/metering/r2-finalize-existing.mjs \
  --harness-config benchmarks/runs/2026-08-23-r2-published-0125/harness-config.json \
  --cell <cell-id> --reserved-by <operator>
```

Inspect the validator-clean private `record.json` and
`publication-manifest.json`; add `--publish` only when the committed slot is
still pristine. Publication copies only the validation-required hash graph and
writes the one-attempt `cell.json` last. The tool never invents missing counts,
deletes retained evidence, or permits a second attempt.

## Load-isolation ruling

Codex and Grok cells are allowed only on `Mac.lan`: a `Mac16,11` Mac mini with
Apple M4 Pro, 12 physical/logical cores, and 24 GB. Claude cells retain the
separate `MacBookPro18,4` M1 Max 10-core/64-GB identity. No serial number, UUID,
or other sensitive machine identifier is recorded. Each host-scoped policy
sets loadavg-1/loadavg-5/loadavg-15 at or below 10.00, sampled once per minute.
A cell is contaminated on the first sample above any ceiling; it continues for
product evidence but becomes scorecard-ineligible. Admission additionally
requires the atomic host lock, three consecutive all-green samples, and fresh
process/port closure.

LLP 0186 deliberately reused the 0.1.24 contamination flags without inventing
a threshold, while this R2 request requires an explicit ceiling. The
orchestrator approved the numeric 10.00 ceiling and three-sample rule before
cell 1. Recovery/resume v4 binds continuation to the actual Mac16,11 host and
exclusive admission lock; it does not retroactively restamp cell 1's
historical host or admission evidence.

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
started. By default the output is a private temporary cell root. Passing
`--output-root` retains the complete record, all sidecars, and a
`validation.json` digest inventory at an exact inspectable path.

```sh
node benchmarks/runs/2026-08-23-r2-published-0125/dry-run-cell.mjs \
  --output-root benchmarks/runs/2026-08-23-r2-published-0125/dry-run-evidence/success
node benchmarks/runs/2026-08-23-r2-published-0125/dry-run-cell.mjs \
  --duration-seconds 1 --failure-probe \
  --output-root benchmarks/runs/2026-08-23-r2-published-0125/dry-run-evidence/failure
```

The first command is the required full-duration lifecycle proof. The second is
a focused fault-injection check: it throws in M1 before choreography, then
requires a validating `record.json` with M1 `aborted` and M2/M3 `not-run`.

The retained Round-5 evidence is:

- Success: `dry-run-evidence/success/validation.json`
  (`sha256:f1eb390c7a2696a8d2c324fd10dc207ec8e0693781292217393845c8ca018862`),
  binding the complete green record at
  `sha256:ba23a258935c82d6c8b6e90c32cc4bf7c610c155c5766692be3ebe6076bd200a`.
- Forced failure: `dry-run-evidence/failure/validation.json`
  (`sha256:8fe36e2574c94eca13b6a8b045b04e132e05b7adcc96d599e4346a6c79e39100`),
  binding the checked-valid aborted record at
  `sha256:e1ea4bd64ed0f18647b9525fe0a173cb68cbf048cd54429218436ffdaeed6ded`.

Both validation dispositions report zero schema/semantic errors and inventory
every retained sidecar by relative path, byte size, and SHA-256 digest.
Re-hash and revalidate them independently with:

```sh
node benchmarks/runs/2026-08-23-r2-published-0125/validate-dry-run-evidence.mjs \
  benchmarks/runs/2026-08-23-r2-published-0125/dry-run-evidence/success \
  --source-binding benchmarks/runs/2026-08-23-r2-published-0125/recovery-resume.v4.json
node benchmarks/runs/2026-08-23-r2-published-0125/validate-dry-run-evidence.mjs \
  benchmarks/runs/2026-08-23-r2-published-0125/dry-run-evidence/failure \
  --source-binding benchmarks/runs/2026-08-23-r2-published-0125/recovery-resume.v4.json
```

## Start blockers

The authoritative list is `preflight.json`. The controller, driver,
suite-status refusal, complete-record path, and 0.3.3-m8 pin are no longer
blockers. The campaign still waits for materialization of the new private
instrument archive, Grok authentication, absent raw 0.1.24 event streams or a
governing pre-wave ruling, and an actually reserved/quiet host. The Claude
effort, load ceiling, and Codex 0.149.0 rulings are resolved and frozen above.


## Orchestrator rulings — final (2026-08-24)

- **Comparator posture:** the twelve retained 0.1.24 raw event streams were not
  recoverable on any fleet machine at campaign start; per LLP 0186's rule this
  run executes as the **D0.6-only pre-wave** — it establishes the annotated
  baseline, and the 40/20/30 targets adjudicate at R3 against it. No estimated
  baselines are used.
- **Host split (documented deviation):** cells run on two reserved hosts, each
  under its own load ceiling and serial execution — Codex and Grok cells on
  `Mac.lan` (`Mac16,11` Mac mini, Apple M4 Pro, 12c/24GB), Claude cells on
  `charlies-macbook-pro-2` (M1 Max, 10c/64GB) admission-gated around fleet
  load. Host identity, load samples, and contamination flags are recorded per
  cell; the plan's "reserved machines or enforced load ceilings" language
  admits both mechanisms.

## Cell-1 deterministic recovery (2026-08-24)

The first and only `sol-clique-explicit` attempt remains immutable at its
private retained root and was not rerun. The versioned metering repair recovers
its complete native token join, and the committed cell directory now contains
`metering.json`, a schema- and semantic-validator-clean `record.json`, and the
minimal hash-linked evidence graph needed to revalidate both. Its recovery note
records the exact Codex 0.149.0 advisory-total compatibility event, separate
protocol terminals and native usage settlements, exact signal-observation
exclusions, and the ordinal-222 first product edit. The recovered
record is scorecard-ineligible because orientation bytes were not measured;
no counter is inferred from the prompt.

This is a deterministic finalization of cell 1, not campaign continuation or a
profile conclusion. No later Codex/Grok cell and no Claude cell ran. Every
later command is fail-closed behind a versioned per-cell admission artifact.
Historical preflight reds are not weakened: the requested cell must satisfy
its current reservation, auth, version, port, process-closure, instrument,
seriality, and load conditions.
