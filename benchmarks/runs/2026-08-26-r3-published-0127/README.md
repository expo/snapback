# LLP 0295 R3 — published Snapback 0.1.27 closure wave

**Status:** commissioned; preregistration committed and non-consuming smoke
passed; no benchmark cell has started. Review status: `scoped-review-pending` (the
author-delegated task expressly requested no review loop).

This directory commissions the LLP 0295 §R3 closure wave against the coherent
published Snapback **0.1.27** package set and immutable instrument
**social-messenger@0.3.4-m8**. The scorecard, exact order, exclusions, and
comparisons are frozen in [PREREGISTRATION.md](./PREREGISTRATION.md); the machine
plan is [harness-config.json](./harness-config.json).

## Rulings

- **Leg A:** 12 scored full-journey cells, `gpt-5.6-sol` xhigh, N=3 for
  Clique/Coterie × Explicit/Familiar. Driver
  `social-messenger-full-journey-native-cli-driver.v1`; one continuous
  M1–M6+M8 builder plus separately metered fresh M7.
- **Leg B:** 12 scored reduced M1–M3 cells, `claude-opus-5` at harness-default,
  the same conditions and N=3. Driver
  `social-messenger-r2-native-cli-driver.v1`. Results are reduced-profile,
  Claude-family scoped; they cannot support a full-journey claim.
- **Leg C:** four reduced M1–M3 `grok-4.6` xhigh cells at N=1. They are
  exploratory and claim-ineligible by registration. Native token counts remain
  registered-unavailable, so no scorecard conclusion is drawn from them.
- Full-journey Claude and Grok accounting adapters remain future work. This
  commission does not alter `journey-contract.mjs` and makes no full-journey
  claim for either family. The narrow loader binding lets each cell select its
  already-supported full or reduced contract; the contract still refuses a
  non-Codex full registration before admission.
- Cells execute strictly serially under one host lock. The scored-leg condition
  order rotates left once per replicate and the global schedule interleaves
  A→B→C at each replicate-1 ordinal, then A→B for replicates 2–3.
- Comparisons are internal to this wave only: Explicit vs Familiar and Clique
  vs Coterie, always family- and scoring-profile scoped. The closed R2 records
  and the 2026-08-25 capstone are annotated historical context, never a numeric
  comparator or pooled observation.
- Finalization is **same-config only**. Cross-overlay retained finalization is
  unavailable, and a changed overlay cannot authorize relaunch. The cleanup
  issue remains open for removal of its dead recognizer.

## Frozen environment

Host `charlies-macbook-air`: Mac17,3, Apple M5, 10 physical/logical cores,
32 GiB, macOS 26.6.2 (Darwin 25.6.0). Harness registrations: Codex CLI 0.149.1,
Grok CLI 1.0.5 (`5115b46bc909`), Claude Code 2.1.241, Node v24.18.0. The Exact
checkout used only by Coterie is pinned read-only at
`bc300aa4b5e40a55fcbec29aa8df94962b4b4200`.

The instrument is materialized read-only at
`/Users/ccheever/bench-r3-20260826/instrument`. Its manifest SHA-256 is
`3fb6d974ce4c4b35ae8e930bcb02a2c987cba1d07443efa95cee71e620eae5b0`.
Commissioning observed 45 GiB free (the packet's estimate was approximately
57 GiB); this remains above the invariant 20 GiB admission floor.

## Conductor policy

Before every admission, the conductor requires the exclusive host lock, closure
of the prior process tree, all registered main and M7 ports unbound, three
consecutive one-minute loadavg-1/5/15 samples at or below 10.00, and at least
20 GiB free. A disk-floor refusal is reported as
`R3_ADMISSION_DISK_FLOOR`; it does not consume the next cell.

After a cell record or blocked report is committed and the cell is sealed, the
conductor deletes only that cell workspace's rebuildable `node_modules` and
build outputs. It never deletes evidence capsules. Cleanup finishes before the
next admission check.

## Non-consuming smoke

Executed against committed preregistration `b62c9acd1e032867bac725ef99f73edc941b718c`
at 2026-08-26T19:15:42Z with:

```sh
env -u NODE_PATH node benchmarks/tools/social-messenger/metering/lane-controller.mjs --smoke \
  --harness-config benchmarks/runs/2026-08-26-r3-published-0127/harness-config.json \
  --cell sol-clique-explicit-1 \
  --driver benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs
```

Observed result: `snapback.r2-controller-non-consuming-smoke.v1`, status
`non-scored`, `scored=false`, `attemptConsumed=false`,
`productionLockAcquired=false`, controller initialized, native session not
launched. It resolved the first cell to full scope with milestones
M1,M2,M3,M4,M5,M6,M8,M7; verified the Codex 0.149.1 version/auth, exact host,
source closure, instrument source/materialized digest, pristine 28-cell serial
state, and all 2,400 final ports unbound. The single-sample smoke load was
8.2671/4.0698/3.5815 for 1/5/15 minutes. Synthetic non-publishable composition
SHA-256: `14fab9491ce44253cb222d1718301b7810e8f3bc909ed630790591f65b3c850b`.

Two earlier non-consuming refusals consumed no lock or attempt and corrected
the preregistration before this pass: TCP 50000 and then TCP 55555 were already
reserved on the host, and the 2,400-port probe needed bounded batches to avoid
misclassifying socket-window exhaustion as occupancy. The final registered,
sequentially preprobed ranges are 57000–58679 and 59000–59719.

## Start boundary

No campaign cell is authorized until the committed tree passes:

```sh
node --check benchmarks/runs/2026-08-26-r3-published-0127/validate-plan.mjs
node benchmarks/runs/2026-08-26-r3-published-0127/validate-plan.mjs
./ref-check --verbose
```

This authoring task stops after commissioning and the non-consuming smoke. It
does not run a campaign cell.
