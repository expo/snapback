# Snapback 4: default witnessed-question output misses p90 line targets

Status: Open
Date: 2026-10-26
Scope: default `check` / fresh `deploy` rendering; LLP 3000.037.000 §1

Integration 27 measured 800 copied schemas from waves15,16,18–30. With the final
0.4.43 feature binary, default check is median **2 / p90 6** lines (max 12),
and fresh default deploy is median **5 / p90 9** (max 20). Median targets are met;
the requested p90 targets of at most 3 and 5 respectively are missed. The final
117-copy follow-up verifies unchanged dispositions, FIX identities and witness
IDs; full details are in
[the survey summary](../snapback4/reports/integration27/merged-main-summary.json).
The measurement native SHA is `3e5b86eb9fdf84842c2fbf40ccb7019a64ec3ad02aef7e180801a1d4203fbffb`.

Compact the presentation while retaining every default-visible concrete witness,
actual blocker, concrete repair and truthful tier/count. A gate must never also
appear as a nonblocking question; unwitnessed advice can remain behind `--review`.
Do not meet the target by hiding witnessed questions, changing enforcement,
relaxing the line target, or deleting rollback/result-shape facts. This is a
measured UX target miss, separate from the passing affected product tests.
