# Metering driver: full-journey cell support + host portability (R3 prerequisite)

**Status:** Open
**Opened:** 2026-08-25
**Systems:** Benchmarks, Metering
**Related:** LLP 0295 §R3, LLP 0201 D2/D0.6,
`benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/RUNBOOK.md`
(blocker inventory), `benchmarks/runs/2026-08-23-r2-published-0125/`

## Problem

The R2 driver stack (`r2-cell-admission.mjs`, `lane-controller.mjs`,
`r2-cell-driver.mjs`) is the only machinery that produces D0.6 per-milestone
metering blocks, and it cannot run the canonical full journey or leave its
original habitat. The capstone preparation round (authoring-only, source
inspection) found six fail-closed incompatibilities:

1. **Reduced-run-only semantics (the deep one):** `r2-cell-driver.mjs`
   writes `runScope: "reduced"`, appends an M1–M3-only handoff, launches one
   native harness session, and ends it after M3. It cannot express LLP 0201
   D1's continuous M1–M6+M8 session plus a separately metered fresh-M7
   session. Listing eight milestones in JSON does not change the executed
   scope.
2. **macOS-only host probes:** admission obtains `hardwareModel`, CPU brand,
   and physical CPU count via macOS `sysctl` keys; fails on Linux before
   host comparison.
3. **Git-required admission/finalization:** admission, seriality replay, and
   `r2-finalize-existing.mjs --publish` need Git object reads; a provisioned
   gitless tree (e.g. `git archive` deployment) cannot admit.
4. **Byte-binding acquisition:** exact Node executable SHA-256/size, kernel
   release, and `os.totalmem()` must be probed on the execution host by the
   tooling; there is no supported remote/deferred binding flow.
5. **M7 port blocks ignored:** `allCampaignPorts()` reads only `cell.ports`,
   never `m7Ports`, so the fresh all-campaign port probe misses the M7
   blocks the journey requires.
6. **No non-consuming smoke:** an ordinary admission acquires the production
   lock and issues a one-attempt transition; the old dry-run is pinned to
   `0.3.3-m8`. There is no way to smoke a new campaign config without
   consuming an attempt.

## Wanted

Full-journey (continuous M1–M6+M8 + fresh M7, with M7 metered separately)
cell semantics; Linux and gitless-tree host support (or a documented
provisioning contract that admission accepts); M7 ports in the campaign
probe; a non-consuming smoke mode current with the instrument pin. This is
the prerequisite for LLP 0295 R3 running as a full-journey, claim-eligible
wave rather than an M1–M3 calibration repeat.

## Interim

The 2026-08-25 capstone run executes in the manual shape with prompt-native
milestone clocks and `0.3.4-m8` receipts (see the run README amendment);
its cells are honestly scorecard-ineligible.
