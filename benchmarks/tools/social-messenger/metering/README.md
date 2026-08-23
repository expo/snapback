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
- typed observation source IDs, relative paths, and hashes (an explicit empty
  array means no retained producer stream, not "measured clean");
- the hashed suite-status input used by choreography startup;
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
At record-write time the loader re-reads every `suiteStatus` receipt path,
requires a regular file, hashes its current bytes, and compares that digest to
the `0.3.3-m8` segment-summary digest captured during choreography's startup
refusal check. A missing, replaced, or edited receipt refuses the record.
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

## D0.6 observation producers

`observations.mjs` is the typed producer and projection boundary. Each JSONL
event is closed-shape, lane/milestone/sequence stamped, and belongs to one of
six blocks. The meter accepts only hash-declared sidecars, validates every
event, and derives the run-record aggregates itself. The record validator
later resolves the same relative paths, recomputes their SHA-256 digests,
revalidates event shape and action/episode joins, and recomputes all six
projections. Aggregate-only claims and decorative hashes therefore fail.

The production `lane-controller.mjs` constructs `ObservationWriter` and
`LaneObservationHarness` for the complete cell. It can consume the frozen R2
`harness-config.json` directly with `--harness-config ... --cell ...`; startup
refuses unless that plan pins `social-messenger@0.3.3-m8`. For every attempted
milestone, `startMilestone()` starts interval `os.loadavg()` sampling and
claims complete lifecycle/API and suite-wait custody; `restart()` and
`reseed()` wrap the operations they count; `apiRequest()` wraps native stream
attempts and records errors plus linked retries; and `finishMilestone()`
records a final load sample. The driver puts only its actual settlement wait
inside `controls.suiteAssertionWait()`—setup, actions, and whole-attempt wall
are not suite wait. After the last attempt, the controller hash-registers its
stream plus the choreography stream in the lane manifest and invokes the
record writer.

Choreography separately writes its own owner-scoped assertion attempts and
measures only the intervals actually spent awaiting browser settlement. Suite
and choreography claims and non-claims remain separate; neither producer can
claim the other's coverage, and the complete browser-wait block is eligible
only when both owners are claimed. A harness with a native normalized event
log may call `semanticAction()` and `recoveryEpisode()` and claim those
streams. Current
harness-native Claude/Codex/Kimi/Grok usage logs do not expose sufficient
semantic-action and failure-to-recovery events, so the lane harness emits
explicit non-claims for those blocks by default.

Every attempted milestone receives all six fields. A block is either
`{"claimed":true,...}` with retained evidence or
`{"claimed":false,"reason":"..."}`. Missing fields are invalid on the
`0.3.3-m8` instrument. A semantic-action or recovery-episode non-claim makes
the correction-action target ineligible; phase gaps, other coverage gaps,
host-load contamination, and API interruptions likewise make the overall
efficiency scorecard ineligible while preserving product-debugging value.
The joiner stamps `instrumentVersion: "social-messenger@0.3.3-m8"`; current
schema validation requires that pin, the exact orientation pin, the current
observability protocol, suite linkage, and the complete claimed-or-non-claimed
shape. A current/R2 record cannot become legacy-compatible by deleting or
downgrading an orientation string.

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
