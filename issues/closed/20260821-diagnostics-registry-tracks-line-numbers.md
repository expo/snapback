# Generated projections go stale on unrelated edits, and only a clean checkout notices

**Status:** Closed
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


## Widened — 2026-08-21

Filed as a diagnostics-registry issue. It is not: it is a generated-projection
issue across at least two registries, and it has now recurred FOUR times in one
day.

- diagnostics registry, three times (line-number churn from unrelated edits)
- symbol registry plus 56 `guide/reference/*` pages, once (`43814f03d`)

The recurrence is structural, not carelessness. Two properties combine:

1. A landing that changes a generator's INPUTS invalidates its output, even when
   the landing has nothing to do with the projection. The diagnostics registry
   pins line and column, so any edit shifting lines in a file containing
   diagnostics is enough.
2. **The staleness is invisible in the worktree where the work happened**, because
   the generator has already been run there. It only appears on a clean
   checkout — which is what CI, a new contributor, and the complete battery all
   get.

Property 2 is why this keeps reaching `main`. The author cannot see it, and the
gate that would catch it runs somewhere they are not looking.

## What would actually fix it

Options, roughly in increasing cost:

1. **Regenerate in the pre-push hook** when a generator's tracked inputs are in
   the pushed range. Cheap, and closes the invisibility gap at the exact moment
   it matters.
2. **Stop pinning volatile fields.** If nothing consumes `line`/`column` in the
   diagnostics registry, dropping them removes an entire recurrence class. Worth
   checking first — it may make option 1 unnecessary for that registry.
3. **A single `regenerate-all-projections` entry point** that CI and humans both
   run, so the set of projections cannot drift from the set anyone remembers.

Whichever is chosen, the goal is that a landing cannot leave `main` red on a
gate the author had no way to see.

## Pointer — 2026-08-27

The decision this ticket defers now has an RFC:
**LLP 0326 — Volatile coordinates in committed projections**
(`llp/0326-volatile-coordinates-in-committed-projections.rfc.md`).

It runs the consumer audit this ticket asked for first ("find who actually
consumes `line`/`column`"). Result: **no consumer computes on them.** They are
a determinism sort key in the generator, a `file:line` cell rendered into
`guide/reference/diagnostics.md`, and an opaque pass-through in
`crates/snapback-server/src/guide_reference.rs`, which paginates `sites` as
JSON `Value`s and never reads the positional fields — so they are *displayed*
to an agent running `snapback guide <CODE>` but never computed on.

Re-measured 2026-08-27: 10,204 site records all carrying `file`/`line`/`column`
in a 2,526,048-byte artifact; **624 registry commits in 30 days out of 4,780
total (13.1%)**, and **30 of the last 40 registry commits changed no `"code":`
line at all**.

This ticket stays **open** — LLP 0326 is Draft and its OQ1 (drop the
coordinates, move them to an uncommitted sidecar, or regenerate in the pre-push
hook) is unruled. Close it when 0326 is decided, recording which option was
taken. The ticket's own option 1 is 0326's Option A; its option 2 is Option C.


## Resolution — 2026-08-28

Closed by **LLP 0326 Option A**, implemented per **LLP 0326.000** Stages 1-4.

The committed registry no longer publishes `line`/`column`. Site records are
deduplicated on `(file, kind, synthetic)` with a `count`, across both the
`diagnostics` and `environment` blocks, at schema
`snapback-diagnostics-registry.v2`.

Measured on the landing: the artifact falls from 2,526,048 to 1,740,821 bytes
(**-31.1%**), and site records from 10,571 to 5,665. `counts.emittingSites`
and its siblings are summed from `count`, so they still mean *sites* and did
not silently change meaning across the shape change.

The ticket's own option 1 was taken; its option 2 (regenerate in the pre-push
hook) landed separately and earlier as LLP 0326.000 Stage 0, which closed the
*visibility* half of this ticket. Both halves are now addressed: staleness is
visible at push time, and unrelated edits no longer restamp the artifact with
content-free coordinate churn.
