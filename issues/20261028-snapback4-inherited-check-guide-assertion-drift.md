# Snapback 4: inherited check/init/guide assertions predate the 0.4.46 surface

Status: Open
Owner: integration / guide owners
Found: 2026-10-28, SCAF1 affected verification from 1c4c51b551

The original optimized 1c4c51b551 binary reproduces these stale expectations:

- check::a_long_card_prints_its_opening_and_index_and_full_prints_it_all expects 839 language lines from --full; the bounded DX16 surface prints 26 indexed lines.
- check::guide_lists_aliases_and_resolves_them_on_stdout expects a level-three Pages and cursors heading; the existing section is level two.
- init::web_and_expo_starters_are_one_small_screen_with_product_comments and init::init_beside_a_projects_own_schema_leaves_its_tests_green expect the old `cases: N passed, 0 failed` text. The same baseline CLI succeeds and emits `authored cases pass (N passed, 0 failed, 0 skipped)`.

Unchanged guide source/fixture inputs also retain three independent assertion reds:

- guide::deploy::deploy_recipe_bootstraps_an_admin_without_a_public_privilege_race: old compact-card bound.
- guide::familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block: 18,300 -> 12,811, one word over the old 30% aggregate cutoff.
- guide::wave33_001_022_codex_011_021_muse_every_reference_section_fits_day_two_budget: old start-card staging-in-opening assertion.

Evidence: snapback4/reports/20261028-scaf1/inherited-test-controls.json records the baseline binary SHA, actual successful outputs and unchanged guide-input hashes. Update expectations to the current bounded/compact surface without relaxing meaningful proof assertions, with the owning guide/CLI changes. SCAF1 separately fixes its introduced verdict ordering and new changelog generated-file references; those are not deferred here. No publication qualification is claimed by this ticket.
