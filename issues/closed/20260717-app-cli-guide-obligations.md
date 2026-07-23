# Guide and capability-index obligations for the app CLI

**Status:** Open
**Severity:** P3
**Systems:** Docs, Guide
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §Guide obligations, LLP 0061 §2/§5
**Marker:** app-cli, docs

Two obligations at two moments. **When LLP 0062 lands** (same commit):
add the `clients.app-cli` GAP row to `guide/capabilities.md` naming
the RFC as authority, with owner and review date (follow the
`auth.agent-principals` row's format), and regenerate the guide
manifest/flat projections. **When phase 1 lands:** a guide page under
`guide/clients/` with CI-run snippets (per LLP 0061 §5's landing
rule), route-map rows for the `/app-api` routes, and the GAP row
flipped to the page.

**Done when:**

- The GAP row is in the same commit that lands the RFC file (verify
  before pushing — the row does not exist in the tree today).
- Phase-1 landing carries the `clients/` guide page with snippets that
  run in the guide check (`node scripts/check-guide.mjs` green), the
  route-map rows, and the updated capability row.
- `./ref-check --verbose` and the guide freshness checks pass.
