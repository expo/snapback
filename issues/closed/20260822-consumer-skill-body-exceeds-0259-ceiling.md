# Consumer snapback-authoring SKILL.md exceeds the LLP 0259 10 KiB ceiling

**Filed:** 2026-08-22, while staging
`benchmarks/runs/2026-08-22-clique-local-main-0125`.
**Status:** Resolved

## Finding

The consumer-form `snapboard-authoring` skill emitted into every new scaffold
(`renderScaffoldAuthoringSkill`, `packages/snapback-cli/index.mjs`) is
**10,534 bytes**, above LLP 0259's 10 KiB (10,240-byte) per-skill budget.
`benchmarks/tools/lane-setup.mjs setup --skill-body snapback-authoring=…`
refuses it:

```
[BENCHMARK_LANE_SETUP_FAILED] skill body snapback-authoring is 10534 bytes; maximum is 10240
```

Breakdown: canonical `packages/snapback-cli/skills/snapback-authoring/SKILL.md`
is 10,192 bytes; `renderScaffoldAuthoringSkill` adds a 342-byte served-Guide
note. Both sizes are unchanged since published 0.1.24, but LLP 0259 Rung A
(`a0f0b232b`, landed 2026-08-15) introduced the ceilings afterward — the
emitted consumer form was never dieted to fit its own policy.

## Impact

Any benchmark lane, metered first-read accounting, or budget-conscious
consumer that ingests the scaffold-emitted skill now breaches the steering-diet
budget by ~300 bytes, and the benchmark instrument rejects the payload
outright. The 2026-08-22 local-main run had to ship a hand-trimmed 10,219-byte
variant with disclosure.

## Suggested fix

Make the emitted consumer form fit ≤10,240 bytes without losing semantics —
e.g., compress the four-line served-Guide note to one line and drop or fold
the checkout-only "diaries/" bullet (dead weight outside a Snapback checkout),
which together recover ~280–330 bytes. Add a test pinning the emitted size to
the ceiling so drift fails CI.

## Resolution

Resolved 2026-08-28. The current renderer measured 10,158 emitted UTF-8 bytes
before this change (10,185 canonical bytes), reflecting an earlier partial fix
that had already shortened the served-Guide note and omitted the checkout-only
diary bullet. The injected note is now compressed to the routing information
the scaffold needs; the canonical skill retains the detailed progressive-read
and served-Guide instructions. The emitted consumer form is 10,099 bytes,
leaving 141 bytes below LLP 0259's 10,240-byte ceiling. The scaffold skill
budget test enforces that ceiling and reports the measured byte count on
failure.
