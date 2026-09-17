
## Known pre-existing defect, in scope for this run's interpretation

**A device can page past its sync horizon from scattered old rows and mark the page
`complete: true, fresh: true`, silently skipping rows.** Filed by a peer session as
P1 (`issues/20260917-snapback4-device-page-past-horizon-answers-from-scattered-rows.md`),
reproduced by that session on published 0.2.27 **and** 0.2.28, and reproduced
independently by this lead on its own build with byte-identical output:

    device page 2   p09 p08 p04   complete:true fresh:true
    server page 2   p09 p08 p07                              <- p07, p06, p05 skipped

`sync [audience] last N by index` bounds what a device *acquires*, but the change
stream applies no horizon and `Device::apply` stores every `put`, so an update to a
row older than the acquired window lands as a lone old row. The device's completeness
rule assumes its rows on the horizon index are a contiguous newest suffix; a scattered
old row breaks that.

**Why it is recorded here rather than fixed before this run.** It is **not** a 0.2.28
regression — it reproduces identically on 0.2.27, the previously published version, so
withdrawing 0.2.28 would remove that release's fixes and leave the same defect in
place. Read completeness belongs to wave 13, which owns it now.

**What it means for this run's numbers.** A builder or grader that scrolls a feed on a
device *after* likes or edits have landed on older posts can see skipped rows on any
version. A fresh device hides it, which is why no fixture or previous calibration has
caught it. If this run reports a feed or timeline defect of that shape, attribute it
here and to neither wave 12 nor 0.2.28.

---

## Result: holistic 85 — and the instrument was compromised for the one number that drove it

Grader: **84 pass, 1 fail, 16 not-run**. The single failure, `m3-a11`, is an
application UI defect (tapping a quote preview does not bring an off-frame original
into view), not Snapback.

| category | 0.2.27 | 0.2.28 | delta |
|---|---:|---:|---:|
| background_work | 86 | 91 | **+5** |
| operations | 84 | 85 | +1 |
| authorization | 95 | 95 | 0 |
| writes_and_transactions | 94 | 94 | 0 |
| offline_sync | 93 | 93 | 0 |
| media_assets | 96 | 95 | -1 |
| client_integration | 89 | 88 | -1 |
| diagnostics_dev_loop | 95 | 94 | -1 |
| data_modeling | 84 | 82 | -2 |
| queries_and_live | 83 | 81 | -2 |
| **overall** | **89** | **85** | **-4** |
| setup_and_docs | 92 | 88 | -4 |
| **scale_and_limits** | **85** | **65** | **-20** |

**Read the −20 with the host in mind, and do not record it as a product fact.**
`scale_and_limits` is driven by one measurement: a **54,982 ms** cold
login-to-first-feed against a 30,000 ms probe bound. That is wall-clock, and this
run executed 17:15–19:28 UTC in a window where the lead measured host load at
**56–70**, `syspolicyd` at 31% CPU, and two peer sessions independently reported
**every new executable stalling 3–7 minutes at `_dyld_start`** on Gatekeeper
provenance scans. In the same window a suite that normally takes ~600 s took
**3,239 s**, and a client test run that normally takes 70 s exceeded **10 minutes** —
a measured 5× slowdown.

**But the honest answer is that this run cannot separate the two, and neither
direction should be asserted.** 55 s is ~6.6× the 0.2.25 run's 8.29 s cold
acquisition, which is more than the ~5× host slowdown accounts for; and the app
itself chose a residency shape this run that the report states plainly — social
feeds bounded to 5,000/1,000 rows while *"other public rows still fully sync"* —
which is a plausible independent cause. **What would separate them is one re-run of
the cold-start probe on an unloaded host.** Until that exists, 65 is a number
produced by a compromised instrument and is not evidence of a 0.2.28 regression.

**Sharpening what the 55 s actually is, from the same evidence file.**
`evidence/scale-final-ui.json` reports, in the same 62-second window that produced
`coldFirstFeedMs: 54982`:

    insights   p95 3.41 ms   max 4.09 ms   (k=20, 3 warmups)
    trending   p95 20.32 ms  max 31.01 ms  (k=20, 3 warmups)

**The engine's reads are milliseconds. The 55 seconds is a fresh *browser*
login-to-first-feed at full corpus** — the check is named
`fresh-browser-feed-insights-and-chat-list-render-at-full-corpus` — i.e. cold
partition *acquisition* and render, not query latency. The app's own report states
the residency shape that drives it: social feeds bounded to 5,000/1,000 rows while
*"other public rows still fully sync"*, against a 167,157-action corpus.

So `scale_and_limits` 65 is not a statement about query performance, and reading it
as one would send the next wave to the wrong place. It is about **acquisition volume
under an app residency choice**, measured through Chromium on a host running at load
56–70. Both of those are outside the engine's read path, and the read path in this
very run is excellent.

**What did move, and is not in doubt:** `background_work` **+5** to 91, its best in
the programme, on a release carrying wave 12's rolling ranking and W14b's digest
card. And wave 12's work reached the builder — the essay records that *"Trending
required explicit hour lanes"*, i.e. the §20.21 form shipped in this version was the
one used, rather than the hand-rolled expiring table three consecutive builders wrote
before it.

**Attribution.** 0.2.28 is not wave 12 alone: it carries wave 12 and its two review
rounds, W13a's four merge-cursor fixes, and W14b's digest card, from two peer
sessions. No movement in this table should be attributed to any one of them.

**Also in scope:** the pre-existing horizon-gap P1 recorded above, reproduced by this
lead on its own build, which can make a device feed silently skip rows on any
version.


---

## Correction to the trend this record was filed under: the score is declining, not flat

This record, the 0.2.27 record and `STATUS.md` all describe the programme's overall
score as **flat**. Fitted rather than eyeballed, across all ten Astra-medium runs, it
is not:

    overall  [90, 91, 88, 91, 88, 88, 91, 90, 89, 85]
             mean 89.10   sd 1.81   slope -0.30/run   total drift -2.67
             the drift exceeds one standard deviation of the series

Every category that measures the cost of *using* the surface slopes down over the
same ten runs:

| category | first → last | slope/run | drift |
|---|---|---:|---:|
| scale_and_limits | 88 → 65 | -1.51 | -13.6 |
| queries_and_live | 91 → 81 | -0.98 | -8.8 |
| setup_and_docs | 96 → 88 | -0.57 | -5.1 |
| data_modeling | 85 → 82 | -0.45 | -4.1 |

**`setup_and_docs` is included, and that is the correction that matters most.** It was
repeatedly described in these records as the programme's success — 85 → 89 → 92 across
runs 8–10. Fitted over all ten it is 96 → 88. Waves 10 and 11 produced a real local
recovery *inside a declining line*; comparing adjacent runs made the recovery look like
the trend. The error was comparing neighbours instead of fitting the series.

**What this implies, and it is not "pick a better papercut".** Across twelve waves each
release added capability, and every measure of the cost of comprehending that capability
got worse, by more than the series' noise. The recurring deductions the 0.2.28 review
groups as "total reads" (LLP 3000.007 §20.22) are the visible form of it. It also raises
a question no review has yet put: whether some surface should be **removed** rather than
better documented. The 0.2.28 review's own last item — measure adoption before funding
another documentation wave — points the same way.

Nothing in the per-run tables above changes. What changes is the frame they should be
read in.
