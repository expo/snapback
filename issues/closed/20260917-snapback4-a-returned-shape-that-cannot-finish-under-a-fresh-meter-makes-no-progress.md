# Snapback 4: a returned shape that cannot finish under a fresh meter mints an inclusive `next` at its own row — a follow makes no progress

Status: Closed 2026-09-18 — landed on main from the reviewed tip `1e5fda7f68` (lane W13j; LLP 3000.007 §14 ruling 35, §20.22.7)
Priority: P3 (a query that can never answer under the ceilings; today's behaviour is honest but loops when followed blindly)
Date: 2026-09-17
Systems: `snapback4-core` `engine/shaping.rs` (`trim_shape`: the inclusive first-row position), `engine/runner.rs` (the shape-loop interception), `cursor.rs` (the v3 inclusive token); `snapback4` `check --cost` (where the static note would live)
Observed version: wave-13 lane W13h's tree (`c871e2d1fb`, the returned-shape refinement of LLP 3000.007 §5.6), found by its blind review (Grok family, residual note)
Evidence status: reasoned from the source by the reviewer; pinned by the server-only test `w13h_a_shape_that_cannot_finish_under_a_fresh_meter_makes_no_progress` (lane W13hR1)

## Problem

Since W13h, a row whose returned shape the meter starved is not on the page: it and every later row are
dropped and `next` positions *before* the first unfinished row — inclusively, with a v3 token, when no
preceding row finished (LLP 3000.007 §5.6, returned-shape refinement; LLP 3000.007.000 §3 item 4). That is
right whenever the row's shape can finish on a retry with a fresh 8,192 meter, which is every case the walk
measures (the grouped search's `hits … last 3`, the `[a,b,c]` boundary fixture). It is wrong for a shape that
cannot finish under *any* fresh meter — one row whose returned shape alone examines more than the ceiling, for
example `{ roomId, unread: count(messages[.roomId] where .at > lastSeen) }` over a chat with 9,000 unread
messages, or LLP 3000.007.000 C2c's `count(… first 9000)`:

- request 1 returns zero rows, `complete: false`, `cut: 'meter'`, `next` = inclusive at that row;
- following `next` re-examines the row with a fresh meter, starves again, and returns the same page with a
  `next` byte-identical to the cursor it was given.

A client that follows `next` until `complete` never terminates and never advances. Before W13h the row was
returned with a wrong (partial) `unread` and `next` after it — a silent wrong answer that did progress; W13h's
behaviour is the honest one, and the loop is its cost.

## What to decide (author's ruling)

Two ways to close the loop; they are not exclusive:

1. **A runtime refusal on the no-progress follow.** When a request begins at an inclusive cursor and its first
   returned row's shape starves again, the engine answers with a diagnostic (`E_SHAPE_EXCEEDS_CEILING` or a
   reuse of `E_QUERY_...`), not the same cursor: the loop becomes a loud refusal at the second request. Cost:
   one new code on the reads surface; the client sees an error instead of an endless `complete: false`.
2. **A `check --cost` note.** A returned shape whose own worst case is unbounded against the ceiling (a `count`
   or a page over a per-row range with no `first`/`last` bound, or a bound above the ceiling) is noted at
   `check` time, in the same family as `N_NEVER_COMPLETE` / the N_WIDE_MERGE arithmetic ruling already open in
   LLP 3000.007 §20.22.7. Cost: none at runtime; a builder who ignores the note still loops.

Recommendation: (1), because the loop is what a bare `usePage` client hits, and the program's rule is a loud
refusal over a silent fallback; (2) in addition once the `check --cost` arithmetic ruling lands. Neither is
built in wave 13 ("stop adding surface for a wave"); the pinning test documents today's behaviour so the
ruling has a fixture to change.

## Regression

`w13h_a_shape_that_cannot_finish_under_a_fresh_meter_makes_no_progress` (server, `crates/snapback4-sim/tests/common/shape_pages.rs`): a first row whose returned shape alone exceeds the meter yields an empty page, `complete: false`, and — followed once — a `next` byte-identical to the request's own cursor. Under ruling (1) the second request refuses instead; under (2) `check` notes the query and the runtime pin stands.

## Resolution (2026-09-18)

Ruling 35 (LLP 3000.007 §14): a request that begins at an inclusive v3 cursor at position P, returns an empty page and
would mint an inclusive `next` at the same P refuses with `E_SHAPE_EXCEEDS_METER`, naming the shape's read site and the
meter, on the server and both device stores (lane W13j, reviewed at `1e5fda7f68`). The first request that drops the starved
row is unchanged; a follow whose row finishes, and every exclusive-cursor follow, are unchanged. The `check --cost` note
for a returned shape whose own bound exceeds the ceiling waits for the cost arithmetic (§14 ruling 35's second half).
