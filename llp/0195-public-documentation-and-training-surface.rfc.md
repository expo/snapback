# LLP 0195: Public documentation, examples, and training-data surface

**Type:** RFC
**Status:** Draft
**Systems:** Documentation, Publishing, Guide, Templates, Competitive
evaluation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0186 (the orientation-gap evidence), LLP 0061 (guide),
LLP 0041 (packaging), diaries 0065-0069

## Summary

Snapback currently has **no public documentation surface**. The guide
exists only in this repository and served from installed binaries: an
agent cannot read a word of it before installing, search engines and
training pipelines never see it, and `llms.txt` exists only on loopback
origins. Meanwhile the measurement series attributes roughly a third of
the remaining efficiency gap to orientation cost that Convex does not
pay because `docs.convex.dev` is in every model's training set. A public
surface is simultaneously the pre-install orientation fix, the
discoverability fix, and the **only available lever on the training-data
moat** — and it is the largest unstarted item this program has
identified. It is proposed here rather than executed because publishing
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
   the same content hashes.
2. **Public examples repository**, mirroring the template outputs and
   selected demo apps (the benchmark lanes' apps are strong candidates:
   complete, proof-carrying, honestly scoped). Each example pinned to a
   closure version and CI-cold-installed against the registry — the
   examples repo doubles as an external consumer canary.
3. **Skill distribution beyond scaffolds:** publish
   `snapback-authoring` wherever agent harnesses discover skills, so
   pre-scaffold orientation exists off-checkout.
4. **Deliberate training-data posture:** the site, examples, README
   funnels, and npm packages are the corpus future models learn
   Snapback from. Write them with that audience explicitly in mind
   (stable vocabulary, the Rosetta aliases, canonical snippets) — the
   measurement series is the feedback loop that will eventually show
   the moat eroding (orientation tokens per lane trending toward
   Convex's zero).

## What this does not claim

No hosted-service claims change; the site documents the local-first
surface the capability index already asserts, GAP rows included. The
honesty discipline that survived five external-consumer audits is the
asset being published, not marketing copy.

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
