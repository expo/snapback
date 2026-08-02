# cold-clone check fails: the all-aboard codegen graph is never materialized

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 3
**Severity:** P2
**Systems:** CI, Codegen, Demos
**Author:** Claude (Fable 5), directed by Philippe Loulidi
**Date:** 2026-08-02
**Related:** issues/20260801-0062-09-codegen-members-and-live-journey.md

`scripts/cold-clone-check.sh` fails during step 1 (production build of the
All Aboard Contract surface) with `SNAPBACK_CODEGEN_CACHE_INVALID`:

```
generated cache is missing or tampered; regenerate before consuming it:
ENOENT ... demos/all-aboard/.snapback/codegen-cache/<digest>/artifacts.json
remediation: Run `snapback generate snapback` and retry.
```

Observed on PR #9 run 30733786001. The script has no codegen materialization
step (`grep -n "generate\|codegen" scripts/cold-clone-check.sh` matches
nothing), so on a clean checkout the gitignored digest-keyed codegen cache
does not exist and the Vite plugin's fail-closed graph verification refuses
the build. The last successful run of the all-aboard-cold-clone lane was
2026-07-28T23:26Z; codegen changes landed after that (for example `8a6731df`,
`e2c79ba8`).

For comparison, `scripts/check-required-surface-builds.mjs` materializes each
gated demo's codegen graph from its committed review manifest before building,
and that lane passes on the same runner.

Exit: cold-clone-check.sh materializes the codegen graph the same fail-closed
way before building the surface, and the lane is green on a clean clone.

## Resolution — 2026-08-02

cold-clone-check.sh now materializes the All Aboard codegen graph
(`SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs
demos/all-aboard/snapback`) before step 1 and refuses drift of the committed
review manifest. Reproduced the `SNAPBACK_CODEGEN_CACHE_INVALID` failure
locally by deleting the regenerable cache, then verified the materialization
plus surface build pass (same inputsHash digest the plugin expected).

Scope note: this closes the codegen-materialization defect only. The lane is
still red, now at step 2 for an unrelated upstream cause — the Exact 0.1.7
production runtime does not boot any Contract route, so the acceptance scores
1/34. That is tracked separately in
issues/20260802-exact-production-runtime-breaks-contract-routes.md and is not
fixable inside this repository.
