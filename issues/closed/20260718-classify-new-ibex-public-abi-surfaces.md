# Classify new Ibex public ABI surfaces in the generated security registry

**Status:** Closed
**Severity:** P1
**Systems:** Upstream Ibex, Security inventory, Host ABI, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-18
**Closed:** 2026-07-18
**Related:** Ibex LLP 0002 §What actually crosses the boundary; Ibex LLP 0021 WP1; `vendor/ibex/packages/ibex-devtools/src/scripts/capsec-coverage-model.mjs`
**Marker:** ibex, capsec, public-abi, generated-registry, drift

Ibex's source-derived capability-security registry fails closed when a newly
observed public ABI has no reviewed classification. The existing
`ex_hermes_watch_time_limit` and `ex_hermes_unwatch_time_limit` exports had not
been added to the reviewed public-ABI set. Adding
`ex_hermes_create_no_eval` correctly caused the same gate to fail, proving that
publishing the submodule without a registry update would leave generated
security inventory stale.

**Done when:**

- All three public exports join the exact reviewed ABI inventory.
- No-eval creation is classified as runtime-bootstrap state rather than being
  misidentified as an authority-bearing evaluator because its name contains
  `eval`.
- Time-limit arm/disarm are classified as trusted authority-control-plane
  operations.
- The focused classifier test names the three semantics explicitly.
- Generated registry, implementation manifest, review tables, fixtures, and
  digests are regenerated reproducibly and all CapSec drift checks pass.
- The published Ibex compatibility branch and Snapback `main` point at that
  complete generated identity.

## Resolution

Ibex commit `bfbc6133af739ed2dabc2f44efa693d1412452e5` adds
`ex_hermes_create_no_eval`, `ex_hermes_watch_time_limit`, and
`ex_hermes_unwatch_time_limit` to the exact reviewed ABI inventory. No-eval is
classified as runtime bootstrap; time-limit arm/disarm are trusted
authority-control-plane operations. The generated registry, manifest, review
tables, fixtures, and digests are reproducibly current and their drift checks
pass.

Snapback commit `a5ed6ebd05766b10607937a1c010352d79eea4b0` points at that published
Ibex identity. GitHub Actions local-proof run `29674515103` passed the canonical
Linux proof on 2026-07-18.
