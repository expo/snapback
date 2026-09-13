# Guide freshness warnings are saturated (45 of 65 pages), obscuring new drift

**Opened:** 2026-08-08 · **Severity:** P2 (documentation reliability) · **Area:** guide / freshness checks

## What

`node scripts/check-guide.mjs` is structurally green, but the corrected
2026-08-08 measurement emits freshness warnings for 45 of the 65 guide pages
because their recorded authorities have changed since the reviewed commits.
The count was already 48 on 2026-08-03 and the corpus has since gained and
reconciled pages; the current ratio is 69%, not the previously recorded 62/64
(97%).

The warning-only policy is intentional: a fast-moving `main` must not starve on
an exact-HEAD documentation review loop. The problem is signal saturation. At
~69% warning coverage, a newly stale or materially changed page looks identical
to the background backlog, so the freshness channel no longer helps reviewers
identify where guide claims need revalidation.

Freshness also compares only `authorities:`. It is blind to changes under
`examples:`, so a page can cite a changed or newly added shipped template/demo
without warning. The authoring-loop template-count miss demonstrated this:
`crud-dashboard` and `media-feed` predated the page review pin, but the template
directory was not an authority and could not make `checkFreshness` warn. Pages
whose claims derive from an example must list the claim-owning source under
`authorities:` as well.

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
- Claim-owning example/template sources are present in `authorities:` so their
  changes participate in freshness; `examples:` remains execution/witness
  metadata, not a freshness input.
- The solution does not require `main` to remain unchanged during a long guide
  review.

## Confidence

High on the saturated warning count and degraded signal. Medium on the right
budget/threshold; the intended warning-only semantics should remain.

## Disposition (2026-08-08 review-fixes sweep)

Left open as a program (not a one-shot fix), consistent with the warning-only
freshness policy. Two concrete follow-ups are the actionable core: (1) add a
new-vs-baseline warning split and an oldest-warning-age readout to
`check-guide.mjs`; (2) file/update one deduplicated backstop ticket when the
warning count or oldest age crosses a threshold — the drift-backstop machinery
Lane G extended (self-health ticketing in `drift-prone-gates.mjs`) is the natural
home. The per-feature-area prose reconciliation stays an ongoing author-scheduled
task. This sweep also confirmed the guide manifest is HEAD-commit-stamped, which
is why client-package changes (Lanes D/F) could not cleanly regenerate-and-land
it on a moving `main`; decoupling the manifest's reviewedCommit stamp from HEAD
(bind to content, per LLP 0189) would remove that landing tax and is worth
folding into this program.
