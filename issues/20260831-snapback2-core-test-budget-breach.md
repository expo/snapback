# snapback2: `measure --check` "Test what you just changed" exceeds its 30 s budget on main

**Status:** Open
**Systems:** snapback2, metrology
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-31
**Related:** LLP 1002 §11 (Measured), `snapback2/scripts/measure.mjs`, wave-2 landing `7a26ee45a`

The step runs `cargo test -q -p snapback2-core` after measure's own forced incremental rebuild. Control experiment 2026-08-31 (quiet machine, syspolicyd/XProtect settled to ~2%): main tip `ae31c9ac2` with zero local changes reads **32.49 s against the 30 s budget** in the integration worktree; a second worktree reads ~45 s (colder target cache). A fully warm `cargo test -p snapback2-core` with no forced rebuild is 17.9 s, so roughly half the cost is recompilation of the test targets after the touch.

Cause: the wave-1/wave-2 landings grew the core suite (ceilings, structural no-early-exit, completeness, Bytes — 175 workspace tests) past the point where touch-rebuild-plus-test fits 30 s on this hardware. The breach is marginal and machine-dependent: it passed (barely, "on the warm retry") at the wave-2 landing gate and now sits just over.

This red is inherited for in-flight lanes (the provenance lane reproduced it with zero Rust changes; the control run above pins it to main). Fix-forward candidates, in preference order: (1) make the forced-rebuild touch narrower so test-target recompilation is not the dominant cost; (2) speed the heaviest new tests (the completeness and outbox fixtures); (3) only then, an author ruling raising the budget — the 30 s number is the product promise of LLP 1002 §11, not an implementation detail.
