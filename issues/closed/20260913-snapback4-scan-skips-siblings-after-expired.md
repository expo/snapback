# Snapback 4: a non-unique scan can return no live rows and `complete: true`

Status: Closed
Priority: P1
Date: 2026-09-13
Systems: interpreter scan continuation
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)

## Problem and reproduction

Index entries are stored as `index columns ++ id`. Scan continuation then drops the extra id: `decode(key).take(index.components.len()).skip(prefix.len())`. The next batch uses that suffix as `Bounds.after`. For a non-unique index that does not already end in `id`, that bound is the exclusive end of the whole equal-key group, so remaining siblings are skipped.

The compiler refuses *opaque cursors* on such indexes (must end in `id` or be unique). It does not protect cursorless pages or the inner batch loop. Uniform scans fetch `take + 1`; if expired or hidden rows eat that batch, the loop continues with the truncated after.

Probe: table `notes` with `by byTag: tag` (not unique, no trailing id), `expire at .until`, twelve expired plus five live rows all `tag = "open"`, `return notes[] first 10 by byTag` when only the five live rows are visible. Result: `[]` with `complete: true`.

Job chunks already resume from the full stored key (`decode(key).skip(prefix.len())` with no `take(components.len())`).

## Implementation locations

- [snapback4/crates/snapback4-core/src/engine/read.rs](../../snapback4/crates/snapback4-core/src/engine/read.rs) (~259)
- [snapback4/crates/snapback4-core/src/store.rs](../../snapback4/crates/snapback4-core/src/store.rs) (`Tx::scan`)
- [snapback4/crates/snapback4-core/src/engine/job.rs](../../snapback4/crates/snapback4-core/src/engine/job.rs) (the working form)

## Suggestion

Resume from the full stored key, including the extra id `index_key` already appends. Keep the compiler cursor rule as defense in depth, not as the only uniqueness guarantee.

## Resolution — 2026-09-13

Internal scan continuations retain the full stored key, including the appended row id. A batch of expired equal-key siblings no longer skips later live siblings or claims an empty complete result. The regression scans 12 expired and 5 live equal-key rows and returns all 5 live rows with complete=true.

Integrated implementation: `4b70bdb6f` and `3d2007794`, plus the HTTP/device follow-ups where applicable. Focused core, simulator and host regressions passed. Full integrated suite and scoped blind review are recorded in the append-only Snapback4 journal before publication.
