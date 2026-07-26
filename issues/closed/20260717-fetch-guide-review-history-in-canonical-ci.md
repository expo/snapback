# Fetch guide review history in canonical CI

**Status:** Resolved (2026-07-26)
**Severity:** P1
**Systems:** CI, Guide, Provenance
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0010 §CI and Review Gates; LLP 0061 §Design 3; GitHub Actions run 29631948936
**Marker:** ci, guide, freshness, git-history, provenance

The canonical Linux proof checked out only the pushed commit. Every guide page
whose `reviewed-commit` named an older authority revision therefore produced
`Invalid revision range` and `reviewed-commit ... is unknown to git`. The
guide checker remained warning-only, so CI reported 28 warnings and could not
perform its intended authority-drift audit.

**Done when:**

- The canonical local-proof checkout includes the historical commits needed
  by guide review identities.
- Workflow source tests pin that checkout depth.
- A replacement Linux proof runs the guide check without unknown-commit or
  invalid-revision warnings.

## Implemented; remote verification pending

The canonical workflow now sets `fetch-depth: 0` on its checkout. The change
is limited to the proof that runs guide freshness; credential persistence
remains disabled and the post-checkout credential attestation still runs
before any later step. The workflow source test refuses a future return to a
shallow canonical checkout.

## Resolution

Canonical `main` local-proof run
[30191116596](https://github.com/ccheever/snapback/actions/runs/30191116596)
passed at commit `d5944bc96abb54d323f48395c7d78bac2d8c0dbe`. The guide
check completed across 35 pages and 85 snippets without either
`Invalid revision range` or an unknown `reviewed-commit`. Its remaining 27
warnings are ordinary authority-drift findings, so historical review identity
validation is working again.
