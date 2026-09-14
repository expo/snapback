# Clique on Snapback4: September 13–14 comparison

The ticket batch is complete, and all three builders, holistic scorers,
independent graders, and fresh M7 sessions have finished. Astra produced the
strongest result. The higher holistic scores do not establish a uniformly
better implementation: Grok still has substantial coverage gaps, Muse's
scale run used a reduced corpus, and the completed full replay remains slow.

The [36 ticket dispositions](./ticket-dispositions.md) include 28 with
implemented fixes, seven already resolved or obsolete, and one documented
policy. The qualified publication suite passed **334 checks in 30 seconds**,
with zero failures and one declared ignored test. The benchmark used published
`snapback4@0.2.6` and `snapback4-expo@0.2.1` throughout. [Release evidence](./release-qualification.json).

| Builder | Independent results: pass / fail / not-run / NA (119) | Comparable passes (101) | Holistic score | Fresh M7 |
| --- | --- | ---: | ---: | --- |
| Astra medium | 100 / 10 / 9 / 0 | 84 | 84 | Builder green, 22m 25s; protocol qualifications |
| Grok 4.6 xhigh | 70 / 18 / 31 / 0 | 60 | 70 | Green receipts, 27m 38s; material app defects |
| Muse Spark 1.3 xhigh | 94 / 16 / 8 / 1 | 79 | 80 | Builder green, 1h 47m 14s; app defects and evidence gaps |

[Independent grades](./grades/summary.md) precede M7 and remain unchanged.
Their raw passing observations differ from the grader's coverage adjudication:
O1 is **74 / 10 / 30**, respectively. Grok and Muse received penalties for
assertion mappings that did not test their claimed behavior. [Holistic scores](./holistic/summary.md)
are same-family narrative assessments, not independent grades.

Compared with the last full **Snapback2** run, holistic scores rose from
**64 / 57 / 78** to **84 / 70 / 80**. Comparable assertion passes changed from
**81 / 68 / 75** to **84 / 60 / 79**. The intervening **Snapback4 Astra** run
also had 84 passes; current fresh M7 succeeds where that run failed. Seven of
Astra's current failure classifications were previously not-run native proofs,
so the larger failure count does not mean seven newly observed native bugs.
[Exact prior results](./prior-results.json), [Astra comparison](./astra-grade-comparison.md),
[Grok comparison](./grok-grade-comparison.md), [Muse comparison](./muse-grade-comparison.md).

M7 remains builder evidence with static audits, independently ungraded. Astra's
audit supports its migration and functional result. Grok's passing receipts
coexist with a 200-vote query that can truncate later poll tallies and an
unreachable native poll composer. Muse reports 160/160 regressions, 31/31 M7
suite checks, and green choreography, but its final offline-vote changes
postdate those suite logs. It also replaced its original pre-change snapshot
after a store reset, limiting the migration-preservation claim.
Its poll queries retain deleted/expired content and can omit live polls once
orphans fill a 100-row limit; count migration covers the starter corpus but
does not backfill historical tombstones.
[Astra audit](./astra-m7-outcome-audit.md), [Grok source audit](./grok-m7-source-delta-audit.md),
[Muse outcome audit](./muse-m7-outcome-audit.md), [Muse source audit](./muse-m7-source-delta-audit.md).

Only Astra completed the frozen **167,157-action replay**: **58m 1s** after
recorded exclusions, versus about 8m 32s in the prior Snapback4 run. Its
full-corpus cold startup took **21.446 seconds**, and two strict performance
checks failed. Registration consumed substantial time under the published
auth limit, and an application correction occurred after the 10% checkpoint;
this is not a uniform-code performance curve or a causal backend speed ratio.
[Astra scale evidence](./astra/README.md).

These are N=1 comparisons. The September 12/current instruments are byte
identical; the September 5 packet differs in fixtures, UI, choreography and
execution rules. Later main-branch fixes are documented in the
[full run record](./README.md), but were not measured by these frozen pins.
[Instrument comparison](./instrument-comparison.md).
