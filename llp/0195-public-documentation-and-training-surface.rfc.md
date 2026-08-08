# LLP 0195: Public documentation, examples, and training-data surface

**Type:** RFC
**Status:** Review
**Systems:** Documentation, Publishing, Guide, Templates, Competitive
evaluation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r7, author-merge: Charlie's revision — publication
binds to a qualified closure/content digest rather than moving HEAD; public
examples become generated projections with a single canonical owner; the
two-clocks success measures separate immediate retrieval from long-horizon
training familiarity — merged onto the r6 review spine, which keeps the
retained "dominant term" citation, the four-audit count, and the
instrumented-hypothesis framing.) 2026-08-08 (r5, this document: 0065 citation slug only.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (the orientation-gap evidence), LLP 0061 (guide),
LLP 0041 (packaging), diaries 0065 (`0065-rematch-published-closure-bakeoff`)/0066/0068/0069

## Summary

Snapback currently has **no public documentation surface**. The guide
exists only in this repository and served from installed binaries: an
agent cannot read a word of it before installing, search engines and
training pipelines never see it, and `llms.txt` exists only on loopback
origins. Meanwhile the measurement series calls orientation cost "the dominant
term" in the remaining efficiency gap (diary 0069) — cost the Convex
lanes did not pay: across all five runs they consumed no documentation
at all, working from prior model familiarity. A public surface is the pre-install orientation fix and the
discoverability fix on its face; that it also feeds future model
training is a plausible but **unverified hypothesis** — prior
familiarity is measured, its provenance is not. The decision case rests
on discoverability and retrieval; the training effect, if real, is
upside this RFC proposes to instrument rather than assume (OQ4). It
remains the largest unstarted item this program has identified. It is proposed here rather than executed because publishing
is the author's decision.

## Proposal

1. **Public docs site, generated from `guide/`.** The corpus is already
   CI-verified, version-fenced (`published-closure.json` + `since:`
   machinery), and honest by construction (GAP rows). A static site
   generator over `guide/` — same markdown, same snippets, the 0194
   reference included — published on a real domain, with `/llms.txt` at
   the root and per-release snapshots pinned to published closures (the
   fence machinery already knows what each closure contains). The
   in-repo/served guide remains canonical; the site is a projection with
   the same content hashes. Publication consumes a qualified
   closure/content digest, not whatever commit happens to be HEAD while
   `main` moves.
2. **Public examples repository**, projecting the template outputs and
   selected demo apps (the benchmark lanes' apps are strong candidates:
   complete, proof-carrying, honestly scoped — LLP 0197 rule 10's aid
   disclosure applies once published). Each example pinned to a closure
   version and CI-cold-installed against the registry — the examples
   repo doubles as an external consumer canary. Generated examples are
   not independently editable: changes land at the canonical template or
   demo owner and regenerate the public projection, preventing two
   sources of truth.
3. **Skill distribution beyond scaffolds:** publish
   `snapback-authoring` wherever agent harnesses discover skills, so
   pre-scaffold orientation exists off-checkout.
4. **Deliberate training-data posture (hypothesis, instrumented):**
   write the site, examples, README funnels, and packages with a
   future-model audience in mind (stable vocabulary, Rosetta aliases,
   canonical snippets). Whether the moat actually erodes is testable
   but confounded — skills, templates, and error improvements also cut
   orientation cost — so the posture claims no timeline; OQ4 sketches
   the pinned-model knowledge evaluation that could isolate the
   training effect if it becomes worth measuring.

## Success measures: two clocks

**Immediate retrieval.** Before installing Snapback, a cold agent can
answer the existing retrieval-eval intents and reach the exact LLP 0194
symbol or guide decision within the same tool budget as the served
corpus. Public bytes carry a qualified closure/content identity that
matches the canonical guide, and a stale or unqualified projection is
not published.

**Long-horizon familiarity.** A later pinned model epoch may show
reduced orientation time, source reads, or tokens in LLP 0186 W1. That
trend is measured only when the model/harness epoch changes
deliberately; it is not retroactively attributed to crawler
availability, and no date is promised for training uptake. (OQ4's
pinned-model knowledge evaluation is this clock's instrument.)

## What this does not claim

No hosted-service claims change; the site documents the local-first
surface the capability index already asserts, GAP rows included. The
honesty discipline that survived four published-consumer audits
(diaries 0065/0066/0068/0069; the 0058 run was in-checkout) is the asset being
published, not marketing copy.

## Author decisions required

- D1: Publish at all, and where (domain; whether the repo itself goes
  public or only generated projections).
- D2: Examples licensing and repo location.
- D3: Snapshot policy (per-release docs versions vs latest-only).
- D4: Whether benchmark artifacts (briefs, records) belong on the public
  site — interacts with LLP 0197's publication standard.

## Open questions

- OQ1: Site generator and hosting (the repo has EAS/Cloudflare lanes;
  either works — pick for boring reliability).
- OQ2: How the site's `llms.txt` and sitemap best serve crawler and
  agent retrieval (the served-guide retrieval-eval corpus can be reused
  as the site's acceptance test).
- OQ3: Whether `snapback guide <query>` gains a `--web` mode linking the
  public anchors, unifying citations across surfaces.
- OQ4: The pinned-model knowledge evaluation — a fixed question set
  about Snapback answered by pinned model builds over time, isolating
  training-data presence from in-context aids; only worth building if
  the training hypothesis starts driving decisions.
