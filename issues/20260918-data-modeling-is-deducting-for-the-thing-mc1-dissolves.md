# `data_modeling` is deducting for exactly the thing maintained columns dissolve

**Filed** 2026-09-18 · **Area** snapback4 / derived data · **Status** open
· **Bears on** wave 14 prioritisation, LLP 3000.007.001 (MC1)

Calibration #14 showed the Astra-medium decline has **localised**: over 12 runs the
holistic slope no longer clears one sd (−1.82 against 1.83), but `data_modeling`
(82, −5.3 against sd 2.6) and `setup_and_docs` (−5.4 against 2.9) both still do.
`data_modeling` is the sharper of the two and is the one category this programme has
never gone at directly.

This file connects two facts nobody had put together: **what `data_modeling` is
deducting for is the exact shape LLP 3000.007.001 retires**, and that build is already
accepted, sequenced and briefed.

## The scorer's own words

`scores/astra/FINAL.md`, `data_modeling` 82:

> "Exact M8 trending required an **explicit ranked table, hour-leading indexes, and
> validation probes**; constrained expressiveness and completeness reasoning added
> design work beyond ordinary SQL or TypeScript."

And `queries_and_live` 85 deducts for the same cause:

> "exact trending needed additional modeling."

One shape, two categories, both of them among the three lowest in the run.

## What the builder actually wrote — the fourth in a row

`snapback/insights.q`:

```quarry
table rankedPosts:
  score: int
  by byRank: hour(at), score, at, id
  insert <- exists posts[id = .postId, at = .at, parentId = null]
    and ((.score = 0 and not exists likeCounts[.postId])
         or exists likeCounts[postId = .postId, value = .score])
```

**The fourth consecutive builder to hand-keep a ranking table.** But read the insert
rule: it validates the copied score against the maintain, so a principal cannot forge a
ranking. That is wave 12's `N_PUBLIC_AGGREGATE_COPY` detector working as designed —
builders 1–3 shipped `update <- allow` and this one did not.

**The cost did not disappear. It moved.** From a security defect to a modelling cost —
and the modelling cost is what `data_modeling` is now docking. We converted a hole into
a tax, and the tax lands in the two categories that still decline beyond one sd.

The underlying cause is untouched and is the one LLP 3000.007.001 §1 names: the
aggregate lives apart from the entity it describes, so every app must copy it, index the
copy, and prove the copy honest.

## Why this matters for sequencing

MC1 removes all three of the scorer's named costs at once:

| scorer's deduction | under maintained columns |
|---|---|
| "explicit ranked table" | gone — `likeCount` is a column of `posts` |
| "hour-leading indexes" | an ordinary index on the parent, `by byLikes: likeCount, at, id` |
| "validation probes" | nothing to validate; no copy exists to be honest about |

So **MC1 is already aimed at the sharpest remaining target.** That was not the reasoning
that commissioned it — ruling 39 accepted it to retire the tie-break limit — but it is a
second, independent, measured argument for the same build, arrived at from the scorer's
rationale rather than from the design's own case.

## What this does not claim

It does not claim MC1 will move `data_modeling`. That is a prediction, and this
programme has just learned what happens to unregistered predictions
(`issues/closed/20260918-pre-registered-prediction-for-calibration-14.md`: the advice
repairs removed every shape they targeted and moved no category). **Pre-register it
before MC1's calibration, with a per-category threshold and an explicit null band** —
the failure mode of the last two conditions was a conjunction whose negation was not the
other branch.

Nor does it claim `setup_and_docs` is answered. It is the other still-declining
category, and nothing here touches it.
