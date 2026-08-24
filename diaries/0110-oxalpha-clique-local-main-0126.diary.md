# Diary 0110: ox-alpha Clique local-main 0.1.26 — both profiles (pi harness)

**Date:** 2026-08-22
**Run:** `benchmarks/runs/2026-08-22-clique-local-main-0126-oxalpha/`
**Lanes:** ox-alpha (stealth/ox-alpha) on pi 0.84.2 headless, Clique M1–M3,
Explicit + Familiar, serial
**Backend:** local source `261e595ad` as candidate closure 0.1.26
(`bakeoff-0-1-26-261e595ad`) via a run-private loopback npm registry on the
fleet host; nothing published
**Outcome:** complete — both profiles reached M1–M3 suite and choreography
green on their final shipped trees.

## Why this run

Author-requested first Clique run with ox-alpha as the lane model, on the pi
coding agent harness instead of Codex CLI. The brief's focus is ergonomics and
smoothness (correction-loop shape, refusal fidelity, guide hits), not wall
clock. First benchmark run staged entirely against a fleet machine (Durand M4
Pro mini) rather than the control plane.

## Staging experience (orchestrator's seat)

- The publication-shaped delivery path from
  `0112-sol-high-clique-local-main-0125` worked again on a different host,
  with one requirement surfaced by the packer: the darwin runtime
  must be built with `SNAPBACK_BUILD_DISTRIBUTION=public-package` or
  `snapback-publish.mjs` refuses with
  `SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED`. The contributor-source
  build that `assemble-runtime-package` produces is not what the packer wants;
  the env-stamped rebuild is. Default dry-run staging is still not the
  receipt-qualified real-publication path.
- `53e7ac866` closed the skill-ceiling staging defect recorded in
  `0112-sol-high-clique-local-main-0125`: the
  scaffold-emitted skill body is 10,165 B, lane-setup accepted it unmodified,
  zero preflight warnings. That diary's trim workaround is obsolete.
- Provisioning the harness on a fresh fleet machine was ~15 minutes: npm
  install the renamed package, copy provider auth, one smoke prompt. The
  `@mariozechner` → `@earendil-works` package rename is a trap: npm `latest`
  of the old name is 0.73.1, silently old.
- pi's `--mode json --print` gives a complete event stream with per-message
  usage, which is a clean metering channel for this harness
  (`tokens.source: pi jsonl agent events`).

The completed lane experience follows.

## Explicit lane (r2, from the transcript)

The lane's own essay is the best summary: "Snapback is what you'd get if Convex
were opinionated about contracts, capabilities, and deployments the way
Firebase is opinionated about offline — more friction at the edges,
considerably less doubt in the middle." Concretely:

- The unqualified dry-run closure's `single_table_v1` refusal hit at first dev
  boot and cost a real redesign of the read layer into all-JS-handlers. The
  refusal message carried enough structure (`requiredCapabilities` in
  functions.manifest) for the lane to self-diagnose without source diving;
  this was not evidence against a receipt-qualified published closure.
- The deepest lane-local app/harness bug found needed two browsers: an empty
  dev LogBox toast intercepted every click. Its Snapback attribution remains
  unverified, but two-client choreography still earned its place.
- After the mid-run infrastructure kill, resuming the same session worked
  cleanly: the agent re-established its backend, re-ran all suites green, and
  finished the docs. State lived in the repo, not in the agent's head.

## Familiar lane

Familiar's verdict: "handlers read like specifications... generation refusals
catch real bugs (unbounded takes, cross-handler awaits). The costs are dialect
cliffs — patch signatures, order(), intent triple-agreement — that cost hours
when hit blind." That matches
`0104-sol-high-clique-explicit-local-main`,
`0105-sol-high-clique-familiar-local-main`, and
`0112-sol-high-clique-local-main-0125`: after the foundation, M2/M3 were
product logic, not plumbing.

## Harness findings (pi + ox-alpha as lane agent)

- ox-alpha stops text-only more readily than the Codex-harness models did; in
  pi's headless mode that terminates the session. Three of four lane attempts
  ended this way or via a 0-token empty completion. A fixed logged
  auto-continuation nudge (same session) recovered every one — cheap, safe,
  and now part of the runner. Any future pi-harness lane needs this wrapper.
- Otherwise the harness performed well: `--mode json` metering is complete
  (per-message usage incl. cache reads, tool-use counts), sessions resume
  deterministically, and cold-start provisioning on a fresh fleet machine took
  minutes.
- Orchestrator-side stumbles (mine): a broad `pkill` during staging recovery
  killed r2's main session mid-choreography (disclosed in the record), and two
  wrapper-script bugs were caught before they contaminated results.

## Numbers

| | explicit r2 | familiar |
|---|---|---|
| Output tokens | 396,294 | 187,777 |
| Tool uses | 1,439 | 716 |
| Suite result | M1–M3 green | M1–M3 green |

Cross-model comparison remains invalid (different model + harness); within
this run, familiar used roughly half the output tokens of explicit on the same
brief — directionally opposite to the sol-high records, worth watching when N
grows.

## Current-main reconciliation — 2026-08-23

This run used the unpublished `261e595ad` candidate. Current `main` already
tests the configured password floor, documents the LiveQuery-only React hook,
preserves sessions through the qualified successor path, and has closed the
fixed-origin lifecycle work. The dry-run package observation routes to the
existing qualified-staging owner; only the admitted `.order()` serving failure
is newly open for current packed revalidation. The frozen-instrument write is
tracked as a harness defect.
