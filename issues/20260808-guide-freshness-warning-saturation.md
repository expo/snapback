# Guide freshness warnings are saturated (62 of 64 pages), obscuring new drift

**Opened:** 2026-08-08 · **Severity:** P2 (documentation reliability) · **Area:** guide / freshness checks

## What

`node scripts/check-guide.mjs` is structurally green, but emits freshness
warnings for 62 of the 64 guide pages because their recorded authorities have
changed since the reviewed commits. The count was already 48 on 2026-08-03 and
has continued rising.

The warning-only policy is intentional: a fast-moving `main` must not starve on
an exact-HEAD documentation review loop. The problem is signal saturation. At
~97% warning coverage, a newly stale or materially changed page looks identical
to the background backlog, so the freshness channel no longer helps reviewers
identify where guide claims need revalidation.

This is especially risky while core authoring surfaces are changing rapidly:
the guide remains the required intent-indexed entry point for agents, and a
structurally valid snippet does not prove the surrounding explanation still
describes the current behavior.

## Fix

Run a scoped freshness reconciliation by feature area, updating each page's
review authority only after checking its prose and snippets against the current
implementation. Keep the warning-only landing policy, but add an operational
budget that files/updates one deduplicated filesystem ticket when the warning
count or oldest warning age crosses a threshold. Report new warnings separately
from the acknowledged backlog so a fresh regression remains visible.

## Acceptance

- Every warned page has either a refreshed reviewed authority or an explicit,
  owned backlog disposition.
- `check-guide` reports new-vs-baseline warning counts and oldest age.
- A scheduled/affected check maintains one deduplicated issue rather than
  allowing silent warning-count growth.
- The solution does not require `main` to remain unchanged during a long guide
  review.

## Confidence

High on the saturated warning count and degraded signal. Medium on the right
budget/threshold; the intended warning-only semantics should remain.
