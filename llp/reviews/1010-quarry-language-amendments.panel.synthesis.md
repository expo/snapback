# Panel: LLP 1010 — author-side synthesis (Claude Fable 5.1)

**Family:** Claude Fable 5.1 — the session that authored revision (a) and revision (b); **not an independent reviewer**, disclosed as the author-side voice
**Provider/runtime:** Claude Code, model claude-fable-5-1
**Date:** 2026-09-03
**Redacted:** No — everything read was in-repo; nothing left the machine beyond the models serving the two CLIs.
**Method:** Wrote revision (a) from a reading of the language at `18b69426b`; ran round 1 blind (codex ultra, grok xhigh) and round 2 cross-read; verified every code claim in both reviews against the checkout before accepting it; wrote revision (b). Records: `1010-quarry-language-amendments.{codex,grok}.md`, `.panel.brief.md`.

## Verdicts

Round 1: both NOT READY. Round 2: both READY after the same list of changes. Revision (b) is that list; LLP 1010 §9 names who found what.

## What the panel changed in the author's view

1. **Bounds-first (rev (a) A4) — killed.** I was at 55/45 and said so; both families made the same argument independently: nothing deleted, benefit imagined, and it does not touch the bracket overload it was a proxy for.
2. **A2 was argued at the wrong layer.** I cited the paper exercise's authorization NULL trap. Rules lower to `rule.eq` and the engine compares `Value`s totally; the IR's own `BinaryOp::Eq` is total too. Only the Quarry program lowering guards. The amendment survives, narrower and stronger (three of four layers already agree), and the corpus cost I had not seen — `social.q:55–57`'s deliberate absence hack — is now a listed migration.
3. **"`where` erases the `capped` state" — wrong.** The inner scan's `Limit` already derives `Capped`. I withdrew that sentence and the two fences built on it.
4. **From fencing `where` to deleting it.** Grok enumerated the corpus in round 1 (three semantic uses, each with a better spelling) and codex flipped in round 2 after checking the seed. I had proposed labels and a viewer heuristic; codex showed the heuristic is evadable by aliasing. Deletion is the smaller change and the honest one.
5. **Merge grew the parts I had left implicit**, mostly from codex: the truncating final slice makes "complete iff every lane is complete" false, so the certificate gets a merge site; id-dedupe at runtime; the `take + 2` reserve in the cost; the table-in-header spelling; and — from both, and from my own reading of round 1 — the shared-suffix cursor applied to every lane, which meets the brief's paging item without a frontier vector. The self lane replaced my self-follow suggestion, which the brief forbids.
6. **Two amendments I had not proposed**: the optional cursor group (codex; grok changed to include it), whose defect I then found while verifying — an absent cursor on a `last N` read is an empty page today — and the canonical modifier order with duplicate-`by` refusal (codex).
7. **Deferred rather than widened**: `insertIfAbsent` to a ticket (both agreed with my lean); no narrowing (both).

## Rulings recorded in revision (b)

D-A delete `where` · D-B moot · D-C mechanism (iii), a certificate merge site · D-D table in the header, lanes as prefixes, static-duplicate refusal plus runtime id-dedupe, the lane cap named in the guide · D-E include the optional cursor group, all-or-none over optional arguments, mixed = `E_INPUT` · D-F ticket · D-G printer order, both parse paths, merge shares it · D-H nested presence branch then `!`, no narrowing.

## Proposed next step

The author authorized implementation in session; LLP 1010 §8 gives two sequential codex lanes on `s2/quarry-amend`, landed by the orchestrator after `scripts/test.sh` is green out of sandbox.
