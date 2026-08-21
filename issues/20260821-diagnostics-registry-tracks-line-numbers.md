# The diagnostics registry pins call-site line numbers, so unrelated edits go stale

**Status:** Open
**Filed:** 2026-08-21

## Observation

`guide/reference/diagnostics-registry.json` records the `file`/`line`/`column`
of every diagnostic call site. So ANY edit that shifts line counts in a file
containing diagnostics invalidates the registry, even when no diagnostic is
added, removed, or renamed.

Concretely: `f99b92cee` deleted three lines from
`crates/snapback-server/src/server.rs` (a duplicate admission guard). That
shifted every later call site by three, producing a 1125-line registry diff in
which **no `SNAPBACK_*` code changed at all** — only line numbers and the
`sourceDigest`.

The `guide` gate then fails with `[diagnostics-registry] stale`, which reads
like a missing diagnostic rather than a line-number shift.

## Why it matters

This has gone stale three times in one day, on three unrelated landings. Each
time the failure surfaced late — from `check-inventories` on a clean tree, or
from the `guide` gate deep in the complete battery — rather than at the edit
that caused it. It is easy to forget precisely because the causing change has
nothing to do with diagnostics.

It also produces enormous, content-free diffs that bury real registry changes.
A landing that genuinely adds a diagnostic is indistinguishable, in review,
from one that merely moved some lines.

## Options

1. Stop pinning line/column. If the registry's purpose is to enumerate codes
   and their sources, `file` alone may be enough, and the churn disappears.
2. Keep positions but regenerate automatically — a pre-commit hook, or fold it
   into an existing generated-artifact refresh, so it cannot drift.
3. Keep positions and make the staleness message name the cause, e.g.
   "positions shifted; no codes changed", so the next person does not go
   hunting for a missing diagnostic.

Option 1 is worth checking first: find who actually consumes `line`/`column`.
If nothing does, this is pure churn with a recurring gate cost.

## Note

Not a regression and not urgent — the registry is regenerated and green. Filed
so the recurrence is understood rather than re-diagnosed a fourth time.
