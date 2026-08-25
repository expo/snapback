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

## Resolution approach (Lane M2, 2026-08-24)

The orchestrator ruled that this app remains the frozen LLP 0182/0183 D1
parity instrument. Lane M2 therefore declared every one of its 23 tables
`public-read`, the behavior-preserving table posture for the control's existing
observable surface, and left all handler-level authority and filtering in
`snapback/functions.mjs` unchanged. The honest-narrowest per-table migration
is deferred for author decision in
[`20260824-zerobugs-control-honest-narrowest-visibility.md`](./20260824-zerobugs-control-honest-narrowest-visibility.md).

Generation now succeeds with 23 declared and zero implicit table policies and
produces `snapback/generated/api.mjs`. No field boundary is currently declared,
so LLP 0231's field-addition fence did not force an additional behavior choice.
The generated control schema identity moved from
`snapback.v1:sessions:schema:sha256:127729d9399eb68bbe819c79af0f5bb21f13851be9c00890a0e37a98ee2e9009`
to
`snapback.v1:sessions:schema:sha256:fbfb92e09f61b2f5c57edca8b88bada793780da8c0c7c50a4405d6f3d4324a80`.
The canonical graph-corpus re-freeze moved only embedded identity/content
digests: frozen result bytes, labels, proof classes, refusal reasons, and proof
objects remained byte-identical. Both graph and relational conformance suites
pass on the re-frozen corpus.

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
