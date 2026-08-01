# LLP 0137 improvement sweep — execution surface

This directory is the machine-readable execution surface for
[LLP 0137](../../llp/0137-react-web-backend-championship.plan.md), the
React-web improvement sweep and deferred backend championship. It follows
the conventions of
[LLP 0102](../../llp/0102-seven-backend-five-app-bakeoff.plan.md)'s
`demos/backend-bakeoff/` tree.

The program exists to surface what would make Snapback better, not to prove
Snapback is better. Phase 1 produces findings, diaries, and a gap ledger — no
backend ranking, no composite, no win/lose claims. Stage 7 (the Phase 2
championship) is deferred behind the dry-well trigger and gets its own freeze.

## G0 — the sweep freeze

Stage 0 (G0) freezes, before any diaried arm:

- the six product contracts A1–A6 with acceptance identifiers
  (`protocol/contracts/*.v1.json`, 71 web acceptance checks total), each
  carrying verbatim plan-bullet traceability and, for the four lineage
  contracts, bindings to their frozen 0102 ancestor scenarios;
- the cross-contract acceptance kernel (`protocol/kernel.v1.json`), inherited
  from LLP 0102's evidence discipline;
- the neutral React shell (`neutral-web/`) and neutral Expo shell
  (`neutral-expo/`) — both dependency-pinned, backend-free, and verified
  (web: `tsc -b && vite build`; expo: `tsc --noEmit`) so no backend gets a
  bespoke starting advantage;
- the probe policy, frozen **verbatim** from LLP 0137
  (`protocol/probe-policy.md`);
- the evidence schemas (`protocol/schemas/*.schema.json`: run capsule,
  gap-ledger finding, Expo platform receipt) and the expected-check-count
  manifests (`protocol/arm-matrix.v1.json`, `protocol/expo-receipt.v1.json`);
- the assistance policy (`protocol/assistance-policy.v1.json`) binding the
  external-consumer posture, the fix loop, and budgets-as-instruments —
  **ratified as written by the author 2026-08-01** (ballot item 1,
  verbatim "1 ratify"; the synthesis choices in the closed ticket
  `issues/closed/20260801-0137-assistance-policy-synthesized-at-g0.md`
  are confirmed, not amended);
- the G2 target-lifecycle rules (`protocol/target-lifecycle.v1.json`); and
- the credentials preflight (`protocol/credentials-health.v1.json`), which
  retains capability names and statuses only — never values.

**Phase 1 does not freeze a Snapback revision.** That is Phase 2's control.
The Snapback revision moves as fixes land between arms; every arm's diary and
capsule record the exact public `@expo/snapback-*` package versions it ran
against. `protocol/protocol.v1.json`, `protocol/environment.v1.json`, and
`protocol/freeze.v1.json` all restate this explicitly, and the verifier
enforces it.

## Running the verifier

```sh
npm test          # unit tests + full G0 verification
npm run verify    # verification only
npm run freeze    # rewrite protocol/freeze.v1.json (amendments only)
npm run preflight:credentials
```

`verify-freeze.mjs` distinguishes:

- **protocol validity** — the freeze is internally frozen and consistent, and
  the retained digest in `protocol/freeze.v1.json` matches the tree; and
- **execution readiness** — diaried arms remain gated on G1 (public
  terminal-package qualification), and per track on G2 (fair target access)
  and G3 (platform honesty). A valid G0 is not authorization to start a
  diaried arm.

`preflight-credentials.mjs` probes credential-source files and local tooling
while discarding all raw content. It prints only capability names, statuses,
booleans, and name-mention counts; it never prints or persists account
emails, tokens, project ids, or key material.

## Freeze boundary

The digest in `protocol/freeze.v1.json` covers this directory (excluding
`node_modules/`, `dist/`, `.expo/`, and the freeze file itself) plus the LLP
0137 plan document. `arms/`, `probes/`, `receipts/`, and `reports/` are live
output directories outside the freeze: the sweep's fix loop keeps producing
evidence after G0. Outcome-affecting protocol changes after G0 require a
dated prospective amendment and a re-freeze; retained evidence is never
rewritten.

Diaries are created when each application's first arm begins (LLP 0137 diary
protocol), not at G0; their append-only prefixes join the freeze
prospectively at that point.

## Shells

The React shell exposes one neutral view per contract (notebook, chat,
board, event, research, ops) with stable `data-testid` values, accessibility
labels, and an explicit `freshness-state` indicator for the retained-offline
contracts. The Expo shell carries the A1 and A4 screens with `testID`
markers. Neither shell contains any backend interface, poller, transport, or
provider abstraction. Each arm copies the frozen shell and integrates its
provider idiomatically; any gateway, poller, or normalization layer an arm
needs stays visible in the arm and counts as glue.
