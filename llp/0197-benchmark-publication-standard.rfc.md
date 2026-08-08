# LLP 0197: Competitive benchmark publication standard

**Type:** RFC
**Status:** Review
**Systems:** Competitive evaluation, Publishing, Documentation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain, plus round-2 finds: preregistration in rule 1, rules 4a/4b, publication-safe schema in rule 6, reproducibility manifest, diary-0058 citation, series restated 2.91x→2.24x. 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
(harness, records), LLP 0195 (public surface), diaries 0058-0069

## Summary

The measurement program can now produce the raw material for
publication — five runs, a committed harness, token metering, and a
directional series (2.91x tokens for the first published-consumer
skill-adjacent lane on 0.1.13 to 2.24x on 0.1.15; bases differ across
rows, the records themselves say the series is directional rather than
a controlled sequence, and diary 0069 disclaims N=1 ratio movement as
signal). The existing series motivates this standard; it is not itself
a publishable controlled comparison. LLP 0186 OQ5 asked what disclosure
makes a public comparison credible rather than vendor noise; this RFC
proposes the standard. The governing principle: **publish the
instrument, not just the number** — the methodology independently
rerunnable by an outsider from public artifacts alone, carried by a
reproducibility manifest per record (harness commit, prompts, model
identity/build and settings as run, closure and competitor versions,
tool versions, environment and machine class, stopping rules, seeds
where available). Where the measuring model is not publicly accessible,
the standard promises rerunnable methodology and comparable
measurement, not bit-identical results — stated on every chart;
"reproduced" is reserved for observed reruns.

## The standard

A published Snapback benchmark claim requires:

1. **N≥3 runs per configuration, preregistered:** the run matrix
   (configurations, budgets, stopping and exclusion rules, frozen
   harness/prompt commits) is committed before results are observed;
   every started attempt gets an ID and is reported — no best-of, no
   post-hoc configuration designation. Median + range. The observed
   ±30% per-lane variance (diary 0069) makes single-run ratios
   unpublishable; the variance study is the prerequisite work item.
2. **The full harness public:** briefs verbatim, lane prompts, fairness
   rules, and run records (the `benchmarks/` tree, published via LLP
   0195) — an outsider with the same model can rerun the measurement.
3. **Fairness notes attached to every chart:** cold-context agents;
   published surfaces only; same model, machine, and serial discipline;
   competitor lanes free to use web docs; model prior-familiarity
   asymmetry stated plainly (it currently favors competitors).
4. **Proof-bar disclosure:** every chart states what each lane proved.
   The headline chart should be the **equal-proof-bar variant**
   (`briefs/messaging-equal-proof-bar.md`), with the bar stated as
   vendor-neutral outcomes (e.g. "cold-start reads of prior history
   with the backend unreachable"), not feature names — the honest
   comparison where depth is priced instead of penalized. The
   unequal-bar table may be published alongside with the asymmetry
   stated (competitor lanes' own-words caveats quoted, not
   paraphrased).
   4a. **Starter symmetry:** where a Snapback lane uses a shipped
   template, the scenario is labeled template-assisted; competitor
   lanes get the same predeclared public-availability and selection
   criteria for their ecosystems' starters; general
   authoring-efficiency claims use held-out brief variants no template
   was designed against (LLP 0196's exit criteria adopt this); where no
   equivalent starter exists, template-assisted and bare-start
   configurations publish separately.
   4b. **Equal-proof-bar failure protocol (preregistered):** identical
   budgets and stopping rules per lane; every failed attempt retained
   and reported as a capability failure — never converted to a timeout
   duration, silently excluded, or substituted with a weaker result;
   efficiency ratios computed only across runs meeting the identical
   bar, with the capability-failure table published beside them.
5. **Version pinning:** every run names the exact closure and
   competitor versions; claims age out when either moves materially.
6. **Self-report symmetry, publication-safe:** lane reports and
   correction-loop content (both vendors') are part of the public
   record — including runs unfavorable to Snapback; the credibility of
   the five-measurement-run, four-published-consumer-audit honesty
   discipline is the asset. Publication passes through a
   **publication-safe artifact schema**: a symmetric public projection
   preserving prompts, measurements, outcomes, proof evidence, and
   correction-loop categories; automated secret/credential/PII and
   private-material scanning; path and machine-identifier scrubbing
   with documented redactions and reason codes; retained hashes of the
   private originals for auditability; and a human with
   repository-disclosure authority reviewing before anything ships.
   Raw transcripts never publish.

## What publishing looks like

A benchmarks page on the LLP 0195 site: the historical series chart as
a dated narrative annotation, exempt from rule 1 because it makes no
controlled-comparison claim (the early losing runs included — the
26m03s-vs-11m15s origin, diary 0058, is part of the story), the current
N≥3 medians as the only comparative claims, links to briefs/records/
prompts, a "run it yourself" section stating expected run cost, and the
reproducibility manifest per record. No superlatives that a record link
cannot back.

## Author decisions required

- D1: Whether to publish at all and when (proposal: after the N≥3
  study and the equal-proof-bar run, not before).
- D2: Which competitors appear (Convex is measured; Supabase/
  PocketBase/Postgres lanes are unbuilt — publishing claims about
  unmeasured competitors is out under this standard).
- D3: Whether competitor names appear in charts or as "backend A/B"
  (proposal: names, with rule 2's reproducibility as the defense).

## Open questions

- OQ1: Token-count comparability across models if the harness ever runs
  on non-Fable models (current standard: one model per published
  series, stated).
- OQ2: Whether an independent third party rerunning the harness is
  worth soliciting before first publication (strongest possible
  credibility; costs a relationship and time).
