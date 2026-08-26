# LLP 0307 capstone — Clique pair vs published 0.1.27, per-milestone metering

**Status:** chartered 2026-08-25; execution in progress
**Charter authority:** LLP 0307 program (author-delegated orchestration,
goal of 2026-08-25); run protocol LLP 0201; admission basis LLP 0295 §R2
rulings (inherited as governing for this registration; the R2 campaign
itself is closed)
**Instrument:** `social-messenger@0.3.4-m8` (schema `0.3.0-m8`, UI
`0.3.2-m8`, choreography `0.3.4-m8`) — the LLP 0281 bump landed at
`97a5fba1c`, stamping `typingObservationBoundaryVersion: v2`

## Purpose

This is the experiment the LLP 0307 chip-away round exists to feed: whether
the round's landed work (Metro CI-watch fix, headless replay surface,
preserved refusal codes, W5 runtime-cost diagnostics, offline_mutation_replay
authorability, URL-first ports) moved the published-pair cost profile that
LLP 0306 documented on 0.1.25 — five-hour sessions, restart festivals,
11,314 s of scale babysitting — measured this time with the per-milestone
metering (LLP 0201 D2 + D0.6) that the 0.1.25 evidence lacked.

Evidence level: N=1 per cell. Calibration plus cost-profile evidence; not
claim-eligible for magnitude (LLP 0201 D5). Feeds the LLP 0295 R3 go/no-go.

## Published input (verified 2026-08-25, pre-admission)

npm `latest` resolves to **0.1.27** for all fourteen package identities of
the closure `fastpath-0-1-27-98681377721e`: `@expo/snapback`,
`@expo/snapback-acceptance`, `@expo/snapback-app-cli`, `@expo/snapback-cli`,
`@expo/snapback-client`, `@expo/snapback-codegen`, `@expo/snapback-contract`,
`@expo/snapback-expo`, `@expo/snapback-expo-custody`, `@expo/snapback-react`,
`@expo/snapback-runtime-darwin-arm64`, `@expo/snapback-runtime-linux-x64`,
`@expo/snapback-vite`, `create-snapback-app`. Snapback lanes use published
surfaces only (npm packages, served guide, CLI help), never the source
checkout.

## Configuration

- **Cells:** two, serial on one host: `capstone-clique-explicit-sol-high`,
  then `capstone-clique-familiar-sol-high`.
- **Builder:** codex `gpt-5.6-sol` at effort `high` — parity with the
  0.1.25 baseline run `2026-08-23-clique-published-0125-sol-high` (LLP
  0306's primary source). Codex CLI version recorded at launch; drift from
  the baseline's 0.149.0 carried as an explicit
  `same-harness-version-change-accepted` flag if present.
- **Journey:** full LLP 0201 D1 — one continuous session M1–M6 + M8, then
  M7 fresh-session, per cell.
- **Prompts:** the R2 frozen per-arm prompts adapted by exactly three
  deltas, recorded in `prompts/`: (a) published spelling 0.1.25 → 0.1.27,
  (b) scope M1–M3 calibration limit → full M1–M8 journey per LLP 0201 D1,
  (c) instrument root → this run's immutable materialized path.
- **Driver stack:** `r2-cell-admission.mjs` → `lane-controller.mjs
  --driver r2-cell-driver.mjs` → composed record validated against
  `run-record.schema.json` + `record-validator.mjs`. This stack is what
  produces the D0.6 per-milestone metering blocks; a mandatory driver
  smoke stage (non-scored dry run of admission + controller startup +
  choreography reachability) runs on the host before the first scored
  attempt's authoring clock begins.
- **Host:** `expo-build-450b` (Tailscale `100.85.211.16`; Linux x86-64,
  AMD Ryzen 5 3600, 125 GiB RAM) — the 0.1.25 baseline host, chosen for
  wall-clock comparability and because it offers clean load isolation at
  charter time. Hardware identity recorded in `harness-config.json`;
  no serial/UUID retained.
- **Ports:** Explicit 48400–48459 (+M7 48600–48659), Familiar 48460–48519
  (+M7 48660–48719). Deliberately disjoint from the concurrent
  `2026-08-25-clique-grok-0127` run's 48100 block.
- **Admission:** loadavg-1/5/15 ≤ 10.00 sampled once per minute, three
  consecutive passing samples; atomic campaign-private host lock acquired
  before the load window and held through finalization; fresh process/port
  ownership probes after the samples; clean env posture (`NODE_OPTIONS`,
  `NODE_PATH`, loader-injection paths absent, scrubbed into children); no
  symlink components in private root/cell/attempt/lock paths; each cell's
  artifacts bind Node path+bytes, controller/driver bytes, ordered argv,
  instrument bytes, host identity, harness version/auth.

## Rulings recorded at charter time

1. **Retained-finalization recognizer** (issue
   `20260825-r2-retained-finalization-recognizer-dead`): accepted as
   fail-closed for this run. Cells are fresh single attempts; cross-overlay
   retained recovery is not relied upon. The R3 design decision stays open.
2. **Instrument ticket** (`20260821-clique-instrument-observability-
   version-bump`): this run is the intended external real-run proof for the
   `0.3.4-m8` choreography paths it exercises. Ticket closure is evaluated
   after the run against the ticket's full condition — the clean control
   lane and forced-outcome-class obligations may remain open beyond this
   run; code presence alone does not close it.
3. **Typing-boundary comparability** (LLP 0201 D3): this run's M3 typing
   observations are boundary **v2**; the 0.1.25 baseline's are implicit v1.
   They are not compared. Typing-path comparisons begin with the next
   same-boundary run.
4. **Session-shape deviation:** the 0.1.25 baseline built the pair in one
   continuous session; this run is two serial per-arm cells (the R-series
   cell shape the LLP 0295 scorecard is registered against). Scorecard
   per-cell figures are primary. Baseline-total comparisons (sum of the two
   cells vs the single pair session) are secondary and carry an explicit
   orientation-doubling caveat: two fresh sessions each pay orientation
   cost the baseline paid once.
5. **Concurrent run:** the author-requested `2026-08-25-clique-grok-0127`
   comparison (grok-4.6 xhigh, M1–M3, instrument `0.3.3-m8`) ran on
   450a/450b/minisforum shortly before this charter; its 450b lane was
   quiescent at charter time (load 0.12, no harness processes). Disjoint
   ports; the admission lock plus a host marker file
   (`~/CAPSTONE-0127-IN-PROGRESS.md`) fence against relaunch collisions.
   Notably, that run's Convex lane independently reproduced the v1
   typing-clock artifact (45-char `pressSequentially` exceeding the 2 s
   ceiling) that boundary v2 fixes.

## Eligibility

Scorecard eligibility per LLP 0295 requires the D0.6 per-phase usage blocks,
clean load windows, and no unresolved API-interruption contamination; an
ineligible cell still retains its product findings and cost narrative.
Every failure is owner-classified (product / instrument / harness / host);
an instrument failure returns to LLP 0281, not to the matrix.

## Amendment 2026-08-25: manual execution mechanism

The preparation round (authoring-only, honest) proved the chartered
mechanism infeasible as written: the R2 driver stack is **reduced-run-only
in material semantics** — `r2-cell-driver.mjs` writes `runScope: "reduced"`,
appends an M1–M3-only handoff, and ends the native session after M3 — so
"driver stack, full M1–M8" was not executable on any host. Five further
fail-closed incompatibilities (macOS-only host probes; Git-object reads
against this gitless host tree; unavailable Node-byte/kernel/memory
bindings; admission ignoring the M7 port blocks; no non-consuming smoke)
are documented at the top of `RUNBOOK.md` and filed as
`issues/closed/20260825-metering-driver-full-journey-portability.md` — that work
is the R3 prerequisite, not this run's.

**This run therefore executes in the manual shape** (the 0.1.25 baseline's
own shape): per-arm codex sessions launched directly with the adapted
prompts, which carry the milestone clock contract natively (`start=<epoch>`,
timestamped lines at every milestone start and green, wall-by-milestone and
first-green tables, correction-loop attribution, separately clocked scale
replay and fresh M7). Per-milestone metering comes from those agent-stamped
clocks, the `0.3.4-m8` choreography receipts (boundary v2, outcome
classes), and harness-native per-turn token events joined to milestone
windows post hoc. **The cells are not D0.6 scorecard-eligible** (they were
already not claim-eligible at N=1 per LLP 0201 D5); they are the
cost-profile comparison this capstone exists for.

Admission simplifies to documented preflight equivalents executed and
recorded before each cell: npm `latest` re-verification, loadavg ≤ 10.00 on
three one-minute samples, fresh process/port probes over the full port
blocks including M7, clean env posture (`NODE_OPTIONS`/`NODE_PATH`/loader
injection absent), read-only instrument digest check — without the R2
byte-binding capsule, which is part of the filed driver work.

Also filed from the preparation round:
`issues/20260825-metering-suite-red-0334-fixtures.md` — the metering test
suite is red on main (52/85 locally) after the `0.3.4-m8` landing left
`0.3.3`-pinned fixtures behind; fix-forward, independent of this run.

## Artifacts

- `harness-config.json`, `admissions/`, `cells/<cell>/` (driver-produced
  `metering.json`, `record.json`, logs), `prompts/`, and `record.md` (the
  human summary) accumulate in this directory as the run executes.
- Raw lane directories live outside git at
  `/home/ccheever/capstone-0127-20260825/` on the host.
