# Acceptance coverage audit — Grok 0.0.15, 2026-09-07 14:45 UTC

Root read the complete current acceptance.mjs, coverage.mjs and instrument M3 assertion definitions. This is an interim audit of the frozen bytes in manifest.json. Do not modify the live benchmark or infer final scores from it; audit final source again before grading.

The M2 unconditional successes and missing actual second-page checks identified in the earlier audit remain. Later milestones still route to runLater(), which records one unconditional placeholder success.

New coverage hazard: acceptance.mjs maps missing required IDs to results.find(r => r.ok), then results[0]. Consequently a missing required test can inherit unrelated passing evidence. The captured M3 receipt has 39 results/39 coverage entries and no mismatched test/ID mappings, so this hazard did not activate in that receipt. coverage.mjs also exports a prefix/fallback mapper, but acceptance.mjs imports suiteRequiredIds only; do not describe that exported fallback as an observed execution.

M3 claim/evidence differences:
- m3-a10 requires rendering a quoted excerpt. The suite tests only committed mutation and stored quoteId equality; it never observes rendering.
- m3-a11 requires tapping the excerpt to jump to the original. The suite tests only stored quoteId equality; it never taps or observes scrolling. The separate captured browser quoted-reply-excerpt-and-jump check fails, directly contradicting any broad UI success inference from the suite label.
- m3-a15 requires seed replay to produce no duplicates across installed segments. The suite replays starter-m3 and checks only that before/after groups.mine have a data field. It neither compares cardinalities/identities nor checks all installed segments. This is insufficient idempotency evidence, not proof of actual duplication.
- m3-a05 requires a second distinct group with the same three members. The code awaits second memberAdd but does not inspect its outcome or query membership; distinct committed group IDs alone do not prove its complete membership. m3-a04b does check the first group's add mutation.

These are coverage limitations in the benchmark-authored application tests. They are not independently reproduced Snapback product defects. Preserve the original suite receipt and browser failures. No full M3 or holistic win is supported.
