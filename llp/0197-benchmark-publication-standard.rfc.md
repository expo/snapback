# LLP 0197: Competitive benchmark publication standard

**Type:** RFC
**Status:** Draft
**Systems:** Competitive evaluation, Publishing, Documentation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
(harness, records), LLP 0195 (public surface), diaries 0058-0069

## Summary

The measurement program can now produce numbers worth publishing —
five runs, a committed harness, token metering, and a series showing
the skill lane moving from 3.26x to ~2x tokens against Convex. LLP 0186
OQ5 asked what disclosure makes a public comparison credible rather
than vendor noise; this RFC proposes the standard. The governing
principle: **publish the instrument, not just the number** — every
claim reproducible by an outsider from public artifacts alone.

## The standard

A published Snapback benchmark claim requires:

1. **N≥3 runs per configuration** with all runs reported (no
   best-of): median + range. The observed ±30% per-lane variance
   (diary 0069) makes single-run ratios unpublishable. The variance
   study is therefore the prerequisite work item.
2. **The full harness public:** briefs verbatim, lane prompts, fairness
   rules, and run records (the `benchmarks/` tree, published via LLP
   0195) — an outsider with the same model can rerun the measurement.
3. **Fairness notes attached to every chart:** cold-context agents;
   published surfaces only; same model, machine, and serial discipline;
   competitor lanes free to use web docs; model prior-familiarity
   asymmetry stated plainly (it currently favors competitors).
4. **Proof-bar disclosure:** every chart states what each lane proved.
   The headline chart should be the **equal-proof-bar variant**
   (`briefs/messaging-equal-proof-bar.md`): both lanes required to
   prove identical offline semantics — the honest comparison where
   depth is priced instead of penalized. The unequal-bar table may be
   published alongside with the asymmetry stated (Convex lanes'
   own-words caveats — "not a real sync story" — quoted, not
   paraphrased).
5. **Version pinning:** every run names the exact closure and
   competitor versions; claims age out when either moves materially.
6. **Self-report symmetry:** lane reports (the diaries' raw
   correction-loop lists, both vendors') are part of the public record
   — including the runs and loop lists unfavorable to Snapback. The
   credibility of the 94-run honesty discipline is the asset.

## What publishing looks like

A benchmarks page on the LLP 0195 site: the series chart (with the
early losing runs included — the 26m-vs-11m origin is part of the
story), the current N≥3 medians, links to briefs/records/prompts, and a
"run it yourself" section. No superlatives that a record link cannot
back.

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
