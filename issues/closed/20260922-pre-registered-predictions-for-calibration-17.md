# Pre-registered predictions for the first 0.3 calibration (#17), written before any 0.3 lever is published

**Filed:** 2026-09-22, by the Snapback 4 0.3 program lead (Claude Opus 5.5),
under the author's instruction to "do your new plan", with 0.3.x as the release
line and a Clique run once there is a 0.3 release the lead is happy with.
**Status:** Resolved — read against calibration #18 (`snapback4@0.3.0`), 2026-09-23. The reading is at the end of this file.
**Subject:**

- [LLP 3000.012](../llp/3000.012-application-still-owns-derived-data.research.md), the evidence;
- [LLP 3000.007.003](../llp/3000.007.003-the-engine-writes-derived-data.rfc.md), forms F1–F3;
- [LLP 3000.009.000](../llp/3000.009.000-the-server-half-opt-in.plan.md), the server half behind `use server`;
- [#15's pre-registration](./closed/20260919-pre-registered-predictions-for-calibration-15.md), the method, and W14c's rolled-forward prediction.

**Numbering note (2026-09-22, added before any 0.3 lever was published).**
Another program prepared calibration #17 as a corrective public-package rerun
of 0.2.33, which carries no 0.3 lever
(`/Users/ccheever/clique-sb4-20260922-astra-cal17/README.md` on the M5). This
file's predictions apply to the **first calibration whose pin carries 0.3
levers**, whatever its number. The fit, bands and thresholds below are frozen
as filed. They are not refit on #17's result, and #17 is read as one more
level observation, not as this file's test.

**Interpretation note (2026-09-22, added before any 0.3 lever was published;
predictions unchanged).** The corrective 0.2.33 control, calibration #17
(`benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.33/`), scored
data_modeling **86** and queries_and_live **89** (holistic 92) with no 0.3
lever. Both already meet this file's confirm thresholds (≥86 and ≥87).
A 0.3 pin crossing them is therefore **not** evidence of a 0.3 effect. The
predictions stay frozen and their outcome is reported as filed, but the
reading will:

- lead with the mechanism criteria: whether the application-maintained
  projection tables, copied attribution fields, verification clauses,
  backfills, feed helpers and the zero-like Trending fill actually
  disappear from the built app;
- compare levels against 0.2.33 as well as 0.2.32;
- use source size, engine-budget constants, guide reading, correction loops
  and correctness as direct evidence.

(Raised by an independent Astra review of the program, 2026-09-22.)

This file follows #15's method: one threshold per category with an explicit
null band, taken from the fitted line **before** any lever exists in a
published pin. The holistic number is not a criterion.

## The fitted lines at the next calibration

The window is the fourteen calibrations after the 0.2.16 step, 0.2.16 →
0.2.32, loaded by `score-trend.mjs`'s rule. The fit is least squares,
extrapolated one run ahead, and `sd` is the residual standard deviation about
the fitted line.

| Category | Line | sd | Confirms | Null band | Refutes |
|---|---:|---:|---:|---|---:|
| data_modeling | 82.3 | 1.86 | **≥ 86** (W14c's registered threshold, kept rather than lowered to the new fit's 85) | 81–85 | **≤ 80** |
| queries_and_live | 82.3 | 4.28 | **≥ 87** | 79–86 | **≤ 78** |
| scale_and_limits | 80.8 | 6.28 | not predicted: too noisy for a one-run reading | — | — |
| setup_and_docs | 89.5 | 2.68 | not predicted (L2 makes no score claim) | — | — |
| client_integration | 88.7 | 1.74 | not predicted (L3 is one defect) | — | — |
| overall | 88.6 | 1.76 | not a criterion | — | — |

## The levers

**L1 — the derived-data forms (LLP 3000.007.003).**

- F1 is maintained columns, F2 engine-recorded attribution, and F3 the
  Following recipe's contract as a declaration.
- **Predicts:** `data_modeling` ≥ 86 confirms and ≤ 80 refutes;
  `queries_and_live` ≥ 87 confirms and ≤ 78 refutes. The category predictions
  are read only when the pin carries **all three** forms. With any form
  missing they are **void**, and the mechanism criteria below are still read,
  form by form.
- **Mechanism criteria**, scored first from the builder's backend and
  narratives:

  | Form | The builder's backend shows… |
  |---|---|
  | F2 | no application-written attribution copies (such as `likes.authorId`, `postAt`, `original` or `posts.replyAuthor`); no insert-rule clauses that verify copies; no backfill job for them |
  | F1 | no copied time column for Trending; no zero-like fill read |
  | F3 | no application-maintained Following projection tables (routing, inbox, broadcast, tombstone or count tables), and no feed helper calls in application mutations |

  Each criterion is read only if the pin carries its form. A builder who
  chooses the old form anyway fails that criterion. The narrative is read for
  why.
- **Confound to name now:** `data_modeling` and `queries_and_live` also charge
  Quarry's learning cost in every run (LLP 3000.012 §2.2). A category that stays
  inside its null band while every mechanism criterion passes is read as
  "responsibilities removed, score unmoved". It is not a refutation of the
  mechanism.

**L2 — the server half behind `use server` (LLP 3000.009.000).**

- **No score prediction.**
- **Mechanism criteria:** Clique's backend needs no `use server`. The services
  card, as recorded in the builder's `guide-*.txt` lookups, carries no
  action-lease or OIDC text.

**L3 — the generated nullable-array type fix.**

- **No score prediction.**
- **Mechanism criterion:** no `object | null[]`-class defect in the run log or
  the grade.

**L4 — generation discovery before a sync page is materialized.**

- **No score prediction.**
- **Mechanism criterion:** none is expected in a cold build, because no schema
  generation changes under a lagging device. It is recorded if it occurs.

## Rules of reading, stated in advance

- A lever that is not in the pin makes its prediction **void**, never failed
  or confirmed.
- Mechanism criteria are scored from the builder's backend source and evidence
  files first, by reading, before any category is read.
- The instrument, prompts and grader or scorer configuration are cal16's,
  unchanged. Only the package pins change.
- Host load and environment confounds are checked in the packet's load
  record before any category is attributed to the pin.
- One calibration is one reading. A confirmation is a step candidate, not a
  trend (LLP 3000.010 §6).

## Reading — calibration #18, the first 0.3-pinned run (2026-09-23)

The run was pinned to `snapback4@0.3.0`, `snapback4-darwin-arm64@0.3.0` and
`snapback4-expo@0.3.0`, all three forms. The instrument, prompts and scorer
were cal17's, byte-for-byte. One Astra-medium cold builder ran for 5,389 s
(cal17: 4,924 s). The holistic score is **92/100**. The functional grade
was 101 of 119 passing, 0 failing and 18 not run, identical to cal17's; the
grader is labelled uncalibrated. No prediction was supplied to any session. The record is
`benchmarks/runs/2026-09-23-snapback4-clique-astra-0.3.0/`.

### Mechanism criteria, read first from the builder's backend

| Form | Criterion | Result |
|---|---|---|
| F3 | No application-maintained Following projection tables; no feed helper calls | **Met.** `maintain feed: timeline` (`social.q:77`, sized `authors 2000, edges 20000`). Following is `feed[viewer] after c last 20`. There are no routing, inbox, broadcast, tombstone or count tables, and no helper calls |
| F1 | No copied time for Trending; no zero-like fill | **Met.** `posts.score: count likes by postId` and `by byHourLikes: hour(at), score, at, id` (`social.q:11–12`). Trending is one merge over 25 hour lanes (`insights.q:33–35`). There is no copied time and no fill |
| F2 | No application-written attribution copies; no verification clauses; no backfill for them | **Met, with one nuance.** Received counts use engine-recorded paths (`receivedLikes: count likes by postId.authorId`, `dailyLikes … day(.at)`, `receivedReposts`, `receivedReplies`, and `replyTarget.authorId` for nested replies; `insights.q`). There is no `likes.authorId`, `postAt` or `replyAuthor` copy, and no verification clause (`likes: insert <- .principal = viewer`). The nuance is in the next paragraph |
| L2 | No `use server`; no action-lease or OIDC text in the services card the builder read | **Partly met.** No `use server` anywhere, and jobs ran without it. `guide-services.txt` (69 lines) still ends with a four-line pointer naming OIDC and ten `E_OIDC_*` codes, although the content moved to `SERVER.md` |
| L3 | No `object \| null[]`-class defect | **Met.** None in the run log. None among the grader's five defects, all of which are in the builder's own app or scripts |

**The F2 nuance.** During M8, nested replies had stored a reply id in
`postId: posts`. `snapback4 doctor` reported "4 null captures at
postId.authorId", which is F2's nulls-not-refusals design doing its job.
The builder then added a real reference, `replyTarget: replies ?`, and
backfilled those four rows with a one-off job
(`evidence/m8-attribution-upgrade.q`, not in the final source). That job
migrated a missing **reference**, not an attribution copy: the attribution
itself stayed engine-recorded.

**Residual application-owned derived data outside the pre-registered
criteria.** The app maintains its own `events` table (`social.q:150`),
written by `createPost` and `setRepost`, to serve a "Global" feed of posts
and reposts. That duplicates the timeline's own event stream. The scorer
noted it: "Global needed a separate event table". Trending also omits the
feeds card's `and not .removed`.

**Where each form came from.** The Following timeline and the column on the
timeline-mapped `posts` table are exactly the composition that the
INTEGRATION lane's counterexample forced into 0.3.0 (the F1 × F3 fix). Before
that fix, this backend would have been refused at admission.

### Category predictions, as filed

| Category | Line (sd) | Confirms | Null | Refutes | 0.2.32 | 0.2.33 | **0.3.0** | As filed |
|---|---:|---:|---|---:|---:|---:|---:|---|
| data_modeling | 82.3 (1.86) | ≥ 86 | 81–85 | ≤ 80 | 82 | 86 | **87** | confirms |
| queries_and_live | 82.3 (4.28) | ≥ 87 | 79–86 | ≤ 78 | 86 | 89 | **90** | confirms |

The pin carries all three forms, so the predictions are not void. **Both
confirm as filed, and neither is attributable to 0.3.** The interpretation
note filed before any lever shipped applies: the 0.2.33 control (#17)
already met both thresholds with no 0.3 lever, and 0.3.0 moves each
category by +1, well within one sd. Overall is 92, unchanged from 0.2.33.

### Levels and direct evidence

- **Up:** setup_and_docs 94→96, diagnostics 94→97 (the scorer credits
  `doctor` for surfacing attribution mistakes), operations 88→91, and
  client_integration 90→92.
- **Down:** background_work 94→89 (a digest computation that could park at
  job bounds) and scale_and_limits 92→90.

One run is one reading (LLP 3000.010 §6). No causal claim is made from these
movements.

**Confound to record.** `snapback4@0.3.0` contains the quadratic
born-row-tracking regression
(`issues/20260923-snapback4-born-row-tracking-is-quadratic.md`). The
builder's scale replays ran through ordinary mutations at about 5–6 ms each
(167,243 actions), which the regression does not affect, and no large-commit
seed appears in the run log. No score is attributed to it.

### Reading

The responsibilities the 0.3 program set out to remove are gone from the
built app. A cold builder, working from the published cards alone, used the
declared timeline, a maintained column for Trending, and engine-recorded
attribution for every received count. It built none of the application-owned
projections, copies, verification clauses or zero-fill that LLP 3000.012
documented in earlier runs. The scores did not move beyond noise, as the
confound note in this file anticipated: "responsibilities removed, score
unmoved" is read as mechanism success, not refutation. What remains
application-owned is a global feed table and a duplicated count maintain.
Those are candidates for a future card, not for this program's forms.
