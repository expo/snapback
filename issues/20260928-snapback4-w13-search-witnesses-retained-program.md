# Snapback 4: the W13 search witnesses do not cover the search card's retained program

- **Status:** Open
- **Date:** 2026-09-28
- **Area:** `snapback4/crates/snapback4-sim/tests/search_global/` (`fixture.rs`, `w13-search-card.quarry`), `snapback4/crates/snapback4-lang/src/guide/search_all.md`
- **Found by:** the 0.4.8 Linux qualification (first cut, release commit 8d62134b58), which failed `snapback4-device::search_global` W13e/W13f cases after lane EX round 5 changed the search card

The W13 scale witnesses built their program from the search card's example. Lane EX round 5 added `immutable roomId, at` and `retain delivered-history` to that example (plus the ordinary `search` query). With retained history, device pages over the example are legitimately incomplete (departed rooms' history is frozen on the device), so the witnesses' complete-holdings assertions failed (`page.complete && page.cut.is_none()`, and a withheld `searchGrouped` page with null data at 9,000 memberships). The landing checks for round 5 did not run these device targets.

The fix for 0.4.8 pins the witnesses to the card's example as of lane OS (aa4763bc5) in `w13-search-card.quarry`; they pass unchanged (device 50, sim 17).

Follow-up: add W13-scale witnesses for the card's current program. They should state its intended device semantics at 500, 1,000 and 9,000 memberships (which pages are complete, which are withheld, and that ordinary `search` composes current and retained pages), and prove `searchGrouped`'s withheld page at 9,000 memberships is intended rather than a regression for builders who copy the card. Landing checks for guide-card edits should include every test that reads a card's example (`grep -rn 'guide::card(' crates/`).
