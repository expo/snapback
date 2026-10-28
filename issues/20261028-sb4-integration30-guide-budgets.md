# Snapback 4: inherited Integration 30 guide budget assertions are red

Status: Open
Baseline: 1c4c51b551

The VER1 affected guide run found two inherited reds whose governing source and
tests are byte-identical to the baseline (hash evidence retained in VER1).

- deploy::deploy_recipe_bootstraps_an_admin_without_a_public_privilege_race:
  the operational deploy card exceeds its existing compactness assertion.
- familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block:
  historical words 18,300 → 12,811, one word over the 70% ceiling of 12,810.

Reconcile the actual card contents/accounting with the existing bounds; do not
raise ceilings to clear an unrelated landing. VER1 did not edit those cards or
weaken the assertions. Its scoped guide run filters only these two named reds;
the complete original attempt is retained. The separately stale start/staging
lookup assertion was repaired to follow the existing start → workflow route.

Evidence: [VER1 results](../snapback4/reports/20261028-ver1/RESULTS.md), including
inherited-guide-failures.json.gz and the first affected receipt.
