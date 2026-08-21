# Benchmark run protocol

Governing plan: LLP 0186 W1
(`llp/0186-agent-authoring-efficiency-program.plan.md`). This protocol
operationalizes the bakeoff practice of diaries 0058/0059 into rules a
repeatable instrument can hold every lane to. Sections marked **DRAFT**
or **OPEN** are not ratified. The instrumented 0065/0066/0068 runs
exercised the attribution rule, which remains draft through calibration;
the OPEN items belong to LLP 0186's open questions, not to this file.

## Run rules

1. **Cold context.** Each lane starts a fresh agent session with no
   memory of other lanes or prior runs of the same brief. Lanes of one
   comparison set must not inspect, reuse, or derive from each other's
   implementations (the independence rule both diaries operated under —
   0058: "I did not inspect, modify, or derive this build from that
   arm").
2. **No human steering.** After the brief is delivered, no human
   messages until the lane finishes or aborts. Clarifications are not
   answered; the brief must stand alone.
3. **Same brief, verbatim.** Every lane of a comparison set receives the
   identical brief file from `briefs/`, byte-for-byte. Brief edits
   create a new brief version and restart calibration for that brief.
4. **Same harness, same model, same effort** across all lanes of a
   comparison set, recorded in the run record (`harness.*`).
5. **Serial, same-machine execution.** Run every lane of a comparison
   set serially on the same machine and hand each lane the same explicit
   occupied-port note through the `{{PORT_EXCLUSIONS}}` prompt parameter.
6. **Published-surface fence.** Snapback lanes may use only published
   packages, their CLI/README surfaces, and the served guide — never a
   source checkout; source-checkout runs are diagnostic-only under
   [Environment pinning](#environment-pinning).
7. **One record per lane run**, validating against
   `schema/run-record.schema.json`, plus a free-form run diary. The
   diary is the qualitative instrument; the record is the quantitative
   one; neither substitutes for the other.

## Timing

The clock starts when the brief is delivered to the cold session and
stops at the last passing acceptance evidence. Orientation (docs/guide
reading) is **inside** the clock and recorded as a phase split —
diary 0058 excluded shared Snapback-heavy orientation and flagged that
as a bias in Snapback's favor; the instrument does not repeat that.
Phase splits (orientation / authoring / verification / diagnosis) are
recovered from the transcript where possible and recorded as null where
not. For LLP 0198 P0-protocol runs, phase attribution is required: all
four `wallClock.phases` and all four `tokens.phases` values must be
recorded rather than marked unavailable. Ordinary records may continue
to use null phase values, with the reason stated in the record.

## Token metering

Input and output tokens are recorded per lane with the accounting
channel named in `tokens.source`; tool invocations are recorded from the
same per-lane usage accounting. The 0065/0066/0068 runs metered tokens
through the orchestration harness, and 0065/0066 also retained tool-use
counts. Where no trustworthy per-lane meter exists, record nulls with an
explanation rather than reconstructing counts (diary 0058: reconstructing
from visible prose "would be fictional").

`tokens.phases` uses the same orientation / authoring / verification /
diagnosis boundaries as the wall clock. Its values are token counts,
not elapsed-time estimates.

Wall-clock comparisons across runs can be muddied by changing machine
load (diary 0066). Tokens are therefore the better cross-run metric,
while same-run wall ratios remain useful under the same-machine rule.

**OPEN (LLP 0186 OQ1):** which harness exposes trustworthy per-lane
usage (Claude Code session accounting, Codex surface, or a wrapping
proxy), and whether cross-model token comparison is ever fair or the
ratchet pins one model per benchmark epoch. Until resolved, token
figures are recorded but make no cross-model claims.

### Social-messenger harness-native amendment (2026-08-21)

For the social-messenger instrument, harness-native per-turn accounting is
the only cap-bearing token channel. Provider usage-window snapshots,
transcript keyword buckets, prose reconstruction, and other estimators are
not approved for cap enforcement or charging. The approved `tokens.source`
values are:

| Cap family / harness | Approved source | Token-cap posture |
| --- | --- | --- |
| Claude frontier, and a Claude-based mid-tier lane | `claude-code-session-usage` (globally de-duplicated per-message usage from the retained builder session tree) | Cap-bearing when the complete tree is retained |
| GPT frontier under Codex | `codex-rollout-token-count` (session-local deltas of every builder/descendant rollout's cumulative `token_count` records, then globally de-duplicated) | Cap-bearing when the complete tree is retained |
| Kimi advisory and Grok advisory | `null` | Per-milestone token fields are honest nulls; token caps are inapplicable and never enforced |

A scored-family lane that fails to retain its approved per-turn stream uses
the explicit `unavailable` adapter with a stable reason code. It records null
lane totals and milestone phases rather than substituting an estimator, and
all milestone token caps/charges are null; it cannot adjudicate a token-cap or
efficiency result. Lane-total final JSON may remain narrative diagnostic
evidence, but it is not a milestone meter.

**Delegation policy: aggregate.** Builder delegation is permitted because it
is part of retained benchmark practice. Every builder-descendant session is
inside the charged lane. Before metering, the driver stamps one lane manifest
that declares the rooted builder session tree (native session/agent identity,
parent, role, relative path, and SHA-256), choreography receipt run IDs and
hashes, terminal-boundary and first-edit artifact hashes, the lane wall-clock
origin, and a recorded clock-skew bound. Claude message IDs are de-duplicated
globally across the tree. Codex cumulative counters are differenced within
each rollout before the descendant rollouts are aggregated, with identities
de-duplicated globally. A missing/unbound descendant makes native metering
invalid; it never silently becomes zero.

Milestone boundary snapshots are prefix sums of native usage records ordered
by the time each turn completed. The driver records **every attempted
milestone's terminal boundary** in a lane-global monotonic sequence: first
green, token/wall cap, or abort. A turn completed at or before milestone `m`'s
terminal boundary belongs to `m`; a turn after it belongs to the next
attempted milestone. Each phase is the difference between consecutive
terminal-prefix snapshots in driver execution order, including failed and
final failed milestones. No failed milestone's tokens roll into its successor.
`firstGreenAt` is populated only for `green`; it is null for caps and aborts.
Green remains the later of separately stamped `suitePassAt` and
`choreoPassAt`; a green choreography `segment-summary.recordedAt` is the exact
combined terminal/`firstGreenAt`. Timestamp equality is inclusive. The driver
sequence determines ordering; the recorded skew bound audits timestamp
correlation, and a usage turn within a nonzero skew ambiguity window makes the
join fail closed.

Every native record preserves fresh input, output, cache-read, cache-write,
and reasoning/thinking counters where the harness exposes them. **The token
cap sums fresh input plus native output.** Cache reads and writes are recorded
but excluded. Reasoning is recorded as a subset of native output and is not
added again. A live watchdog requires a non-optional enforcement controller
and a wall-clock origin. It trips when that sum reaches or exceeds the
registered `(cap family, milestone)` token cap; the milestone becomes a
`capability-failure` and charges the token cap plus actual wall with
`capped-tokens`, per LLP 0201 D2. The controller must request termination and
return a timestamped evidence acknowledgement. The watchdog gates the next
model turn until that acknowledgement arrives and then refuses that turn; the
driver may proceed only by arming the next milestone after acknowledgement.
Any already-in-flight post-trip usage remains retained as overshoot evidence.
Turn identity is lane-global and cumulative across `arm()` calls, so rereading
a cumulative session log cannot recharge an earlier milestone.

The social-messenger extension also records an explicit first-product-edit
receipt: driver-stamped timestamp, exact orientation bytes, selected skills,
and the native token prefix at that instant. The driver measures the bytes and
skill selection directly; the metering tool does not infer them from prose or
shell-command heuristics.

Complete social-messenger records validate against
`schema/social-messenger/run-record.schema.json`, which composes the base and
extension schemas. It restricts `tokens.source` to the approved values and
mechanically requires advisory and unavailable records to carry null token
totals, phases, caps, and charges with no `capped-tokens` flag.

## Repetitions and variance

Agent runs are nondeterministic. A preregistered series with **N>=3 per
configuration** is ratchet-eligible and reports the median, range, and
every constituent value. Single runs remain recorded existence evidence,
never evidence of magnitude.

**No variance claim — and no ratchet breach report treating a delta as
real — is made from fewer than N>=8 repetitions per lane of the
configuration in question.** An ordering claim likewise requires N>=8
on that configuration unless its rung matrix row states a preregistered
variance-transfer rule. This floor carries the operational lesson LLP
0186 OQ2 cites ("measure N≥8 before blaming a commit", the Minisforum
telemetry lane) and governs attribution of a real regression to a commit
or release (`issues/closed/20260808-w1-benchmark-harness-formalization.md`).

**OPEN (LLP 0186 OQ2):** the actual calibration answer — how many
repetitions make the ratchet stable enough to gate a release without
being too expensive to run, the tolerance, and the cadence — is what the
calibration phase exists to determine. Single runs during calibration
are still recorded (a single run is evidence of existence — "this
defect occurred" — never of magnitude).

## Environment pinning

- **Snapback lane: published packages only.** Since the 0.1.9 promotion
  (2026-08-06, `issues/closed/20260803-first-npm-latest-promotion.md`),
  the Snapback lane installs `@expo/snapback-*` from npm `latest` like
  an external agent would — not the source checkout the 0058/0059 runs
  used. Exact versions land in `harness.environment`. A run against a
  source checkout is a diagnostic run, labeled as such, and never a
  baseline.
- Competitor lanes pin their package versions the same way (diary 0058
  ran Convex 1.43.0; the record keeps that precision).
- OS, Node/Bun, and Expo SDK versions are recorded. Lanes of one
  comparison set run on the same machine class.
- Backend accounts/deployments are fresh per run where the platform
  allows; reused state is recorded.

## Correction-loop attribution rule (DRAFT)

This rule replaces the prior ~11 / ~4-heavy figures, which were
reconstructions from qualitative diary text rather than recorded counts
(LLP 0186, Measurable outcome 3).

**Status, 2026-08-08.** Diaries 0065/0066/0068 exercised this rule with
the `framework` / `self` / `tooling` shorthand mapped to the enum below
as specified in `records/schema.md`. It remains **DRAFT** until LLP 0186
OQ2's calibration phase confirms or revises it, and the ratchet reading
these attributions remains measurement-only.

**A correction loop** is counted each time the agent treats a step as
complete (or a tool reports success), contrary evidence arrives, and the
agent must revise work it had already produced. Ordinary first-pass
authoring, however long, is not a loop; a compile error fixed before any
done-claim is not a loop; three attempts against the same defect are one
loop with three iterations noted in the summary.

**Attribution, decided per loop with an evidence pointer:**

- `snapback-defect` — the platform under test caused the loop: a
  product defect, a doc/behavior mismatch, a type/runtime disagreement,
  or an error message that misdescribed its cause. (Named for the
  Snapback ratchet; every lane records its own platform's defects under
  this value.) Baseline examples from the diaries: the managed dev-loop
  multi-JSON abort, the optional-arg type/runtime disagreement, the
  anonymous-caller upload 403.
- `agent-error` — the agent's own authoring mistake against accurate
  documentation and accurate diagnostics. Baseline examples: diary
  0058's module-scope `PlatformColor` web export failure ("That was my
  mistake") and the `StartedLiveQueryHandle` misuse ("The type
  declarations were accurate").
- `environment` — harness, OS, network, or third-party tooling
  unrelated to the platform under test. Baseline example: 0058's
  browser-control runtime failing its own setup ("It is not counted as
  a Snapback defect").
- `ambiguous` — attribution genuinely contested after examining the
  evidence. Counts toward no lane's ratchet figure, but is reported;
  a run with many `ambiguous` loops is a signal the rule needs
  refinement, and the calibration phase should revise the draft.

Every `snapback-defect` loop also records `subAttribution`; no other
attribution may carry the field. `defect` means platform misbehavior.
`knowledge-gap` means missing or undiscoverable knowledge caused the
loop.

Tie-break: if accurate documentation existed but was undiscoverable at
the point of need (the shipped-but-undiscovered class of LLP 0186's
evidence section), the loop is `snapback-defect` — discoverability is
part of the product under test — with the guide/retrieval-eval pointer
as evidence.

## Publication

Per the README's publication gate (LLP 0186 W1): no public comparative
numbers until the Snapback lane, from published packages, is not losing
on self-inflicted plumbing. **OPEN (LLP 0186 OQ5):** the disclosure
standard for published results. Draft position: publish the harness and
model identifiers, brief files, this protocol, fairness rules, raw run
records, and raw diaries alongside any headline number — but what makes
that credible rather than vendor-benchmark noise is OQ5's to resolve.
