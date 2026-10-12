# Snapback 4: a meter cut inside a predicate's read skips the row on the next page

**Opened:** 2026-10-12 (workstream MERGE, LLP 3000.036.001 round 4; GPT's
round-4 finding 1 traced a merged page into it, and the direct page shows it
alone)

A direct page whose `where` dereferences a reference column positions its
continuation after a row whose predicate the meter cut, so the next page never
returns that row. Over

```quarry
table metas:
  ok: bool
  public
table tasks:
  owner: principal
  meta: metas
  at: int
  read <- .owner = viewer
  online only
query flagged(c: cursor ?):
  return tasks where .owner = viewer and .meta.ok = true last 2 by .at after c
```

with `metas m1 {ok: true}`, `t1 {owner alice, meta m1, at 10}` and
`t2 {owner alice, meta m1, at 5}`, Alice's first page under
`Ceilings { examined: 1 }` is empty, incomplete, with a `next`; following it
without a ceiling answers `["t2"]` — `t1`, the first match, is never returned.
At `examined: 3` the first page answers `["t1"]` and the continuation `[]`,
skipping `t2`.

`read.rs` (`scan_prepared`) records `last_rule_visible` before the filter runs
and, when the cut lands inside the filter, positions the exclusive `next` at
that key. Only timeline feeds and existence predicates retry inclusively
(`filter_interrupted`, LLP 3000.007 §20.24.1); "general counting predicates
keep their existing forward progress". A predicate that reads (a member
through a reference) is neither, so its unfinished verdict is treated as a
reject.

Merged pages (LLP 3000.036.001) no longer reach it: a member through a
reference is not total, so such a page keeps this single read
(`a_reference_member_is_not_total`).

**Fix direction:** treat a cut inside any predicate that reads as an
interrupted verdict (retry the row inclusively, with the existing
no-emission-at-the-same-position guard against a loop), or position at the
previous rule-visible key. Add the scenario above as a regression; check the
meter oracle (`run`) for why it did not draw it.
