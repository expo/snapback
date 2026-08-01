# Round-2 builder dispatches

Three ready-to-use prompts for FRESH-CONTEXT builder agents (Agent tool,
`subagent_type: "general-purpose"` — never a fork: the whole measurement
is what a builder without round-1 context experiences). Dispatch
sequentially (they share the fixed-port hygiene and server lifecycle);
after each builder reports, a verifier with full context (a fork) runs
the arm's driver, writes the diary delta entry, and only then the next
builder starts.

Isolation rules embedded in each prompt (do not weaken): the builder may
not read `diaries/`, `issues/`, `llp/` (except pages the guide itself
links), the round-1 arm (`demos/upload-bakeoff/<app>/snapback/`), or
`reports/`. The guide (`guide/index.md`) and the packages are the whole
allowed surface, plus the provider-neutral GPS instrument
`demos/upload-bakeoff/_shared/gps-jpeg.mjs`, whose existence the prompt
discloses.

Each prompt requires: build in `demos/upload-bakeoff/<app>/snapback-r2/`;
wall-clock from empty dir to each checklist item; every stumble logged
verbatim (exact diagnostics) in `build-log.md` in the arm dir as hit,
never smoothed; a distinct-concept ceremony count with the list; the
checklist proven by a runnable driver printing an evidence table;
which package surface was used (workspace vs published 0.1.8) recorded.
