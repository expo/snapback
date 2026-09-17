# Snapback 4: an expression in a merge lane source's range seek compiles clean and is refused at runtime — `E_INPUT: unknown variable $value1`

Status: Closed (2026-09-17, wave 13 lane W13c)
Priority: P2 (a program `check` accepts with no problems is refused on every call; loud, not silent, and one rewrite away — but the rewrite is not offered and the message names a compiler temporary)
Date: 2026-09-17
Systems: `snapback4-lang` `bind/program.rs::merge` (lane source binding), lane `setup`; the engine's lane-source evaluation order
Observed version: published `snapback4@0.2.27`
Evidence status: met by a fresh builder in the bounds bar's first "before" run (run 1, loop 4, self-attributed `snapback4-defect`), then reproduced by execution on the published binary

## Problem

```quarry
query inline(at: time, c: cursor ?):
  return merge posts after c last 10 by byHourAt:
    [h.hourAt] for h in hours[hourAt >= hour(at - 86400000), hourAt <= hour(at)] first 25 by byHour
```

`check: ok — 2 tables (0 synced), 3 operations, no problems`. Every call answers

```
{"denied":{"code":"E_INPUT","family":"input","message":"E_INPUT: unknown variable $value1"}}
```

The same seek with its two expressions bound to locals first answers correctly,
and the same inline seek on a direct page (not a lane source) answers correctly.

## Reproduction (`benchmarks/runs/2026-09-17-snapback4-bounds-probes/merge-lane-inline-seek`)

`SB=/path/to/snapback4 node measure.mjs` — 30 hours, one post each:

```
  inline  REFUSED {"denied":{"code":"E_INPUT","family":"input","message":"E_INPUT: unknown variable $value1"}}
  bound   rows=10 complete=true next=yes
  direct  rows=25 complete=true next=no
```

## Cause (read from source at `e246af6e6`, not yet confirmed by a fix)

`bind/program.rs::merge` binds a lane's **source** scan with the lane's own
`setup` body (`let (scan, _) = self.scan(domain, &mut setup)?`, `:536`), so the
temporaries the binder hoists for the source's seek bounds (`$value1`, …) are
assigned inside `MergeLane.setup`. That setup is the per-source-row prelude — it
exists so the lane *prefix* can mention the loop binding (`[h.hourAt]`) — and the
engine runs it after the source scan has produced a row. The source scan's own
bounds are therefore evaluated before anything defines them. A seek over plain
variables hoists nothing, which is why binding locals first works.

## Fix

Hoist what the source scan needs into the statement list that precedes the merge
(`out`), not into the lane's per-row setup: the source cannot mention the lane's
binding — it defines it — so nothing it hoists depends on a source row. Keep the
lazy path's rule that discovery freezes only prefixes (LLP 3000.007 §20.12).
Regression: the probe's three queries on the server and both device stores, eager
and lazy lanes; add a key expression (`hours[bucket(at)]`-style prefix on the
source) and a `where` on the source, which hoist through the same path.

Whatever the fix, a compiler temporary's name should not reach an author: if the
interpreter can still meet an undefined `$…` variable, that is an internal error
with the operation and site, not `E_INPUT`.

## Resolution (2026-09-17)

Fixed by wave 13's lane W13c: a lane source's hoisted temporaries are bound into the statements that precede the merge, not the lane's per-row setup; the probe's three queries answer on the server and both device stores; an undefined temporary is now `E_INTERNAL` naming the operation and site, never `E_INPUT`.
