# Pre-registered predictions for the first 0.3 calibration (#17), written before any 0.3 lever is published

**Filed:** 2026-09-22, by the Snapback 4 0.3 program lead (Claude Opus 5.5),
under the author's instruction to "do your new plan", with 0.3.x as the release
line and a Clique run once there is a 0.3 release the lead is happy with.
**Status:** open. It is read against the first calibration whose pin carries
0.3 levers.
**Subject:**

- [LLP 3000.012](../llp/3000.012-application-still-owns-derived-data.research.md), the evidence;
- [LLP 3000.007.003](../llp/3000.007.003-the-engine-writes-derived-data.rfc.md), forms F1–F3;
- [LLP 3000.009.000](../llp/3000.009.000-the-server-half-opt-in.plan.md), the server half behind `use server`;
- [#15's pre-registration](./closed/20260919-pre-registered-predictions-for-calibration-15.md), the method, and W14c's rolled-forward prediction.

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
