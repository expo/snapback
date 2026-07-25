# All Aboard: seed-true reset (resetFeed cannot restore the seed state)

**Status:** Open
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
