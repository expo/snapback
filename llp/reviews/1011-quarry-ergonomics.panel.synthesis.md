# Panel: LLP 1011 — author-side synthesis (Claude Fable 5.1)

**Family:** Claude Fable 5.1 — the session that authored revisions (a) and (b); **not an independent reviewer**, disclosed as the author-side voice
**Provider/runtime:** Claude Code, model claude-fable-5-1
**Date:** 2026-09-03
**Redacted:** No — everything read was in-repo; nothing left the machine beyond the models serving the two CLIs.
**Method:** Wrote revision (a) from the LLP 1010 migrations and the code at `4a33e55de`; ran round 1 blind and round 2 cross-read; verified every code claim in both reviews before accepting it; wrote revision (b). Records: `1011-quarry-ergonomics.{codex,grok}.md`, `.panel.brief.md`.

## Verdicts

Round 1: both NOT READY. Round 2: both READY after the same list. Revision (b) is that list; LLP 1011 §9 names who found what.

## What the panel changed in the author's view

1. **The mint rule.** I had "null on Exhausted, token on Limit". Grok showed two cases the engine already distinguishes: an empty capped page (a hidden run ate the budget) must not continue from an examined position, and a merge whose lanes all exhausted but whose union exceeded N must page. Codex insisted no per-site stop reason be exposed. The rule became: complete → null; nonempty capped → the last returned row; empty capped → null.
2. **Page provenance.** My "returned value is a page" rule would have matched none of the shipped feeds, because shaping retypes the page to a sequence. The certificate gets a result-page site tracked through bindings and shapes.
3. **The token.** Plain JSON collapses ids and strings on this wire; the token carries typed values and the suffix descriptor. I argued it should not bind to the site, and both families agreed in round 2.
4. **`fn` deferred.** I proposed general helpers, then a guard-and-pure subset. Codex held that even the subset needs statement lifting and temporary hygiene; grok changed on the deletion count, since the repeated guards use three client-asserted refusal codes. `shape` alone deletes fourteen repeats; that is the honest cut.
5. **B3's mechanism was wrong.** A read-ruled pre-read would have turned write authority into read-and-write and broken the chat template's `notifications` table. The rule moves into the engine's write primitives, with codex's three-way rule for the receipt-only twin.
6. **Narrowing** survives only as `if` narrowing on binding identity and one hop; codex showed conjunct narrowing is unsafe while right-hand preludes lower before the `&&`.
7. **B6's `--filter` struck** by both; the index repair became a catalog-time two-site diagnostic once codex showed the refusal fires before the predicate exists.
8. **Three items I missed**: the chat `thread` has no continuation (grok); `data` can page today on the control path (codex); a 3,329-line generated golden is committed (codex).

## Proposed next step

Implement under the author's standing instruction: two sequential codex lanes on `s2/quarry-ergo` per LLP 1011 §8, landed by the orchestrator after `scripts/test.sh` is green out of sandbox.
