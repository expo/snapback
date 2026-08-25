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
