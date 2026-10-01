# WB orientation

Starting commit: `91a111cd85` on `sb4-intent/wb-wall-clock-budgets`.
Scope: publication-suite test fixtures and guards; no product implementation,
API, package version, seed count, sample count or skip policy changes.

Read the Snapback 4 fence (`AGENTS.md`, `NOT-DOING.md`, `JOURNAL.md`), the
adopted `rules/RULES.md`, LLP 3000 and the design brief LLP 2000.000. The
local `llp-orient` skill was read from the initialized sibling LLP checkout.

The governing constraint is [LLP 3000, Publication suite under contention](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention):
state and ownership decide success; guards diagnose hangs; preserve seeds,
samples, coverage and outcome assertions; semantic clocks are separate from
host scheduling. In particular, browser callback lateness is not a promised
wall-clock frame bound.

The fallback case implements [LLP 3000.023 §10](../../../llp/3000.023-answers-stay-on-screen.rfc.md#10):
a previous answer cannot certify the next branch or erase the pending replica
cut. Preserve present/absent classification, `serverOnly`, `changeCut`, current
answers, refusals, and publication before release of the held sync.

Explicit timing acceptance criteria remain in [LLP 3000.017 §4.7](../../../llp/3000.017-ephemeral-tables.rfc.md#47-tests)
(ephemeral propagation and expiry) and [LLP 3000.018 §3.2](../../../llp/3000.018-a-live-query-follows-presence.rfc.md#32)
(presence refresh). Backoff, admission expiry, heartbeat silence, clock
estimation, idle retirement and shutdown grace tests continue to exercise
those product policies. See AUDIT.md for the retained checks.

The load harness is adapted from [SL's report](../20260929-sl-suite-under-load/REPORT.md)
and its `run.py`, `busy.c`, and `confine.c`. WB uses ten CPUs per run as
requested, keeping the published client-pool policy and all model counts.
