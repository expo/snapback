# Social-messenger harness-native token metering

This tool turns retained harness-native per-turn usage into exact
social-messenger milestone phases. It has no estimator or provider-usage
fallback.

| Adapter | `tokens.source` | Cap posture |
| --- | --- | --- |
| Complete Claude builder session tree | `claude-code-session-usage` | Cap-bearing; streamed message IDs de-duplicated globally |
| Complete Codex builder rollout tree | `codex-rollout-token-count` | Cap-bearing; cumulative counters differenced per rollout, then globally de-duplicated |
| Explicit `unavailable` mode, every family | `null` | Stable reason required; null totals/phases/caps/charges; no token-cap adjudication |

Kimi/Grok lanes always use `unavailable`. A Claude/GPT/mid-tier lane uses it
only when its approved retained tree is missing; no estimator can replace that
tree.

## Driver-stamped lane manifest

`meter.mjs` accepts only `--manifest`. The manifest binds one lane run to:

- a rooted `builder` / `builder-descendant` session tree with native identity,
  parent, role, relative path, and SHA-256 for every source;
- receipt source IDs, expected `runId`/milestone, relative paths, and hashes;
- a hashed terminal-boundary artifact and optional hashed first-edit marker;
- the driver's stable ID, stamp, and required lane wall-clock origin; and
- `rfc3339-with-bounded-skew` evidence plus a non-negative maximum skew.

Artifacts must be relative to and remain inside the manifest directory. The
loader verifies every digest, native Claude/Codex session identity, descendant
reachability, receipt `runId`/milestone, and lane/driver identity before it
parses usage. Every Codex nonzero cumulative delta must equal normalized
`last_token_usage`. Green milestones additionally require a bound
`segment-summary` that attests `green: true` at exactly the driver-stamped
terminal/first-green timestamp; a non-green receipt conflicts.
The emitted `meteringProvenance` block retains all identities, hashes, and clock
evidence.

Delegation policy is **aggregation**: every builder descendant is charged.
Omitting a descendant invalidates the manifest; delegation is never treated as
free work. The usage-only retained-real-log fixture under `test/fixtures/`
captures the reviewed Claude tree whose descendant contributes 12 unique
messages and 21,496 output tokens.

Run:

```sh
node benchmarks/tools/social-messenger/metering/meter.mjs \
  --manifest /path/to/private-lane/metering-manifest.json \
  --out /path/to/private-lane/metering.json
```

## Terminal-boundary join

The driver boundary artifact records every attempted milestone explicitly.
Each attempted entry carries:

- `status`: `green`, `capability-failure`, or `aborted`;
- `terminalAt` and lane-global `terminalSequence`;
- `terminalReason`: `green`, `token-cap`, `wall-cap`, or `abort`; and
- the separate suite/choreography/first-green receipts where applicable.

The joiner orders attempts by `terminalSequence`, snapshots all usage completed
at or before each `terminalAt`, and differences consecutive terminal prefixes.
Thus cap/abort usage never folds into the next milestone and a final failed
attempt never disappears. `firstGreenAt` is reserved for `green` and remains
null for every non-green attempt. Equality at the timestamp boundary is
inclusive.

The sequence is the ordering authority. RFC 3339 timestamps correlate usage
to driver boundaries under the manifest's skew evidence. When a turn lies
inside a nonzero ambiguity window, the join fails closed instead of guessing.
Drivers must record a measured nonzero skew bound for separately stamped
process clocks; zero is reserved for evidence that one process and clock
stamps both channels. The final terminal is stamped after in-flight/overshoot
usage settles. A retained turn after it invalidates the join rather than
disappearing from actuals.

The first-product-edit marker is also a hash-bound driver receipt:

```json
{
  "laneRunId": "lane-r01",
  "at": "2026-08-21T12:34:56.000Z",
  "orientationBytes": 12103,
  "selectedSkills": ["snapback-authoring"]
}
```

The driver measures bytes and selected skills directly. The joiner only takes
the native usage prefix at `at`; it does not infer orientation from prose or
shell commands.

## Watchdog contract

`TokenCapWatchdog` cannot be constructed without an enforcement controller:

```js
const watchdog = new TokenCapWatchdog({
  enforcementController: {
    id: "lane-process-controller",
    async terminate(trip) {
      // Stop the active request/process and await observable termination.
      return {
        acknowledged: true,
        acknowledgedAt: new Date().toISOString(),
        evidence: "process-exit:12345",
      };
    },
  },
});
```

Arming a numeric token cap requires `startedAt` and carries the manifest's
`maxClockSkewMs`; actual wall is derived from that origin. Drivers tail every
declared builder and descendant stream into the same watchdog as turns
complete. They execute model turns through `runTurn()` (or call `beforeTurn()`
before their equivalent turn primitive) and feed completed turns to
`observe()`. At `input + output >= tokenCap`, termination of the complete tree
is requested immediately. The next turn waits for acknowledgement and is then
rejected with `SOCIAL_MESSENGER_TOKEN_CAP_ENFORCED`.

Lane-global completed-turn identities persist across arm/disarm cycles, so a
cumulative-log reread cannot recharge earlier usage. A new ID older than the
armed boundary beyond skew is rejected. New observations after a trip require
`{ inFlight: true }`; they update `actualTokens` and separate overshoot
evidence, while un-attested post-trip consumption is rejected. Before
`disarm()`, call `reconcileMilestone({ retainedTokens, terminalAt })` with the
joined complete-tree `input + output`. A mismatch records the divergence and
fails closed; a retained total already at cap also trips enforcement. Cache
counters stay observable but excluded from the cap; reasoning is enforced as
a subset of output.

## Record schema

Validate complete records with
`benchmarks/schema/social-messenger/run-record.schema.json`. It composes the
base record and extension, restricts sources by cap family, and enforces the
honest-null/no-token-cap posture for both advisory and scored-family
`unavailable` lanes, including a stable `meteringProvenance.unavailableReason`
and null first-edit tokens. Publication tooling additionally runs
`record-validator.mjs` for D2 charging equalities that JSON Schema cannot
express.
