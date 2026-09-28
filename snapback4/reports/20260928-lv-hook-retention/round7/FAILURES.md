# Round 7 failures

Every failing test name is in [failures.json](./failures.json). No baseline or
environmental exemption is claimed; inherited LV defects remain ours.

| Run | Failure and attribution | Resolution |
| --- | --- | --- |
| `before.log.gz` | **Ours; expected negative.** All six online/process/wasm malformed-200/404 cases fail on the unmodified round-6 SDK at the retained-secret assertion. | All six pass after the classification correction. |
| `search.log.gz` | **Ours; unexpected fixture error.** Six composed-search cases time out waiting for an empty sync to revalidate a mounted page. Empty sync does not promise that refresh. Direct diagnostic/retention assertions had passed. | Observe the same key with `keep:false`, wait for its diagnostic, and assert the retained peer survives. Corrected six-case run and expanded twelve-case run pass. |
| `audit-before.log.gz` | **Ours; expected negative on isolated round 6.** 28 failures / 2 passes across the final 30 regressions. Twenty-six fail retained-answer assertions; the two process/wasm ordinary `E_OFFLINE` cases time out awaiting the refresh after the old implementation cleared its presence interval. The two composed `E_OFFLINE` cases already pass. | Final implementation passes all 30; this control changes only ignored copied modules, never the live SDK. Do not describe the two timed-out controls as direct memory/fence assertion failures. |
| `affected.log.gz` | **Ours; verification interference.** The keep=true React authority browser case throws while reading `window.latest.query.data`; the broader run is **1,529 pass / 1 fail**. Vite error and the final `http-response.ts` source edit both occurred at 01:42:15 +0200. A live-source reload is the likely cause; this run was not source-frozen. | The complete two-case browser file passes with frozen sources and no product/test correction (`authority-react-rerun.log.gz`). The separate final 1,017-case run also passes. The original broad run remains red. |
| Isolated-control setup | **Ours; operational.** The first command used a nonexistent per-package TypeScript path (`ERR_MODULE_NOT_FOUND`) and stopped before creating/running the control. | Resolve the existing workspace `typescript` package; isolated control completes. No tool installation. |

Read-only discovery also tried several nonexistent guessed source/helper paths;
`rg --files` located the actual files. These were our discovery errors, not
product or environment failures. No final affected-test failure is unresolved.
`scripts/test.sh` was not run; no complete-suite qualification is claimed.
