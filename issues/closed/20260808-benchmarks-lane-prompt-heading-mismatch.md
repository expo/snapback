# Benchmarks papercut: lane-prompt heading vs README extraction instruction mismatch

**Opened:** 2026-08-08 · **Severity:** P4 (papercut)

Diary 0069 residue item 7, called out and never filed: the brief's heading
is `## Lane-prompt block (verbatim, runs 0065–0068)`
(benchmarks/briefs/messaging.md:46) while benchmarks/README.md:97's
extraction instruction says to use "its `Lane-prompt block` verbatim"
without the parenthetical — an extractor matching the documented heading
literally misses it. Align the two (drop the parenthetical from the heading
or quote it in the README).

Filed by the 2026-08-08 comprehensive docs review (dedup sweep of recent
diaries).

## Resolution

Fixed 2026-08-08 (docs-review execution, 47ab42dd6). The brief's heading is
now `## Lane-prompt block`, matching the three sibling briefs and the
README extraction instruction; the runs-provenance parenthetical was
preserved as a body line ("Used verbatim by runs 0065–0068."). Repo grep
confirmed nothing extracted the parenthetical form.
