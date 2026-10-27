# TOK1 evidence

The root WORKSTREAM-REPORT.md records the final result. model-replays.json has
native calls/input/cache counts and actual docs-output token counts for all four
pairs. Preliminary after runs, prompts, schemas and verbatim compressed traces
remain beside the final runs; no original lane/store was modified.

Reading scope: fresh installed package/spec → first compiling application schema
→ SDK lookup. This is not a full-application bakeoff. Final reading cards match
the final source; later initializer recovery and the origin/main SQLite merge
are covered by integrated tests/packed consumers, not credited to reading totals.
See reading-artifacts.json for package hashes and HARNESS-COMPATIBILITY.md for
the exact child-only --hold/environment requirement.

Reproduce with replay-reading.mjs (same harness model CLIs/flags) and
summarize-replays.mjs; the latter reads compressed traces too. run-consumers.mjs
packs once and installs the actual tarballs for starter/proof/staging/production
consumers. prove-install-first.mjs proves npm i snapback4 alone before frontend
installation using a local artifact registry. run-scoped.mjs uses the selector's
runPlan engine and explicitly retains/narrows its conservative complete plan;
it never claims publication qualification or the complete selector battery.
