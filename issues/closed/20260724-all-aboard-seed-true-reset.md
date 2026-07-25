# All Aboard: seed-true reset (resetFeed cannot restore the seed state)

**Status:** Resolved
**Severity:** P2
**Systems:** Demos, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** demos/all-aboard/snapback/handlers.mjs, expo-jam-allaboard diaries 0001/0005/0006
**Marker:** all-aboard-external-review

`resetFeed` (`demos/all-aboard/snapback/handlers.mjs:568-585`) stamps
`feedRefreshState.lastSource: 'reset'`, while the seeded state carries
`lastSource: 'seed'` (`seed.gen.mjs:59`) and the surfaces render the
SCHEDULE/DEMO DATA label from that field. So no app-reachable call can
return the app to an honest seed-labeled state; the only seed-true path
is the admin-token `reset(seed)` app reset, unreachable from an app
client. The All Aboard external review (Kimi, 2026-07-24) reports every
single arm tripped on this, and the SB-SWIFTUI arm built an entire
second-port `/reseed` control seam to work around it; Convex and
Supabase's seed-true resets were praised as "the most honest test hook
of any row" in four diaries.

Fix in the demo app (this is app-level, not engine-level): either make
`resetFeed` restore the literal seed rows (`lastSource: 'seed'`,
`tickIndex: 0`), or add a distinct `reseedFeed` mutation that does,
keeping `resetFeed`'s current zero-state semantics if they are still
wanted. Mirror to the expo-jam-allaboard copy (byte-identical port) so
its `/reseed` control seam can be retired.

**Done when:**

- An app-reachable mutation restores the feed tables to the literal
  seed fixture (`lastSource: 'seed'`, `tickIndex: 0`), asserted
  byte-equivalent against `seed.json` by the acceptance suite.
- The demo's acceptance suite uses it between arms/cases instead of a
  full admin reseed.
- The change is noted in the demo diary per the diary convention.

## Resolution

Closed 2026-07-25. `resetFeed` itself is now seed-true (no separate
`reseedFeed`): a consumer audit showed nothing depends on the old
`lastSource: 'reset'` label — every call site (headless, real-data ×3,
browser, browser-react) uses `resetFeed` for exactly "tick 0, all on-time,
clear the ENG-23642 poll budget", and the badge helpers treat `'reset'` and
`'seed'` identically as DEMO DATA — so a second mutation would have preserved
semantics nobody consumes while leaving two resets to choose between.

Seed-source mechanism: the generated-constant approach does not fit the build
flow — Snapback handler files are closed single-file scripts and codegen's
`scanUnsupportedHandlerSource` rejects import/export, so `seed.gen.mjs` cannot
emit a module the handler imports, and passing the fixture as a mutation
argument would let any app client write arbitrary rows. Instead the mutation
restores by construction: it rewrites every handler-mutable feed field to its
seed literal (`lastSource: 'seed'`, `tickIndex: 0`, `fetchedAt: 0`,
`observedAt: 0`, `lastError: ''`, `lastUpstreamPollAt: null`, empty
`liveDepartures`), and the fields it does not touch (`staleAfterMs`,
`tickCount`, static schedule tables) are exactly those no mutation ever
writes. The headless suite's new check dirties the state (feed tick +
`claimFeedPoll` stamp), calls `resetFeed`, and asserts the feed tables
byte-equivalent to `seed.json` (canonical key order; excluding only
underscore-prefixed Snapback system columns `_createdAt`/`_updatedAt`/
`_version` — commit bookkeeping, not seeded state — and null columns, which
are storage's representation of optional fields the fixture omits). That
assertion is what pins the restore-by-construction invariant against drift.
It runs before the suite's single subscription is created, so the 180s
warm-poll cron is unarmed and cannot commit a tick mid-assertion.

Evidence (2026-07-25, worktree branch `worktree-agent-ae1bb47a94e0e00b9`):
headless 12/12 PASS including the byte-equivalence check; real-data 8/8 PASS
(the three budget-clearing resetFeed uses); browser 34/34 PASS; browser-react
18/18 checks PASS (one Chrome teardown-attestation cleanup error,
environmental); badge-freshness 6/6 PASS under bun. cron.mjs fails 2/7 in
this worktree identically with and without the change (pre-existing
environment issue — cron inspect state empty; the two feed-related checks
pass).

Remaining step: mirror the byte-identical `handlers.mjs` change (and the
regenerated artifacts) into the `expo-jam-allaboard` copy so its second-port
`/reseed` control seam can be retired. That repo is shared with live sessions
and was deliberately not touched here.
