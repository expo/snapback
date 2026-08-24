# R2 campaign blocked on `charlies-mac-mini--durand`

**Status:** Blocked before cell 1; no benchmark cell was started.
**Observed:** 2026-08-24 01:30 PDT (2026-08-24T08:30Z)
**Repository revision:** `6823dffd2fd3bc453dcc580082fd5062f01a88ff`
**Host:** `Charlies-Mac-mini-Durand` (`Mac16,11`, 12 logical CPUs, 25,769,803,776 bytes memory)

## Blocking condition

The mandatory pre-cell plan validation fails before the first codex/grok cell:

```text
$ /Users/ccheever/.volta/bin/codex --version
codex-cli 0.148.0

$ /Users/ccheever/.volta/tools/image/node/24.18.0/bin/node \
    benchmarks/runs/2026-08-23-r2-published-0125/validate-plan.mjs
Error: R2_PLAN_INVALID: harness codex-sol version does not match recorded 0.149.0
```

`harness-config.json` freezes `/Users/ccheever/.volta/bin/codex` at observed
version `0.149.0`. The configured executable currently reports `0.148.0`.
Launching despite that red would violate both the frozen harness identity and
the requirement to rerun `validate-plan.mjs` successfully before every cell.

The other inspected pinned identities were available:

```text
/Users/ccheever/.grok/bin/grok --version
grok 1.0.5 (5115b46bc909) [stable]

/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node --version
v24.18.0
```

## Admission evidence before refusal

The first cell's admission window passed. Samples were taken one minute apart;
all loadavg-1/loadavg-5/loadavg-15 values were at or below the inclusive 10.00
ceiling:

| Sample | UTC | loadavg-1 | loadavg-5 | loadavg-15 |
| --- | --- | ---: | ---: | ---: |
| 1 | 2026-08-24T08:28:22Z | 1.25 | 1.57 | 2.03 |
| 2 | 2026-08-24T08:29:22Z | 1.32 | 1.51 | 1.97 |
| 3 | 2026-08-24T08:30:22Z | 1.25 | 1.46 | 1.92 |

## Disposition

- No production lane-controller or R2 cell driver was launched.
- No cell attempt exists, so no success- or failure-shaped `record.json` was
  fabricated.
- All four Codex and all four Grok cells remain `not-started`.
- The four Claude cells were not touched.
- No product code or benchmark harness code was modified.

Resume only after the frozen Codex executable identity is restored or a new
orchestrator ruling and corresponding landed plan update makes
`validate-plan.mjs` green. Then begin again with the three-sample admission
gate before `sol-clique-explicit`.
