# Review and refresh stale guide authority baselines

**Status:** Closed
**Severity:** P3
**Systems:** Guide, Auth, Backend authoring, Client authoring, Documentation CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0061, guide/conventions.md
**Marker:** maintenance

`node scripts/check-guide.mjs` passes but reports authority changes since the
recorded review baseline for ten pages:

- `guide/auth/sessions-and-principals.md`
- `guide/backend/actions-and-fetch.md`
- `guide/backend/cron.md`
- `guide/backend/mutations.md`
- `guide/backend/queries.md`
- `guide/capabilities.md`
- `guide/clients/headless.md`
- `guide/clients/react.md`
- `guide/conventions.md`
- `guide/getting-started/the-authoring-loop.md`

The warning is intentionally advisory, but these pages are the authoring
surface and may now describe behavior or examples derived from superseded LLP
or code authority.

**Done when:**

- Review each changed authority and update affected prose/snippets rather than
  mechanically advancing review hashes.
- Re-run snippet, capability-index, and guide freshness checks.
- Refresh each page's review baseline only after confirming its content remains
  accurate.
- `node scripts/check-guide.mjs` completes without freshness warnings.

## Resolution

Reviewed every authority surfaced by the freshness checker (20 pages after
following the full warning queue), then pinned the pages to the implementation
commit. The review corrected agent principals from design-only to an honest
partial GAP, documented authority-creating writes, scoped-token exclusion from
host operations, declaration-bound room revocation, and the retained
membership-query limitation. The regenerated manifest/flat guide passes all
snippet and surface joins with zero freshness warnings.
