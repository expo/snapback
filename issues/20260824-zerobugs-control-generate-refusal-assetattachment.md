# zerobugs control `bun run generate` refuses at main HEAD — assetAttachment visibility governance

**Status:** Open · **Opened:** 2026-08-24 (session snapback G3 arc) ·
**Systems:** codegen / visibility governance / zerobugs control demo

## Problem

At `origin/main` `e3a9f87ba` (2026-08-24), `demos/zerobugs/control`'s
`bun run generate` (`SNAPBACK_OUTBOUND_ACTIONS=1 snapback generate snapback`,
workspace `@expo/snapback-cli`) exits 1. The output is a structured policy
action plan centered on the `assetAttachment` table having
`authoredVisibility: omitted`, with `requiresApproval: true` guide pointers
(`auth.protecting-data#declare-who-can-read-each-table`) and no generated
`snapback/generated/api.mjs`. The zb5 acceptance gates
(`tests/acceptance/gates/zb5-large.mjs` etc.) import that module, so the
whole zb5 gate family is unrunnable from a fresh checkout at HEAD.

Likely origin: the 2026-08-23/24 visibility-governance codegen landings
(e.g. `9eb4bee48` and the LLP 0297/0304 agent-safe-schema-authoring wave)
tightened generation over a control-demo schema authored before the policy
existed. The G2 measurement arc sidestepped it by pinning its measurement
worktree at the G2-complete anchor commit (`35f48e6a6`).

## Acceptance

- Either declare the intended `assetAttachment` visibility in the control
  demo schema (author-decided policy), or give demos a recorded
  approval/acknowledgment path so `generate` succeeds non-interactively.
- A fresh checkout at main HEAD can run
  `bun install && bun run generate` in `demos/zerobugs/control` and then
  the zb5 gate family.
- If the governance refusal is intended to block generation for undeclared
  tables, record that decision in the governing LLP and update the zb5 gate
  docs/pins accordingly.
