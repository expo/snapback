# Social-messenger harness-native token metering

This tool turns retained harness-native per-turn usage into exact
social-messenger milestone phases. It deliberately has no estimator or
provider-usage fallback.

Approved adapters:

| Adapter | `tokens.source` | Cap posture |
| --- | --- | --- |
| Claude session JSONL | `claude-code-session-usage` | Cap-bearing when per-message usage is retained |
| Codex rollout JSONL | `codex-rollout-token-count` | Cap-bearing when `token_count` events are retained |
| Kimi/Grok advisory | `null` | Honest per-milestone nulls; never token-cap enforced |

The Claude adapter de-duplicates streamed updates by message ID. The Codex
adapter differences cumulative `total_token_usage` records, so repeated
snapshots do not double-count. Both normalize native fields to `input`
(fresh, uncached input), `output`, `cacheRead`, `cacheWrite`, and `reasoning`.
`reasoning` is a reported subset of native output, not an additional cap
counter.

## Join contract

`meter.mjs` accepts one or more choreography `receipts-m*.jsonl` files and/or
a JSON boundary overlay. A passing segment summary contributes its
`recordedAt` as `choreoPassAt`; a green summary also contributes the exact
`firstGreenAt`. A boundary overlay may supply the separately stamped
`suitePassAt`, `choreoPassAt`, and `firstGreenAt` fields, either directly or
under `milestones.MN.authoring`.

At each green boundary the joiner takes a prefix sum of every turn completed
at or before the boundary. Consecutive prefix differences become
`milestones.MN.authoring.tokens`; turns after one green and before the next are
therefore charged to the next milestone. `boundarySnapshots` are retained in
the tool output for audit/replay. Copy `source` to the base run record's
`tokens.source`, merge the milestone authoring patches, and copy
`firstProductEdit` into the social-messenger extension.

The first-product-edit marker is an explicit driver receipt:

```json
{
  "at": "2026-08-21T12:34:56.000Z",
  "orientationBytes": 12103,
  "selectedSkills": ["snapback-authoring"]
}
```

The joiner snapshots native usage at `at`. The driver measures the exact bytes
it loaded and records the selected skills; the meter does not infer either
from prose or shell-command heuristics.

## Watchdog contract

`TokenCapWatchdog` is driver-neutral. Arm it with one `(capFamily, milestone,
tokenCap)` and feed it normalized completed turns. It de-duplicates stable
turn IDs and trips once when `input + output >= tokenCap`; cache reads/writes
are retained in usage but excluded. The trip callback receives a
`capability-failure` event whose charging block uses the token cap, actual
wall, and `capped-tokens`, ready for the driver's process-stop/status hook.
Advisory families require `tokenCap: null` and cannot be armed.
