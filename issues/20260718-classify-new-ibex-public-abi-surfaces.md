# Classify new Ibex public ABI surfaces in the generated security registry

**Status:** In Progress
**Severity:** P1
**Systems:** Upstream Ibex, Security inventory, Host ABI, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-18
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

## Implemented; remote verification pending

The reviewed-name set and exact classifiers now include all three exports,
with an explicit no-eval exception ahead of the generic evaluator-name rule.
Ibex LLP 0002 and LLP 0021 record the 184-surface ABI inventory (87 `ex_host`,
39 `ex_hermes`, 10 worklet, plus the Android Java/JNI bridge routes) and the new
classifications. Generated artifacts are current; publication and remote
verification remain pending.
