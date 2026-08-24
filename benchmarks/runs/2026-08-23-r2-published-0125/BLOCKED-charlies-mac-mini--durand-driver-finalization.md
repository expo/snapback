# R2 campaign blocked by production driver finalization on `charlies-mac-mini--durand`

**Status:** Blocked after the first Codex cell attempt; no later cell was started.
**Observed:** 2026-08-24 03:10 PDT (2026-08-24T10:10Z)
**Campaign runner revision:** `f001ae44b108b3dcbc0960b2af4ea9b547f8a0f7`
**Cell:** `sol-clique-explicit`
**Driver:** `social-messenger-r2-native-cli-driver.v1`
**Instrument:** `social-messenger@0.3.3-m8`

## Blocking condition

The production lane-controller exited with status 2 while composing the
mandatory record after the model completed all three milestones:

```text
social-messenger lane controller: Codex token_count record 711.last_token_usage.total_tokens does not equal input_tokens + output_tokens
```

Native stream ordinal 710 (line/record 711) contains this token-count shape:

```json
{
  "last_token_usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 15283
  }
}
```

The controller rejected that provider-native event before completing its
success or failure record path. The cell directory therefore has
`record-base.json`, `metering-manifest.json`, and `terminal-boundaries.json`,
but has neither the required `record.json` nor `metering.json`. There is no
complete record for the landed validator to validate, and a conductor-authored
substitute would violate the production-driver record contract.

This is the run plan's driver-broken stop condition. The first attempt was not
rerun, and the campaign stopped before admission for cell 2.

## Admission and plan evidence

The pre-cell admission gate passed with three consecutive samples taken one
minute apart. Every 1/5/15-minute load average was at or below the inclusive
10.00 ceiling:

| Sample | UTC | loadavg-1 | loadavg-5 | loadavg-15 |
| --- | --- | ---: | ---: | ---: |
| 1 | 2026-08-24T09:03:36.627Z | 9.8169 | 7.6943 | 6.3779 |
| 2 | 2026-08-24T09:04:36.630Z | 5.1660 | 6.7583 | 6.1162 |
| 3 | 2026-08-24T09:05:36.633Z | 2.6572 | 5.7500 | 5.7813 |

The landed `validate-plan.mjs` was rerun after admission and returned
`{"ok":true,"status":"prepared-blocked",...}`. Wave execution proceeded
under the README's final orchestrator rulings. Frozen executable identities
were exact: Codex 0.149.0, Grok 1.0.0, Claude Code 2.1.239, Bun 1.3.12, and
Node v24.18.0.

## Attempt evidence and teardown

The production controller's terminal boundary file records:

| Milestone | Status | Terminal UTC |
| --- | --- | --- |
| M1 | green | 2026-08-24T09:54:04.184Z |
| M2 | green | 2026-08-24T10:01:49.197Z |
| M3 | green | 2026-08-24T10:05:46.005Z |

The 268 controller observations include no load breach and no provider
interruption event. Maximum observed in-cell load averages were 9.5811,
6.2930, and 5.8760 for the 1/5/15-minute windows. After the controller exited,
no lane-controller, cell-driver, or model process remained, and no campaign
port remained listening.

During the attempt the model issued a broad permission command while preparing
a copied choreography harness. Post-attempt comparison found the private
instrument byte-identical to the frozen runner copy and still non-writable;
no cross-cell instrument mutation was observed. Because no complete record
exists, no contamination field has been fabricated.

Raw, uncommitted attempt evidence is retained on this host at:

```text
/Users/ccheever/bench-matrix-20260823-r2/cells/sol-clique-explicit
```

## Disposition

- `sol-clique-explicit` has one attempted execution and no valid complete
  record. It must not be silently rerun.
- The other three Codex and all four Grok cells remain `not-started`.
- The four Claude cells were not touched.
- No product code or benchmark harness code was modified.
- No cell evidence was committed under `cells/`, because the mandatory record
  is absent.

Resume only after the production driver/controller can preserve a complete
failure-shaped record when provider token adaptation rejects an event, and an
orchestrator rules how the retained first attempt should be represented before
any rerun.
