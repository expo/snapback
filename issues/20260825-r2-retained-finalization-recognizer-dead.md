# R2 finalize-existing retained-overlay recognizer is unconditionally dead after the dual-review hardening

Opened: 2026-08-25
Source: grok-4.6 delta re-review (MINOR) of `abee210f1e43`, R2 instrument hardening round.

`benchmarks/tools/social-messenger/metering/r2-finalize-existing.mjs` (~:329-337)
identifies a retained-finalization overlay by `instrumentMigrations.at(-1)` plus
`commits.includes("scoped-review-pending")`. The hardening round replaced the
placeholder commits with real SHAs and appended a new final migration entry, so
`retainedFinalizationMigration()` now always returns `null`.

Effect is fail-closed, not a weakening: same-config finalize-existing still
works; only cross-overlay retained recovery (an attempt admitted under a
previous overlay, finalized under a newer one) lost its recognizer. The R2
campaign (`2026-08-23-r2-published-0125`) is closed, so nothing current is
affected.

Before the next campaign (R3), decide explicitly whether cross-overlay retained
finalization should exist at all. If yes, identify the overlay by its
reason/commits (e.g. `b86cd6e2d`, `057ce5898`, `92f21bec4`), not by
`.at(-1)` + a retired placeholder. If no, delete the dead helper and its
callers so the surface stays honest. Reviewer guidance: do not teach the helper
to accept the dual-review row as a retained overlay implicitly.

## 2026-08-26 R3 commissioning decision

The author-delegated R3 packet chooses **same-config finalization only** for
`2026-08-26-r3-published-0127`. A retained attempt may be finalized only by the
exact committed harness config and executing-source closure that admitted it.
No cross-overlay recognizer is commissioned, and an overlay change cannot
authorize a relaunch or recovery of consumed evidence.

This resolves the R3 policy decision, not the dead-code cleanup. Keep this
ticket open until the unconditional recognizer, helper, and callers are removed
or replaced by an independently commissioned contract.

## R3 commissioning follow-up (2026-08-26)

The recognizer stays dead. The R3 `2026-08-26-r3-published-0127` validator now
fails closed if its run config contains any `instrumentMigrations` entry, so a
future edit to this packet cannot resurrect cross-overlay retained
finalization while the generic dead code awaits removal.
