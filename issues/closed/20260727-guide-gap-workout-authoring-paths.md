# Guide gap: workout authoring paths

Opened: 2026-07-27
Resolved: 2026-07-27

The five-app workout found three facts an author needed but could not obtain
from the guide: snapshot-bundle authoring and response shape, the public versus
admin cron inspection split, and the pinned dependency install required before
source-tree codegen.

Resolution:

- added `guide/realtime/snapshot-bundles.md` and closed the capability-index
  GAP;
- corrected `guide/backend/cron.md` to name the admin detail projection and
  shared fixture;
- added the source-checkout install prerequisite and missing-module
  classification to `guide/getting-started/the-authoring-loop.md`.

`node scripts/check-guide.mjs` verifies the updated corpus and executable
transclusions.
