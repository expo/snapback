# R2 published-0.1.25 campaign synthesis

**Status:** Closed on 2026-08-25

**Campaign:** `2026-08-23-r2-published-0125`

**Product pins:** Snapback 0.1.25; `social-messenger@0.3.3-m8`

This synthesis applies the final rulings in the [run README](./README.md), the
pre-registered [scorecard](./scorecard-preregistration.md), and
[LLP 0295 §R2](../../../llp/0295-published-matrix-improvement-program.plan.md#r2-load-isolated-calibration-rerun).
The campaign attempted each of its twelve cells exactly once. Three cells have
validator-clean records and nine are consumed with hash-bound `BLOCKED`
reports. Product evidence is retained from every milestone that ran; efficiency
eligibility is not inferred for a consumed cell.

## Cell outcomes

“Suites green” below means both the milestone suite and its required
choreography were retained green. “Not reached” is not a product red: the
attempt ended in admission or instrument processing before an accepted
milestone verdict.

| Cell | Model | Condition | Milestones reached | Product outcome | Metering availability | Scorecard eligibility | Disposition | Root-cause class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sol-clique-explicit` | GPT-5.6 Sol, xhigh | Clique / Explicit / Expo Router web | M1–M3 green | All three suites and choreography green | Unavailable: corrupt retained Codex `token_count` event; no phase usage | No: orientation evidence and phase usage unavailable | [Record; metering failed closed](./cells/sol-clique-explicit/record.json) | instrument-defect |
| `sol-clique-familiar` | GPT-5.6 Sol, xhigh | Clique / Familiar / Expo Router web | M1–M3 green | All three suites and choreography green | Unavailable: corrupt retained Codex `token_count` event; no phase usage | No: load contamination, missing orientation/phase usage, and non-claimed M3 recovery episodes | [Recovered record; metering unavailable](./cells/sol-clique-familiar/record.json) | instrument-defect + contamination |
| `sol-coterie-explicit` | GPT-5.6 Sol, xhigh | Coterie / Explicit / Exact/Contract web | M1 started; no accepted green boundary | No accepted suite/choreography verdict | Not produced: observation driver crashed before finalization | No: no validator-clean record; load contamination also observed | [Consumed; retry/`binaryExcavation` crash](./BLOCKED-sol-coterie-explicit-driver-observation.md) | instrument-defect + contamination |
| `sol-coterie-familiar` | GPT-5.6 Sol, xhigh | Coterie / Familiar / Exact/Contract web | None; prompt not delivered | No product execution | Not produced: controller refused admission replay | No: no validator-clean record | [Consumed at admission seriality check](./BLOCKED-sol-coterie-familiar-admission-seriality-finalization.md) | contamination |
| `grok-clique-explicit` | Grok 4.6, xhigh | Clique / Explicit / Expo Router web | M1–M3 green | All three suites and choreography green | Unavailable by preregistration: advisory family has no approved native per-turn adapter | No: no validator-clean record and phase usage unavailable | [Consumed; suite-status rollover](./BLOCKED-grok-clique-explicit-suite-status-finalization.md) | instrument-defect |
| `grok-clique-familiar` | Grok 4.6, xhigh | Clique / Familiar / Expo Router web | M1–M3 green | All three suites and choreography green | Unavailable by preregistration: advisory family has no approved native per-turn adapter | No: no validator-clean record and phase usage unavailable | [Consumed; suite-status rollover](./BLOCKED-grok-clique-familiar-suite-status-finalization.md) | instrument-defect |
| `grok-coterie-explicit` | Grok 4.6, xhigh | Coterie / Explicit / Exact/Contract web | M1–M3 green | All three suites and choreography green | Unavailable by preregistration: advisory family has no approved native per-turn adapter | No: no validator-clean record and phase usage unavailable | [Consumed; suite-status rollover](./BLOCKED-grok-coterie-explicit-suite-status-finalization.md) | instrument-defect |
| `grok-coterie-familiar` | Grok 4.6, xhigh | Coterie / Familiar / Exact/Contract web | M1–M3 green | All three suites and choreography green | Unavailable by preregistration; no finalized aggregate | No: no validator-clean record and phase usage unavailable | [Consumed; telemetry-boundary/capsule refusal](./BLOCKED-grok-coterie-familiar-observation-window-finalization.md) | instrument-defect |
| `opus-clique-explicit` | Claude Opus 5, harness-default effort | Clique / Explicit / Expo Router web | M1–M3 green | All three suites and choreography green | Available: native per-milestone usage retained | No: API interruption and host-load contamination (17 distinct breach samples) | [Valid record; contaminated](./cells/opus-clique-explicit/record.json) | contamination |
| `opus-clique-familiar` | Claude Opus 5, harness-default effort | Clique / Familiar / Expo Router web | M1 started; no accepted green boundary | No accepted suite/choreography verdict | Not produced: observation driver crashed before finalization | No: no validator-clean record; load contamination also observed | [Consumed; retry/`binaryExcavation` crash](./BLOCKED-charlies-macbook-pro-2-opus-clique-familiar-driver-observation.md) | instrument-defect + contamination |
| `opus-coterie-explicit` | Claude Opus 5, harness-default effort | Coterie / Explicit / Exact/Contract web | M1 started; no accepted green boundary | No accepted suite/choreography verdict | Not produced: observation driver crashed before finalization | No: no validator-clean record; load contamination also observed | [Consumed; retry/`binaryExcavation` crash](./BLOCKED-charlies-macbook-pro-2-opus-coterie-explicit-driver-observation.md) | instrument-defect + contamination |
| `opus-coterie-familiar` | Claude Opus 5, harness-default effort | Coterie / Familiar / Exact/Contract web | M1–M3 green | All three suites and choreography green | Not available as a validated aggregate: finalization failed | No: no validator-clean record; host-load and raw API-interruption contamination also observed | [Consumed; terminal-boundary finalization](./BLOCKED-charlies-macbook-pro-2-opus-coterie-familiar-finalization.md) | instrument-defect + contamination |

No cell's disposition had model behavior as its primary root cause. That does
not assert that every model action was correct; it says the campaign-level
failure or ineligibility that determined each disposition was an instrument
defect, contamination, or both.

## Pre-registered efficiency scorecard

The final comparator ruling supersedes any temptation to compare these cells
directly with the incomplete 0.1.24 aggregates. Because the raw 0.1.24 event
streams could not be recovered, this campaign ran in the pre-registered
**D0.6-only pre-wave comparator posture**. It was therefore a candidate source
of an annotated baseline for R3, not an R2 before/after adjudication against
estimated 0.1.24 values.

The eligible population is **0 of 12 cells**. Each of the three records is
explicitly ineligible. The other nine attempts have no validator-clean record,
so eligibility cannot be assigned or inferred. Applying the pre-registration
exactly produces the following result:

| Pre-registered row | Result |
| --- | --- |
| Semantic correction actions: at least 40% lower median | **No eligible comparison.** |
| Harness-native output tokens: at least 20% lower median | **No eligible comparison.** |
| Load-qualified M1 wall: at least 30% lower median | **No eligible comparison.** |
| Five structural zero-count rows | **No eligible comparison.** |
| At most one choreography retry per failed assertion | **No eligible comparison.** |
| Orientation at or below 16 KiB plus selected detail | **No eligible comparison.** |
| One grouped migration advisory per repair class | **No eligible comparison.** |
| Like-for-like debug-artifact size/link-wall baseline | **No eligible comparison.** |

Accordingly, this campaign supplies no efficiency pass, fail, median,
direction-consistency result, profile comparison, or eligible D0.6 baseline.
The registered 40/20/30 targets remain unadjudicated. In particular, the
available Opus token counts and the ineligible Sol action counts are not
combined into a replacement metric.

## Instrument-defect ledger

The commit list below records fixes that landed during the campaign; it does
not imply that already-consumed cells were recovered or rerun.

| Failure mode | Campaign manifestation | Fix commit(s) | Next-campaign status |
| --- | --- | --- | --- |
| `binaryExcavation` on `retry` | A retried package-source inspection was emitted as action class `retry` while retaining `binaryExcavation: true`; the observation contract rejected it and the queued failure escaped ordinary finalization in three cells. | `b5a141698` (retry classification and queued-failure containment) | **Closed for new attempts.** The three R2 attempts remain consumed. |
| Corrupt Codex `token_count` | The retained Codex event reported zero input/output with a nonzero aggregate total, initially aborting `sol-clique-explicit` finalization. | `a4ad07029`, `7b828efca`, then final fail-closed posture in `5db41d203` | **Closed fail-closed.** Corrupt native usage is rejected and represented as unavailable, never repaired by inference. |
| Sidecar lane identity | Short cell IDs in suite/choreography observation sidecars disagreed with the fully qualified `laneRunId`, aborting Opus finalization. | `a4ad07029`, `7b828efca` | **Closed.** Identity is canonicalized before validation; the retained Opus Explicit attempt was finalized to a valid record. |
| Suite-status rollover | Later milestone runs overwrote M1/M2 aggregate status, contradicting their already hash-bound green receipts in three Grok cells. | `f489b8e28` | **Closed for new attempts.** Unchanged verdict plus identical refusal-time receipt identity may restore rollover; the admitted v5 attempts remained consumed because capsule identity could not migrate. |
| Admission prefix | The original contiguous-prefix rule rejected legitimate two-host out-of-order progress and consumed-cell reports as if later slots had to remain pristine. | `1cb5a230` | **Closed.** Admission now uses disposition-complete campaign state. The later `sol-coterie-familiar` refusal was a different contamination event: shared `main` advanced during its admission window. |
| v6 plan drift | After the suite-status migration appended a new instrument migration, plan validation incorrectly treated `instrumentMigrations.at(-1)` as the earlier recovery transition and refused the final Grok cell. | `4890eb485` | **Closed for plan validation.** The repaired plan can identify the governing transition without relying on array position. |
| Telemetry boundary | A post-terminal host-load sample was treated as post-terminal semantic work and blocked `grok-coterie-familiar` finalization. | `b86cd6e2d` | **Closed for pure harness telemetry.** Only registered `block-claim` and host-load samples may drain after the semantic terminal; post-terminal semantic actions still fail closed. |
| Capsule custody after leftover process | The no-launch finalizer first correctly refused a cell-owned Snapback process left alive; after exact-PID cleanup it still could not validate the retained attempt as the exact currently registered capsule across instrument migrations. The same exact-capsule mismatch prevented recovery of the earlier v5 Grok attempts. | No fix landed. `057ce5898` and `92f21bec4` retain the refusals; they are evidence commits, not fixes. | **Open.** R3 needs attempt-byte custody and finalization against the admitted capsule without rewriting provenance, plus verified process-tree teardown before finalization. |

## Product findings

This is retained product evidence, deliberately separate from the efficiency
scorecard and from any general capability claim.

- Eight of twelve attempts reached M1, M2, and M3 with both suite and
  choreography green. Across the 36 planned milestone cells, that is 24 green,
  12 not reached, and no accepted red verdict.
- Three attempts ended during M1 observation handling before an accepted green
  boundary; one was consumed before prompt delivery. Those four attempts say
  nothing negative about the application because the instrument prevented a
  product verdict.
- Every app/profile condition had at least one retained M1–M3-green execution:
  Clique Explicit in all three model families, Clique Familiar in Sol and
  Grok, Coterie Explicit in Grok, and Coterie Familiar in Grok and Opus.
- Therefore the bounded observation is that the pinned
  `social-messenger@0.3.3-m8` M1–M3 journeys were completed on Snapback 0.1.25
  in eight concrete attempts across both client stacks and both authoring
  profiles. The campaign does not establish a completion rate independent of
  the broken instrument, a profile winner, or an efficiency improvement.

## Limitations and R3 implications

The wave split Codex/Grok and Claude across two materially different hosts, so
wall results are not one-host measurements. Admission began under the same
10.00 ceiling, but load later contaminated multiple attempts—including two of
the three validator-clean records, with 17 distinct breach samples in the
otherwise valid Opus record—and API interruption contaminated that Opus cell.
Nine of twelve attempts (75%) were consumed without a validator-clean record.
The no-rerun ruling correctly preserved single-attempt provenance, but it also
meant fixes could not replace lost cells. If the author commissions R3, it must
first produce an eligible D0.6 comparator rather than treating these ineligible
attempts as one; freeze and real-event-test each native adapter/finalization
path before admission; keep each admitted capsule's exact bytes available
through finalization; isolate campaign state from a moving shared checkout;
verify process-tree teardown; and maintain load isolation throughout the cell,
not only at admission. The R3 go/no-go decision remains with the author.
