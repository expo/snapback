# caps names the largest oversize files, not the ones that changed

**Status:** Open
**Systems:** caps, rules, loop
**Severity:** P2
**Author:** Claude Opus 5, directed by Charlie Cheever
**Date:** 2026-09-01

scripts/caps.mjs:169

Failure scenario: add ten lines to snapback2/packages/compiler/src/test.ts, taking it from 1,491 to 1,501 lines as caps counts them. caps correctly fails, but the two files it names are crates/snapback-engine/src/local/engine.rs (45,167 lines) and crates/snapback-engine/src/local/tests/engine.rs (43,469 lines) - both Snapback 1, both untouched, both present on main. The file that actually changed is never named. The only signal that anything moved is the oversize count going from 205 to 206, which is easy to read as noise.

Why it happens: line 169 is oversize.sort((a, b) => b.lines - a.lines).slice(0, oversize.length - allowedOversize). The baseline is a count, so caps reports the largest files over the allowance rather than the ones responsible for exceeding it. When a repository carries a large historical baseline, the offenders are permanently masked by files nobody is allowed to fix.

Consequence, observed rather than hypothesized: during the 2026-09-01 review sweep an agent read the caps output, saw only Snapback 1 files named, and reported no new violation. The orchestrator also had to diff the tracked >1,500-line file sets between main and the lane to find the real file. The check fired correctly and told both readers the wrong thing, which is the failure mode the issue.mjs header comment already names for a different check: a diagnostic that names a different fact than the one that would fix the file.

Note a second, smaller trap in the same area: caps counts text.split('\n').length (caps.mjs:153), so a file with a trailing newline counts one higher than wc -l. A file wc -l reports as exactly 1,500 is 1,501 to caps and is over the cap. Anyone checking their own work with wc will conclude they are exactly at the limit when they are past it.

Suggested fix: name the files whose oversize status is new relative to the merge base, not the largest ones - or, if that is too much machinery, always name every file over the cap that is not in a committed baseline list, and make the baseline a list of paths rather than a bare count so the diff is computable. Also state the counting rule in the message ('N lines as caps counts them, including the trailing newline') so wc -l and caps cannot disagree silently.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — diagnostics still lack attribution. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The title's largest-file algorithm is stale: caps now prints the smallest overflow files. That still cannot identify newly oversized files from a count-only baseline; the later recorded counterexamples show unchanged S1 paths can mask new S2 overages.

Source: scripts/caps.mjs oversize.sort ascending followed by slice(0, overflow). Narrow remaining work to truthful offender attribution and explicit line-count convention, not merely reversing the sort again. Respect the no-new-registry rule; no baseline increase or S1 cleanup is authorized here.
