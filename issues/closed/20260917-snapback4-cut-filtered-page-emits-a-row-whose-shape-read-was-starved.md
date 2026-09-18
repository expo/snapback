# Snapback 4: a meter-cut filtered page emits a row whose nested shape read was starved, and `next` positions past it — the preview is empty and never refilled

Status: Closed 2026-09-17 — landed on main from the reviewed tip `e8d3a8b858` (lane W13h; LLP 3000.007 §20.22.7, §5.6)
Priority: P2 (a wrong answer inside an honestly incomplete page, in the search card's recommended form; the continuation cannot repair it)
Date: 2026-09-17
Systems: `snapback4-core` `engine/read.rs` (`scan_prepared`: the returned row's shape evaluation under a cut meter; `record_page`'s position for a cut filtered page, §5.6)
Observed version: wave-13 lane W13e's tree on main `939e558690` (rulings 23–25, W13a, W13b, W13f landed); the same shape reads existed on 0.2.27
Evidence status: measured by lane W13e on the server and both device stores (the 9,000-membership grouped walk); disclosed on the search card pending this fix

## Problem

```quarry
query searchGrouped(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom where exists (messages[.roomId] matching q) { roomId, hits: messages[.roomId] matching q last 3 by byRoomWords }
```

At 9,000 memberships with hits in three chats, request 1 is meter-cut at 8,194 examined and
carries `next` (LLP 3000.007 §5.6: a cut filtered page positions after its last rule-visible
examined row); request 2 finishes. Every expected chat appears exactly once — but the chat
emitted last on the cut page has **`hits: []`**: its predicate (`exists`) was satisfied before
the cut and the row was emitted, then the nested `hits` page ran with an exhausted meter and
returned nothing. Following `next` starts *after* that chat, so its preview is never refilled.
The page says `complete: false, cut: 'meter'`, which is honest about the page and wrong about
that row: a screen renders a chat with hits as a chat with none.

## Fix

A row whose returned shape could not be computed because the meter was cut is not a
result. Where that happens: the binder lowers a returned shape into a **loop that runs
after the source page is materialised** (`bind/program.rs`, the shape loop; the runner
materialises the page at `engine/runner.rs` ≈ 244 before executing it) — not inside
`scan_prepared`, whose frontier has advanced past every emitted candidate by then. So the
repair is in that shaping phase: when the shape of a returned row is starved by the cap,
drop that row and every row after it from the page, and position the continuation
**before the first unfinished shaped row**, so the next request reads it again with a
fresh meter. The page then answers `complete: false, cut: 'meter'` with fewer rows and a
`next` that reaches the dropped row first. Moving the scan frontier back one candidate
would not do it — discovery has advanced much further than the shaped rows.

This is a proposed refinement of the continuation law, to be recorded when it lands:
LLP 3000.007 §5.6 positions a cut filtered page after its last rule-visible examined
row, and LLP 3000.007.000 §3 lets a merge's candidate survive later shape exhaustion; both
stay true for rows whose shape *was* computed. The new rule adds: a row whose shape was
not computed is not on the page, and the position is before it.

Regression: the 9,000-membership grouped walk asserts every chat's `hits` on the page
where the chat appears (no empty preview for a chat with hits); a cut landing exactly
during a returned row's shape read positions `next` before that row; the walk still
returns every chat once; a cut during the *predicate* keeps §5.6's position (control);
server and both device stores.

## Related

- LLP 3000.007 §5.6 (the filtered page's cut position), §20.22.4 and the search card's grouped form
- LLP 3000.007.000 §5 (the descoped hook discharge — a "starved shape read" was one of the
  contributions its covering invariant missed; this ticket fixes the page, not the hook)

## Resolution (2026-09-17)

Landed on main 2026-09-17 (reviewed at `e8d3a8b858`): a row whose returned shape the meter starved is not on the page — it and
every later row are dropped and `next` positions before the first unfinished rule-visible row (exclusive after a finished
predecessor, else an inclusive v3 token at that row); the 9,000-membership grouped walk returns no chat without its hits.
The ownership analysis that decides when a shaped page's rewind is published went through five blind rounds; its
invariant is recorded in the journal and §5.6. The residual — a shape that cannot finish under any fresh meter — is
`issues/20260917-snapback4-a-returned-shape-that-cannot-finish-under-a-fresh-meter-makes-no-progress.md`.
