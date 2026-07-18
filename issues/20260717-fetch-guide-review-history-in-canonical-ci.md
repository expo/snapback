# Fetch guide review history in canonical CI

**Status:** In Progress
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
