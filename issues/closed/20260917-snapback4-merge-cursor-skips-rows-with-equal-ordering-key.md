# Snapback 4: a merge over a unique index that does not end in `id` silently skips a row when two lanes share an ordering key

Status: Closed (2026-09-17, wave 13 lane W13a)
Priority: P1 (rows silently missing from an answer certified `complete: true`; no diagnostic; reachable with an ordinary non-unique index that merely omits `id`; the paved `…, at, id` indexes are not affected)
Date: 2026-09-17
Systems: `merge` pagination (eager and lazy paths), merge cursors, `E_CURSOR_INDEX`, `rules::lazy_merge`
Observed version: published `snapback4@0.2.27`
Evidence status: found independently by both blind reviewers of the ruling-26 design (GPT and Grok, 2026-09-17), then reproduced by execution on the published binary

## Problem

A merge's cursor is the index suffix after the lane prefix, and resumption is
exclusive on that suffix (`rows.rs` `Bounds.after`). `E_CURSOR_INDEX` admits "an
index ending in `id` or a unique index" and `rules::lazy_merge`
(`engine/rules.rs:90–95`) admits the same. For one prefix a unique index's
suffix identifies a row. Across merge lanes it does not: only `(prefix, suffix)`
is unique. Two rows in different lanes with equal suffixes are one cursor
position, and the second is never returned. `MergeHead` breaks the tie by lane
index, not `id` (`engine/read.rs:31–40`).

## Reproduction (`benchmarks/runs/2026-09-17-snapback4-bounds-probes/merge-equal-suffix-skip`)

```quarry
table msgs:
  roomId: id
  at: time
  body: text <=100
  unique byRoomAt: roomId, at
  read <- allow
  online only

query feed(a: id, b: id, c: cursor ?):
  return merge msgs after c last 1 by byRoomAt:
    [a]
    [b]
```

Rooms r1 and r2 each hold a row at `at = 100`; r1 also 90, r2 also 80. `check` is
clean. Following `next`:

```
page 1: ["r1-100"] complete=true next=yes
page 2: ["r1-090"] complete=true next=yes
page 3: ["r2-080"] complete=true next=no
walk returned 3 of 4; missing: ["r2-100"]
```

A realistic shape: `unique byAuthorDay: authorId, day` for a daily summary, merged
over followed authors — two authors' summaries for the same day straddling a page
boundary.

## It is broader than a tie across lanes: a merge cursor bypasses `E_CURSOR_INDEX` altogether

(`benchmarks/runs/2026-09-17-snapback4-bounds-probes/merge-cursor-bypasses-cursor-index`.) A *direct* page with a cursor
over `by byRoomAt: roomId, at` — non-unique, no `id` — is refused:
"`E_CURSOR_INDEX`: index msgs.byRoomAt cannot carry a cursor: it neither ends in id
nor is unique". The same index under a **merge** cursor compiles with no problem and
no note, because merge lanes are bound with `cursor: None` and the shared cursor is
attached afterwards (`bind/program.rs:547–551`); they never reach the check at
`:274–277`. With two rows at `at = 100` in **one** room:

```
page 1: ["r1-100-b"] complete=true next=yes
page 2: ["r1-090"] complete=true next=no
walk returned 2 of 3; missing: ["r1-100-a"]
```

So an author who leaves `id` off an index gets a refusal for a direct page and
silent loss for a merge.

## Fix options

1. **Preferred — the engine breaks the tie.** Every stored index key already ends
   with the row id (`rows.rs` `index_key`: "the components, then the id"), for
   unique indexes too and on both stores. Make the merged position
   `(suffix values, row id)`: heads compare on it, the token carries it,
   resumption seeks on it. No author changes a schema and both reproductions
   above return every row.
2. **Fallback — refuse at `check`**: route merges through a cursor check that
   requires `id` in the suffix after the lane prefix. For a non-unique index the
   existing mechanical rewrite (append `id`) is right. For a **unique** index it
   is wrong — appending `id` silently stops enforcing the uniqueness the author
   declared — so the rewrite there must add a second, plain index ending in `id`.

Either way, add the regression above on the server and both device stores, for
the eager path and the lazy path at ≤ 8 and > 8 lanes (the batch size differs).
The ruling-26 design depends on this: its drain-cut continuation is only correct
when the merged position identifies a row.

**Fix specified (2026-09-17):** [LLP 3000.007.000](../llp/3000.007.000-merge-position-and-drain-cut-continuation.spec.md)
§1 item 1 (D0.1) — option 1 above, as *append-if-missing* and confined to the
**merge** position (a direct page's token does not change) — with its acceptance in
§6 (D5.6). Two blind review families verified the premise on all three stores.
Built by wave 13's first engine lane (LLP 3000.007 §20.22.1).

## Resolution (2026-09-17)

Fixed by wave 13's lane W13a: the merge position carries the stored row id when the suffix lacks it (LLP 3000.007.000 §1 item 1, D0.1); probes return 4 of 4 and 3 of 3 on the server and both device stores. Regressions in `crates/snapback4-sim/tests/common/merge_continuation.rs`, registered for the server and both device stores.
