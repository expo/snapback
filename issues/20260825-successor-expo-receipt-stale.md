# Supervised Expo extra keeps the previous descriptor after a same-owner schema successor

**Filed:** 2026-08-25
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-explicit`
**Systems:** React/Expo, CLI, Local server lifecycle, Code generation
**Owner:** LLP 0310.000 Track A — not a drive-by fix

## Problem

After M1 green, an additive M2 generate produced `startup-successor-activated`
with accounts/sessions/stores preserved. Generated files named the new
descriptor. The running Expo integration receipt still named the M1
descriptor (`5204d9d4`). The web client refused with
`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`. Login never rendered.

This is a regression versus Clique explicit greens on 0.1.24 and 0.1.25.
LLP 0302's fail-closed identity gate is correct against a *wrong* backend;
it must not fire on a legal successor in the same `snapback dev` owner.

## Evidence

- `benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-explicit/`
  (`final-report.md`, `diary.md`, `run-log.md`)
- LLP 0310 F1; LLP 0310.000 Ruling 1 / Track A

## Direction

Recook the Expo extra / integration receipt onto the successor identity
before the next client handshake. If recook cannot complete, refuse the
successor rather than serve split-brain. Do not weaken mismatch against a
foreign backend. Do not bless `pkill` or owner restart as the paved recovery.
