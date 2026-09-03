# snapback2: "Test what you just changed" is within 0.4 s of its 30 s budget

**Opened:** 2026-09-03 · **Systems:** snapback2 loop metrics (`scripts/measure.mjs`), snapback2-core tests
**Source:** the landing gate of `cfbd52280` (cursor and identity follow-ups).

`node scripts/measure.mjs --check` measured `core_test_s` at 29.66 s on a quiet
machine (budget 30 s, `rules/RULES.md`); a run under concurrent load measured
30.4 s and failed. Recent main records sit at 24–28 s; the follow-ups landing
added six Rust tests (327 → 333). The budget is a trade, not a limit: the next
few Rust tests landed by anyone will tip this row red and block a landing.

Options, cheapest first:
1. Move the slowest `snapback2-core` integration tests that are not "what you
   just changed" to the scheduled battery, or shard the measured step to the
   crate touched by the diff.
2. Speed up the owner journeys that dominate (`snapback2::owner`), which are
   already the long tail of nextest.
3. Raise the budget in `rules/RULES.md` only with a written trade.

Not a regression to name (the quiet measurement is within budget); filed so the
next over-budget red is not attributed to an innocent landing.
