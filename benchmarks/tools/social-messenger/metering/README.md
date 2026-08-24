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
`segment-summary` that attests `green: true` at exactly the first-green
timestamp, no later than the driver-stamped terminal; a non-green receipt
conflicts.
At record-write time the loader re-reads every `suiteStatus` receipt path,
requires a regular file, hashes its current bytes, and compares that digest to
the `0.3.3-m8` segment-summary digest captured during choreography's startup
refusal check. A missing, replaced, or edited receipt refuses the record.
The emitted `meteringProvenance` block retains all identities, hashes, and clock
evidence.

The Codex parser is versioned independently from the manifest. Adapter
`codex-rollout-jsonl.v2` has one bounded compatibility rule for the observed
Codex CLI 0.149.0 native shape: when a validated cumulative component snapshot
is unchanged, and `last_token_usage` carries zero for every component but a
contradictory positive advisory `total_tokens`, the repeated status creates no
turn and charges no tokens. The parser records the rule ID, native CLI version,
source/session identity, record index/timestamp, and every ignored advisory
counter under `meteringProvenance.adapter.compatibilityEvents`. The exception
never applies when any cumulative component advances; those records still
require an internally valid `last_token_usage` equal to the cumulative delta.
Optional native counters that are genuinely absent remain `null` where the
record schema allows null; the adapter does not manufacture zeroes.

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

For a green attempt, the hash-bound segment summary stamps `suitePassAt`,
`choreoPassAt`, and `firstGreenAt`. `terminalAt` may be later: the production
driver stamps it from the native token-count settlement after the successful
terminal signal. The closing milestone uses the final native token count before
native task completion. This keeps first-green proof distinct
from the terminal prefix used for complete charging. A first-green timestamp
after the terminal is invalid.

Retained `social-messenger-r2-native-cli-driver.v1` manifests from before this
repair stamped the segment-summary time as `terminalAt` and labeled a fixed
five-second handoff allowance as clock skew. The loader has a version-bounded
recovery for exactly that driver/evidence pair: it identifies the successful
native `r2-cell-signal` completion and the corresponding settled native
`token_count`, treats the shared host system clock as the effective zero-skew
channel, and records the native ordinals and every original/effective value
under `meteringProvenance.driver.compatibilityEvents`. It also records the
small controller setup overlaps that armed the next milestone before the
prior signal turn's usage settled, without moving any token turn across the
boundary. A final host-load sample after native task settlement is retained
but explicitly excluded from the authoring window. Other driver IDs, clock
evidence, ambiguous native handoffs, and manifests remain unchanged or fail
closed.

The joiner orders attempts by `terminalSequence`, snapshots all usage completed
at or before each `terminalAt`, and differences consecutive terminal prefixes.
Thus cap/abort usage never folds into the next milestone and a final failed
attempt never disappears. `firstGreenAt` is reserved for `green` and remains
null for every non-green attempt. Equality at the timestamp boundary is
inclusive.

The sequence is the ordering authority. RFC 3339 timestamps correlate usage
to driver boundaries under the manifest's skew evidence. When a turn lies
inside a nonzero ambiguity window, the join fails closed instead of guessing.
Drivers must record a measured nonzero skew bound for uncorrelated or
cross-host clocks. Zero is valid for separate processes only when hash-bound
evidence establishes that both read the same host system clock and native
execution order settles the join. The final terminal is
stamped after in-flight/overshoot usage settles. A retained turn after it
invalidates the join rather than disappearing from actuals.

The first-product-edit marker is also a hash-bound driver receipt:

```json
{
  "laneRunId": "lane-r01",
  "at": "2026-08-21T12:34:56.000Z",
  "orientationBytes": null,
  "selectedSkills": ["snapback-authoring"]
}
```

The driver records only measured bytes and observed selected skills. A native
Codex `FileChange` completion provides the first-product-edit timestamp and
hash-bound ordinal/item/path provenance; commandless file changes also project
as `edit` or `generate` semantic actions. The joiner takes the native usage
prefix at `at`; it does not infer orientation from prose or shell commands.
Missing orientation bytes or per-phase usage makes the LLP 0295 efficiency
scorecard ineligible rather than estimated.

For current R2 driver records, `meteringProvenance.manifest`, `adapter`,
`driver.compatibilityEvents`, `observations`, and every session's
`nativeCliVersion` are mandatory. The semantic validator resolves the
hash-bound manifest and replays the native adapter, terminal recovery,
observation filtering, and first-edit derivation. Deleting or fabricating a
compatibility claim therefore fails even if the edited JSON still has a valid
shape. Older extension-v2 records retain their additive compatibility.

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
milestone, `startMilestone()` starts interval `os.loadavg()` sampling. Every
other custody claim is explicit in the driver contract: absent claim options
produce non-claims, and an external suite/choreography producer may supply its
own claim without a competing controller marker. `restart()` and
`reseed()` wrap the operations they count; `apiRequest()` wraps native stream
attempts and records errors plus linked retries; and `finishMilestone()`
records a final load sample. The driver puts only its actual settlement wait
inside `controls.suiteAssertionWait()`—setup, actions, and whole-attempt wall
are not suite wait. After the last attempt—or in the `finally` path after a
thrown attempt—the controller hash-registers every producer stream, writes
`metering.json`, composes the complete per-cell `record.json`, and validates it
against the composed schema plus semantic validator. Unreached reduced-scope
milestones are retained as `not-run`; a crash cannot erase the attempted
failure.

Choreography separately writes its own owner-scoped assertion attempts and
measures only the intervals actually spent awaiting browser settlement. Suite
and choreography claims and non-claims remain separate; neither producer can
claim the other's coverage, and the complete browser-wait block is eligible
only when both owners are claimed. A harness with a native normalized event
log calls `semanticAction()` and `recoveryEpisode()` at its decoded
tool-result boundary. The R2 production driver does this for Codex, Grok, and
Claude native CLI streams; it also owns the lifecycle/API wrappers, while
typed suite and choreography sidecars own their settlement waits. A green
current-instrument milestone with no native semantic action or no
suite/choreography settlement attempt is invalid, so selecting the driver
alone cannot claim trustworthy coverage. Drivers without those producers
retain explicit non-claims.

Every attempted milestone receives all six fields. A block is either
`{"claimed":true,...}` with retained evidence or
`{"claimed":false,"reason":"..."}`. Missing fields are invalid on the
`0.3.3-m8` instrument. A semantic-action or recovery-episode non-claim makes
the correction-action target ineligible; phase gaps, other coverage gaps,
host-load contamination, and API interruptions likewise make the overall
efficiency scorecard ineligible while preserving product-debugging value.
The joiner stamps `instrumentVersion: "social-messenger@0.3.3-m8"`;
`instrumentVersion` is unconditional for every plan record, and current schema
validation requires that pin, the exact orientation pin, the current
observability protocol, suite linkage, and the complete claimed-or-non-claimed
shape. A current/R2 record cannot become legacy-compatible by coordinated
deletion/downgrade of optional markers or by substituting explicit
`social-messenger@0.3.2-m8` while retaining a current protocol, orientation
pin, or choreography version.

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
