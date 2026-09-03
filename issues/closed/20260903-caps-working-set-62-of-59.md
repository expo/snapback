# `caps` is red on main: 62 documents in `llp/current` against the cap of 59

**Opened:** 2026-09-03 · **Systems:** `llp/current`, `scripts/caps.mjs`, `rules/RULES.md`
**Author:** Claude Fable 5.1 (orchestrator) · **Date:** 2026-09-03
**Status:** Open · **Severity:** P2 (blocking check red on main)

`rules/RULES.md`: "59 documents in the working set. A 60th requires archiving one — which
is just removing the link." Landing `08643f8b0` (2026-09-02, "docs(research): assess
bounded data program extensions") added three links without archiving any:

- `llp/current/0329.014.006-data-kinds-beyond-tables.research.md`
- `llp/current/0329.014.007-competitive-and-local-first-assessment.research.md`
- `llp/current/0329.014.008-local-first-improvements.research.md`

so `node scripts/caps.mjs` fails with `cap:current: 62 documents in working set, over the
cap of 59` on pristine main. This surfaced once the line-cap red was fixed
(`issues/closed/20260901-caps-oversize-baseline-breach.md`); it had been masked behind it.

Wanted: the owner of that landing archives three links (removing the link is the
archive; the documents stay), or names which three of the existing 59 are done. Not done
here because choosing what leaves the working set is the authoring session's call.

**Resolved 2026-09-03 (author's pick, `5c1492305`).** Archived three finished
documents by removing their links: LLP 1004 (the Quarry ruling is implemented
and amended; its remaining replication workstream is tracked in LLP 1007 §5),
LLP 1005 and LLP 1008 (research syntheses already folded into the living RFCs
1006 and 1009, which stay in the working set). Working set is 59 of 59 and
`caps` is green on main.
