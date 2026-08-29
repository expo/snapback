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
`last_token_usage`; a cumulative reset is admitted only after the registered
native `compacted` marker and must checksum from its new zero origin. Green milestones additionally require a bound
`segment-summary` that attests `green: true` at exactly the first-green
timestamp, no later than the driver-stamped terminal; a non-green receipt
conflicts.
At record-write time the loader re-reads every `suiteStatus` receipt path,
requires a regular file, hashes its current bytes, and compares that digest to
the `0.3.6-m8` segment-summary digest captured during choreography's startup
refusal check. A missing, replaced, or edited receipt refuses the record.
The production driver also rolls each green milestone's refusal-time verdict
and receipt identity into the final aggregate `suite-status.json`. A later
milestone suite may replace that aggregate file with only its own entry; an
absent entry or unbound `{ "pass": false, "receipt": null }` placeholder is
therefore restored only when the original receipt still carries the same
verdict and SHA-256 captured by choreography. A receipt verdict flip or any
identity change still refuses finalization, with both verdicts named when they
differ. File timestamps and write ordering are not evidence.
The emitted `meteringProvenance` block retains all identities, hashes, and clock
evidence.

The Codex parser is versioned independently from the manifest. Adapter
`codex-rollout-jsonl.v4` treats `total_token_usage` as the charging ledger and
validates the aggregate `last_token_usage.total_tokens` against every charging
cumulative-component delta. Codex also emits unchanged cumulative recaps: a
periodic duplicate can repeat populated last-use fields, while a context
compaction recap carries zero last-use components and a nonzero aggregate
housekeeping total between `compacted` and `ContextCompaction`. Both are
non-charging and create no turn. When cumulative usage advances, an
aggregate-only last-turn shape is admitted only when its aggregate equals the
exact cumulative delta; full component shapes must additionally equal that
delta component by component. A cumulative counter that moves backwards
without the registered native `compacted` reset marker, or a post-reset value
that does not checksum from its new zero origin, still fails closed with the
event-scoped diagnostic.
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
`choreoPassAt`, `firstGreenAt`, and the protocol `terminalAt`: authoring ends
when suite and choreography are both green. Native CLI usage can settle later.
That later timestamp and native ordinal live only in the versioned
`usageSettlements` provenance and select the token prefix; they never extend
the authoring wall. A first-green timestamp after the protocol terminal is
invalid.

Retained `social-messenger-r2-native-cli-driver.v1` manifests from before this
repair stamped the segment-summary time as `terminalAt` and labeled a fixed
five-second handoff allowance as clock skew. The loader has a version-bounded
recovery for exactly that driver/evidence pair: it identifies the successful
native `r2-cell-signal` completion and corresponding native `token_count`,
records their timestamps and ordinals under
`meteringProvenance.driver.compatibilityEvents`, and leaves the protocol
boundaries byte-for-byte authoritative. The two signal commands accidentally
observed as next-milestone `process` actions are excluded by exact source,
sequence, timestamp, action identity/class, and native signal ordinal. A
separate exact, digest-bound sub-second correlation retains receipt-finalizing
observations emitted just after the protocol timestamp. Neither rule excuses
an arbitrary event. All remaining observations project only inside protocol
windows. Other driver IDs, clock evidence, ambiguous native handoffs, and
manifests remain unchanged or fail closed.

Current drivers stamp `instrumentationCommandsObserved: false` after filtering
their private signal commands at ingestion. Such streams skip the recovered
cell-1 one-second candidate heuristic completely: a legitimate next-milestone
process/progress observation remains product evidence even when its timestamp
is within one second on either side of native signal completion. Only the
exact registered cell-1 native and observation byte streams can use the
compatibility exclusion.

The joiner orders attempts by `terminalSequence`, snapshots usage at each
separate available native settlement (or at `terminalAt` for drivers without
that carrier), and differences consecutive prefixes.
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
execution order settles the join. An available closing settlement rejects any
retained usage after it. An unsignaled closing failure with no later native
token count records null phase usage and explicit ineligibility; it never
reuses an earlier milestone's settlement as though it were measured.

The first-product-edit marker is also a hash-bound driver receipt:

```json
{
  "laneRunId": "lane-r01",
  "at": "2026-08-21T12:34:56.000Z",
  "orientationBytes": null,
  "selectedSkills": []
}
```

The driver records only measured bytes and observed selected skills. Codex
`FileChange` carries no skill-selection field, so its recovered marker keeps
`selectedSkills` empty even when the separate orientation carrier records a
delivered skill. A native Codex `FileChange` completion provides the first-product-edit timestamp and
hash-bound ordinal/item/path provenance; commandless file changes also project
as `edit` or `generate` semantic actions. The joiner takes the native usage
prefix at `at`; it does not infer orientation from prose or shell commands.
Missing orientation bytes or per-phase usage makes the LLP 0295 efficiency
scorecard ineligible rather than estimated.

For current R2 driver records, `meteringProvenance.manifest`, `recordBase`,
`adapter`, `driver.compatibilityEvents`, `observations`, and every session's
`nativeCliVersion` are mandatory. The semantic validator resolves the
hash-bound manifest, rebuilds the complete join, and composes the complete
record from the hash-bound base. Milestone/total/orientation tokens, phases,
walls, caps, charging, eligibility, all provenance, and the entire commandless
FileChange projection must match that replay. Deleting or fabricating a claim
therefore fails even if coordinated edits remain internally consistent. Older
extension-v2 records retain their additive compatibility.

Optional orientation cache/reasoning counters may honestly be null when the
native carrier omits them. Measured input/output tokens plus measured bytes
still establish orientation evidence; the optional nulls alone do not erase
it.

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
refuses unless that plan pins `social-messenger@0.3.6-m8`. For every attempted
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

For R2 campaign cells, admission binds the actual Node executable bytes,
controller and production-driver paths and bytes, exact ordered argv, harness
config, immutable materialized instrument, the entire actually imported source
closure, a canonical no-loader/preload Node environment posture, non-sensitive
allowed-host hardware identity, the complete committed
prefix replay, and an atomic campaign-private exclusive host lock. Process and
every campaign port are probed after the three load samples. The controller
atomically claims that same lock, imports and preflights the driver without
writing an attempt, and performs a second actual process/port probe while it
repeats the prefix, command, config,
instrument, and source-closure checks immediately before its first atomic
private-cell write. Node module-loader/preload environment variables are
forbidden for admission/controller execution and scrubbed from the native
harness child. Every private-root, cells, cell, lock, and transaction path is
canonically contained with no symbolic-link ancestor. The controller holds the
lock through finalization. Explicit stale-lock
recovery uses an exact snapshot/CAS guard, archives only the owner it inspected,
and still refuses any cell with existing private evidence.

If a single campaign attempt completed its native stream and manifest but the
controller failed during join or record write, finalize it without importing
the production driver or invoking `prepare()`:

```sh
node benchmarks/tools/social-messenger/metering/r2-finalize-existing.mjs \
  --harness-config benchmarks/runs/2026-08-23-r2-published-0125/harness-config.json \
  --cell <cell-id> --reserved-by <operator> [--publish]
```

The tool requires a retained one-attempt capsule whose exact admission,
config/instrument/source identities, host/lock claim, process ownership, and
registered model/adapter policy form one consistent graph. It derives counts
only from the hash-bound native graph, validates the composed record, and
writes a deterministic publication manifest. `--publish` preflights every
target conflict before its first write, resumes only byte-identical partials
from the same transaction, copies the whole validation graph (including prompt,
assertions, exact validated coverage manifest, and provenance), writes
`cell.json` last, and runs the production
finalized-slot validator against the published slot. Missing counts outside the
registered Grok-unavailable path, divergent derived or partial bytes, a target
escape/symlink, or a second attempt fail closed; retained private evidence is
never deleted.

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
`0.3.6-m8` instrument. A semantic-action or recovery-episode non-claim makes
the correction-action target ineligible; phase gaps, other coverage gaps,
host-load contamination, and API interruptions likewise make the overall
efficiency scorecard ineligible while preserving product-debugging value.
The joiner stamps `instrumentVersion: "social-messenger@0.3.6-m8"` and
`typingObservationBoundaryVersion: "v2"`;
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
